<?php

if (php_sapi_name() !== 'cli') {
    exit("This script can only be run from the command line.\n");
}

define('H5AI_VERSION', '{{VERSION}}');
define('MIN_PHP_VERSION', '8.4.0');

$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI'] = '/';
$_SERVER['SCRIPT_NAME'] = '/_h5ai/public/index.php';
$_SERVER['SERVER_SOFTWARE'] = 'CLI';
$_SERVER['HTTP_USER_AGENT'] = 'CLI';

require_once __DIR__ . '/class-bootstrap.php';
spl_autoload_register(Bootstrap::autoload(...));

$session_store = [];
$session = new Session($session_store);
$request = new Request($_REQUEST, '');
$setup = new Setup();
$context = new Context($session, $request, $setup);
$request_marker = $setup->get('CACHE_PRV_PATH') . '/refresh.requested';
register_shutdown_function(static fn() => @unlink($request_marker));

$lock_file = $setup->get('CACHE_PRV_PATH') . '/refresh.lock';
$fp = @fopen($lock_file, 'c+');
if (!$fp || !flock($fp, LOCK_EX | LOCK_NB)) {
    @unlink($request_marker);
    exit(0);
}

[$withFoldersize, $withDu] = $context->foldersize_mode();

$paths = array_slice($argv, 1);
if ($withFoldersize) {
    $paths = array_values(array_filter($paths, is_dir(...)));
    if ($withDu) {
        // One du process for every stale folder instead of one per folder.
        Filesize::refresh_du($paths);
    } else {
        foreach ($paths as $path) {
            Filesize::getSize($path, $withFoldersize, $withDu);
        }
    }
}

flock($fp, LOCK_UN);
fclose($fp);
@unlink($request_marker);
