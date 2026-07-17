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
        $request = new Request($_REQUEST, file_get_contents('php://input'));
        $setup = new Setup($request->query_boolean('refresh', false));
        $context = new Context($session, $request, $setup);

        self::trigger_background_warming($context);

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

    private static function trigger_background_warming(Context $context): void {
        $setup = $context->get_setup();
        if (!$context->query_option('cache.warm_at_startup', false)) {
            return;
        }

        $lock_file = $setup->get('CACHE_PRV_PATH') . '/warmer.lock';
        $fp = @fopen($lock_file, 'c+');
        if (!$fp) {
            return;
        }

        if (flock($fp, LOCK_EX | LOCK_NB)) {
            $lastrun_file = $setup->get('CACHE_PRV_PATH') . '/warmer.lastrun';
            $laststart_file = $setup->get('CACHE_PRV_PATH') . '/warmer.laststart';
            $lastrun = @file_get_contents($lastrun_file);
            $laststart = @file_get_contents($laststart_file);
            $now = time();
            $interval = (int) $context->query_option('cache.warm_interval', 86400);
            $laststart = (int) $laststart;
            if ($laststart > 0 && ($now - $laststart) > 300) {
                @unlink($laststart_file);
                $laststart = 0;
            }
            $last_activity = max((int) $lastrun, $laststart);

            if (!$last_activity || ($now - $last_activity) > $interval) {
                @file_put_contents($laststart_file, (string) $now, LOCK_EX);
                $script_path = $setup->get('PRIVATE_PATH') . '/php/warm-cache.php';
                if (!Util::launch_background($script_path)) {
                    @unlink($laststart_file);
                }
            }
            flock($fp, LOCK_UN);
            fclose($fp);
        } else {
            fclose($fp);
        }
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
