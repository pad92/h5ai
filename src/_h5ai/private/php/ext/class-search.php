<?php

class Search {
    public function __construct(private readonly Context $context) {}

    public function get_paths(
        string $root,
        ?string $pattern = null,
        bool $ignorecase = false,
        array &$visited = [],
        int $depth = 0,
        array &$paths = [],
    ): array {
        $max_results = max(1, (int) $this->context->query_option('search.maxResults', 1000));
        $max_depth = max(0, (int) $this->context->query_option('search.maxDepth', 64));
        if ($depth > $max_depth || count($paths) >= $max_results) {
            return $paths;
        }
        $real_root = realpath($root) ?: $root;
        if (in_array($real_root, $visited, true)) {
            return [];
        }
        $visited[] = $real_root;

        $max_pattern_length = max(1, (int) $this->context->query_option('search.maxPatternLength', 256));
        if (!$pattern || strlen($pattern) > $max_pattern_length || !$this->context->is_managed_path($root)) {
            return [];
        }

        $re = Util::wrap_pattern('(*LIMIT_MATCH=100000)(*LIMIT_DEPTH=1000)' . $pattern);
        if ($ignorecase) {
            $re .= 'i';
        }
        if (@preg_match($re, '') === false) {
            return [];
        }
        foreach ($this->context->read_dir($root) as $name) {
            if (count($paths) >= $max_results) {
                break;
            }
            $path = $root . '/' . $name;
            $is_directory = @is_dir($path);
            if (@preg_match($re, basename($path))
                && ($is_directory || $this->context->is_managed_file($path))) {
                $paths[] = $path;
            }
            if ($is_directory && !@is_link($path)) {
                $this->get_paths($path, $pattern, $ignorecase, $visited, $depth + 1, $paths);
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
