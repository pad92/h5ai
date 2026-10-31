<?php

declare(strict_types=1);

define('H5AI_VERSION', 'test');
define('MIN_PHP_VERSION', '8.4.0');

require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-util.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-json.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-session.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-request.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-setup.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-context.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-pathpolicy.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-item.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-filesize.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/ext/class-archive.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/ext/class-tarheader.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-api.php';

final class RequestTestSetup extends Setup {
    public function __construct(private readonly array $values) {}

    public function get(string $key): string|bool {
        if (!array_key_exists($key, $this->values)) {
            throw new RuntimeException("missing test setup key: {$key}");
        }
        return $this->values[$key];
    }
}

$root = getenv('H5AI_TEST_ROOT');
if (!is_string($root) || $root === '') {
    http_response_code(500);
    exit;
}

$setup = new RequestTestSetup([
    'ROOT_PATH' => $root,
    'ROOT_HREF' => '/',
    'PUBLIC_PATH' => $root . '/_h5ai/public',
    'PRIVATE_PATH' => $root . '/_h5ai/private',
    'CONF_PATH' => $root . '/_h5ai/conf',
]);
$request = Request::from_globals();
$store = [];
$context = new Context(new Session($store), $request, $setup);
(new Api($context))->apply();
