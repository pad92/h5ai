<?php

// Encode ustar headers, extending fields with POSIX PAX records when necessary.
class TarHeader {
    private const MAX_OCTAL = 8589934591;

    public static function encode(string $path, int $size, int|false $mtime, string $type): string {
        $name = $path;
        $prefix = '';
        $extended = '';
        if (strlen($name) > 100) {
            $slash = strrpos($path, '/');
            if ($slash !== false && $slash <= 155 && strlen($path) - $slash - 1 <= 100) {
                $prefix = substr($path, 0, $slash);
                $name = substr($path, $slash + 1);
            } else {
                $extended .= self::record('path', $path);
                $name = 'PaxFile';
            }
        }
        $mtime = $mtime === false ? 0 : $mtime;
        if ($size > self::MAX_OCTAL) {
            $extended .= self::record('size', (string) $size);
            $size = 0;
        }
        if ($mtime < 0 || $mtime > self::MAX_OCTAL) {
            $extended .= self::record('mtime', (string) $mtime);
            $mtime = 0;
        }

        $headers = '';
        if ($extended !== '') {
            $headers = self::block('PaxHeader', '', strlen($extended), $mtime, 'x')
                . $extended . str_repeat("\0", (512 - strlen($extended) % 512) % 512);
        }
        return $headers . self::block($name, $prefix, $size, $mtime, $type);
    }

    private static function record(string $key, string $value): string {
        $payload = ' ' . $key . '=' . $value . "\n";
        $length = strlen($payload) + 1;
        // The record length includes its own decimal digits.
        while (($actual = strlen((string) $length) + strlen($payload)) !== $length) {
            $length = $actual;
        }
        return $length . $payload;
    }

    private static function block(string $name, string $prefix, int $size, int $mtime, string $type): string {
        $header = str_pad($name, 100, "\0")
            . "0000755\0" . "0000000\0" . "0000000\0"
            . str_pad(decoct($size), 11, '0', STR_PAD_LEFT) . "\0"
            . str_pad(decoct($mtime), 11, '0', STR_PAD_LEFT) . "\0"
            . '        ' . $type . str_repeat("\0", 100)
            . "ustar\0" . '00' . str_repeat("\0", 80)
            . str_pad($prefix, 155, "\0") . str_repeat("\0", 12);
        $checksum = str_pad(decoct(array_sum(unpack('C*', $header))), 6, '0', STR_PAD_LEFT) . "\0 ";
        return substr_replace($header, $checksum, 148, 8);
    }
}
