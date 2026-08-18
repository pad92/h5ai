<?php

class Util {
    const ERR_MISSING_PARAM = 'ERR_MISSING_PARAM';
    const ERR_ILLIGAL_PARAM = 'ERR_ILLIGAL_PARAM';
    const ERR_FAILED = 'ERR_FAILED';
    const ERR_DISABLED = 'ERR_DISABLED';
    const ERR_UNSUPPORTED = 'ERR_UNSUPPORTED';
    const NO_DEFAULT = 'NO_*@+#?!_DEFAULT';
    const RE_DELIMITER = '@';

    public static function normalize_path(string $path, bool $trailing_slash = false): string {
        $path = preg_replace('#[\\\\/]+#', '/', $path);
        return preg_match('#^(\w:)?/$#', $path) ? $path : (rtrim($path, '/') . ($trailing_slash ? '/' : ''));
    }

    public static function json_exit(array $obj = []): never {
        header('Content-type: application/json;charset=utf-8');
        echo json_encode($obj);
        exit;
    }

    public static function json_fail(string $err, string $msg = '', bool $cond = true): void {
        if ($cond) {
            Util::json_exit(['err' => $err, 'msg' => $msg]);
        }
    }

    public static function array_query(array $array, string $keypath = '', mixed $default = Util::NO_DEFAULT): mixed {
        $value = $array;

        $keys = array_filter(explode('.', $keypath));
        foreach ($keys as $key) {
            if (!is_array($value) || !array_key_exists($key, $value)) {
                return $default;
            }
            $value = $value[$key];
        }

        return $value;
    }

    public static function wrap_pattern(string $pattern): string {
        return Util::RE_DELIMITER . str_replace(Util::RE_DELIMITER, '\\' . Util::RE_DELIMITER, $pattern) . Util::RE_DELIMITER;
    }

    // Shared non-blocking pipe pump for passthru_cmd/proc_open_cmdv. Feeds
    // stdout chunks to $on_stdout, caps captured stderr at 8 KiB, enforces
    // the timeout and asks $should_abort (total pumped bytes) for an early
    // abort reason. Returns [?int exit_code, string error, ?string abort]
    // where a non-null abort means the process was terminated.
    private static function pump_pipes(mixed $process, array $pipes, callable $on_stdout, int $timeout, callable $should_abort): array {
        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);
        $started_at = microtime(true);
        $exit_code = null;
        $error = '';
        $total_bytes = 0;

