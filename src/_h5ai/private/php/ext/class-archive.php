<?php

class Archive {
    const NULL_BYTE = "\0";

    private static int $SEGMENT_SIZE = 65536;
    private static string $TAR_PASSTHRU_CMD = 'cd [ROOTDIR] && tar --no-recursion -c -- [DIRS] [FILES]';
    private static string $ZIP_PASSTHRU_CMD = 'cd [ROOTDIR] && zip - -- [FILES]';

    private const TYPES = ['php-tar', 'shell-tar', 'shell-zip'];

    private string $base_path;
    private string $type = '';
    private array $dirs = [];
    private array $files = [];
    private int $total_bytes = 0;
    private bool $limit_exceeded = false;

    public function __construct(private readonly Context $context) {}

    // Collects the selection without writing anything, so the caller can
    // still answer with an error. False for an unknown type, an unmanaged
    // base folder, an empty selection or one over the download limits.
    public function prepare(string $type, string $base_href, string|array $hrefs): bool {
        $this->type = $type;
        $this->base_path = $this->context->to_path($base_href);
        if (!in_array($type, self::TYPES, true) || !$this->context->is_managed_path($this->base_path)) {
            return false;
        }

        $this->dirs = [];
        $this->files = [];
        $this->total_bytes = 0;
        $this->limit_exceeded = false;

        $has_requested_hrefs = is_array($hrefs)
            ? array_any($hrefs, static fn(string $href): bool => trim($href) !== '')
            : trim($hrefs) !== '';
        $this->add_hrefs($hrefs);
        if ($this->limit_exceeded) {
            return false;
        }

        if (count($this->dirs) === 0 && count($this->files) === 0 && !$has_requested_hrefs) {
            $this->add_dir($this->base_path, '.');
        }
        if ($this->limit_exceeded) {
            return false;
        }
        return count($this->dirs) > 0 || count($this->files) > 0;
    }

    // Writes the prepared archive. False when it could not be completed;
    // output may already have started, see headers_sent().
    public function stream(): bool {
        return match ($this->type) {
            'php-tar' => $this->php_tar($this->dirs, $this->files),
            'shell-tar' => $this->shell_cmd(self::$TAR_PASSTHRU_CMD),
            'shell-zip' => $this->shell_cmd(self::$ZIP_PASSTHRU_CMD),
            default => false,
        };
    }

    private function shell_cmd(string $cmd): bool {
        $cmd = str_replace(
            ['[ROOTDIR]', '[DIRS]', '[FILES]'],
            [
                escapeshellarg($this->base_path),
                $this->dirs ? implode(' ', array_map(escapeshellarg(...), $this->dirs)) : '',
                $this->files ? implode(' ', array_map(escapeshellarg(...), $this->files)) : '',
            ],
            $cmd,
        );
        try {
            $rc = Util::passthru_cmd(
                $cmd,
                max(1, (int) $this->context->query_option('download.timeout', 300)),
            );
            if ($rc !== 0) {
                return false;
            }
        } catch (\Exception) {
            return false;
        }
        return true;
    }

    private function php_tar(array $dirs, array $files): bool {
        $filesizes = [];
        $headers = [];
        $total_size = 1024;
        foreach ($dirs as $real_dir => $archived_dir) {
            $headers[$real_dir] = TarHeader::encode($archived_dir, 0, @filemtime($real_dir), '5');
            $total_size += strlen($headers[$real_dir]);
        }
        foreach ($files as $real_file => $archived_file) {
            $size = filesize($real_file);
            if ($size === false) {
                return false;
            }
            $filesizes[$real_file] = $size;
            $headers[$real_file] = TarHeader::encode($archived_file, $size, @filemtime($real_file), '0');
            $total_size += strlen($headers[$real_file]) + $size;
            if ($size % 512 !== 0) {
                $total_size += 512 - ($size % 512);
            }
        }

        header('Content-Length: ' . $total_size);

        foreach ($dirs as $real_dir => $archived_dir) {
            echo $headers[$real_dir];
        }

        foreach ($files as $real_file => $archived_file) {
            if (connection_aborted()) {
                return false;
            }
            $size = $filesizes[$real_file];

            echo $headers[$real_file];
            if (!$this->print_file($real_file, $size)) {
                return false;
            }

            if ($size % 512 !== 0) {
                echo str_repeat(self::NULL_BYTE, 512 - ($size % 512));
            }
        }

        echo str_repeat(self::NULL_BYTE, 1024);

        return true;
    }

