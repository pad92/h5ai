<?php

class Bootstrap {
    private static $autopaths = ['core', 'ext'];

    public static function run() {
        spl_autoload_register(['Bootstrap', 'autoload']);
        putenv('LANG=en_US.UTF-8');
        setlocale(LC_CTYPE, 'en_US.UTF-8');
        date_default_timezone_set(@date_default_timezone_get());
        session_start();

        $session = new Session($_SESSION);
        $request = new Request($_REQUEST, file_get_contents('php://input'));
        $setup = new Setup($request->query_boolean('refresh', false));
        $context = new Context($session, $request, $setup);

        self::trigger_background_warming($context);

        if ($context->is_api_request()) {
            (new Api($context))->apply();
        } elseif ($context->is_info_request()) {
            $public_href = $setup->get('PUBLIC_HREF');
            $x_head_tags = $context->get_x_head_html();
            $fallback_mode = false;
            require __DIR__ . '/pages/info.php';
        } else {
            $public_href = $setup->get('PUBLIC_HREF');
            $x_head_tags = $context->get_x_head_html();
            $fallback_mode = $context->is_fallback_mode();
            $fallback_html = (new Fallback($context))->get_html();
            require __DIR__ . '/pages/index.php';
        }
    }

    private static function trigger_background_warming($context) {
        $setup = $context->get_setup();
        $enabled = $context->query_option('cache.warm_at_startup', false);
        if (!$enabled) {
            return;
        }

        $lock_file = $setup->get('CACHE_PRV_PATH') . '/warmer.lock';
        $fp = @fopen($lock_file, 'c+');
        if ($fp) {
            if (flock($fp, LOCK_EX | LOCK_NB)) {
                flock($fp, LOCK_UN);
                fclose($fp);

                $lastrun_file = $setup->get('CACHE_PRV_PATH') . '/warmer.lastrun';
                $lastrun = @file_get_contents($lastrun_file);
                $now = time();
                $interval = intval($context->query_option('cache.warm_interval', 86400));

                if (!$lastrun || ($now - intval($lastrun)) > $interval) {
                    $script_path = $setup->get('PRIVATE_PATH') . '/php/warm-cache.php';
                    $cmd = "nice -n 19 php " . escapeshellarg($script_path) . " > /dev/null 2>&1 &";
                    @exec($cmd);
                }
            } else {
                fclose($fp);
            }
        }
    }

    public static function autoload($class_name) {
        $filename = 'class-' . strtolower($class_name) . '.php';

        foreach (Bootstrap::$autopaths as $path) {
            $file = __DIR__  . '/' . $path . '/' . $filename;
            if (file_exists($file)) {
                require_once $file;
                return true;
            }
        }
    }
}
