<?php

// Resolves file types from conf/types.json, by file name (glob) or by MIME
// type. The first matching type in file order wins and 'file' means unknown,
// as in the browser's core/types.js.
class TypeMatcher {
    public const UNKNOWN = 'file';

    private array $name_patterns = [];
    private array $mime_fragments = [];

    public function __construct(array $types) {
        foreach ($types as $type => $definition) {
            if (!is_array($definition)) {
                continue;
            }
            $globs = array_filter((array) ($definition['glob'] ?? []), is_string(...));
            if ($globs !== []) {
                $alternatives = array_map(
                    static fn(string $glob): string => '(' . str_replace('\*', '.*', preg_quote($glob, '/')) . ')',
                    $globs,
                );
                $this->name_patterns[$type] = '/^(' . implode('|', $alternatives) . ')$/i';
            }
            $fragments = array_filter((array) ($definition['mime'] ?? []), is_string(...));
            if ($fragments !== []) {
                $this->mime_fragments[$type] = $fragments;
            }
        }
    }

    public function type_of_name(string $name): string {
        return array_find_key(
            $this->name_patterns,
            static fn(string $pattern): bool => preg_match($pattern, $name) === 1,
        ) ?? self::UNKNOWN;
    }

    // A type matches when the MIME type contains one of its 'mime' entries.
    public function type_of_mime(string $mime): string {
        return array_find_key(
            $this->mime_fragments,
            static fn(array $fragments): bool => array_any(
                $fragments,
                static fn(string $fragment): bool => str_contains($mime, $fragment),
            ),
        ) ?? self::UNKNOWN;
    }
}
