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

    // Mirrors thumbnails.js: the configured categories minus the blocklist.
    // The browser sends the item type itself, so the warmer does too.
    private static function requested_thumb_types(Context $context): array {
        $types = [];
        foreach (self::THUMB_CATEGORIES as $category) {
            $types = [...$types, ...(array) $context->query_option('thumbnails.' . $category, [])];
        }
        return array_values(array_diff($types, (array) $context->query_option('thumbnails.blocklist', [])));
    }

    public function warm(): void {
        $this->warm_path($this->setup->get('ROOT_PATH'));
    }

    private function warm_path(string $path, array &$visited = []): void {
        $real_path = realpath($path) ?: $path;
        if (in_array($real_path, $visited, true)) {
            return;
        }
        $visited[] = $real_path;

        if (!is_dir($path) || !$this->context->is_managed_path($path)) {
            return;
        }

        $files = $this->context->read_dir($path);

        foreach ($files as $file) {
            $child_path = $path . '/' . $file;
            if (is_dir($child_path) && !is_link($child_path)) {
                $this->warm_path($child_path, $visited);
            } elseif (!is_dir($child_path)
                && $this->thumb_instance !== null
                && $this->context->is_managed_file($child_path)) {
                $type = $this->types->type_of_name($file);
                if (in_array($type, $this->thumb_types, true)) {
                    $href = $this->context->to_href($child_path, false);
                    $this->thumb_instance->thumb_for($type, $href, $this->thumb_width, $this->thumb_height);
                }
            }
        }

        // Runs from warm-cache.php on the CLI: use the background timeout.
        [$withFoldersize, $withDu, , $timeout] = $this->context->foldersize_mode();
        if ($withFoldersize) {
            Filesize::getCachedSize($path, $withFoldersize, $withDu, $timeout);
        }
    }
}
