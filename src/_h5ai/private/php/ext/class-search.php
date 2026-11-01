<?php

class Search {
    public function __construct(private readonly Context $context) {}

    // Paths below $root whose name matches the regular expression $pattern:
    // at most search.maxResults of them, search.maxDepth levels deep. An
    // empty, oversized or invalid pattern, or an unmanaged root, yields [].
    // $visited (real path => true) skips folders already walked.
    public function get_paths(string $root, ?string $pattern = null, bool $ignorecase = false, array &$visited = []): array {
        $max_pattern_length = max(1, (int) $this->context->query_option('search.maxPatternLength', 256));
        if (!$pattern || strlen($pattern) > $max_pattern_length) {
            return [];
        }
        $re = Util::wrap_pattern('(*LIMIT_MATCH=100000)(*LIMIT_DEPTH=1000)' . $pattern) . ($ignorecase ? 'i' : '');
        if (@preg_match($re, '') === false) {
            return [];
        }

        $paths = [];
        $this->walk(
            $root,
            $re,
            0,
            max(0, (int) $this->context->query_option('search.maxDepth', 64)),
            max(1, (int) $this->context->query_option('search.maxResults', 1000)),
            $visited,
            $paths,
        );
        return $paths;
    }

    private function walk(string $folder, string $re, int $depth, int $max_depth, int $max_results, array &$visited, array &$paths): void {
        if ($depth > $max_depth || count($paths) >= $max_results) {
            return;
        }
        $real_folder = realpath($folder) ?: $folder;
        if (isset($visited[$real_folder])) {
            return;
        }
        $visited[$real_folder] = true;
        if (!$this->context->paths()->is_managed_path($folder)) {
            return;
        }

        foreach ($this->context->paths()->read_dir($folder) as $name) {
            if (count($paths) >= $max_results) {
                return;
            }
            $path = $folder . '/' . $name;
            $is_directory = @is_dir($path);
            if (@preg_match($re, $name) && ($is_directory || $this->context->paths()->is_managed_file($path))) {
                $paths[] = $path;
            }
            if ($is_directory && !@is_link($path)) {
                $this->walk($path, $re, $depth + 1, $max_depth, $max_results, $visited, $paths);
            }
        }
    }

    public function get_items(string $href, ?string $pattern = null, bool $ignorecase = false): array {
        $root = $this->context->paths()->to_path($href);
        return $this->context->with_cached_folder_sizes(function () use ($root, $pattern, $ignorecase): array {
            $cache = [];
            return array_map(
                fn(string $path): array => Item::get($this->context, $path, $cache)->to_json_object(),
                $this->get_paths($root, $pattern, $ignorecase),
            );
        });
    }
}
