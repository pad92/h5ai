<?php

class CacheWarmer {
    // Categories thumbnails.js combines into the types it requests thumbnails for.
    private const THUMB_CATEGORIES = ['img', 'mov', 'doc', 'ar', 'aud'];

    private readonly Setup $setup;
    private readonly TypeMatcher $types;
    private ?Thumb $thumb_instance = null;
    // Thumbnail type => its category (img, mov, doc, ar, aud).
    private array $thumb_types = [];
    // Category => files of that kind met by the walk, and how many of them
    // have a thumbnail. Written to COVERAGE_FILE for the info page.
    private array $coverage = [];
    private int $thumb_width = 0;
    private int $thumb_height = 0;
    private ?TaskStatus $status = null;

    // $thumb lets tests observe the generated thumbnails.
    public function __construct(private readonly Context $context, ?Thumb $thumb = null) {
        $this->setup = $context->get_setup();

        $this->types = $context->get_type_matcher();

        if ($this->context->query_option('thumbnails.enabled', false) && $this->setup->get('HAS_PHP_WEBP')) {
            $this->thumb_instance = $thumb ?? new Thumb($this->context);
            [$this->thumb_width, $this->thumb_height] = Thumb::default_dimensions($this->context);
            $this->thumb_types = self::requested_thumb_types($this->context);
        }
    }

    // Thumbnail coverage of the last warm run, in the private cache.
    public const COVERAGE_FILE = 'warmer.coverage.json';

    // A start marker older than this is a worker that died before writing
    // warmer.lastrun: it no longer blocks a new start.
    public const START_TIMEOUT = 300;

    // Starts warm-cache.php in the background when cache.warmAtStartup is
    // on and both the last run and any start in progress are older than
    // cache.warmInterval. warmer.laststart marks a start so concurrent
    // requests launch one worker; warmer.lock only guards that decision and
    // is released before launching, since the worker holds it while running.
    // $launch (script path => accepted) replaces Util::launch_background().
    public static function launch_if_due(Context $context, ?callable $launch = null): bool {
        if (!self::cache_option($context, 'warmAtStartup', 'warm_at_startup', false)) {
            return false;
        }
        $setup = $context->get_setup();
        $cache = $setup->get('CACHE_PRV_PATH');
        $lock = @fopen($cache . '/warmer.lock', 'c+');
        if ($lock === false) {
            return false;
        }
        // A taken lock means a worker is running or another request is
        // deciding: nothing to do.
        $is_due = false;
        if (flock($lock, LOCK_EX | LOCK_NB)) {
            $now = time();
            $laststart = (int) @file_get_contents($cache . '/warmer.laststart');
            if ($laststart > 0 && $now - $laststart > self::START_TIMEOUT) {
                $laststart = 0;
            }
            $last_activity = max((int) @file_get_contents($cache . '/warmer.lastrun'), $laststart);
            $interval = (int) self::cache_option($context, 'warmInterval', 'warm_interval', 86400);
            $is_due = $last_activity === 0 || $now - $last_activity > $interval;
            if ($is_due) {
                @file_put_contents($cache . '/warmer.laststart', (string) $now, LOCK_EX);
            }
            flock($lock, LOCK_UN);
        }
        fclose($lock);
        if (!$is_due) {
            return false;
        }

        $launch ??= static fn(string $script): bool => Util::launch_background($script);
        if (!$launch($setup->get('PRIVATE_PATH') . '/php/warm-cache.php')) {
            @unlink($cache . '/warmer.laststart');
            return false;
        }
        return true;
    }

    // When the warmer last finished and when a request will start it next
    // (null when it never ran or is disabled).
    public static function schedule(Context $context): array {
        $enabled = (bool) self::cache_option($context, 'warmAtStartup', 'warm_at_startup', false);
        $interval = (int) self::cache_option($context, 'warmInterval', 'warm_interval', 86400);
        $lastrun = (int) @file_get_contents($context->get_setup()->get('CACHE_PRV_PATH') . '/warmer.lastrun');
        $lastrun = $lastrun > 0 ? $lastrun : null;
        return [
            'enabled' => $enabled,
            'interval' => $interval,
            'lastRun' => $lastrun,
            'nextRun' => $enabled && $lastrun !== null ? $lastrun + $interval : null,
        ];
    }

