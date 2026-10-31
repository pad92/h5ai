<?php

if (php_sapi_name() !== 'cli') {
    exit("This script can only be run from the command line.\n");
}

require_once __DIR__ . '/class-bootstrap.php';
$context = Bootstrap::cli_context();
$setup = $context->get_setup();
$laststart_file = $setup->get('CACHE_PRV_PATH') . '/warmer.laststart';
register_shutdown_function(static fn() => @unlink($laststart_file));

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
@unlink($laststart_file);

flock($fp, LOCK_UN);
fclose($fp);

$end_time = microtime(true);
$duration = round($end_time - $start_time, 2);
echo "Cache warming completed successfully in {$duration} seconds.\n";
