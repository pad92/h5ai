<?php

class Search {
    public function __construct(private readonly Context $context) {}

    public function get_paths(string $root, ?string $pattern = null, bool $ignorecase = false, array &$visited = []): array {
        $paths = [];
        $real_root = realpath($root) ?: $root;
        if (in_array($real_root, $visited, true)) {
            return [];
        }
        $visited[] = $real_root;

        if (!$pattern || !$this->context->is_managed_path($root)) {
            return [];
        }

        $re = Util::wrap_pattern($pattern);
        if ($ignorecase) {
            $re .= 'i';
        }
        if (@preg_match($re, '') === false) {
            return [];
        }
        foreach ($this->context->read_dir($root) as $name) {
            $path = $root . '/' . $name;
            if (@preg_match($re, basename($path))) {
                $paths[] = $path;
            }
            if (@is_dir($path) && !@is_link($path)) {
                $paths = [...$paths, ...$this->get_paths($path, $pattern, $ignorecase, $visited)];
            }
        }

        return $paths;
    }

    public function get_items(string $href, ?string $pattern = null, bool $ignorecase = false): array {
        $cache = [];
        $root = $this->context->to_path($href);
        return array_map(
            fn(string $path): array => Item::get($this->context, $path, $cache)->to_json_object(),
            $this->get_paths($root, $pattern, $ignorecase),
        );
    }
}
