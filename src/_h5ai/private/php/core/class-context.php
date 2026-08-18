<?php

class Context {
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
    private array $managed_cache = [];
    private ?array $foldersize_mode = null;
    private ?array $canonical_paths = null;

    public function __construct(
        private readonly Session $session,
        private readonly Request $request,
        private readonly Setup $setup,
    ) {
        $this->options = Json::load($this->setup->get('CONF_PATH') . '/options.json');

        $this->passhash = $this->query_option('passhash', '');
        $this->options['hasCustomPasshash'] = $this->passhash !== '';
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

    // [$withFoldersize, $withDu, $timeout, $background_timeout] for the current
    // request. The two timeouts differ because a request must answer inside the
    // pool's request_terminate_timeout while a CLI worker has no such limit;
    // callers pick the one matching their context. Constant per request, so it
    // is memoized to avoid recomputing it for every listed item.
    public function foldersize_mode(): array {
        return $this->foldersize_mode ??= [
            $this->query_option('foldersize.enabled', false),
            $this->setup->get('HAS_CMD_DU') && $this->query_option('foldersize.type', null) === 'shell-du',
            $this->foldersize_timeout('foldersize.timeout', Filesize::DEFAULT_TIMEOUT),
            $this->foldersize_timeout('foldersize.backgroundTimeout', Filesize::DEFAULT_BACKGROUND_TIMEOUT),
        ];
    }

    // A number is clamped into range, because an out-of-range one is still a
    // deliberate choice. Anything non-numeric (null, a string, an array) is
    // malformed and falls back to the default: casting it would yield 0 and
    // silently cripple every du pass to the one-second floor.
    private function foldersize_timeout(string $option, int $default): int {
        $value = $this->query_option($option, $default);
        if (!is_numeric($value)) {
            $value = $default;
        }
        $value = (float) $value;
        if (is_nan($value)) {
            $value = (float) $default;
        }
        // Clamp as a float, then cast. Casting first would turn an overflowing
        // literal such as 1e9999 into INF, then into 0, landing on the floor
        // instead of the ceiling (and warning about it).
        return (int) max(1, min(Filesize::MAX_TIMEOUT, $value));
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

    public function is_managed_file(string $path): bool {
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

        return $this->is_managed_path(dirname($path)) && !$this->is_hidden(basename($path));
    }

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

        $db = null;
        $height = $this->options['thumbnails']['size'] ?? 240;
        $width = (int) floor($height * (4 / 3));

        if ($this->query_option('thumbnails.enabled', false) && $this->setup->get('HAS_PHP_WEBP')) {
            foreach ($result as &$item_obj) {
                if (!isset($item_obj['managed'])) {
                    continue;
                }
                $custom_thumb = Thumb::check_custom_thumb($this->to_path($item_obj['href']));
                if ($custom_thumb === null || !$this->is_managed_file($custom_thumb)) {
                    continue;
                }

                $db ??= new CacheDB($this->setup);
                $thumb_gen = new Thumb($this, $custom_thumb, 'img', $db);
                $thumb_href = $thumb_gen->thumb($width, $height);
                if ($thumb_href) {
                    $item_obj['thumbSquare'] = $thumb_href;
                    $item_obj['thumbRational'] = $thumb_href;
                }
            }
            unset($item_obj);
        }

        $stale_paths = Filesize::get_stale_paths();
        if (!empty($stale_paths)) {
            $this->trigger_folder_refresh($stale_paths);
        }

        return $result;
    }

    private function trigger_folder_refresh(array $paths): void {
        $marker = $this->setup->get('CACHE_PRV_PATH') . '/refresh.requested';
        if (is_file($marker) && (time() - (int) @filemtime($marker)) > 300) {
            @unlink($marker);
        }
        $marker_handle = @fopen($marker, 'x');
        if (!$marker_handle) {
            return;
        }
        fclose($marker_handle);
        $script_path = $this->setup->get('PRIVATE_PATH') . '/php/refresh-cache.php';
        if (!Util::launch_background($script_path, $paths)) {
            @unlink($marker);
        }
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

        $max_batch = max(1, (int) $this->query_option('thumbnails.maxBatchSize', 40));
        $max_dimension = max(1, (int) $this->query_option('thumbnails.maxDimension', 4096));

        foreach (array_slice($requests, 0, $max_batch) as $req) {
            if (!is_array($req) || !isset($req['type'], $req['href'])
                || !is_string($req['type']) || !is_string($req['href'])) {
                $hrefs[] = null;
                $filetypes[] = null;
                continue;
            }
            if ($req['type'] === 'blocked') {
                $hrefs[] = null;
                $filetypes[] = null;
                continue;
            }
            $path = $this->to_path($req['href']);
            if (!$this->is_managed_file($path)) {
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

            $req_width = min($max_dimension, max(1, isset($req['width']) ? (int) $req['width'] : $width));
            $req_height = min($max_dimension, max(0, isset($req['height']) ? (int) $req['height'] : $height));
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
