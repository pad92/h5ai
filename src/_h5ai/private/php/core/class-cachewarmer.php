<?php

class CacheWarmer {
    private $context;
    private $setup;
    private $type_helper;
    private $thumb_instance;
    private $size;
    private $img_types;
    private $mov_types;
    private $doc_types;
    private $thumbnails_enabled;

    public function __construct($context) {
        $this->context = $context;
        $this->setup = $context->get_setup();

        // Initialize TypeHelper
        $types_data = Json::load($this->setup->get('CONF_PATH') . '/types.json');
        $this->type_helper = new TypeHelper($types_data);

        // Thumbnail settings
        $this->thumbnails_enabled = $this->context->query_option('thumbnails.enabled', false) && $this->setup->get('HAS_PHP_JPEG');
        if ($this->thumbnails_enabled) {
            $this->thumb_instance = new Thumb($this->context);
            $this->size = intval($this->context->query_option('thumbnails.size', 100));
            $this->img_types = $this->context->query_option('thumbnails.img', []);
            $this->mov_types = $this->context->query_option('thumbnails.mov', []);
            $this->doc_types = $this->context->query_option('thumbnails.doc', []);
        }
    }

    public function warm() {
        $root_path = $this->setup->get('ROOT_PATH');
        $this->warm_path($root_path);
    }

    private function warm_path($path) {
        if (!is_dir($path) || !$this->context->is_managed_path($path)) {
            return;
        }

        // Get direct files using context's read_dir so we respect hidden filters
        $files = $this->context->read_dir($path);
        
        foreach ($files as $file) {
            $child_path = $path . '/' . $file;
            if (is_dir($child_path)) {
                // Recursive warm of subdirectory
                $this->warm_path($child_path);
            } else {
                // If it is a file, check if we need to generate thumbnails
                if ($this->thumbnails_enabled) {
                    $type = $this->type_helper->getType($file);
                    $thumb_type = null;
                    if (in_array($type, $this->img_types)) {
                        $thumb_type = 'img';
                    } elseif (in_array($type, $this->mov_types)) {
                        $thumb_type = 'mov';
                    } elseif (in_array($type, $this->doc_types)) {
                        $thumb_type = 'doc';
                    }

                    if ($thumb_type !== null) {
                        $href = $this->context->to_href($child_path, false);
                        // Generate square thumbnail
                        $this->thumb_instance->thumb($thumb_type, $href, $this->size, $this->size);
                        // Generate landscape thumbnail
                        $this->thumb_instance->thumb($thumb_type, $href, intval(round($this->size * 4 / 3)), $this->size);
                    }
                }
            }
        }

        // Compute and store folder size in persistent cache
        // We call getCachedSize to calculate and persist the folder size
        $withFoldersize = $this->context->query_option('foldersize.enabled', false);
        $withDu = $this->setup->get('HAS_CMD_DU') && $this->context->query_option('foldersize.type', null) === 'shell-du';
        if ($withFoldersize) {
            // This will compute (using the optimized recursive cached method) and save to persistent cache
            Filesize::getCachedSize($path, $withFoldersize, $withDu);
        }
    }
}

class TypeHelper {
    private $regexps = [];

    public function __construct($types) {
        if (is_array($types)) {
            foreach ($types as $type => $patterns) {
                $parts = [];
                if (isset($patterns['glob'])) {
                    foreach ($patterns['glob'] as $pattern) {
                        $escaped = preg_quote($pattern, '/');
                        $escaped = str_replace('\\*', '.*', $escaped);
                        $parts[] = '(' . $escaped . ')';
                    }
                }
                if (!empty($parts)) {
                    $this->regexps[$type] = '/^(' . implode('|', $parts) . ')$/i';
                }
            }
        }
    }

    public function getType($name) {
        foreach ($this->regexps as $type => $regex) {
            if (preg_match($regex, $name)) {
                return $type;
            }
        }
        return 'file';
    }
}
