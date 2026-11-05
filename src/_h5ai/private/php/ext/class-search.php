<?php

// Recursive name search. A background refresh keeps an index of every
// managed name below the root, in the spirit of locate/updatedb: a search
// reads that local file instead of walking a slow remote mount, and only
// checks its matches on disk, so a deleted file never shows up while a new
// one waits for the next refresh. Without a usable index, the bounded walk
// answers and a refresh is requested.
class Search {
    // Read by searches: a JSON header line, then one entry per line.
    public const INDEX_FILE = 'search-index.txt';
    // Read by the refresh only: each folder's state and entries, serialized
    // by PHP, which keeps file names that are not valid UTF-8 (JSON cannot).
    public const TREE_FILE = 'search-index.tree';
    private const LOCK_FILE = 'search-index.lock';
    private const VERSION = 3;
    private const DEFAULT_TTL = 300;
    // Kernel file times lag time() by up to a clock tick, and have a
    // one-second resolution here: a folder changed in the second the
    // previous refresh read it, or just before, is listed again.
    private const RACY_MARGIN = 1;
    // Entry types: a folder the refresh descends into, a symlinked folder it
    // lists but never follows, and anything else (checked when it matches).
    private const TYPE_DIR = 'd';
    private const TYPE_LINK = 'l';
    private const TYPE_FILE = 'f';

    public function __construct(private readonly Context $context) {}

    // Paths below $root whose name matches the regular expression $pattern:
    // at most search.maxResults of them, search.maxDepth levels below $root.
    // An empty, oversized or invalid pattern, or an unmanaged root, yields [].
    public function get_paths(string $root, ?string $pattern = null, bool $ignorecase = false): array {
        $max_pattern_length = max(1, (int) $this->context->query_option('search.maxPatternLength', 1024));
        if (!$pattern || strlen($pattern) > $max_pattern_length) {
            return [];
        }
        $matches = self::name_matcher($pattern, $ignorecase);
        if ($matches === null) {
            return [];
        }
        $root = Util::normalize_path($root);
        if (!$this->context->paths()->is_managed_path($root)) {
            return [];
        }

        $max_depth = max(0, (int) $this->context->query_option('search.maxDepth', 64));
        $max_results = max(1, (int) $this->context->query_option('search.maxResults', 1000));
        // The index never goes into a symlinked folder, but a search started
        // from inside one walks it, as before the index.
        $is_in_symlink = $this->is_in_symlinked_folder($root);
        $paths = $is_in_symlink ? null : $this->search_index($root, $matches, $max_depth, $max_results);
        if ($paths === null) {
            if (!$is_in_symlink) {
                $this->context->trigger_search_index_refresh();
            }
            $paths = [];
            $visited = [];
            $this->walk($root, $matches, 0, $max_depth, $max_results, $visited, $paths);
        }
        return $paths;
    }

    // Whether a name matches $pattern, read as the browser's filter reads it:
    // characters, not bytes, so that the case of É is ignored like that of E,
    // and in NFC when the intl extension can normalize the name. A name that
    // is not valid UTF-8 is matched byte by byte. Null for an invalid pattern.
    private static function name_matcher(string $pattern, bool $ignorecase): ?Closure {
        $re = Util::wrap_pattern('(*LIMIT_MATCH=100000)(*LIMIT_DEPTH=1000)' . $pattern) . ($ignorecase ? 'i' : '');
        if (@preg_match($re, '') === false) {
            return null;
        }
        $re_unicode = $re . 'u';
        if (@preg_match($re_unicode, '') === false) {
            return static fn(string $name): bool => @preg_match($re, $name) === 1;
        }
        $can_normalize = class_exists('Normalizer');
        return static function (string $name) use ($re, $re_unicode, $can_normalize): bool {
            // Normalizing fails on a name that is not UTF-8, which is kept.
            if ($can_normalize && !Normalizer::isNormalized($name, Normalizer::FORM_C)) {
                $name = Normalizer::normalize($name, Normalizer::FORM_C) ?: $name;
            }
            $result = @preg_match($re_unicode, $name);
            // Only a bad encoding goes byte by byte: a match limit hit on a
            // good name is no match.
            if ($result === false && preg_last_error() === PREG_BAD_UTF8_ERROR) {
                $result = @preg_match($re, $name);
            }
            return $result === 1;
        };
    }

    // Whether $root or one of its parents below ROOT_PATH is a symlink. A
    // symlinked ROOT_PATH itself is indexed like any root.
    private function is_in_symlinked_folder(string $root): bool {
        $base = $this->context->get_setup()->get('ROOT_PATH');
        for ($path = $root; $path !== $base && str_starts_with($path, $base); $path = dirname($path)) {
            if (@is_link($path)) {
                return true;
            }
        }
        return false;
    }

