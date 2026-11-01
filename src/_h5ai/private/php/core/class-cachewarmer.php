<?php

class CacheWarmer {
    // Categories thumbnails.js combines into the types it requests thumbnails for.
    private const THUMB_CATEGORIES = ['img', 'mov', 'doc', 'ar', 'aud'];

    private readonly Setup $setup;
    private readonly TypeMatcher $types;
    private ?Thumb $thumb_instance = null;
    private array $thumb_types = [];
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

    // cache.$name, falling back to the name older releases used ($legacy_name).
    private static function cache_option(Context $context, string $name, string $legacy_name, mixed $default): mixed {
        return $context->query_option('cache.' . $name, $context->query_option('cache.' . $legacy_name, $default));
    }

    // Mirrors thumbnails.js: the configured categories minus the blocklist.
    // The browser sends the item type itself, so the warmer does too.
    private static function requested_thumb_types(Context $context): array {
        $types = [];
        foreach (self::THUMB_CATEGORIES as $category) {
            $types = [...$types, ...(array) $context->query_option('thumbnails.' . $category, [])];
        }
        return array_values(array_diff($types, (array) $context->query_option('thumbnails.blocklist', [])));
    }

    // Returns how many vanished thumbnail sources were pruned. $status, when
    // given, follows the walk (one item per file) and the folder sizes.
    public function warm(?TaskStatus $status = null): int {
        $root = $this->setup->get('ROOT_PATH');
        $this->status = $status;
        $status?->phase('files');
        $this->warm_path($root);
        $pruned = $this->thumb_instance?->prune_orphans() ?? 0;

        // Runs from warm-cache.php on the CLI: use the background timeout.
        [$with_foldersize, $with_du, , $timeout] = $this->context->foldersize_mode();
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
                if (in_array($type, $this->thumb_types, true)) {
                    $href = $this->context->paths()->to_href($child_path, false);
                    $this->thumb_instance->thumb_for($type, $href, $this->thumb_width, $this->thumb_height);
                }
            }
        }
    }
}
