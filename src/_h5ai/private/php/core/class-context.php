<?php

class Context {
    private const DEFAULT_PASSHASH = 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e';
    private const AS_ADMIN_SESSION_KEY = 'AS_ADMIN';
    private const L10N_ISO_CODES = [
        'af', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'he',
        'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lv', 'nb', 'nl', 'pl',
        'pt-br', 'pt-pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'tr', 'uk',
        'zh-cn', 'zh-tw',
    ];

    private array $options;
    private string $passhash;
    private ?array $types = null;

    public function __construct(
        private readonly Session $session,
        private readonly Request $request,
        private readonly Setup $setup,
    ) {
        $this->options = Json::load($this->setup->get('CONF_PATH') . '/options.json');

        $this->passhash = $this->query_option('passhash', '');
        $this->options['hasCustomPasshash'] = strcasecmp($this->passhash, self::DEFAULT_PASSHASH) !== 0;
        unset($this->options['passhash']);
    }

    public function get_session(): Session {
        return $this->session;
    }

    public function get_request(): Request {
        return $this->request;
    }

    public function get_setup(): Setup {
        return $this->setup;
    }

    public function get_options(): array {
        return $this->options;
    }

    public function query_option(string $keypath = '', mixed $default = null): mixed {
        return Util::array_query($this->options, $keypath, $default);
    }

    public function get_types(): array {
        return $this->types ??= Json::load($this->setup->get('CONF_PATH') . '/types.json');
    }

    public function login_admin(string $pass): bool {
        $ok = $this->verify_pass($pass);
        if ($ok) {
            // Prevent session fixation when elevating privileges.
            $this->session->regenerate();
        }
        $this->session->set(self::AS_ADMIN_SESSION_KEY, $ok);
        return $this->session->get(self::AS_ADMIN_SESSION_KEY);
    }

    private function verify_pass(string $pass): bool {
        $stored = $this->passhash;
        if ($stored === '') {
            return false;
        }

        // Legacy unsalted SHA-512 hex digests (includes the default empty-password hash).
        if (preg_match('/^[a-f0-9]{128}$/i', $stored)) {
            return hash_equals(strtolower($stored), hash('sha512', $pass));
        }

        // Modern password_hash() digests (bcrypt/argon2).
        return password_verify($pass, $stored);
    }

    public function logout_admin(): bool {
        $this->session->set(self::AS_ADMIN_SESSION_KEY, false);
        $this->session->regenerate();
        return $this->session->get(self::AS_ADMIN_SESSION_KEY);
    }

    public function is_admin(): bool {
        return (bool) $this->session->get(self::AS_ADMIN_SESSION_KEY);
    }

    public function is_api_request(): bool {
        return strtolower($this->setup->get('REQUEST_METHOD')) === 'post';
    }

    public function is_info_request(): bool {
        return str_starts_with($this->setup->get('REQUEST_HREF') . '/', $this->setup->get('PUBLIC_HREF'));
    }

    public function is_text_browser(): bool {
        return preg_match('/curl|links|lynx|w3m/i', $this->setup->get('HTTP_USER_AGENT')) === 1;
    }

    public function is_fallback_mode(): bool {
        return $this->query_option('view.fallbackMode', false) || $this->is_text_browser();
    }

    public function to_href(string $path, bool $trailing_slash = true): string {
        $rel_path = substr($path, strlen($this->setup->get('ROOT_PATH')));
        $parts = explode('/', $rel_path);
        $encoded_parts = array_map(rawurlencode(...), array_filter($parts, static fn(string $part): bool => $part !== ''));

        return Util::normalize_path($this->setup->get('ROOT_HREF') . implode('/', $encoded_parts), $trailing_slash);
    }

    public function to_path(string $href): string {
        $rel_href = substr($href, strlen($this->setup->get('ROOT_HREF')));
        return Util::normalize_path($this->setup->get('ROOT_PATH') . '/' . rawurldecode($rel_href));
    }

    public function is_hidden(string $name): bool {
        if ($name === '.' || $name === '..') {
            return true;
        }

        return array_any(
            $this->query_option('view.hidden', []),
            fn(string $re): bool => (bool) @preg_match(Util::wrap_pattern($re), $name),
        );
    }

