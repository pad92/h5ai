<?php

class Filesize {
    private static array $cache = [];
    private static ?array $persistent_cache = null;
    private static bool $persistent_cache_dirty = false;
    private static ?string $persistent_cache_path = null;
    private static bool $async_mode = false;
    private static array $stale_paths = [];

    private static function init_persistent_cache(): void {
        if (self::$persistent_cache !== null) {
            return;
        }
        self::$persistent_cache_path = __DIR__ . '/../../cache/foldersizes.json';
        if (file_exists(self::$persistent_cache_path)) {
            $content = @file_get_contents(self::$persistent_cache_path);
            $decoded = json_decode($content, true);
            self::$persistent_cache = is_array($decoded) ? $decoded : [];
        } else {
            self::$persistent_cache = [];
        }

        register_shutdown_function(self::save_persistent_cache(...));
    }

    public static function save_persistent_cache(): void {
        if (!self::$persistent_cache_dirty || self::$persistent_cache_path === null) {
            return;
        }
        $dir = dirname(self::$persistent_cache_path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        @file_put_contents(self::$persistent_cache_path, json_encode(self::$persistent_cache));
        self::$persistent_cache_dirty = false;
    }

    public static function set_persistent_cache_entry(string $path, int $size, array $dirs): void {
        self::init_persistent_cache();
        self::$persistent_cache[$path] = [
            'size' => $size,
            'mtime' => @filemtime($path),
            'dirs' => $dirs,
        ];
        self::$persistent_cache_dirty = true;
    }

    private static function is_cache_entry_valid(mixed $entry): bool {
        if (!is_array($entry) || !isset($entry['dirs']) || !is_array($entry['dirs'])) {
            return false;
        }
        return array_all(
            $entry['dirs'],
            fn(int|false $cached_mtime, string $dir_path): bool => is_dir($dir_path) && @filemtime($dir_path) === $cached_mtime,
        );
    }

    public static function getSize(string $path, bool $withFoldersize, bool $withDu): ?int {
        return new self()->size($path, $withFoldersize, $withDu);
    }

    public static function set_async_mode(bool $enabled): void {
        self::$async_mode = $enabled;
    }

    public static function get_stale_paths(): array {
        return array_unique(self::$stale_paths);
    }

    public static function getCachedSize(string $path, bool $withFoldersize, bool $withDu): ?int {
        if (array_key_exists($path, self::$cache)) {
            return self::$cache[$path];
        }

        if (is_dir($path) && $withFoldersize) {
            self::init_persistent_cache();
            if (array_key_exists($path, self::$persistent_cache)) {
                $entry = self::$persistent_cache[$path];
                if (self::is_cache_entry_valid($entry)) {
                    return self::$cache[$path] = $entry['size'];
                }
                if (self::$async_mode) {
                    self::$stale_paths[] = $path;
                    return self::$cache[$path] = $entry['size'];
                }
            } elseif (self::$async_mode) {
                self::$stale_paths[] = $path;
                return self::$cache[$path] = null;
            }
        }

        return self::$cache[$path] = self::getSize($path, $withFoldersize, $withDu);
    }

    private function __construct() {}

    private function read_dir(string $path): array {
        if (!is_dir($path) || !is_readable($path)) {
            return [];
        }
        $paths = [];
        try {
            $iter = new \FilesystemIterator($path, \FilesystemIterator::SKIP_DOTS);
            foreach ($iter as $item) {
                $paths[] = $item->getPathname();
            }
        } catch (\UnexpectedValueException) {}
        return $paths;
    }

    private function php_filesize(string $path, bool $recursive = false, array &$dirs = [], array &$visited = []): int|false {
        $real_path = realpath($path) ?: $path;
        if (in_array($real_path, $visited, true)) {
            return 0;
        }
        $visited[] = $real_path;

        $size = @filesize($path);

        if (!is_dir($path)) {
            return $size;
        }

        // From here on $size is an accumulator: a failed filesize() on the
        // directory itself must not leak `false` into the summed result.
        if ($size === false) {
            $size = 0;
        }

        $dirs[$path] = @filemtime($path);

        if (!$recursive) {
            return $size;
        }

        self::init_persistent_cache();

        foreach ($this->read_dir($path) as $p) {
            if (is_dir($p) && !is_link($p)) {
                if (array_key_exists($p, self::$persistent_cache)) {
                    $entry = self::$persistent_cache[$p];
                    if (self::is_cache_entry_valid($entry)) {
                        $size += $entry['size'];
                        foreach ($entry['dirs'] as $d => $mt) {
                            $dirs[$d] = $mt;
                        }
                        continue;
                    }
                }

                $sub_dirs = [];
                $sub_size = $this->php_filesize($p, true, $sub_dirs, $visited);
                $size += $sub_size;

                self::set_persistent_cache_entry($p, $sub_size, $sub_dirs);

                foreach ($sub_dirs as $d => $mt) {
                    $dirs[$d] = $mt;
                }
            } else {
                $size += @filesize($p);
            }
        }
        return $size;
    }

    private function exec(array $cmdv): array {
        $cmd = implode(' ', array_map(escapeshellarg(...), $cmdv));
        $lines = [];
        $rc = null;
        exec($cmd, $lines, $rc);
        return $lines;
    }

    // Single `du -bL` pass over the given paths. Without `-s`, du prints the
    // cumulative apparent size of every directory it visits, so one process
    // yields the sizes of the whole subtree of every path at once.
    // Returns a map [dir_path => size].
    private function du_tree(array $paths): array {
        if (empty($paths)) {
            return [];
        }
        $lines = $this->exec(['du', '-bL', ...$paths]);

        $sizes = [];
        foreach ($lines as $line) {
            $parts = preg_split('/\s+/', $line, 2);
            if (count($parts) === 2) {
                $sizes[$parts[1]] = (int) $parts[0];
            }
        }
        return $sizes;
    }

    // Derive the [dir => mtime] cache-validation map for $path straight from a
    // du subtree map: du already enumerated every descendant directory, so we
    // only need to stat directories instead of re-walking the whole tree.
    private function dirs_from_tree(string $path, array $tree): array {
        $prefix = $path . '/';
        $dirs = [];
        foreach (array_keys($tree) as $dir) {
            if ($dir === $path || str_starts_with($dir, $prefix)) {
                $dirs[$dir] = @filemtime($dir);
            }
        }
        if (!isset($dirs[$path])) {
            $dirs[$path] = @filemtime($path);
        }
        return $dirs;
    }

    // Compute and cache folder sizes for several paths with a single du call.
    public static function refresh_du(array $paths): void {
        new self()->batch_du($paths);
    }

    private function batch_du(array $paths): void {
        $paths = array_values(array_filter($paths, is_dir(...)));
        if (empty($paths)) {
            return;
        }
        $tree = $this->du_tree($paths);
        foreach ($paths as $path) {
            if (!isset($tree[$path])) {
                // du produced no size for this path (permissions, vanished
                // folder, ...): do not persist a bogus 0, keep the previous
                // cache entry so a stale-but-real size is served instead.
                continue;
            }
            $size = $tree[$path];
            $dirs = $this->dirs_from_tree($path, $tree);
            self::set_persistent_cache_entry($path, $size, $dirs);
            self::$cache[$path] = $size;
        }
    }

    private function size(string $path, bool $withFoldersize = false, bool $withDu = false): ?int {
        if (is_file($path)) {
            $size = $this->php_filesize($path);
            // filesize() can fail (race with a deletion, permissions):
            // report "unknown" instead of fataling on the ?int return type.
            return $size === false ? null : $size;
        }

        if (is_dir($path) && $withFoldersize) {
            if ($withDu) {
                $tree = $this->du_tree([$path]);
                if (!isset($tree[$path])) {
                    // du failed for this path: do not persist a bogus 0.
                    return null;
                }
                $size = $tree[$path];
                $dirs = $this->dirs_from_tree($path, $tree);
                self::set_persistent_cache_entry($path, $size, $dirs);
                return $size;
            }

            $dirs = [];
            $size = $this->php_filesize($path, true, $dirs);
            self::set_persistent_cache_entry($path, $size, $dirs);
            return $size;
        }

        return null;
    }
}
