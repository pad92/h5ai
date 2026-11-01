<?php

class Filesize {
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

    // Deletes the folder size cache file and the temporary files an
    // interrupted save_persistent_cache() left next to it, under the lock that
    // save takes, so no save can interleave. Returns how many entries the
    // file held. Requests running meanwhile may still save the sizes they
    // computed.
    public static function purge_cache(string $file): int {
        $lock = @fopen($file . '.lock', 'c+');
        if ($lock === false || !flock($lock, LOCK_EX)) {
            throw new RuntimeException('cannot lock the folder size cache');
        }
        try {
            $entries = json_decode((string) @file_get_contents($file), true);
            if (file_exists($file) && !@unlink($file)) {
                throw new RuntimeException('cannot delete the folder size cache');
            }
            // tempnam($dir, 'foldersizes.') names: six random characters.
            foreach (glob(dirname($file) . '/foldersizes.??????', GLOB_NOSORT) ?: [] as $leftover) {
                if (is_file($leftover)) {
                    @unlink($leftover);
                }
            }
            self::$persistent_cache = null;
            self::$dirty_entries = [];
            self::$persistent_cache_dirty = false;
            return is_array($entries) ? count($entries) : 0;
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    // Entries of the folder size cache file and how many are still served
    // (younger than CACHE_TTL). Counts only: paths never leave the server.
    public static function cache_stats(string $file): array {
        $content = @file_get_contents($file);
        $entries = $content === false ? null : json_decode($content, true);
        $entries = is_array($entries) ? $entries : [];
        $cached_at = array_filter(array_map(
            static fn(mixed $entry): ?int => is_array($entry) && is_int($entry['cached_at'] ?? null) ? $entry['cached_at'] : null,
            $entries,
        ), is_int(...));
        return [
            'entries' => count($entries),
            'fresh' => count(array_filter($entries, self::is_cache_entry_fresh(...))),
            'bytes' => $content === false ? 0 : strlen($content),
            'ttl' => self::CACHE_TTL,
            'newest' => $cached_at === [] ? null : max($cached_at),
        ];
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

    // Computes a size now. Only the CLI workers call it: requests read
    // folder sizes from the cache through get_cached_size().
    public static function get_size(string $path, bool $with_foldersize, bool $with_du, int $timeout = self::DEFAULT_BACKGROUND_TIMEOUT): ?int {
        return new self($timeout)->size($path, $with_foldersize, $with_du);
    }

    // Starts collecting the folders get_cached_size() could not answer.
    public static function begin_async_mode(): void {
        self::$stale_paths = [];
    }

    // The folders to hand to the background refresh, each once.
    public static function end_async_mode(): array {
        $stale_paths = array_unique(self::$stale_paths);
        self::$stale_paths = [];
        return $stale_paths;
    }

    // Size of a listed item without computing any folder size: a regular
    // file is read directly, a folder comes from a fresh cache entry or is
    // unknown (null) and queued for the refresh worker. Call it between
    // begin_async_mode() and end_async_mode(), as
    // Context::with_cached_folder_sizes() does.
    public static function get_cached_size(string $path, bool $with_foldersize, bool $is_folder): ?int {
        if (array_key_exists($path, self::$cache)) {
            return self::$cache[$path];
        }
        if (!$is_folder) {
            // Item has just read this path's type and mtime, so PHP can
            // reuse the same cached stat result for the regular file size.
            $size = @filesize($path);
            return self::$cache[$path] = $size === false ? null : $size;
        }
        if ($with_foldersize) {
            self::init_persistent_cache();
            $entry = self::$persistent_cache[$path] ?? null;
            if (self::is_cache_entry_fresh($entry)) {
                return self::$cache[$path] = $entry['size'];
            }
            self::$stale_paths[] = $path;
        }
        return self::$cache[$path] = null;
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
    // $paths is never empty: every caller passes at least one folder.
    private function du_tree(array $paths): array {
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
    public static function refresh_du(array $paths, int $timeout = self::DEFAULT_BACKGROUND_TIMEOUT): void {
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
