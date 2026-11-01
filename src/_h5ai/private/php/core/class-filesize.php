<?php

class Filesize {
    // du limit for a size computed while serving a request. Requests read
    // folder sizes from the cache (Context::with_cached_folder_sizes), so
    // this only matters for a caller outside that path; it must stay below
    // the php-fpm pool's request_terminate_timeout so the fail-closed path
    // below runs before the worker is killed from under it.
    public const DEFAULT_TIMEOUT = 50;
    // Directory mtimes do not change when an existing file is rewritten. A
    // bounded lifetime therefore limits how long such a change can go unseen.
    public const CACHE_TTL = 300;
    // Warming or refreshing the cache from the CLI: no pool limit applies, and
    // cutting a large tree short would leave it permanently uncached.
    public const DEFAULT_BACKGROUND_TIMEOUT = 900;
    public const MAX_TIMEOUT = 3600;

    private static array $cache = [];
    private static ?array $persistent_cache = null;
    private static bool $persistent_cache_dirty = false;
    private static array $dirty_entries = [];
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
        $path = self::$persistent_cache_path;
        $dir = dirname($path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        $lock = @fopen($path . '.lock', 'c+');
        if (!$lock || !flock($lock, LOCK_EX)) {
            if ($lock) {
                fclose($lock);
            }
            return;
        }

        $current = [];
        $content = @file_get_contents($path);
        if ($content !== false) {
            $decoded = json_decode($content, true);
            $current = is_array($decoded) ? $decoded : [];
        }
        foreach (self::$dirty_entries as $entry_path => $entry) {
            $current[$entry_path] = $entry;
        }
        // Expired entries are never served again, only recomputed: dropping
        // them keeps the file, decoded by every listing, to recent activity.
        $current = array_filter($current, self::is_cache_entry_fresh(...));

        $tmp = @tempnam($dir, 'foldersizes.');
        $json = json_encode($current);
        if ($tmp !== false && $json !== false && @file_put_contents($tmp, $json, LOCK_EX) !== false
            && @rename($tmp, $path)) {
            self::$persistent_cache = $current;
            self::$dirty_entries = [];
            self::$persistent_cache_dirty = false;
        } elseif ($tmp !== false) {
            @unlink($tmp);
        }
        flock($lock, LOCK_UN);
        fclose($lock);
    }

    // An entry holds a folder's total size, its own mtime and its direct
    // subfolders. Every subfolder has an entry of its own, written in the same
    // pass, so validating a folder walks its subtree through those entries
    // and the file stays linear in the number of folders.
    public static function set_persistent_cache_entry(string $path, int $size, array $children): void {
        self::init_persistent_cache();
        self::$persistent_cache[$path] = [
            'size' => $size,
            'mtime' => @filemtime($path),
            'cached_at' => time(),
            'children' => array_values($children),
        ];
        self::$dirty_entries[$path] = self::$persistent_cache[$path];
        self::$persistent_cache_dirty = true;
    }

    private static function is_cache_entry_fresh(mixed $entry): bool {
        if (!is_array($entry) || !isset($entry['size'], $entry['cached_at'], $entry['children'])
            || !is_int($entry['size']) || !is_int($entry['cached_at']) || !is_array($entry['children'])
            || !array_key_exists('mtime', $entry)) {
            return false;
        }
        if ($entry['cached_at'] > time() || time() - $entry['cached_at'] > self::CACHE_TTL) {
            return false;
        }
        return true;
    }

    // Fresh, and neither the folder nor any folder below it changed its
    // entries since: an added, removed or renamed entry changes the mtime of
    // the folder holding it.
    private static function is_cache_entry_valid(string $path): bool {
        $entry = self::$persistent_cache[$path] ?? null;
        if (!self::is_cache_entry_fresh($entry) || !is_dir($path) || @filemtime($path) !== $entry['mtime']) {
            return false;
        }
        return array_all($entry['children'], static fn(mixed $child): bool => is_string($child) && self::is_cache_entry_valid($child));
    }

    public static function get_size(string $path, bool $with_foldersize, bool $with_du, int $timeout = self::DEFAULT_TIMEOUT): ?int {
        return new self($timeout)->size($path, $with_foldersize, $with_du);
    }

    public static function begin_async_mode(): void {
        self::$stale_paths = [];
        self::$async_mode = true;
    }

    public static function end_async_mode(): array {
        self::$async_mode = false;
        $stale_paths = array_unique(self::$stale_paths);
        self::$stale_paths = [];
        return $stale_paths;
    }

    public static function get_cached_size(
        string $path,
        bool $with_foldersize,
        bool $with_du,
        int $timeout = self::DEFAULT_TIMEOUT,
        ?bool $is_folder = null,
    ): ?int {
        if (array_key_exists($path, self::$cache)) {
            return self::$cache[$path];
        }

        if (self::$async_mode) {
            if ($is_folder === false) {
                // Item has just read this path's type and mtime, so PHP can
                // reuse the same cached stat result for the regular file size.
                $size = @filesize($path);
                return self::$cache[$path] = $size === false ? null : $size;
            }
            if ($is_folder === null) {
                return self::$cache[$path] = null;
            }
            if ($is_folder && $with_foldersize) {
                self::init_persistent_cache();
                if (array_key_exists($path, self::$persistent_cache)) {
                    $entry = self::$persistent_cache[$path];
                    if (self::is_cache_entry_fresh($entry)) {
                        return self::$cache[$path] = $entry['size'];
                    }
                }
                self::$stale_paths[] = $path;
                return self::$cache[$path] = null;
            }
            return self::$cache[$path] = null;
        }

        if (is_dir($path) && $with_foldersize) {
            self::init_persistent_cache();
            if (self::is_cache_entry_valid($path)) {
                return self::$cache[$path] = self::$persistent_cache[$path]['size'];
            }
        }

        return self::$cache[$path] = self::get_size($path, $with_foldersize, $with_du, $timeout);
    }

