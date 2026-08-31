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
require_once __DIR__ . '/../../src/_h5ai/private/php/ext/class-thumb.php';

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

if (function_exists('imagecreatetruecolor')) {
    $wideImage = imagecreatetruecolor(4097, 1);
    $wideImageStream = fopen('php://temp', 'r+');
    imagepng($wideImage, $wideImageStream);
    imagedestroy($wideImage);
    $wideImageObject = new Image();
    try {
        check($wideImageObject->set_source_data($wideImageStream), 'wide test image must be readable');
        $wideImageObject->thumb(4096, 0);
    } catch (\Throwable $exception) {
        throw new RuntimeException('wide images must not cause thumbnail dimension errors: ' . $exception->getMessage());
    }
    fclose($wideImageStream);
}

// Rows 1-2 pin the clamp: an out-of-range number must not reintroduce an
// unbounded du pass, nor collapse below the one-second floor. Rows 3-4 pin the
// fallback instead: a non-numeric value and an absent key must both land on the
// documented default rather than cast to 0 and cripple every pass.
$timeoutConf = json_decode(file_get_contents($conf . '/options.json'), true);
foreach ([
    [['timeout' => 99999999, 'backgroundTimeout' => 1e9], Filesize::MAX_TIMEOUT, Filesize::MAX_TIMEOUT],
    [['timeout' => 0, 'backgroundTimeout' => -5], 1, 1],
    [['timeout' => 'abc', 'backgroundTimeout' => null], Filesize::DEFAULT_TIMEOUT, Filesize::DEFAULT_BACKGROUND_TIMEOUT],
    [[], Filesize::DEFAULT_TIMEOUT, Filesize::DEFAULT_BACKGROUND_TIMEOUT],
] as [$override, $expected, $expectedBackground]) {
    $timeoutConf['foldersize'] = ['enabled' => true] + $override;
    file_put_contents($conf . '/options.json', json_encode($timeoutConf));
    [, , $timeout, $backgroundTimeout] = (new Context(new Session($store), new Request([], ''), $setup))->foldersize_mode();
    check($timeout === $expected, "foldersize.timeout must clamp to {$expected}, got " . var_export($timeout, true));
    check(
        $backgroundTimeout === $expectedBackground,
        "foldersize.backgroundTimeout must clamp to {$expectedBackground}, got " . var_export($backgroundTimeout, true),
    );
}

// An exponent that overflows to INF must still clamp to the ceiling. Written as
// raw JSON because json_encode() cannot represent INF.
file_put_contents(
    $conf . '/options.json',
    '{"passhash":"","view":{"hidden":[],"unmanaged":[]},'
    . '"foldersize":{"enabled":true,"timeout":1e9999,"backgroundTimeout":1e9999}}',
);
[, , $timeout, $backgroundTimeout] = (new Context(new Session($store), new Request([], ''), $setup))->foldersize_mode();
check($timeout === Filesize::MAX_TIMEOUT, 'an overflowing foldersize.timeout must clamp to the ceiling, got ' . var_export($timeout, true));
check($backgroundTimeout === Filesize::MAX_TIMEOUT, 'an overflowing foldersize.backgroundTimeout must clamp to the ceiling, got ' . var_export($backgroundTimeout, true));

$output = '';
$error = '';
$startedAt = microtime(true);
$exitCode = Util::proc_open_cmdv([PHP_BINARY, '-r', 'sleep(3);'], $output, $error, 1);
check($exitCode === 124, 'child processes must be terminated after their timeout');
check((microtime(true) - $startedAt) < 2.5, 'child process timeout must return promptly');

// A folder-size pass over a slow tree must be cut off at its timeout, and the
// partial tree it already wrote must not be parsed: half a du listing would
// persist a wrong, too-small size in the cache. The child here is an ordinary
// sleeping process; a mount hung in uninterruptible I/O cannot be simulated
// portably, and by design nothing here recovers from that case.
$filesizeClass = new ReflectionClass(Filesize::class);
$filesizeCtor = $filesizeClass->getConstructor();
$filesizeCtor->setAccessible(true);
$boundedFilesize = $filesizeClass->newInstanceWithoutConstructor();
$filesizeCtor->invoke($boundedFilesize, 1);
$filesizeExec = $filesizeClass->getMethod('exec');
$filesizeExec->setAccessible(true);
$startedAt = microtime(true);
$lines = $filesizeExec->invoke(
    $boundedFilesize,
    [PHP_BINARY, '-r', 'fwrite(STDOUT, "123\t/tmp\n"); sleep(3);'],
);
check((microtime(true) - $startedAt) < 2.5, 'folder-size commands must be bounded by their timeout');
check($lines === [], 'a timed-out folder-size command must not yield partial sizes');

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
