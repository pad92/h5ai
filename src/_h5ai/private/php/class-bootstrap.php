<?php

class Bootstrap {
    private static array $autopaths = ['core', 'ext'];

    public static function run(): void {
        spl_autoload_register(self::autoload(...));
        putenv('LANG=en_US.UTF-8');
        setlocale(LC_CTYPE, 'en_US.UTF-8');
        session_start([
            'cookie_httponly' => true,
            'cookie_samesite' => 'Strict',
            'cookie_secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
            'use_strict_mode' => true,
        ]);

        $session = new Session($_SESSION);
        $request = Request::from_globals();
        $setup = new Setup(Context::wants_setup_refresh($request, $session));
        $context = new Context($session, $request, $setup);

        CacheWarmer::launch_if_due($context);

        if ($context->is_api_request()) {
            new Api($context)->apply();
        } elseif ($context->is_info_request()) {
            $public_href = $setup->get('PUBLIC_HREF');
            $x_head_tags = $context->get_x_head_html();
            $fallback_mode = false;
            require __DIR__ . '/pages/info.php';
        } else {
            $public_href = $setup->get('PUBLIC_HREF');
            $x_head_tags = $context->get_x_head_html();
            $fallback_mode = $context->is_fallback_mode();
            $fallback_html = new Fallback($context)->get_html();
            require __DIR__ . '/pages/index.php';
        }
    }

    // Shared by the CLI workers (warm-cache.php, refresh-cache.php): they see
    // the served tree as a GET request for its root would.
    public static function cli_context(): Context {
        require_once __DIR__ . '/version.php';
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/';
        $_SERVER['SCRIPT_NAME'] = '/_h5ai/public/index.php';
        $_SERVER['SERVER_SOFTWARE'] = 'CLI';
        $_SERVER['HTTP_USER_AGENT'] = 'CLI';
        spl_autoload_register(self::autoload(...));

        $session_store = [];
        return new Context(new Session($session_store), new Request([], ''), new Setup());
    }

    public static function autoload(string $class_name): bool {
        $filename = 'class-' . strtolower($class_name) . '.php';

        foreach (self::$autopaths as $path) {
            $file = __DIR__ . '/' . $path . '/' . $filename;
            if (file_exists($file)) {
                require_once $file;
                return true;
            }
        }
        return false;
    }
}