    // Matches read from the index, or null without a usable one. An index
    // older than search.indexTtl still answers and asks for a refresh.
    private function search_index(string $root, Closure $matches, int $max_depth, int $max_results): ?array {
        $relative_root = $this->relative_path($root);
        $handle = $relative_root === null ? false : @fopen($this->cache_file(self::INDEX_FILE), 'r');
        if ($handle === false) {
            return null;
        }
        try {
            $header = $this->read_header($handle);
            if ($header === null) {
                return null;
            }
            if (time() - $header['built'] >= $this->ttl()) {
                $this->context->trigger_search_index_refresh();
            }
            $prefix = $relative_root === '' ? '' : self::escape($relative_root) . '/';
            $hide_unreadable = (bool) $this->context->query_option('view.hideIf403', false);
            $paths = [];
            // The index lists each folder's entries right after it, so the
            // entries below $root follow each other: past them, stop.
            $is_below_root = false;
            while (($line = fgets($handle)) !== false) {
                $entry = substr($line, 1, -1);
                if (!str_starts_with($entry, $prefix)) {
                    if ($is_below_root) {
                        break;
                    }
                    continue;
                }
                $is_below_root = true;
                $below_root = substr($entry, strlen($prefix));
                if (substr_count($below_root, '/') > $max_depth) {
                    continue;
                }
                $slash = strrpos($below_root, '/');
                $name = self::unescape($slash === false ? $below_root : substr($below_root, $slash + 1));
                if (!$matches($name)) {
                    continue;
                }
                $path = $this->absolute_path(self::unescape($entry));
                if ($this->is_current_match($line[0], $path, $root, $hide_unreadable)) {
                    $paths[] = $path;
                    if (count($paths) >= $max_results) {
                        break;
                    }
                }
            }
            return $paths;
        } finally {
            fclose($handle);
        }
    }

    // The index may be minutes old: a match counts only if it is still there,
    // still a file or a folder as indexed, managed and, with view.hideIf403,
    // readable. is_managed_path() fails on anything but a folder.
    private function is_current_match(string $type, string $path, string $root, bool $hide_unreadable): bool {
        $policy = $this->context->paths();
        $is_current = $type === self::TYPE_FILE
            ? $policy->is_managed_file($path)
            : $policy->is_managed_path($path);
        return $is_current && (!$hide_unreadable || $this->is_readable_from($path, $root));
    }

