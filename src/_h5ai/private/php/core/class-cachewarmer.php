<?php

class CacheWarmer {
    private readonly Setup $setup;
    private readonly TypeHelper $type_helper;
    private ?Thumb $thumb_instance;
    private int $size;
    private array $img_types;
    private array $mov_types;
    private array $doc_types;
    private array $aud_types;
    private readonly bool $thumbnails_enabled;

    public function __construct(private readonly Context $context) {
        $this->setup = $context->get_setup();

        $types_data = Json::load($this->setup->get('CONF_PATH') . '/types.json');
        $this->type_helper = new TypeHelper($types_data);

        $this->thumbnails_enabled = $this->context->query_option('thumbnails.enabled', false) && $this->setup->get('HAS_PHP_WEBP');
        if ($this->thumbnails_enabled) {
            $this->thumb_instance = new Thumb($this->context);
            $this->size = (int) $this->context->query_option('thumbnails.size', 100);
            $this->img_types = $this->context->query_option('thumbnails.img', []);
            $this->mov_types = $this->context->query_option('thumbnails.mov', []);
            $this->doc_types = $this->context->query_option('thumbnails.doc', []);
            $this->aud_types = $this->context->query_option('thumbnails.aud', []);
        }
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
                && $this->thumbnails_enabled
                && $this->context->is_managed_file($child_path)) {
                $type = $this->type_helper->getType($file);
                $thumb_type = match (true) {
                    in_array($type, $this->img_types, true) => 'img',
                    in_array($type, $this->mov_types, true) => 'mov',
                    in_array($type, $this->doc_types, true) => 'doc',
                    in_array($type, $this->aud_types, true) => 'aud',
                    default => null,
                };

                if ($thumb_type !== null) {
                    $href = $this->context->to_href($child_path, false);
                    $this->thumb_instance->thumb($thumb_type, $href, $this->size, $this->size);
                    $this->thumb_instance->thumb($thumb_type, $href, (int) round($this->size * 4 / 3), $this->size);
                }
            }
        }

        [$withFoldersize, $withDu] = $this->context->foldersize_mode();
        if ($withFoldersize) {
            Filesize::getCachedSize($path, $withFoldersize, $withDu);
        }
    }
}

class TypeHelper {
    private array $regexps = [];

    public function __construct(array $types) {
        foreach ($types as $type => $patterns) {
            if (!isset($patterns['glob'])) {
                continue;
            }
            $parts = [];
            foreach ($patterns['glob'] as $pattern) {
                $escaped = preg_quote($pattern, '/');
                $escaped = str_replace('\\*', '.*', $escaped);
                $parts[] = '(' . $escaped . ')';
            }
            if (!empty($parts)) {
                $this->regexps[$type] = '/^(' . implode('|', $parts) . ')$/i';
            }
        }
    }

    public function getType(string $name): string {
        return array_find_key($this->regexps, fn(string $regex): bool => (bool) preg_match($regex, $name)) ?? 'file';
    }
}
