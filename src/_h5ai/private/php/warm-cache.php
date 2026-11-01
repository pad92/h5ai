<?php

if (php_sapi_name() !== 'cli') {
    exit("This script can only be run from the command line.\n");
}

require_once __DIR__ . '/class-bootstrap.php';
$context = Bootstrap::cli_context();
$setup = $context->get_setup();
$laststart_file = $setup->get('CACHE_PRV_PATH') . '/warmer.laststart';

$lock_file = $setup->get('CACHE_PRV_PATH') . '/warmer.lock';
$fp = @fopen($lock_file, 'c+');
if (!$fp || !flock($fp, LOCK_EX | LOCK_NB)) {
    // The start marker belongs to the running warmer: leave it alone.
    echo "Cache warmer is already running.\n";
    exit(0);
}
// From here this process owns the start marker, even if it fails.
register_shutdown_function(static fn() => @unlink($laststart_file));

@ftruncate($fp, 0);
@fwrite($fp, getmypid());

echo "Starting cache warming...\n";
$start_time = microtime(true);

$warmer = new CacheWarmer($context);
// Written while this process holds warmer.lock, as TaskStatus requires.
$status = new TaskStatus($setup->get('CACHE_PRV_PATH'), TaskStatus::WARMER);
$pruned = $warmer->warm($status);
if ($warmer->was_stopped()) {
    // Not recorded as a run, but warmer.lastrun below still postpones the
    // next automatic start: the administrator stopped this one.
    $status->abandon();
    echo "Cache warming stopped on request.\n";
} else {
    $status->finish();
    echo "Pruned the thumbnails of {$pruned} vanished files.\n";
}

$lastrun_file = $setup->get('CACHE_PRV_PATH') . '/warmer.lastrun';
@file_put_contents($lastrun_file, time());
@unlink($laststart_file);

flock($fp, LOCK_UN);
fclose($fp);

$end_time = microtime(true);
$duration = round($end_time - $start_time, 2);
echo "Cache warming completed successfully in {$duration} seconds.\n";
