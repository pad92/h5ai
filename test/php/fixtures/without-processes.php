<?php

// Run by ContextTest with exec and proc_open disabled: every way h5ai starts
// a process must fail like a command that cannot start, not fatally. Also
// asks for a folder refresh, as a listing does, over H5AI_TEST_ROOT.

require __DIR__ . '/../../../src/_h5ai/private/php/class-bootstrap.php';
spl_autoload_register(Bootstrap::autoload(...));
require __DIR__ . '/../support/TestSetup.php';

$root = getenv('H5AI_TEST_ROOT');
$cache = getenv('H5AI_TEST_CACHE');
file_put_contents($root . '/../conf/options.json', '{}');
$setup = new TestSetup([
    'ROOT_PATH' => $root, 'ROOT_HREF' => '/', 'CONF_PATH' => $root . '/../conf',
    'PUBLIC_PATH' => $root . '/../public', 'PRIVATE_PATH' => $root . '/../private',
    'CACHE_PRV_PATH' => $cache, 'FILE_PREFIX' => '_h5ai',
]);
$store = [];
(new Context(new Session($store), new Request([], ''), $setup))->trigger_folder_refresh([$root]);
echo is_file($cache . '/refresh.requested') ? 'marker kept' : 'marker removed', "\n";
echo 'exec_0: ', var_export(Util::exec_0('true'), true), "\n";
echo 'proc_open_cmdv: ', Util::proc_open_cmdv(['true'], $output, $error), "\n";
echo 'passthru_cmd: ', Util::passthru_cmd('true'), "\n";
