<?php

class Search {
    private const INDEX_FILE = 'search-index.json';
    private const INDEX_VERSION = 2;

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

        $index = $this->read_index();
        if ($index === null) {
            $index = $this->build_index();
            $this->write_index($index);
        }

        $max_depth = max(0, (int) $this->context->query_option('search.maxDepth', 64));
        $max_results = max(1, (int) $this->context->query_option('search.maxResults', 1000));
        $root = Util::normalize_path($root);
        $root_prefix = $root === '/' ? '/' : $root . '/';
        $root_real = realpath($root) ?: $root;
        if (isset($visited[$root_real])) {
            return [];
        }
        $initial_visited = $visited;
        $blocked_dirs = [];
        $paths = [];
        foreach ($index['paths'] as $path) {
            if (!str_starts_with($path, $root_prefix)) {
                continue;
            }
            $relative = substr($path, strlen($root_prefix));
            $depth = substr_count($relative, '/');
            if ($depth > $max_depth) {
                continue;
            }
            $parent = dirname($path);
            $skip = false;
            while (str_starts_with($parent, $root)) {
                $parent_real = realpath($parent) ?: $parent;
                if (isset($initial_visited[$parent_real]) || isset($blocked_dirs[$parent_real])) {
                    $skip = true;
                    break;
                }
                if ($parent === $root) {
                    break;
                }
                $parent = dirname($parent);
            }
            if ($skip) {
                continue;
            }
            $matches = @preg_match($re, basename($path)) === 1;
            $is_directory = @is_dir($path);
            $is_visible = !$matches || !$this->context->query_option('view.hideIf403', false)
                || $this->is_readable_from($path, $root);
            if ($matches && $is_visible && (($is_directory && $this->context->paths()->is_managed_path($path))
                || (!$is_directory && $this->context->paths()->is_managed_file($path)))) {
                $paths[] = $path;
                if (count($paths) >= $max_results) {
                    break;
                }
            }
            if ($is_directory) {
                $real_path = realpath($path) ?: $path;
                if (isset($initial_visited[$real_path])) {
                    $blocked_dirs[$real_path] = true;
                } elseif ($depth + 1 <= $max_depth) {
                    $visited[$real_path] = true;
                }
            }
        }
        return $paths;
    }

    // The cache warmer passes the paths it already walked, avoiding a second
    // scan of the share.
    public function store_index(array $dirs, array $paths): void {
        $this->write_index([
            'version' => self::INDEX_VERSION,
            'config' => $this->index_config_hash(),
            'dirs' => $dirs,
            'paths' => $paths,
        ]);
    }

    private function build_index(): array {
        $root = $this->context->get_setup()->get('ROOT_PATH');
        $dirs = [];
        $paths = [];
        $max_depth = max(0, (int) $this->context->query_option('search.maxDepth', 64));
        $walk = function (string $folder, int $depth) use (&$walk, &$dirs, &$paths, $max_depth): void {
            if ($depth > $max_depth) {
                return;
            }
            if (!$this->context->paths()->is_managed_path($folder)) {
                return;
            }
            $state = self::directory_state($folder);
            if ($state === null) {
                return;
            }
            $dirs[$folder] = $state;
            foreach ($this->context->paths()->read_dir($folder, true) as $name) {
                $path = $folder . '/' . $name;
                if (is_dir($path)) {
                    $paths[] = $path;
                    $child_state = self::directory_state($path);
                    if ($child_state !== null && !is_link($path)) {
                        $dirs[$path] = $child_state;
                    }
                    if (!is_link($path)) {
                        if (is_readable($path)) {
                            $walk($path, $depth + 1);
                        }
                    }
                } elseif ($this->context->paths()->is_managed_file($path)) {
                    $paths[] = $path;
                }
            }
        };
        $walk($root, 0);
        return ['version' => self::INDEX_VERSION, 'config' => $this->index_config_hash(), 'dirs' => $dirs, 'paths' => $paths];
    }

    private function read_index(): ?array {
        $file = $this->index_path();
        $data = json_decode((string) @file_get_contents($file), true);
        if (!is_array($data) || ($data['version'] ?? null) !== self::INDEX_VERSION
            || ($data['config'] ?? null) !== $this->index_config_hash()
            || !is_array($data['dirs'] ?? null) || !is_array($data['paths'] ?? null)
            || array_any($data['paths'], static fn(mixed $path): bool => !is_string($path))) {
            return null;
        }
        foreach ($data['dirs'] as $path => $mtime) {
            clearstatcache(true, (string) $path);
            if (!is_string($path) || !is_array($mtime) || !is_dir($path) || is_link($path)
                || self::directory_state($path) !== $mtime) {
                return null;
            }
        }
        return $data;
    }

    private function write_index(array $data): void {
        $file = $this->index_path();
        $tmp = $file . '.' . bin2hex(random_bytes(6)) . '.tmp';
        $json = json_encode($data);
        if ($json === false || @file_put_contents($tmp, $json, LOCK_EX) === false || !@rename($tmp, $file)) {
            @unlink($tmp);
        }
    }

    public static function stats(string $path): array {
        $size = @filesize($path);
        $data = $size === false ? null : json_decode((string) @file_get_contents($path), true);
        $updated = $size === false ? false : @filemtime($path);
        return [
            'bytes' => $size === false ? 0 : $size,
            'entries' => is_array($data['paths'] ?? null) ? count($data['paths']) : 0,
            'directories' => is_array($data['dirs'] ?? null) ? count($data['dirs']) : 0,
            'updated' => $updated === false || $updated === 0 ? null : $updated,
        ];
    }

    public static function directory_state(string $path): ?array {
        clearstatcache(true, $path);
        $mtime = @filemtime($path);
        $ctime = @filectime($path);
        $permissions = @fileperms($path);
        if ($mtime === false || $ctime === false || $permissions === false) {
            return null;
        }
        return ['mtime' => $mtime, 'ctime' => $ctime, 'permissions' => $permissions & 0777];
    }

    private function is_readable_from(string $path, string $root): bool {
        $current = $path;
        while (true) {
            if (!is_readable($current)) {
                return false;
            }
            if ($current === $root) {
                return true;
            }
            $parent = dirname($current);
            if ($parent === $current || !str_starts_with($parent, $root)) {
                return false;
            }
            $current = $parent;
        }
    }

    private function index_path(): string {
        return $this->context->get_setup()->get('CACHE_PRV_PATH') . '/' . self::INDEX_FILE;
    }

    private function index_config_hash(): string {
        return hash('sha256', json_encode([
            $this->context->get_setup()->get('ROOT_PATH'),
            $this->context->query_option('view.hidden', []),
            $this->context->query_option('view.unmanaged', []),
            $this->context->query_option('view.hideIf403', false),
            $this->context->query_option('search.maxDepth', 64),
        ]));
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
