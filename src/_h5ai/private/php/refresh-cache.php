<?php

if (php_sapi_name() !== 'cli') {
    exit("This script can only be run from the command line.\n");
}

require_once __DIR__ . '/class-bootstrap.php';
$context = Bootstrap::cli_context();
$setup = $context->get_setup();
$request_marker = $setup->get('CACHE_PRV_PATH') . '/refresh.requested';
register_shutdown_function(static fn() => @unlink($request_marker));

$lock_file = $setup->get('CACHE_PRV_PATH') . '/refresh.lock';
$fp = @fopen($lock_file, 'c+');
if (!$fp || !flock($fp, LOCK_EX | LOCK_NB)) {
    @unlink($request_marker);
    exit(0);
}

[$with_foldersize, $with_du, $timeout] = $context->foldersize_mode();

$paths = array_slice($argv, 1);
if ($with_foldersize) {
    $paths = array_values(array_filter($paths, is_dir(...)));
    // Written while this process holds refresh.lock, as TaskStatus requires.
    $status = new TaskStatus($setup->get('CACHE_PRV_PATH'), TaskStatus::REFRESH);
    if ($with_du) {
        // One du process for every stale folder instead of one per folder:
        // no count to follow, the previous duration is the estimate.
        $status->phase('sizes');
        Filesize::refresh_du($paths, $timeout);
    } else {
        $status->phase('sizes', count($paths));
        foreach ($paths as $path) {
            Filesize::get_size($path, $with_foldersize, $with_du, $timeout);
            $status->advance();
        }
    }
    $status->finish();
}

flock($fp, LOCK_UN);
fclose($fp);
@unlink($request_marker);
