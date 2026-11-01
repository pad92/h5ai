<?php

class Context {
    // Depth of an API listing (`items.what`). Each level includes the ones
    // before it: the folder's content, then the content of every ancestor
    // up to the root (for the tree), then the content of each subfolder.
    public const LIST_FOLDER = 1;
    public const LIST_WITH_ANCESTORS = 2;
    public const LIST_WITH_SUBFOLDERS = 3;

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
    private ?TypeMatcher $type_matcher = null;
    private readonly PathPolicy $paths;
    private ?array $foldersize_mode = null;

    public function __construct(
        private readonly Session $session,
        private readonly Request $request,
        private readonly Setup $setup,
    ) {
        $this->options = Json::load($this->setup->get('CONF_PATH') . '/options.json');

        $this->passhash = $this->query_option('passhash', '');
        $this->options['hasCustomPasshash'] = $this->passhash !== '';
        unset($this->options['passhash']);
        $this->paths = new PathPolicy($this->setup, $this->options);
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

    // [$with_foldersize, $with_du, $timeout, $background_timeout] for the current
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
        // A numeric string or JSON number is never NaN once cast.
        $value = (float) $value;
        // Clamp as a float, then cast. Casting first would turn an overflowing
        // literal such as 1e9999 into INF, then into 0, landing on the floor
        // instead of the ceiling (and warning about it).
        return (int) max(1, min(Filesize::MAX_TIMEOUT, $value));
    }

    public function get_types(): array {
        return $this->types ??= Json::load($this->setup->get('CONF_PATH') . '/types.json');
    }

    public function get_type_matcher(): TypeMatcher {
        return $this->type_matcher ??= new TypeMatcher($this->get_types());
    }

    // Refused without checking the password while the client is throttled
    // (see LoginThrottle). Login is disabled when no passhash is configured.
    public function login_admin(string $pass): bool {
        if ($this->passhash === '') {
            $this->session->set(self::AS_ADMIN_SESSION_KEY, false);
            return false;
        }
        $client = $this->request->client_address();
        $throttle = new LoginThrottle($this->setup->get('CACHE_PRV_PATH') . '/login-failures.json');
        if (!$throttle->try_attempt($client)) {
            Util::log('admin login refused: too many failed attempts from this client');
            $this->session->set(self::AS_ADMIN_SESSION_KEY, false);
            return false;
        }
        $ok = $this->verify_pass($pass);
        if ($ok) {
            $throttle->forget($client);
            // Prevent session fixation when elevating privileges.
            $this->session->regenerate();
        }
        $this->session->set(self::AS_ADMIN_SESSION_KEY, $ok);
        return $this->session->get(self::AS_ADMIN_SESSION_KEY);
    }

    // Only called by login_admin(), once a passhash is known to be set.
    private function verify_pass(string $pass): bool {
        $stored = $this->passhash;

        // Legacy unsalted SHA-512 hex digests (includes the default empty-password
        // hash). Still accepted so existing installations keep working.
        if (preg_match('/^[a-f0-9]{128}$/i', $stored)) {
            $ok = hash_equals(strtolower($stored), hash('sha512', $pass));
            if ($ok) {
                Util::log('deprecated: passhash is an unsalted SHA-512 digest; replace it with a password_hash() value');
            }
            return $ok;
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
        return self::is_admin_session($this->session);
    }

    private static function is_admin_session(Session $session): bool {
        return (bool) $session->get(self::AS_ADMIN_SESSION_KEY);
    }

    // Decided before Setup exists, since Setup probes the host on creation.
    // Re-probing runs a shell command per tool, and the info page asks for
    // it on every load, so only an administrator session triggers it.
    public static function wants_setup_refresh(Request $request, Session $session): bool {
        return $request->query_boolean('refresh', false) && self::is_admin_session($session);
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

    // Path <-> URL mapping and access checks for the served tree.
    public function paths(): PathPolicy {
        return $this->paths;
    }

    public function get_current_path(): string {
        $current_href = Util::normalize_path($this->setup->get('REQUEST_HREF'), true);
        $current_path = $this->paths->to_path($current_href);

        if (!is_dir($current_path)) {
            $current_path = Util::normalize_path(dirname($current_path), false);
        }

        return $current_path;
    }

    // Items for an API listing of $href, sorted folders first, as JSON-ready
    // arrays. $what is one of the LIST_* depths; an unmanaged $href yields [].
    // Folder sizes come from the cache only (see with_cached_folder_sizes()).
    public function get_items(string $href, int $what): array {
        if (!$this->paths->is_managed_href($href)) {
            return [];
        }

        $cache = $this->with_cached_folder_sizes(function () use ($href, $what): array {
            $cache = [];
            $folder = Item::get($this, $this->paths->to_path($href), $cache);

            if ($what >= self::LIST_WITH_SUBFOLDERS && $folder !== null) {
                foreach ($folder->get_content($cache) as $item) {
                    $item->get_content($cache);
                }
                $folder = $folder->get_parent($cache);
            }

            while ($what >= self::LIST_WITH_ANCESTORS && $folder !== null) {
                $folder->get_content($cache);
                $folder = $folder->get_parent($cache);
            }

            if ($what === self::LIST_FOLDER && $folder !== null) {
                $folder->get_content($cache);
            }
            return $cache;
        });

        uasort($cache, Item::cmp(...));
        $result = [];
        foreach ($cache as $item) {
            $result[] = $item->to_json_object();
        }

        $db = null;
        [$width, $height] = Thumb::default_dimensions($this);

        if ($this->query_option('thumbnails.enabled', false) && $this->setup->get('HAS_PHP_WEBP')) {
            foreach ($result as &$item_obj) {
                if (!isset($item_obj['managed'])) {
                    continue;
                }
                $custom_thumb = Thumb::check_custom_thumb($this->paths->to_path($item_obj['href']));
                if ($custom_thumb === null || !$this->paths->is_managed_file($custom_thumb)) {
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

        return $result;
    }

    // Runs $build with folder sizes served from the cache only: a request
    // never waits on du. Folders missing from the cache or expired are
    // handed to the background refresh worker afterwards.
    public function with_cached_folder_sizes(callable $build): mixed {
        Filesize::begin_async_mode();
        try {
            $result = $build();
        } finally {
            $stale_paths = Filesize::end_async_mode();
        }
        $this->trigger_folder_refresh($stale_paths);
        return $result;
    }

    public function trigger_folder_refresh(array $paths): void {
        if ($paths === []) {
            return;
        }
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

    // Answers a thumbs API request: for each entry {type, href[, width,
    // height]} the thumbnail href (or null) and, when generation found the
    // browser's type wrong, the corrected type (or null). At most
    // thumbnails.maxBatchSize entries are processed.
    public function get_thumbs(array $requests): array {
        $hrefs = [];
        $thumbs = [];
        $filetypes = [];
        $db = new CacheDB($this->setup);

        $max_batch = max(1, (int) $this->query_option('thumbnails.maxBatchSize', 40));

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
            $path = $this->paths->to_path($req['href']);
            if (!$this->paths->is_managed_file($path)) {
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

            [$req_width, $req_height] = Thumb::request_dimensions($this, $req);
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
