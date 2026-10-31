<?php

// Router for `php -S` in HttpApiTest: serves the API over the share in
// H5AI_TEST_ROOT, configured by its _h5ai/private/conf/options.json.

require __DIR__ . '/../../../src/_h5ai/private/php/class-bootstrap.php';
spl_autoload_register(Bootstrap::autoload(...));
require __DIR__ . '/../support/TestSetup.php';

$root = getenv('H5AI_TEST_ROOT');
$setup = new TestSetup([
    'ROOT_PATH' => $root,
    'ROOT_HREF' => '/',
    'PUBLIC_PATH' => $root . '/_h5ai/public',
    'PRIVATE_PATH' => $root . '/_h5ai/private',
    'CONF_PATH' => $root . '/_h5ai/private/conf',
    'FILE_PREFIX' => '_h5ai',
    'HAS_CMD_DU' => false,
    'HAS_PHP_WEBP' => false,
]);
$store = [];
new Api(new Context(new Session($store), Request::from_globals(), $setup))->apply();
