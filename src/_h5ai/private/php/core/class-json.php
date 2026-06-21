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

        return self::decode(file_get_contents($path));
    }

    public static function save(string $path, mixed $obj): bool {
        return file_put_contents($path, json_encode($obj)) !== false;
    }

    private static function decode(string $json): array {
        return json_decode(self::strip($json), true);
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
