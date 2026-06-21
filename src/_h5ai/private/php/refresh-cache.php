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
spl_autoload_register(['Bootstrap', 'autoload']);

$session_store = [];
$session = new Session($session_store);
$request = new Request($_REQUEST, '');
$setup = new Setup();
$context = new Context($session, $request, $setup);

$lock_file = $setup->get('CACHE_PRV_PATH') . '/refresh.lock';
$fp = @fopen($lock_file, 'c+');
if (!$fp || !flock($fp, LOCK_EX | LOCK_NB)) {
    exit(0);
}

$withFoldersize = $context->query_option('foldersize.enabled', false);
$withDu = $setup->get('HAS_CMD_DU') && $context->query_option('foldersize.type', null) === 'shell-du';

$paths = array_slice($argv, 1);
foreach ($paths as $path) {
    if (is_dir($path) && $withFoldersize) {
        Filesize::getSize($path, $withFoldersize, $withDu);
    }
}

flock($fp, LOCK_UN);
fclose($fp);
