<?php

enum CommentStyle {
    case Single;
    case Multi;
}

class Json {
    public static function load(string $path): array {
        if (!is_readable($path)) {
            return [];
        }

        $decoded = self::decode(file_get_contents($path));
        if ($decoded === null) {
            // Malformed JSON must degrade to defaults, not fatal the whole
            // app with a TypeError.
            Util::log('failed to parse JSON, falling back to defaults: ' . $path);
            return [];
        }
        return $decoded;
    }

    public static function save(string $path, mixed $obj): bool {
        // LOCK_EX prevents concurrent requests from interleaving writes and
        // leaving a torn file behind (e.g. cache/cmds.json).
        return file_put_contents($path, json_encode($obj), LOCK_EX) !== false;
    }

    private static function decode(string $json): ?array {
        $decoded = json_decode(self::strip($json), true);
        return is_array($decoded) ? $decoded : null;
    }

    private static function strip(string $commented_json): string {
        $insideString = false;
        $insideComment = null;
        $parts = [];
        $len = strlen($commented_json);

        for ($i = 0; $i < $len; $i++) {
            $char = $commented_json[$i];
            $next = $commented_json[$i + 1] ?? '';

            if ($insideComment === null && $char === '"' && ($i === 0 || $commented_json[$i - 1] !== '\\')) {
                $insideString = !$insideString;
            }

            if ($insideString) {
                $parts[] = $char;
            } elseif ($insideComment === null) {
                if ($char === '/' && $next === '/') {
                    $insideComment = CommentStyle::Single;
                    $i++;
                } elseif ($char === '/' && $next === '*') {
                    $insideComment = CommentStyle::Multi;
                    $i++;
                } else {
                    $parts[] = $char;
                }
            } elseif ($insideComment === CommentStyle::Single) {
                if ($char === "\r" && $next === "\n") {
                    $insideComment = null;
                    $parts[] = "\r\n";
                    $i++;
                } elseif ($char === "\n") {
                    $insideComment = null;
                    $parts[] = "\n";
                }
            } elseif ($insideComment === CommentStyle::Multi && $char === '*' && $next === '/') {
                $insideComment = null;
                $i++;
            }
        }

        return implode('', $parts);
    }
}