    // cache.$name, falling back to the name older releases used ($legacy_name).
    private static function cache_option(Context $context, string $name, string $legacy_name, mixed $default): mixed {
        return $context->query_option('cache.' . $name, $context->query_option('cache.' . $legacy_name, $default));
    }

    // Mirrors thumbnails.js: the configured categories minus the blocklist.
    // The browser sends the item type itself, so the warmer does too.
    // Returns type => category; a type listed twice keeps its first category.
    private static function requested_thumb_types(Context $context): array {
        $blocked = (array) $context->query_option('thumbnails.blocklist', []);
        $types = [];
        foreach (self::THUMB_CATEGORIES as $category) {
            foreach ((array) $context->query_option('thumbnails.' . $category, []) as $type) {
                if (is_string($type) && !in_array($type, $blocked, true)) {
                    $types[$type] ??= $category;
                }
            }
        }
        return $types;
    }

    // The coverage of the last warm run: {at, categories: {category: {files,
    // thumbnails}}}, or null before the first run with thumbnails enabled.
    public static function last_coverage(string $cache_path): ?array {
        $content = @file_get_contents($cache_path . '/' . self::COVERAGE_FILE);
        $data = $content === false ? null : json_decode($content, true);
        return is_array($data) && isset($data['at'], $data['categories']) ? $data : null;
    }

    private function save_coverage(): void {
        $file = $this->setup->get('CACHE_PRV_PATH') . '/' . self::COVERAGE_FILE;
        $tmp = $file . '.' . bin2hex(random_bytes(6)) . '.tmp';
        $json = json_encode(['at' => time(), 'categories' => (object) $this->coverage]);
        if ($json === false || @file_put_contents($tmp, $json) === false || !@rename($tmp, $file)) {
            @unlink($tmp);
        }
    }

    // Returns how many vanished thumbnail sources were pruned. $status, when
    // given, follows the walk (one item per file) and the folder sizes.
    public function warm(?TaskStatus $status = null): int {
        $root = $this->setup->get('ROOT_PATH');
        $this->status = $status;
        $status?->phase('files');
        $this->coverage = array_fill_keys(array_unique(array_values($this->thumb_types)), ['files' => 0, 'thumbnails' => 0]);
        $this->warm_path($root);
        $pruned = $this->thumb_instance?->prune_orphans() ?? 0;
        if ($this->thumb_instance !== null) {
            $this->save_coverage();
        }

        [$with_foldersize, $with_du, $timeout] = $this->context->foldersize_mode();
        if ($with_foldersize) {
            $status?->phase('sizes');
            Filesize::refresh_tree($root, $with_du, $timeout);
        }
        return $pruned;
    }

    // Symlinked folders are not followed, so the walk cannot loop.
    private function warm_path(string $path): void {
        if (!is_dir($path) || !$this->context->paths()->is_managed_path($path)) {
            return;
        }

        $files = $this->context->paths()->read_dir($path);

        foreach ($files as $file) {
            $child_path = $path . '/' . $file;
            if (is_dir($child_path) && !is_link($child_path)) {
                $this->warm_path($child_path);
                continue;
            }
            $this->status?->advance();
            if (!is_dir($child_path)
                && $this->thumb_instance !== null
                && $this->context->paths()->is_managed_file($child_path)) {
                $type = $this->types->type_of_name($file);
                $category = $this->thumb_types[$type] ?? null;
                if ($category !== null) {
                    $href = $this->context->paths()->to_href($child_path, false);
                    $thumb = $this->thumb_instance->thumb_for($type, $href, $this->thumb_width, $this->thumb_height);
                    $this->coverage[$category]['files']++;
                    $this->coverage[$category]['thumbnails'] += $thumb === null ? 0 : 1;
                }
            }
        }
    }
}
