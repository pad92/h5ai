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

    public static function passthru_cmd(string $cmd): int {
        $rc = null;
        passthru($cmd, $rc);
        return $rc;
    }

    public static function exec_cmdv(array $cmdv, bool $capture = false, bool $redirect = false): array|string|false {
        $cmd = implode(' ', array_map(escapeshellarg(...), $cmdv));

        if ($redirect) {
            $cmd .= ' 2>&1';
        }

        if ($capture) {
            $lines = [];
            $rc = null;
            exec($cmd, $lines, $rc);
            return [$lines, $rc];
        }
        return exec($cmd);
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

    public static function proc_open_cmdv(array $cmdv, mixed &$output, mixed &$error): int {
        $cmd = implode(' ', array_map(escapeshellarg(...), $cmdv));

        $descriptorspec = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $process = proc_open($cmd, $descriptorspec, $pipes);

        if (is_resource($process)) {
            fclose($pipes[0]);

            if (is_resource($output)) {
                stream_copy_to_stream($pipes[1], $output);
            } else {
                $output = stream_get_contents($pipes[1]);
            }
            fclose($pipes[1]);

            $error = stream_get_contents($pipes[2]);
            fclose($pipes[2]);

            return proc_close($process);
        }
        return -1;
    }

    public static function filesize(Context $context, string $path): ?int {
        $withFoldersize = $context->query_option('foldersize.enabled', false);
        $withDu = $context->get_setup()->get('HAS_CMD_DU') && $context->query_option('foldersize.type', null) === 'shell-du';
        return Filesize::getCachedSize($path, $withFoldersize, $withDu);
    }

    public static function get_mimetype(string $source_path): string {
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        return $finfo->file($source_path) ?: 'application/octet-stream';
    }

    public static function log(string $log_msg, string $filename = __DIR__ . '/../../cache/debug.log'): void {
        // Strip CR/LF to prevent log injection / forged entries from user-influenced paths.
        $log_msg = str_replace(["\r", "\n"], ' ', $log_msg);
        file_put_contents($filename, date('Y-m-d H:i:s') . ' ' . $log_msg . PHP_EOL, FILE_APPEND);
    }
}
