<?php

class Item {
    public static function cmp(self $item1, self $item2): int {
        if ($item1->is_folder && !$item2->is_folder) {
            return -1;
        }
        if (!$item1->is_folder && $item2->is_folder) {
            return 1;
        }

        return strcasecmp($item1->path, $item2->path);
    }

    // The item for a path inside the served root, or null for any other path
    // (a sibling sharing the root's name prefix included).
    public static function get(Context $context, string $path, array &$cache): ?self {
        $root = $context->get_setup()->get('ROOT_PATH');
        if ($path !== $root && !str_starts_with($path, rtrim($root, '/') . '/')) {
            return null;
        }

        if (array_key_exists($path, $cache)) {
            return $cache[$path];
        }

        $item = new self($context, $path);
        $cache[$path] = $item;
        return $item;
    }

    public readonly string $path;
    public readonly string $href;
    public readonly int|false $date;
    public readonly ?int $size;
    public readonly bool $is_folder;
    public bool $is_content_fetched = false;

    private function __construct(
        public readonly Context $context,
        string $path,
    ) {
        $this->path = Util::normalize_path($path, false);
        $this->is_folder = is_dir($this->path);
        $this->href = $context->paths()->to_href($this->path, $this->is_folder);
        $this->date = @filemtime($this->path);
        $this->size = Util::filesize($context, $this->path, $this->is_folder);
    }

    public function to_json_object(): array {
        $obj = [
            'href' => $this->href,
            'time' => $this->date * 1000,
            'size' => $this->size,
        ];

        if ($this->is_folder) {
            $obj['managed'] = $this->context->paths()->is_managed_href($this->href);
            $obj['fetched'] = $this->is_content_fetched;
        }

        return $obj;
    }

    public function get_parent(array &$cache): ?self {
        $parent_path = Util::normalize_path(dirname($this->path), false);
        if ($parent_path !== $this->path && str_starts_with($parent_path, $this->context->get_setup()->get('ROOT_PATH'))) {
            return self::get($this->context, $parent_path, $cache);
        }
        return null;
    }

    public function get_content(array &$cache): array {
        $items = [];

        if (!$this->context->paths()->is_managed_href($this->href)) {
            return $items;
        }

        $files = $this->context->paths()->read_dir($this->path);
        foreach ($files as $file) {
            $item = self::get($this->context, $this->path . '/' . $file, $cache);
            $items[$item->path] = $item;
        }

        $this->is_content_fetched = true;

        return $items;
    }
}