    public function read_dir(string $path): array {
        $names = [];
        if (is_dir($path)) {
            foreach (scandir($path) as $name) {
                if (
                    $this->is_hidden($name)
                    || $this->is_hidden($this->to_href($path) . $name)
                    || (!is_readable($path . '/' . $name) && $this->query_option('view.hideIf403', false))
                ) {
                    continue;
                }
                $names[] = $name;
            }
        }
        return $names;
    }

    public function is_managed_href(string $href): bool {
        return $this->is_managed_path($this->to_path($href));
    }

    public function is_managed_path(string $path): bool {
        if (!is_dir($path) || str_contains($path, '../') || str_contains($path, '/..') || $path === '..') {
            return false;
        }

        // Canonicalize and ensure the resolved path stays within the served root.
        // realpath() also resolves symlinks, so a symlinked directory pointing
        // outside the root is rejected here.
        $root_real = realpath($this->setup->get('ROOT_PATH'));
        $path_real = realpath($path);
        if ($root_real === false || $path_real === false
            || ($path_real !== $root_real && !str_starts_with($path_real, $root_real . '/'))) {
            return false;
        }

        if (str_starts_with($path, $this->setup->get('PUBLIC_PATH'))
            || str_starts_with($path, $this->setup->get('PRIVATE_PATH'))) {
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

    public function get_current_path(): string {
        $current_href = Util::normalize_path($this->setup->get('REQUEST_HREF'), true);
        $current_path = $this->to_path($current_href);

        if (!is_dir($current_path)) {
            $current_path = Util::normalize_path(dirname($current_path), false);
        }

        return $current_path;
    }

    public function get_items(string $href, int $what): array {
        if (!$this->is_managed_href($href)) {
            return [];
        }

        Filesize::set_async_mode(true);

        $cache = [];
        $folder = Item::get($this, $this->to_path($href), $cache);

        if ($what >= 3 && $folder !== null) {
            foreach ($folder->get_content($cache) as $item) {
                $item->get_content($cache);
            }
            $folder = $folder->get_parent($cache);
        }

        while ($what >= 2 && $folder !== null) {
            $folder->get_content($cache);
            $folder = $folder->get_parent($cache);
        }

        if ($what === 1 && $folder !== null) {
            $folder->get_content($cache);
        }

        Filesize::set_async_mode(false);

        uasort($cache, Item::cmp(...));
        $result = [];
        foreach ($cache as $item) {
            $result[] = $item->to_json_object();
        }

        include_once __DIR__ . '/../ext/class-thumb.php';
        include_once __DIR__ . '/../ext/class-cachedb.php';

        $db = new CacheDB($this->setup);
        $height = $this->options['thumbnails']['size'] ?? 240;
        $width = (int) floor($height * (4 / 3));
        $supported_formats = ['png', 'jpg', 'jpeg', 'webp'];

        foreach ($result as &$item_obj) {
            if (!isset($item_obj['managed'])) {
                continue;
            }
            $folder_path = $this->to_path($item_obj['href']);
            $thumb_dir = $folder_path . '/_thumb';

            if (!is_dir($thumb_dir)) {
                continue;
            }
            $files = @scandir($thumb_dir);
            if (!$files) {
                continue;
            }

            $match = array_find($files, fn(string $file): bool => in_array(strtolower(pathinfo($file, PATHINFO_EXTENSION)), $supported_formats, true));
            if ($match !== null) {
                $thumb_gen = new Thumb($this, $thumb_dir . '/' . $match, 'img', $db);
                $thumb_href = $thumb_gen->thumb($width, $height);
                if ($thumb_href) {
                    $item_obj['thumbSquare'] = $thumb_href;
                    $item_obj['thumbRational'] = $thumb_href;
                }
            }
        }
        unset($item_obj);

        $stale_paths = Filesize::get_stale_paths();
        if (!empty($stale_paths)) {
            $this->trigger_folder_refresh($stale_paths);
        }

        return $result;
    }

    private function trigger_folder_refresh(array $paths): void {
        $script_path = $this->setup->get('PRIVATE_PATH') . '/php/refresh-cache.php';
        $args = implode(' ', array_map(escapeshellarg(...), $paths));
        $cmd = 'nice -n 19 php ' . escapeshellarg($script_path) . ' ' . $args . ' > /dev/null 2>&1 &';
        @exec($cmd);
    }

    public function get_langs(): array {
        $langs = [];
        $l10n_path = $this->setup->get('CONF_PATH') . '/l10n';
        if (is_dir($l10n_path)) {
            if ($dir = opendir($l10n_path)) {
                while (($file = readdir($dir)) !== false) {
                    if (str_ends_with($file, '.json')) {
                        $translations = Json::load($l10n_path . '/' . $file);
                        $langs[basename($file, '.json')] = $translations['lang'];
                    }
                }
                closedir($dir);
            }
        }
        ksort($langs);
        return $langs;
    }

    public function get_l10n(array $iso_codes): array {
        $results = [];
        foreach ($iso_codes as $iso_code) {
            if (!in_array($iso_code, self::L10N_ISO_CODES, true)) {
                continue;
            }
            $file = $this->setup->get('CONF_PATH') . '/l10n/' . $iso_code . '.json';
            $results[$iso_code] = Json::load($file);
            $results[$iso_code]['isoCode'] = $iso_code;
        }
        return $results;
    }

    public function get_thumbs(array $requests): array {
        $hrefs = [];
        $thumbs = [];
        $filetypes = [];
        $height = $this->options['thumbnails']['size'] ?? 240;
        $width = (int) floor($height * (4 / 3));
        $db = new CacheDB($this->setup);

        foreach ($requests as $req) {
            if ($req['type'] === 'blocked') {
                $hrefs[] = null;
                $filetypes[] = null;
                continue;
            }
            $path = $this->to_path($req['href']);
            if (!$this->is_managed_path(dirname($path)) || $this->is_hidden(basename($path))) {
                $hrefs[] = null;
                $filetypes[] = null;
                continue;
            }
            if (!array_key_exists($path, $thumbs)) {
                $thumbs[$path] = new Thumb($this, $path, $req['type'], $db);
            } elseif ($thumbs[$path]->get_type()->name === 'file') {
                $hrefs[] = null;
                $filetypes[] = 'file';
                continue;
            }

            $req_width = isset($req['width']) ? (int) $req['width'] : $width;
            $req_height = isset($req['height']) ? (int) $req['height'] : $height;
            $hrefs[] = $thumbs[$path]->thumb($req_width, $req_height);

            if ($thumbs[$path]->get_type()?->was_wrong()) {
                $filetypes[] = $thumbs[$path]->get_type()->name;
            } else {
                $filetypes[] = null;
            }
        }
        return [$hrefs, $filetypes];
    }

    private function prefix_x_head_href(string $href): string {
        if (preg_match('@^(https?://|/)@i', $href)) {
            return $href;
        }
        return $this->setup->get('PUBLIC_HREF') . 'ext/' . $href;
    }

    private function get_fonts_html(): string {
        $fonts = $this->query_option('view.fonts', []);
        $fonts_mono = $this->query_option('view.fontsMono', []);
        $escape = static fn(string $f): string => str_replace(['\\', '"'], ['\\\\', '\\"'], $f);

        $html = '<style class="x-head">';
        if (count($fonts) > 0) {
            $escaped = array_map($escape, $fonts);
            $html .= '#root,input,select{font-family:"' . implode('","', $escaped) . '"!important}';
        }
        if (count($fonts_mono) > 0) {
            $escaped = array_map($escape, $fonts_mono);
            $html .= 'pre,code{font-family:"' . implode('","', $escaped) . '"!important}';
        }
        $html .= '</style>';
        return $html;
    }

    public function get_x_head_html(): string {
        $scripts = $this->query_option('resources.scripts', []);
        $styles = $this->query_option('resources.styles', []);
        $html = '';
        foreach ($styles as $href) {
            $html .= '<link rel="stylesheet" href="' . htmlspecialchars($this->prefix_x_head_href($href), ENT_QUOTES, 'UTF-8') . '" class="x-head">';
        }
        foreach ($scripts as $href) {
            $html .= '<script src="' . htmlspecialchars($this->prefix_x_head_href($href), ENT_QUOTES, 'UTF-8') . '" class="x-head"></script>';
        }
        $html .= $this->get_fonts_html();
        return $html;
    }
}
