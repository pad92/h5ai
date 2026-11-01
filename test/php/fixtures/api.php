<?php

// Router for `php -S` in HttpApiTest: serves the API over the share in
// H5AI_TEST_ROOT, configured by its _h5ai/private/conf/options.json. A test
// can override setup values in _h5ai/private/conf/test-setup.json.

require __DIR__ . '/../../../src/_h5ai/private/php/class-bootstrap.php';
spl_autoload_register(Bootstrap::autoload(...));
require __DIR__ . '/../support/TestSetup.php';

$root = getenv('H5AI_TEST_ROOT');
$overrides = json_decode((string) @file_get_contents($root . '/_h5ai/private/conf/test-setup.json'), true);
$setup = new TestSetup((is_array($overrides) ? $overrides : []) + [
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