    private function __construct(private readonly int $timeout) {}

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

    // Size of a folder walked in PHP, reusing the valid entries of its
    // subfolders and caching every folder it had to walk. Returns null for a
    // folder already counted through another path (bind mount, ...).
    private function php_folder_size(string $path, array &$visited): ?int {
        $real_path = realpath($path) ?: $path;
        if (isset($visited[$real_path])) {
            return null;
        }
        $visited[$real_path] = true;

        $size = (int) @filesize($path);
        $children = [];
        foreach ($this->read_dir($path) as $child) {
            if (!is_dir($child) || is_link($child)) {
                $size += (int) @filesize($child);
                continue;
            }
            $child_size = self::is_cache_entry_valid($child)
                ? self::$persistent_cache[$child]['size']
                : $this->php_folder_size($child, $visited);
            if ($child_size === null) {
                continue;
            }
            $size += $child_size;
            $children[] = $child;
        }
        self::set_persistent_cache_entry($path, $size, $children);
        return $size;
    }

    // Bounded so a pass over a large or slow tree cannot run unchecked. It does
    // not help against a mount that has hung outright: the child then sits in
    // uninterruptible I/O where the kill signal stays pending, exactly like the
    // plain directory reads elsewhere in this class. On abort the partial
    // output is dropped rather than parsed: both callers treat a missing entry
    // as "size unknown" and keep the previous cache entry, while a truncated
    // tree would persist a wrong, too-small size.
    private function exec(array $cmdv): array {
        $output = '';
        $error = '';
        $rc = Util::proc_open_cmdv($cmdv, $output, $error, $this->timeout);
        // proc_open_cmdv() reports both its timeout and its output cap as 124
        // without saying which, so the message names the two possibilities
        // rather than asserting the wrong one.
        if ($rc === 124) {
            Util::log("folder size: `{$cmdv[0]}` aborted (timeout {$this->timeout}s or output limit)");
            return [];
        }
        $output = rtrim($output, "\r\n");
        return $output === '' ? [] : preg_split('/\r?\n/', $output);
    }

    // Single `du -b` pass over the given paths. Without `-s`, du prints the
    // cumulative apparent size of every directory it visits, so one process
    // yields the sizes of the whole subtree of every path at once.
    // Returns a map [dir_path => size].
    private function du_tree(array $paths): array {
        if (empty($paths)) {
            return [];
        }
        $lines = $this->exec(['du', '-b', ...$paths]);

        $sizes = [];
        foreach ($lines as $line) {
            $parts = preg_split('/\s+/', $line, 2);
            if (count($parts) === 2) {
                $sizes[$parts[1]] = (int) $parts[0];
            }
        }
        return $sizes;
    }

    // Caches every folder of a du map: du already measured each of them.
    private static function persist_tree(array $tree): void {
        $children = [];
        foreach (array_keys($tree) as $dir) {
            $parent = dirname($dir);
            if ($parent !== $dir && isset($tree[$parent])) {
                $children[$parent][] = $dir;
            }
        }
        foreach ($tree as $dir => $size) {
            self::set_persistent_cache_entry($dir, $size, $children[$dir] ?? []);
            self::$cache[$dir] = $size;
        }
    }

    // Compute and cache folder sizes for several paths with a single du call.
    // A path du could not measure (permissions, vanished folder, timeout)
    // keeps whatever entry it had: no bogus 0 is persisted.
    public static function refresh_du(array $paths, int $timeout = self::DEFAULT_TIMEOUT): void {
        $paths = array_values(array_filter($paths, is_dir(...)));
        if ($paths !== []) {
            self::persist_tree(new self($timeout)->du_tree($paths));
        }
    }

    // Caches the size of every folder below $root in one pass that reads
    // each folder once: a single du over the whole tree, or a PHP walk that
    // reuses still-valid subfolder entries. A du pass cut short by the
    // timeout caches nothing, as a partial tree would understate sizes.
    public static function refresh_tree(string $root, bool $with_du, int $timeout = self::DEFAULT_BACKGROUND_TIMEOUT): ?int {
        self::init_persistent_cache();
        $sizer = new self($timeout);
        if ($with_du) {
            $tree = $sizer->du_tree([$root]);
            self::persist_tree($tree);
            return $tree[$root] ?? null;
        }
        $visited = [];
        return self::$cache[$root] = $sizer->php_folder_size($root, $visited);
    }

    private function size(string $path, bool $with_foldersize = false, bool $with_du = false): ?int {
        if (is_file($path)) {
            // filesize() can fail (race with a deletion, permissions):
            // report "unknown" instead of fataling on the ?int return type.
            $size = @filesize($path);
            return $size === false ? null : $size;
        }

        if (is_dir($path) && $with_foldersize) {
            self::init_persistent_cache();
            if ($with_du) {
                $tree = $this->du_tree([$path]);
                self::persist_tree($tree);
                return $tree[$path] ?? null;
            }
            $visited = [];
            return $this->php_folder_size($path, $visited);
        }

        return null;
    }
}