    // Emits exactly $size bytes, the size already announced in the tar header
    // and in Content-Length. A file that shrank or became unreadable since is
    // padded with NUL bytes, and one that grew is cut, so the archive keeps
    // its structure. Returns false only when the client went away.
    private function print_file(string $file, int $size): bool {
        $remaining = $size;
        $fd = @fopen($file, 'rb');
        if ($fd === false) {
            Util::log('archive: cannot read ' . $file . ', padding its entry');
        } else {
            while ($remaining > 0 && !feof($fd)) {
                if (connection_aborted()) {
                    fclose($fd);
                    return false;
                }
                $chunk = fread($fd, min(self::$SEGMENT_SIZE, $remaining));
                if ($chunk === false) {
                    break;
                }
                $remaining -= strlen($chunk);
                echo $chunk;
                @ob_flush();
                @flush();
            }
            fclose($fd);
            if ($remaining > 0) {
                Util::log('archive: ' . $file . ' shrank while archiving, padding its entry');
            }
        }

        // Pad in segments so a large missing file never builds one huge string.
        while ($remaining > 0) {
            $pad = min(self::$SEGMENT_SIZE, $remaining);
            echo str_repeat(self::NULL_BYTE, $pad);
            $remaining -= $pad;
        }
        return true;
    }

    private function add_hrefs(string|array $hrefs): void {
        if (!is_array($hrefs)) {
            $hrefs = [$hrefs];
        }

        foreach ($hrefs as $href) {
            if (trim($href) === '') {
                continue;
            }

            $href = Util::normalize_path($href, false);
            $d = dirname($href);
            $n = basename($href);

            if ($this->context->is_managed_href($d) && !$this->context->is_hidden($n)) {
                $real_file = $this->context->to_path($href);
                $archived_file = preg_replace('!^' . preg_quote(Util::normalize_path($this->base_path, true)) . '!', '', $real_file);

                if (is_dir($real_file) && !is_link($real_file)) {
                    $this->add_dir($real_file, $archived_file);
                } elseif (!is_dir($real_file)) {
                    $this->add_file($real_file, $archived_file);
                }
            }
        }
    }

    private function add_file(string $real_file, string $archived_file): void {
        if (!$this->context->is_managed_file($real_file) || !is_readable($real_file)) {
            return;
        }
        if (isset($this->files[$real_file])) {
            return;
        }
        $size = @filesize($real_file);
        if ($size === false) {
            return;
        }
        $max_entries = max(1, (int) $this->context->query_option('download.maxEntries', 10000));
        $max_bytes = max(1, (int) $this->context->query_option('download.maxBytes', 10737418240));
        if ((count($this->dirs) + count($this->files) + 1) > $max_entries
            || ($this->total_bytes + $size) > $max_bytes) {
            $this->limit_exceeded = true;
            return;
        }
        $this->total_bytes += $size;
        $this->files[$real_file] = $archived_file;
    }

    private function add_dir(string $real_dir, string $archived_dir, array &$visited = []): void {
        // Keyed by real path: a lookup per folder must not scan every folder seen.
        $real_path = realpath($real_dir) ?: $real_dir;
        if (isset($visited[$real_path])) {
            return;
        }
        $visited[$real_path] = true;

        if (!$this->context->is_managed_path($real_dir)) {
            return;
        }
        if (isset($this->dirs[$real_dir])) {
            return;
        }

        $max_entries = max(1, (int) $this->context->query_option('download.maxEntries', 10000));
        if ((count($this->dirs) + count($this->files) + 1) > $max_entries) {
            $this->limit_exceeded = true;
            return;
        }

        $this->dirs[$real_dir] = $archived_dir;

        foreach ($this->context->read_dir($real_dir) as $file) {
            if ($this->limit_exceeded || connection_aborted()) {
                return;
            }
            $real_file = $real_dir . '/' . $file;
            $archived_file = $archived_dir . '/' . $file;

            if (is_dir($real_file) && !is_link($real_file)) {
                $this->add_dir($real_file, $archived_file, $visited);
            } elseif (!is_dir($real_file)) {
                $this->add_file($real_file, $archived_file);
            }
        }
    }
}