        while (true) {
            $status = proc_get_status($process);
            if (!$status['running'] && $status['exitcode'] >= 0) {
                $exit_code = $status['exitcode'];
            }
            $read = array_values(array_filter(
                [$pipes[1], $pipes[2]],
                static fn($pipe): bool => !feof($pipe),
            ));
            if ($read !== []) {
                $write = null;
                $except = null;
                if (@stream_select($read, $write, $except, 0, 200000) === false) {
                    usleep(10000);
                    continue;
                }
                foreach ($read as $pipe) {
                    $chunk = fread($pipe, 65536);
                    if ($chunk === false || $chunk === '') {
                        continue;
                    }
                    $total_bytes += strlen($chunk);
                    if ($pipe === $pipes[1]) {
                        $on_stdout($chunk);
                    } elseif (strlen($error) < 8192) {
                        $error .= substr($chunk, 0, 8192 - strlen($error));
                    }
                }
            } else {
                usleep(10000);
            }
            $abort = $should_abort($total_bytes);
            if ($abort === null && (microtime(true) - $started_at) > max(1, $timeout)) {
                $abort = 'timeout';
            }
            if ($abort !== null) {
                proc_terminate($process);
                usleep(100000);
                if (proc_get_status($process)['running']) {
                    proc_terminate($process, 9);
                }
                return [$exit_code, $error, $abort];
            }
            if (!$status['running'] && feof($pipes[1]) && feof($pipes[2])) {
                return [$exit_code, $error, null];
            }
        }
    }

    public static function passthru_cmd(string $cmd, int $timeout = 300): int {
        $process = proc_open($cmd, [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ], $pipes);
        if (!is_resource($process)) {
            return -1;
        }

        [$exit_code, $error, $abort] = self::pump_pipes(
            $process,
            $pipes,
            static function (string $chunk): void {
                echo $chunk;
                @flush();
            },
            $timeout,
            static fn(int $total_bytes): ?string => connection_aborted() ? 'aborted' : null,
        );

        fclose($pipes[1]);
        fclose($pipes[2]);
        $close_code = proc_close($process);
        if ($error !== '') {
            self::log('archive command: ' . trim($error));
        }
        return $abort !== null ? 124 : ($exit_code ?? $close_code);
    }

    public static function exec_0(string $cmd): bool {
        $lines = [];
        $rc = null;
        try {
            @exec($cmd, $lines, $rc);
            return $rc === 0;
        } catch (\Exception) {}
        return false;
    }

    public static function proc_open_cmdv(array $cmdv, mixed &$output, mixed &$error, int $timeout = 30): int {
        $descriptorspec = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $process = proc_open($cmdv, $descriptorspec, $pipes);

        if (is_resource($process)) {
            $output_is_stream = is_resource($output);
            if (!$output_is_stream) {
                $output = '';
            }
            $max_output_bytes = 64 * 1024 * 1024;

            [$exit_code, $error, $abort] = self::pump_pipes(
                $process,
                $pipes,
                static function (string $chunk) use (&$output, $output_is_stream): void {
                    if ($output_is_stream) {
                        fwrite($output, $chunk);
                    } else {
                        $output .= $chunk;
                    }
                },
                $timeout,
                static fn(int $total_bytes): ?string => $total_bytes > $max_output_bytes ? 'output-limit' : null,
            );
            if ($abort !== null) {
                $error .= $abort === 'output-limit'
                    ? "\nprocess output exceeded 64 MiB"
                    : "\nprocess timed out";
            }

            // Keep the pipes non-blocking: a killed process or one of its
            // descendants may briefly retain a write descriptor.
            $remaining_output = stream_get_contents($pipes[1]);
            if ($remaining_output !== false) {
                if ($output_is_stream) {
                    fwrite($output, $remaining_output);
                } else {
                    $output .= $remaining_output;
                }
            }
            $remaining_error = stream_get_contents($pipes[2]);
            if ($remaining_error !== false) {
                $error .= substr($remaining_error, 0, max(0, 8192 - strlen($error)));
            }
            fclose($pipes[1]);
            fclose($pipes[2]);
            $close_code = proc_close($process);
            return $abort !== null ? 124 : ($exit_code ?? $close_code);
        }
        return -1;
    }

    // Fire-and-forget launch of a low-priority PHP worker script. Returns
    // whether the shell accepted the job; the caller rolls back its
    // marker/lock file when it did not.
    public static function launch_background(string $script_path, array $args = []): bool {
        $cmd = 'nice -n 19 php ' . escapeshellarg($script_path);
        foreach ($args as $arg) {
            $cmd .= ' ' . escapeshellarg($arg);
        }
        $cmd .= ' > /dev/null 2>&1 &';
        $rc = null;
        return @exec($cmd, $unused, $rc) !== false && $rc === 0;
    }

    public static function filesize(Context $context, string $path): ?int {
        [$withFoldersize, $withDu, $timeout] = $context->foldersize_mode();
        return Filesize::getCachedSize($path, $withFoldersize, $withDu, $timeout);
    }

    public static function get_mimetype(string $source_path): string {
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        return $finfo->file($source_path) ?: 'application/octet-stream';
    }

    // Diagnostics go to the PHP/web-server error log only: h5ai must not
    // create any log file of its own.
    public static function log(string $log_msg): void {
        // Strip CR/LF to prevent log injection / forged entries from user-influenced paths.
        @error_log('h5ai: ' . str_replace(["\r", "\n"], ' ', $log_msg));
    }
}
