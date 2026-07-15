<?php

class Archive {
    const NULL_BYTE = "\0";

    private static int $SEGMENT_SIZE = 65536;
    private static string $TAR_PASSTHRU_CMD = 'cd [ROOTDIR] && tar --no-recursion -c -- [DIRS] [FILES]';
    private static string $ZIP_PASSTHRU_CMD = 'cd [ROOTDIR] && zip - -- [FILES]';

    private string $base_path;
    private array $dirs = [];
    private array $files = [];
    private int $total_bytes = 0;
    private bool $limit_exceeded = false;

    public function __construct(private readonly Context $context) {}

    public function output(string $type, string $base_href, string|array $hrefs): bool {
        $this->base_path = $this->context->to_path($base_href);
        if (!$this->context->is_managed_path($this->base_path)) {
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
            $this->add_dir($this->base_path, $type === 'php-tar' ? '/' : '.');
        }
        if ($this->limit_exceeded) {
            return false;
        }

        return match ($type) {
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
        $total_size = 512 * count($dirs) + 1024;
        foreach (array_keys($files) as $real_file) {
            $size = filesize($real_file);
            $filesizes[$real_file] = $size;
            $total_size += 512 + $size;
            if ($size % 512 !== 0) {
                $total_size += 512 - ($size % 512);
            }
        }

        header('Content-Length: ' . $total_size);

        foreach ($dirs as $real_dir => $archived_dir) {
            echo $this->php_tar_header($archived_dir, 0, @filemtime($real_dir . DIRECTORY_SEPARATOR . '.'), 5);
        }

        foreach ($files as $real_file => $archived_file) {
            if (connection_aborted()) {
                return false;
            }
            $size = $filesizes[$real_file];

            echo $this->php_tar_header($archived_file, $size, @filemtime($real_file), 0);
            $this->print_file($real_file);

            if ($size % 512 !== 0) {
                echo str_repeat(self::NULL_BYTE, 512 - ($size % 512));
            }
        }

        echo str_repeat(self::NULL_BYTE, 1024);

        return true;
    }

    private function php_tar_header(string $filename, int $size, int|false $mtime, int $type): string {
        $name = substr(basename($filename), -99);
        $prefix = substr(Util::normalize_path(dirname($filename)), -154);
        if ($prefix === '.') {
            $prefix = '';
        }

        $header =
            str_pad($name, 100, self::NULL_BYTE)
            . '0000755' . self::NULL_BYTE
            . '0000000' . self::NULL_BYTE
            . '0000000' . self::NULL_BYTE
            . str_pad(decoct($size), 11, '0', STR_PAD_LEFT) . self::NULL_BYTE
            . str_pad(decoct($mtime), 11, '0', STR_PAD_LEFT) . self::NULL_BYTE
            . '        '
            . str_pad($type, 1)
            . str_repeat(self::NULL_BYTE, 100)
            . 'ustar' . self::NULL_BYTE
            . '00'
            . str_repeat(self::NULL_BYTE, 80)
            . str_pad($prefix, 155, self::NULL_BYTE)
            . str_repeat(self::NULL_BYTE, 12);
        assert(strlen($header) === 512);

        $checksum = array_sum(unpack('C*', $header));
        $checksum = str_pad(decoct($checksum), 6, '0', STR_PAD_LEFT) . self::NULL_BYTE . ' ';
        $header = substr_replace($header, $checksum, 148, 8);

        return $header;
    }

    private function print_file(string $file): void {
        if ($fd = fopen($file, 'rb')) {
            while (!feof($fd)) {
                if (connection_aborted()) {
                    break;
                }
                print fread($fd, self::$SEGMENT_SIZE);
                @ob_flush();
                @flush();
            }
            fclose($fd);
        }
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
        $real_path = realpath($real_dir) ?: $real_dir;
        if (in_array($real_path, $visited, true)) {
            return;
        }
        $visited[] = $real_path;

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
