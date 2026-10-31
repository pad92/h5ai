<?php

require __DIR__ . '/../../../src/_h5ai/private/php/class-bootstrap.php';
spl_autoload_register(Bootstrap::autoload(...));

final class HttpTestSetup extends Setup {
    public function __construct(private readonly string $root) {}

    public function get(string $key): string|bool {
        return match ($key) {
            'ROOT_PATH' => $this->root,
            'ROOT_HREF' => '/',
            'PUBLIC_PATH' => $this->root . '/_h5ai/public',
            'PRIVATE_PATH' => $this->root . '/_h5ai/private',
            'CONF_PATH' => $this->root . '/_h5ai/private/conf',
            'FILE_PREFIX' => '_h5ai',
            'HAS_CMD_DU', 'HAS_PHP_WEBP' => false,
            default => throw new RuntimeException('Unexpected setup key: ' . $key),
        };
    }
}

$store = [];
$request = Request::from_globals();
$context = new Context(new Session($store), $request, new HttpTestSetup(getenv('H5AI_TEST_ROOT')));
new Api($context)->apply();
