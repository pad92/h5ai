<?php

if (php_sapi_name() !== 'cli') {
    exit("This script can only be run from the command line.\n");
}

// Define variables to mock the web server environment
define('H5AI_VERSION', '1.1.0');
define('MIN_PHP_VERSION', '7.0.0');

$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI'] = '/';
$_SERVER['SCRIPT_NAME'] = '/_h5ai/public/index.php';
$_SERVER['SERVER_SOFTWARE'] = 'CLI';
$_SERVER['HTTP_USER_AGENT'] = 'CLI';

require_once dirname(__FILE__) . '/class-bootstrap.php';
spl_autoload_register(['Bootstrap', 'autoload']);

$session = new Session($_SESSION);
$request = new Request($_REQUEST, '');
$setup = new Setup();
$context = new Context($session, $request, $setup);

$lock_file = $setup->get('CACHE_PRV_PATH') . '/warmer.lock';
$fp = @fopen($lock_file, 'c+');
if (!$fp || !flock($fp, LOCK_EX | LOCK_NB)) {
    echo "Cache warmer is already running.\n";
    exit(0);
}

@ftruncate($fp, 0);
@fwrite($fp, getmypid());

echo "Starting cache warming...\n";
$start_time = microtime(true);

$warmer = new CacheWarmer($context);
$warmer->warm();

$lastrun_file = $setup->get('CACHE_PRV_PATH') . '/warmer.lastrun';
@file_put_contents($lastrun_file, time());

flock($fp, LOCK_UN);
fclose($fp);

$end_time = microtime(true);
$duration = round($end_time - $start_time, 2);
echo "Cache warming completed successfully in {$duration} seconds.\n";
