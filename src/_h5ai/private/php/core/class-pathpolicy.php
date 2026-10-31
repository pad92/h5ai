<?php

// Shared filesystem boundary for listing, search, downloads and custom content.
class PathPolicy {
    private array $managed_cache = [];
    private ?array $canonical_paths = null;

    public function __construct(
        private readonly Setup $setup,
        private readonly array $options,
    ) {}

    private function query_option(string $keypath, mixed $default = null): mixed {
        return Util::array_query($this->options, $keypath, $default);
    }

    // URL of a filesystem path below ROOT_PATH, each segment percent-encoded.
    // Does not check that $path is inside the root: callers pass managed paths.
    public function to_href(string $path, bool $trailing_slash = true): string {
        $rel_path = substr($path, strlen($this->setup->get('ROOT_PATH')));
        $parts = explode('/', $rel_path);
        $encoded_parts = array_map(rawurlencode(...), array_filter($parts, static fn(string $part): bool => $part !== ''));

        return Util::normalize_path($this->setup->get('ROOT_HREF') . implode('/', $encoded_parts), $trailing_slash);
    }

    // Filesystem path of a URL below ROOT_HREF. The result is not checked:
    // pass it to is_managed_path()/is_managed_file() before using it.
    public function to_path(string $href): string {
        $rel_href = substr($href, strlen($this->setup->get('ROOT_HREF')));
        return Util::normalize_path($this->setup->get('ROOT_PATH') . '/' . rawurldecode($rel_href));
    }

    // Whether a name (or href) matches view.hidden; '.' and '..' always do.
    public function is_hidden(string $name): bool {
        if ($name === '.' || $name === '..') {
            return true;
        }

        return array_any(
            $this->query_option('view.hidden', []),
            fn(string $re): bool => (bool) @preg_match(Util::wrap_pattern($re), $name),
        );
    }

    // Visible entry names of a folder. Unreadable entries are logged and
    // kept unless view.hideIf403 is set.
    public function read_dir(string $path): array {
        $names = [];
        if (is_dir($path)) {
            foreach (scandir($path) as $name) {
                if ($this->is_hidden($name) || $this->is_hidden($this->to_href($path) . $name)) {
                    continue;
                }
                if (!is_readable($path . '/' . $name)) {
                    Util::log('permission denied while listing: ' . $path . '/' . $name);
                    if ($this->query_option('view.hideIf403', false)) {
                        continue;
                    }
                }
                $names[] = $name;
            }
        }
        return $names;
    }

    public function is_managed_href(string $href): bool {
        return $this->is_managed_path($this->to_path($href));
    }

    // A visible regular file whose real path stays inside the root, outside
    // h5ai's own folders, in a managed folder.
    public function is_managed_file(string $path): bool {
        return $this->is_contained_file($path) && !$this->is_hidden(basename($path));
    }

    // Like is_managed_file(), but hidden names are allowed and the file must
    // be readable.
    public function is_custom_file(string $path): bool {
        // Custom header/footer names are hidden from listings by design.
        return $this->is_contained_file($path) && is_readable($path);
    }

    private function is_contained_file(string $path): bool {
        if (!is_file($path)) {
            return false;
        }

        [$root_real, $public_real, $private_real] = $this->canonical_paths();
        $file_real = realpath($path);
        if ($root_real === false || $file_real === false
            || !str_starts_with($file_real, $root_real . '/')) {
            return false;
        }
        if (($public_real !== false && str_starts_with($file_real, $public_real . '/'))
            || ($private_real !== false && str_starts_with($file_real, $private_real . '/'))) {
            return false;
        }

        return $this->is_managed_path(dirname($path));
    }

    // A folder h5ai may list: its real path stays inside the root and outside
    // h5ai's folders, it holds no view.unmanaged marker, and no folder between
    // it and the root hosts another h5ai installation.
    public function is_managed_path(string $path): bool {
        // Result is stable within a request but the check is costly (realpath +
        // walking up to the root), and it runs once per listed sub-folder.
        return $this->managed_cache[$path] ??= $this->compute_is_managed_path($path);
    }

    private function compute_is_managed_path(string $path): bool {
        if (!is_dir($path) || str_contains($path, '../') || str_contains($path, '/..') || $path === '..') {
            return false;
        }

        // Canonicalize and ensure the resolved path stays within the served root.
        // realpath() also resolves symlinks, so a symlinked directory pointing
        // outside the root is rejected here.
        [$root_real, $public_real, $private_real] = $this->canonical_paths();
        $path_real = realpath($path);
        if ($root_real === false || $path_real === false
            || ($path_real !== $root_real && !str_starts_with($path_real, $root_real . '/'))) {
            return false;
        }

        if (($public_real !== false && ($path_real === $public_real || str_starts_with($path_real, $public_real . '/')))
            || ($private_real !== false && ($path_real === $private_real || str_starts_with($path_real, $private_real . '/')))) {
            return false;
        }

        if (array_any($this->query_option('view.unmanaged', []), fn(string $name): bool => file_exists($path . '/' . $name))) {
            return false;
        }

        $root_path = $this->setup->get('ROOT_PATH');
        while ($path !== $root_path) {
            if (@is_dir($path . '/_h5ai/private/conf')) {
                return false;
            }
            $parent_path = Util::normalize_path(dirname($path));
            if ($parent_path === $path) {
                return false;
            }
            $path = $parent_path;
        }
        return true;
    }

    private function canonical_paths(): array {
        return $this->canonical_paths ??= [
            realpath($this->setup->get('ROOT_PATH')),
            realpath($this->setup->get('PUBLIC_PATH')),
            realpath($this->setup->get('PRIVATE_PATH')),
        ];
    }
}
