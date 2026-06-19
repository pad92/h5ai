<?php

class Search {
    private $context;

    public function __construct($context) {
        $this->context = $context;
    }

    public function get_paths($root, $pattern = null, $ignorecase = false, &$visited = []) {
        $paths = [];
        $real_root = realpath($root);
        if ($real_root === false) {
            $real_root = $root;
        }
        if (in_array($real_root, $visited)) {
            return [];
        }
        $visited[] = $real_root;

        if ($pattern && $this->context->is_managed_path($root)) {
            $re = Util::wrap_pattern($pattern);
            if ($ignorecase) {
                $re .= 'i';
            }
            $names = $this->context->read_dir($root);
            foreach ($names as $name) {
                $path = $root . '/' . $name;
                if (@preg_match($re, @basename($path))) {
                    $paths[] = $path;
                }
                if (@is_dir($path) && !@is_link($path)) {
                    $paths = array_merge($paths, $this->get_paths($path, $pattern, $ignorecase, $visited));
                }
            }
        }
        return $paths;
    }

    public function get_items($href, $pattern = null, $ignorecase = false) {
        $cache = [];
        $root = $this->context->to_path($href);
        $paths = $this->get_paths($root, $pattern, $ignorecase);
        $items = array_map(function ($path) use (&$cache) {
            return Item::get($this->context, $path, $cache)->to_json_object();
        }, $paths);
        return $items;
    }
}
