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
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-item.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-filesize.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/ext/class-search.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/ext/class-archive.php';

final class TestSetup extends Setup {
    public function __construct(private readonly array $values) {}

    public function get(string $key): string|bool {
        if (!array_key_exists($key, $this->values)) {
            throw new RuntimeException("missing test setup key: {$key}");
        }
        return $this->values[$key];
    }
}

function check(bool $condition, string $message): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$tmp = sys_get_temp_dir() . '/h5ai-test-' . bin2hex(random_bytes(6));
$root = $tmp . '/root';
$outside = $tmp . '/outside.txt';
$conf = $tmp . '/conf';
mkdir($root, 0700, true);
mkdir($conf, 0700, true);
file_put_contents($outside, 'secret');
file_put_contents($root . '/inside.txt', 'inside');
for ($i = 0; $i < 5; $i++) {
    file_put_contents($root . "/match-{$i}.txt", 'x');
}
symlink($outside, $root . '/outside-link.txt');
file_put_contents($conf . '/options.json', json_encode([
    'passhash' => '',
    'view' => ['hidden' => [], 'unmanaged' => []],
    'foldersize' => ['enabled' => false],
    'search' => ['maxResults' => 2, 'maxDepth' => 4],
]));
file_put_contents($conf . '/types.json', '{}');

$setup = new TestSetup([
    'ROOT_PATH' => $root,
    'ROOT_HREF' => '/',
    'PUBLIC_PATH' => $tmp . '/public',
    'PRIVATE_PATH' => $tmp . '/private',
    'CONF_PATH' => $conf,
    'HAS_CMD_DU' => false,
]);
$store = [];
$context = new Context(new Session($store), new Request([], ''), $setup);

check(!$context->login_admin(''), 'administrator login must be disabled without a configured hash');
check($context->is_managed_file($root . '/inside.txt'), 'regular files inside root must be managed');
check(!$context->is_managed_file($root . '/outside-link.txt'), 'file symlinks escaping root must be rejected');

$visited = [];
$results = (new Search($context))->get_paths($root, 'match', false, $visited);
check(count($results) === 2, 'search result limit must be enforced');
$visited = [];
$results = (new Search($context))->get_paths($root, 'outside-link', false, $visited);
check($results === [], 'search must reject file symlinks escaping root');

$archive = new Archive($context);
$method = new ReflectionMethod($archive, 'add_file');
$method->invoke($archive, $root . '/outside-link.txt', 'outside-link.txt');
$files = new ReflectionProperty($archive, 'files');
check($files->getValue($archive) === [], 'archives must reject file symlinks escaping root');
$archive->output('unsupported', '/', ['/outside-link.txt']);
$dirs = new ReflectionProperty($archive, 'dirs');
check($dirs->getValue($archive) === [], 'an invalid selection must not fall back to archiving the whole folder');

$limitedConf = json_decode(file_get_contents($conf . '/options.json'), true);
$limitedConf['download'] = ['maxEntries' => 2, 'maxBytes' => 1024];
file_put_contents($conf . '/options.json', json_encode($limitedConf));
$limitedContext = new Context(new Session($store), new Request([], ''), $setup);
$limitedArchive = new Archive($limitedContext);
$addDir = new ReflectionMethod($limitedArchive, 'add_dir');
$addDir->invoke($limitedArchive, $root, '.');
$limitExceeded = new ReflectionProperty($limitedArchive, 'limit_exceeded');
check($limitExceeded->getValue($limitedArchive), 'whole-folder archive entry limits must be enforced');

$output = '';
$error = '';
$startedAt = microtime(true);
$exitCode = Util::proc_open_cmdv([PHP_BINARY, '-r', 'sleep(3);'], $output, $error, 1);
check($exitCode === 124, 'child processes must be terminated after their timeout');
check((microtime(true) - $startedAt) < 2.5, 'child process timeout must return promptly');

unlink($root . '/outside-link.txt');
foreach (glob($root . '/*') as $file) {
    unlink($file);
}
rmdir($root);
unlink($outside);
unlink($conf . '/options.json');
unlink($conf . '/types.json');
rmdir($conf);
rmdir($tmp);

echo "PHP security tests passed\n";
