<?php

class Filesize {
    private static $cache = [];
    private static $persistent_cache = null;
    private static $persistent_cache_dirty = false;
    private static $persistent_cache_path = null;

    private static function init_persistent_cache() {
        if (self::$persistent_cache !== null) {
            return;
        }
        self::$persistent_cache_path = dirname(__FILE__) . '/../../cache/foldersizes.json';
        if (file_exists(self::$persistent_cache_path)) {
            $content = @file_get_contents(self::$persistent_cache_path);
            self::$persistent_cache = json_decode($content, true);
            if (!is_array(self::$persistent_cache)) {
                self::$persistent_cache = [];
            }
        } else {
            self::$persistent_cache = [];
        }

        register_shutdown_function(['Filesize', 'save_persistent_cache']);
    }

    public static function save_persistent_cache() {
        if (self::$persistent_cache_dirty && self::$persistent_cache_path !== null) {
            $dir = dirname(self::$persistent_cache_path);
            if (!is_dir($dir)) {
                @mkdir($dir, 0755, true);
            }
            @file_put_contents(self::$persistent_cache_path, json_encode(self::$persistent_cache));
            self::$persistent_cache_dirty = false;
        }
    }

    public static function set_persistent_cache_entry($path, $size, $dirs) {
        self::init_persistent_cache();
        self::$persistent_cache[$path] = [
            'size' => $size,
            'mtime' => @filemtime($path),
            'dirs' => $dirs
        ];
        self::$persistent_cache_dirty = true;
    }

    private static function is_cache_entry_valid($entry) {
        if (!is_array($entry) || !isset($entry['dirs']) || !is_array($entry['dirs'])) {
            return false;
        }
        foreach ($entry['dirs'] as $dir_path => $cached_mtime) {
            if (!is_dir($dir_path) || @filemtime($dir_path) !== $cached_mtime) {
                return false;
            }
        }
        return true;
    }

    public static function getSize($path, $withFoldersize, $withDu) {
        $fs = new Filesize();
        return $fs->size($path, $withFoldersize, $withDu);
    }

    public static function getCachedSize($path, $withFoldersize, $withDu) {
        if (array_key_exists($path, Filesize::$cache)) {
            return Filesize::$cache[$path];
        }

        if (is_dir($path) && $withFoldersize) {
            self::init_persistent_cache();
            if (array_key_exists($path, self::$persistent_cache)) {
                $entry = self::$persistent_cache[$path];
                if (self::is_cache_entry_valid($entry)) {
                    $size = $entry['size'];
                    Filesize::$cache[$path] = $size;
                    return $size;
                }
            }
        }

        $size = Filesize::getSize($path, $withFoldersize, $withDu);

        Filesize::$cache[$path] = $size;
        return $size;
    }


    private function __construct() {}

    private function read_dir($path) {
        $paths = [];
        if (is_dir($path)) {
            foreach (scandir($path) as $name) {
                if ($name !== '.' && $name !== '..') {
                    $paths[] = $path . '/' . $name;
                }
            }
        }
        return $paths;
    }

    private function php_filesize($path, $recursive = false, &$dirs = []) {
        $size = @filesize($path);

        if (!is_dir($path)) {
            return $size;
        }

        $dirs[$path] = @filemtime($path);

        if (!$recursive) {
            return $size;
        }

        foreach ($this->read_dir($path) as $p) {
            if (is_dir($p)) {
                Filesize::init_persistent_cache();
                if (array_key_exists($p, Filesize::$persistent_cache)) {
                    $entry = Filesize::$persistent_cache[$p];
                    if (Filesize::is_cache_entry_valid($entry)) {
                        $size += $entry['size'];
                        foreach ($entry['dirs'] as $d => $mt) {
                            $dirs[$d] = $mt;
                        }
                        continue;
                    }
                }

                $sub_dirs = [];
                $sub_size = $this->php_filesize($p, true, $sub_dirs);
                $size += $sub_size;

                Filesize::set_persistent_cache_entry($p, $sub_size, $sub_dirs);

                foreach ($sub_dirs as $d => $mt) {
                    $dirs[$d] = $mt;
                }
            } else {
                $size += @filesize($p);
            }
        }
        return $size;
    }


    private function exec($cmdv) {
        $cmd = implode(' ', array_map('escapeshellarg', $cmdv));
        $lines = [];
        $rc = null;
        exec($cmd, $lines, $rc);
        return $lines;
    }

    private function exec_du_all($paths) {
        $cmdv = array_merge(['du', '-sbL'], $paths);
        $lines = $this->exec($cmdv);

        $sizes = [];
        foreach ($lines as $line) {
            $parts = preg_split('/[\s]+/', $line, 2);
            $size = intval($parts[0], 10);
            $path = $parts[1];
            $sizes[$path] = $size;
        }
        return $sizes;
    }

    private function exec_du($path) {
        $sizes = $this->exec_du_all([$path]);
        return $sizes[$path];
    }

    private function get_all_subdirs($path) {
        $dirs = [$path => @filemtime($path)];
        try {
            $iterator = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($path, RecursiveDirectoryIterator::SKIP_DOTS),
                RecursiveIteratorIterator::SELF_FIRST
            );
            foreach ($iterator as $item) {
                if ($item->isDir()) {
                    $p = Util::normalize_path($item->getPathname(), false);
                    $dirs[$p] = @filemtime($p);
                }
            }
        } catch (Exception $e) {}
        return $dirs;
    }

    private function size($path, $withFoldersize = false, $withDu = false) {
        if (is_file($path)) {
            return $this->php_filesize($path);
        }

        if (is_dir($path) && $withFoldersize) {
            if ($withDu) {
                $size = $this->exec_du($path);
                $dirs = $this->get_all_subdirs($path);
                Filesize::set_persistent_cache_entry($path, $size, $dirs);
                return $size;
            }

            $dirs = [];
            $size = $this->php_filesize($path, true, $dirs);
            Filesize::set_persistent_cache_entry($path, $size, $dirs);
            return $size;
        }

        return null;
    }
}