    // The walk used before the index existed, and still used without one.
    private function walk(string $folder, Closure $matches, int $depth, int $max_depth, int $max_results, array &$visited, array &$paths): void {
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
            if ($matches($name)
                && (($is_directory && $this->context->paths()->is_managed_path($path))
                    || (!$is_directory && $this->context->paths()->is_managed_file($path)))) {
                $paths[] = $path;
            }
            if ($is_directory && !@is_link($path)) {
                $this->walk($path, $matches, $depth + 1, $max_depth, $max_results, $visited, $paths);
            }
        }
    }

    // Brings the index up to date. Every managed folder is stat()ed, but only
    // the folders whose state changed since the previous refresh are listed
    // again. False when another refresh holds the lock, when this process
    // runs as root (it would index names the web server cannot read), or
    // when the index cannot be written; the last two are logged.
    public function refresh_index(): bool {
        $lock = @fopen($this->cache_file(self::LOCK_FILE), 'c+');
        if ($lock === false) {
            Util::log('search index: cannot open ' . $this->cache_file(self::LOCK_FILE));
            return false;
        }
        if (!flock($lock, LOCK_EX | LOCK_NB)) {
            fclose($lock);
            return false;
        }
        try {
            $uid = $this->writer_uid();
            if ($uid === null) {
                Util::log('search index: the private cache is not writable: ' . $this->cache_file(''));
                return false;
            }
            if ($uid === 0) {
                Util::log('search index: not refreshed as root; run the cache warmer as the web server user');
                return false;
            }
            $started = time();
            $previous = $this->read_tree();
            $dirs = [];
            $this->refresh_dir('', $previous, $dirs);
            return $this->write_index($uid, $started, $dirs);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    private function refresh_dir(string $relative, ?array $previous, array &$dirs): void {
        $path = $this->absolute_path($relative);
        if (!$this->context->paths()->is_managed_path($path)) {
            return;
        }
        // Read before listing: a change made during the listing shows in
        // the next refresh instead of hiding behind an up-to-date state.
        $state = self::directory_state($path);
        if ($state === null) {
            return;
        }
        $known = $previous['dirs'][$relative] ?? null;
        $entries = $known !== null && $known['s'] === $state && self::is_settled($state, $previous['built'])
            ? $known['e']
            : $this->list_entries($path);
        $dirs[$relative] = ['s' => $state, 'e' => $entries];
        foreach ($entries as $entry) {
            if ($entry[0] === self::TYPE_DIR) {
                $name = substr($entry, 1);
                $this->refresh_dir($relative === '' ? $name : $relative . '/' . $name, $previous, $dirs);
            }
        }
    }

    // A folder whose times are older than the previous refresh's start (with
    // the racy margin) kept its entries if it kept its state.
    private static function is_settled(array $state, int $previous_start): bool {
        return max($state['mtime'], $state['ctime']) < $previous_start - self::RACY_MARGIN;
    }

    // The visible entries of $path as type . name: on a large share a string
    // costs far less memory than a pair. Unreadable entries are kept, since
    // view.hideIf403 applies when a search runs. Whether a file is managed is
    // left to the search too, which checks each match anyway: checking every
    // file here would double the stat() calls of a listing.
    private function list_entries(string $path): array {
        $entries = [];
        foreach ($this->context->paths()->read_dir($path, true) as $name) {
            $child = $path . '/' . $name;
            $type = !@is_dir($child) ? self::TYPE_FILE : (@is_link($child) ? self::TYPE_LINK : self::TYPE_DIR);
            $entries[] = $type . $name;
        }
        return $entries;
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

    // The previous refresh's tree, or null when it is missing or was made
    // for another version or configuration.
    private function read_tree(): ?array {
        $content = @file_get_contents($this->cache_file(self::TREE_FILE));
        $tree = $content === false ? null : @unserialize($content, ['allowed_classes' => false]);
        if (!is_array($tree) || ($tree['version'] ?? null) !== self::VERSION
            || ($tree['config'] ?? null) !== $this->config_hash()
            || !is_int($tree['built'] ?? null) || !is_array($tree['dirs'] ?? null)) {
            return null;
        }
        return $tree;
    }

    private function write_index(int $uid, int $started, array $dirs): bool {
        $config = $this->config_hash();
        $is_tree_written = $this->replace_cache_file(self::TREE_FILE, static fn($handle): bool => fwrite($handle, serialize(
            ['version' => self::VERSION, 'config' => $config, 'built' => $started, 'dirs' => $dirs],
        )) !== false);
        $header = [
            'version' => self::VERSION,
            'config' => $config,
            'uid' => $uid,
            'built' => $started,
            'entries' => array_sum(array_map(static fn(array $dir): int => count($dir['e']), $dirs)),
            'directories' => count($dirs),
        ];
        return $this->replace_cache_file(self::INDEX_FILE, function ($handle) use ($header, $dirs): bool {
            return fwrite($handle, json_encode($header) . "\n") !== false && $this->write_entries($handle, '', $dirs);
        }) && $is_tree_written;
    }

    // Depth-first, in listing order: the order of the walk's results.
    private function write_entries($handle, string $relative, array $dirs): bool {
        foreach ($dirs[$relative]['e'] ?? [] as $entry) {
            $type = $entry[0];
            $name = substr($entry, 1);
            $child = $relative === '' ? $name : $relative . '/' . $name;
            if (fwrite($handle, $type . self::escape($child) . "\n") === false) {
                return false;
            }
            if ($type === self::TYPE_DIR && !$this->write_entries($handle, $child, $dirs)) {
                return false;
            }
        }
        return true;
    }

    // Writes a temporary file next to $name and renames it into place.
    private function replace_cache_file(string $name, callable $write): bool {
        $file = $this->cache_file($name);
        $tmp = $file . '.' . bin2hex(random_bytes(6)) . '.tmp';
        $handle = @fopen($tmp, 'x');
        $is_written = $handle !== false && $write($handle);
        if ($handle !== false) {
            $is_written = fclose($handle) && $is_written;
        }
        if ($is_written && @rename($tmp, $file)) {
            return true;
        }
        @unlink($tmp);
        Util::log('search index: cannot write ' . $file);
        return false;
    }

    // The user this process writes files as, read from a file it creates:
    // unlike posix_geteuid(), this needs no extension. Null when the cache
    // folder is not writable.
    private function writer_uid(): ?int {
        $probe = @tempnam($this->cache_file(''), 'search-index-');
        if ($probe === false || dirname($probe) !== rtrim($this->cache_file(''), '/')) {
            if ($probe !== false) {
                @unlink($probe);
            }
            return null;
        }
        $uid = @fileowner($probe);
        @unlink($probe);
        return $uid === false ? null : $uid;
    }

    private function read_header($handle): ?array {
        $line = fgets($handle);
        $header = $line === false ? null : json_decode($line, true);
        if (!is_array($header) || ($header['version'] ?? null) !== self::VERSION
            || ($header['config'] ?? null) !== $this->config_hash()
            || !is_int($header['built'] ?? null) || !is_int($header['uid'] ?? null)) {
            return null;
        }
        // An index written by another user may hold names this one cannot
        // read. Without the posix extension, the writer's refusal to run as
        // root is the only guard.
        if (function_exists('posix_geteuid') && $header['uid'] !== posix_geteuid()) {
            return null;
        }
        return $header;
    }

    // Size and counts for the info page, from the header only: never a path.
    public static function stats(string $cache_path): array {
        $index = $cache_path . '/' . self::INDEX_FILE;
        $bytes = 0;
        foreach ([$index, $cache_path . '/' . self::TREE_FILE] as $file) {
            $bytes += (int) @filesize($file);
        }
        $handle = @fopen($index, 'r');
        $header = $handle === false ? null : json_decode((string) fgets($handle), true);
        if ($handle !== false) {
            fclose($handle);
        }
        return [
            'bytes' => $bytes,
            'entries' => is_int($header['entries'] ?? null) ? $header['entries'] : 0,
            'directories' => is_int($header['directories'] ?? null) ? $header['directories'] : 0,
            'updated' => is_int($header['built'] ?? null) && $header['built'] > 0 ? $header['built'] : null,
        ];
    }

    // Removes the index, its tree and the temporary files an interrupted
    // write left, under the refresh lock: a running refresh would write the
    // index again right after. Returns the counts the index held; throws
    // while a refresh runs.
    public static function purge(string $cache_path): array {
        $lock = @fopen($cache_path . '/' . self::LOCK_FILE, 'c+');
        if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
            if ($lock !== false) {
                fclose($lock);
            }
            throw new RuntimeException('the search index is being refreshed');
        }
        try {
            $stats = self::stats($cache_path);
            @unlink($cache_path . '/' . self::INDEX_FILE);
            @unlink($cache_path . '/' . self::TREE_FILE);
            foreach (@scandir($cache_path) ?: [] as $name) {
                if (preg_match('/^search-index\..+\.tmp$/', $name)) {
                    @unlink($cache_path . '/' . $name);
                }
            }
            return ['entries' => $stats['entries'], 'directories' => $stats['directories']];
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    // Paths are stored relative to ROOT_PATH, one per line: backslashes and
    // line breaks in names are escaped.
    private static function escape(string $relative): string {
        return addcslashes($relative, "\\\n\r");
    }

    private static function unescape(string $escaped): string {
        return str_contains($escaped, '\\') ? stripcslashes($escaped) : $escaped;
    }

    // $path relative to ROOT_PATH ('' for the root itself), or null outside.
    private function relative_path(string $path): ?string {
        $base = $this->context->get_setup()->get('ROOT_PATH');
        if ($path === $base) {
            return '';
        }
        $prefix = $base === '/' ? '/' : $base . '/';
        return str_starts_with($path, $prefix) ? substr($path, strlen($prefix)) : null;
    }

    private function absolute_path(string $relative): string {
        $base = $this->context->get_setup()->get('ROOT_PATH');
        return $relative === '' ? $base : ($base === '/' ? '/' : $base . '/') . $relative;
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

    private function ttl(): int {
        return max(0, (int) $this->context->query_option('search.indexTtl', self::DEFAULT_TTL));
    }

    private function cache_file(string $name): string {
        return $this->context->get_setup()->get('CACHE_PRV_PATH') . '/' . $name;
    }

    // What the indexed entries depend on. view.hideIf403 and search.maxDepth
    // apply when a search runs, so they are not part of it.
    private function config_hash(): string {
        return hash('sha256', json_encode([
            $this->context->get_setup()->get('ROOT_PATH'),
            $this->context->query_option('view.hidden', []),
            $this->context->query_option('view.unmanaged', []),
        ]));
    }

    public function get_items(string $href, ?string $pattern = null, bool $ignorecase = false): array {
        $root = $this->context->paths()->to_path($href);
        return $this->context->with_cached_folder_sizes(function () use ($root, $pattern, $ignorecase): array {
            $cache = [];
            // Nothing refreshes search results, so an expired folder size
            // would blink there for good: it is shown without the flag.
            return array_map(
                fn(string $path): array => array_diff_key(Item::get($this->context, $path, $cache)->to_json_object(), ['sizeStale' => true]),
                $this->get_paths($root, $pattern, $ignorecase),
            );
        });
    }
}
