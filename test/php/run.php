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
require_once __DIR__ . '/../../src/_h5ai/private/php/ext/class-tarheader.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-item.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-filesize.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-fallback.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/ext/class-search.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/ext/class-archive.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/ext/class-custom.php';
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

final class ListingTestContext extends Context {
    public array $refreshPaths = [];

    public function trigger_folder_refresh(array $paths): void {
        $this->refreshPaths = $paths;
    }
}

$tmp = sys_get_temp_dir() . '/h5ai-test-' . bin2hex(random_bytes(6));
$root = $tmp . '/root';
$outside = $tmp . '/outside.txt';
$conf = $tmp . '/conf';
mkdir($root, 0700, true);
mkdir($conf, 0700, true);
mkdir($root . '/_h5ai/public', 0700, true);
mkdir($root . '/_h5ai/private', 0700, true);
file_put_contents($outside, 'secret');
file_put_contents($root . '/_h5ai/public/internal.txt', 'public internal');
file_put_contents($root . '/_h5ai/private/internal.txt', 'private internal');
file_put_contents($root . '/inside.txt', 'inside');
for ($i = 0; $i < 5; $i++) {
    file_put_contents($root . "/match-{$i}.txt", 'x');
}
symlink($outside, $root . '/outside-link.txt');
symlink($outside, $root . '/_h5ai.header.html');
symlink($root . '/_h5ai/public/internal.txt', $root . '/_h5ai.headers.html');
symlink($root . '/_h5ai/private/internal.txt', $root . '/_h5ai.footer.html');
file_put_contents($root . '/_h5ai.header.md', '# Allowed header');
file_put_contents($root . '/_h5ai.footer.md', 'Allowed footer');
file_put_contents($conf . '/options.json', json_encode([
    'passhash' => '',
    'view' => ['hidden' => [], 'unmanaged' => []],
    'foldersize' => ['enabled' => false],
    'custom' => ['enabled' => true],
    'search' => ['maxResults' => 2, 'maxDepth' => 4],
]));
file_put_contents($conf . '/types.json', '{}');

$setup = new TestSetup([
    'ROOT_PATH' => $root,
    'ROOT_HREF' => '/',
    'PUBLIC_PATH' => $root . '/_h5ai/public',
    'PRIVATE_PATH' => $root . '/_h5ai/private',
    'FILE_PREFIX' => '_h5ai',
    'CONF_PATH' => $conf,
    'HAS_CMD_DU' => false,
]);
$store = [];
$context = new Context(new Session($store), new Request([], ''), $setup);

foreach ([1, 2] as $listingAttempt) {
    $listing = array_column($context->get_items('/', 1), null, 'href');
    check($listing['/inside.txt']['size'] === 6, 'API listings must retain regular file sizes');
    check($listing['/match-0.txt']['size'] === 1, 'API listings must preserve distinct sizes for sorting');
}
$context->trigger_folder_refresh([]); // Empty work must not touch the cache or launch a worker.

$savedOptions = file_get_contents($conf . '/options.json');
$listingOptions = json_decode($savedOptions, true);
$listingOptions['foldersize'] = ['enabled' => true, 'type' => 'shell-du'];
file_put_contents($conf . '/options.json', json_encode($listingOptions));
$listingSetup = new TestSetup([
    'ROOT_PATH' => $root, 'ROOT_HREF' => '/',
    'PUBLIC_PATH' => $root . '/_h5ai/public', 'PUBLIC_HREF' => '/_h5ai/public/',
    'PRIVATE_PATH' => $root . '/_h5ai/private', 'CONF_PATH' => $conf, 'HAS_CMD_DU' => true,
]);
$listingContext = new ListingTestContext(new Session($store), new Request([], ''), $listingSetup);
$savedPath = getenv('PATH');
$duMarker = $tmp . '/du-invoked';
file_put_contents($tmp . '/du', "#!/bin/sh\nprintf invoked > " . escapeshellarg($duMarker) . "\nexit 1\n");
chmod($tmp . '/du', 0700);
putenv('PATH=' . $tmp . ':' . $savedPath);
try {
    $listingCache = new ReflectionProperty(Filesize::class, 'cache');
    $listingPersistentCache = new ReflectionProperty(Filesize::class, 'persistent_cache');
    $listingPersistentCache->setValue(null, []);
    $listingCache->setValue(null, []);
    $coldListing = array_column($listingContext->get_items('/', 1), null, 'href');
    check($coldListing['/inside.txt']['size'] === 6, 'cold folder caches must not hide regular file sizes');
    check($coldListing['/']['size'] === null, 'cold folder sizes must remain unknown until refreshed');
    check(in_array($root, $listingContext->refreshPaths, true), 'cold API listings must queue folder refreshes');

    $listingCache->setValue(null, []);
    $html = (new Fallback($listingContext))->get_html($root);
    check(str_contains($html, 'inside.txt'), 'cold fallback listings must render files');
    check(in_array($root, $listingContext->refreshPaths, true), 'cold fallback listings must queue folder refreshes');
    check(!file_exists($duMarker), 'initial HTML and API listings must not execute du synchronously');
    check(Filesize::get_stale_paths() === [], 'listing refresh queues must be drained after rendering');
} finally {
    putenv($savedPath === false ? 'PATH' : 'PATH=' . $savedPath);
    file_put_contents($conf . '/options.json', $savedOptions);
    unlink($tmp . '/du');
    if (file_exists($duMarker)) {
        unlink($duMarker);
    }
    $listingCache->setValue(null, []);
    $listingPersistentCache->setValue(null, null);
}

$urlEncodedRequest = new Request(
    ['action' => 'download', 'type' => 'shell-zip', 'hrefs' => ['/first.txt', '/second.txt']],
    'action=download&type=shell-zip&hrefs%5B0%5D=%2Ffirst.txt&hrefs%5B1%5D=%2Fsecond.txt',
    'application/x-www-form-urlencoded; charset=UTF-8',
);
check($urlEncodedRequest->query_string('action') === 'download', 'URL-encoded forms must use PHP-parsed request parameters');
check($urlEncodedRequest->query_array('hrefs') === ['/first.txt', '/second.txt'], 'URL-encoded forms must preserve multiple selected hrefs');
$multipartRequest = new Request(
    ['action' => 'download', 'hrefs' => ['/first.txt', '/second.txt']],
    'multipart body',
    'multipart/form-data; boundary=test',
);
check($multipartRequest->query_array('hrefs') === ['/first.txt', '/second.txt'], 'multipart forms must use PHP-parsed request parameters');
$jsonRequest = new Request(['action' => 'wrong'], '{"action":"download"}', 'application/json; charset=utf-8');
check($jsonRequest->query_string('action') === 'download', 'JSON requests must continue to use their decoded body');

$httpRoot = $tmp . '/http-root';
mkdir($httpRoot . '/_h5ai/public', 0700, true);
mkdir($httpRoot . '/_h5ai/private', 0700, true);
mkdir($httpRoot . '/_h5ai/conf', 0700, true);
file_put_contents($httpRoot . '/first.txt', 'first');
file_put_contents($httpRoot . '/second.txt', 'second');
file_put_contents($httpRoot . '/_h5ai/conf/options.json', json_encode([
    'passhash' => '',
    'view' => ['hidden' => [], 'unmanaged' => []],
    'download' => ['enabled' => true],
]));
$socket = stream_socket_server('tcp://127.0.0.1:0', $socketError, $socketErrorMessage);
check($socket !== false, 'a local socket must be available for HTTP request tests');
$socketAddress = stream_socket_get_name($socket, false);
$port = (int) substr(strrchr($socketAddress, ':'), 1);
fclose($socket);
$server = proc_open(
    [PHP_BINARY, '-S', "127.0.0.1:{$port}", __DIR__ . '/request-router.php'],
    [0 => ['pipe', 'r'], 1 => ['file', '/dev/null', 'a'], 2 => ['file', '/dev/null', 'a']],
    $serverPipes,
    null,
    ['H5AI_TEST_ROOT' => $httpRoot],
);
check(is_resource($server), 'the PHP test web server must start');
fclose($serverPipes[0]);
$serverReady = false;
for ($attempt = 0; $attempt < 50; $attempt++) {
    $probe = @fsockopen('127.0.0.1', $port, $probeError, $probeErrorMessage, 0.05);
    if (is_resource($probe)) {
        fclose($probe);
        $serverReady = true;
        break;
    }
    usleep(20000);
}
$httpPost = static function (string $body, string $contentType, string $query = '') use ($port): array {
    $options = ['http' => [
        'method' => 'POST',
        'header' => "Content-Type: {$contentType}\r\nConnection: close\r\n",
        'content' => $body,
        'ignore_errors' => true,
        'timeout' => 3,
    ]];
    $response = file_get_contents("http://127.0.0.1:{$port}/" . $query, false, stream_context_create($options));
    preg_match('/^HTTP\/\S+\s+(\d+)/', $http_response_header[0] ?? '', $matches);
    return [$response, (int) ($matches[1] ?? 0)];
};
$tarEntryNames = static function (string $tar): array {
    $names = [];
    $offset = 0;
    while ($offset + 512 <= strlen($tar)) {
        $header = substr($tar, $offset, 512);
        if ($header === str_repeat("\0", 512)) {
            break;
        }
        $name = rtrim(substr($header, 0, 100), "\0");
        if ($name !== '') {
            $names[] = basename($name);
        }
        $size = octdec(trim(substr($header, 124, 12), " \0"));
        $offset += 512 + (int) (ceil($size / 512) * 512);
    }
    return $names;
};
try {
    check($serverReady, 'the PHP test web server must accept HTTP connections');
    $formFields = [
        'action' => 'download',
        'as' => 'selected.tar',
        'type' => 'php-tar',
        'baseHref' => '/',
        'hrefs' => '',
    ];
    $urlEncodedBody = http_build_query($formFields);
    foreach (['/first.txt', '/second.txt'] as $index => $href) {
        $urlEncodedBody .= '&' . http_build_query(["hrefs[{$index}]" => $href]);
    }
    [$response, $status] = $httpPost($urlEncodedBody, 'application/x-www-form-urlencoded');
    check($status === 200 && is_string($response), 'a URL-encoded browser download request must succeed over HTTP');
    $names = $tarEntryNames($response);
    check(in_array('first.txt', $names, true) && in_array('second.txt', $names, true), 'a multiple-file form download must include every selected file');

    $multipartFields = $formFields;
    foreach (['/first.txt', '/second.txt'] as $index => $href) {
        $multipartFields["hrefs[{$index}]"] = $href;
    }
    $multipartBody = '';
    foreach ($multipartFields as $name => $value) {
        $multipartBody .= "--h5ai-test-boundary\r\n"
            . "Content-Disposition: form-data; name=\"{$name}\"\r\n\r\n{$value}\r\n";
    }
    $multipartBody .= "--h5ai-test-boundary--\r\n";
    [$response, $status] = $httpPost(
        $multipartBody,
        'multipart/form-data; boundary=h5ai-test-boundary',
    );
    check($status === 200 && is_string($response), 'a multipart browser download request must be accepted over HTTP');
    $names = $tarEntryNames($response);
    check(in_array('first.txt', $names, true) && in_array('second.txt', $names, true), 'a multipart download must include every selected file');

    [$response, $status] = $httpPost(
        http_build_query(array_replace($formFields, ['hrefs' => '/first.txt'])),
        'application/x-www-form-urlencoded',
    );
    check($status === 200 && is_string($response) && in_array('first.txt', $tarEntryNames($response), true), 'string href selections must remain supported through the API');

    [$response] = $httpPost(
        'action=download&as=bad.tar&type=php-tar&baseHref=%2F&hrefs%5B0%5D=%2Ffirst.txt&hrefs%5B1%5D%5Bx%5D=invalid',
        'application/x-www-form-urlencoded',
    );
    check(is_string($response) && str_contains($response, Util::ERR_ILLIGAL_PARAM), 'download selections with non-string elements must be rejected cleanly');

    [$response] = $httpPost('{"action":', 'application/json', '?action=download');
    check(is_string($response) && str_contains($response, Util::ERR_ILLIGAL_PARAM), 'malformed JSON must be rejected without falling back to query parameters');
} finally {
    proc_terminate($server);
    proc_close($server);
}

check(!$context->login_admin(''), 'administrator login must be disabled without a configured hash');
$passwordOptions = json_decode(file_get_contents($conf . '/options.json'), true);
$passwordOptions['passhash'] = password_hash('modern-admin-password', PASSWORD_DEFAULT);
file_put_contents($conf . '/options.json', json_encode($passwordOptions));
$modernStore = [];
$modernPasswordContext = new Context(new Session($modernStore), new Request([], ''), $setup);
check($modernPasswordContext->login_admin('modern-admin-password'), 'administrator login must verify modern password_hash digests');
check(!$modernPasswordContext->login_admin('wrong-password'), 'administrator login must reject an incorrect modern password');

$passwordOptions['passhash'] = hash('sha512', 'legacy-admin-password');
file_put_contents($conf . '/options.json', json_encode($passwordOptions));
$legacyStore = [];
$legacyPasswordContext = new Context(new Session($legacyStore), new Request([], ''), $setup);
check($legacyPasswordContext->login_admin('legacy-admin-password'), 'administrator login must keep verifying legacy SHA-512 digests');

$passwordOptions['passhash'] = '';
file_put_contents($conf . '/options.json', json_encode($passwordOptions));
check($context->is_managed_file($root . '/inside.txt'), 'regular files inside root must be managed');
check(!$context->is_managed_file($root . '/outside-link.txt'), 'file symlinks escaping root must be rejected');
$custom = (new Custom($context))->get_customizations('/');
check($custom['header'] === ['content' => '# Allowed header', 'type' => 'md'], 'custom headers must skip outside symlinks and preserve hidden Markdown files');
check($custom['footer'] === ['content' => 'Allowed footer', 'type' => 'md'], 'custom footers must skip h5ai internal symlinks and preserve Markdown files');

unlink($root . '/_h5ai.header.md');
unlink($root . '/_h5ai.footer.md');
unlink($root . '/_h5ai.header.html');
unlink($root . '/_h5ai.footer.html');
file_put_contents($root . '/_h5ai.header.html', '<header>Allowed HTML</header>');
file_put_contents($root . '/_h5ai.footer.html', '<footer>Allowed HTML</footer>');
$custom = (new Custom($context))->get_customizations('/');
check($custom['header'] === ['content' => '<header>Allowed HTML</header>', 'type' => 'html'], 'ordinary HTML custom headers must remain supported');
check($custom['footer'] === ['content' => '<footer>Allowed HTML</footer>', 'type' => 'html'], 'ordinary HTML custom footers must remain supported');

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

// Rewriting a file leaves its containing directory mtime alone. Expired size
// entries must therefore be recomputed even when the directory map still
// matches, for both growth and truncation.
$sizeDir = $root . '/size-cache';
$sizeFile = $sizeDir . '/existing.txt';
mkdir($sizeDir);
file_put_contents($sizeFile, 'small');
$dirMtime = filemtime($sizeDir);
$persistentCache = new ReflectionProperty(Filesize::class, 'persistent_cache');
$requestCache = new ReflectionProperty(Filesize::class, 'cache');
$persistentCache->setValue(null, [
    $sizeDir => ['size' => 5, 'cached_at' => time() - Filesize::CACHE_TTL - 1, 'dirs' => [$sizeDir => $dirMtime]],
]);
$requestCache->setValue(null, []);
Filesize::set_async_mode(true);
check(
    Filesize::getCachedSize($sizeFile, true, false, Filesize::DEFAULT_TIMEOUT, false) === 5,
    'listing requests must retain regular file sizes while folder sizes refresh',
);
check(
    Filesize::getCachedSize($sizeDir, true, false, Filesize::DEFAULT_TIMEOUT, true) === null,
    'listing requests must leave an expired folder size unknown while it refreshes',
);
check(in_array($sizeDir, Filesize::get_stale_paths(), true), 'expired listing sizes must be queued for background refresh');
Filesize::set_async_mode(false);
$requestCache->setValue(null, []);
file_put_contents($sizeFile, 'a much larger existing file');
clearstatcache(true, $sizeDir);
check(filemtime($sizeDir) === $dirMtime, 'rewriting a file must not change the fixture directory mtime');
check(
    Filesize::getCachedSize($sizeDir, true, false) === filesize($sizeDir) + filesize($sizeFile),
    'an expired folder-size cache entry must detect growth of an existing file',
);

$persistentCache->setValue(null, [
    $sizeDir => ['size' => filesize($sizeFile), 'cached_at' => time() - Filesize::CACHE_TTL - 1, 'dirs' => [$sizeDir => $dirMtime]],
]);
$requestCache->setValue(null, []);
file_put_contents($sizeFile, 'x');
clearstatcache(true, $sizeDir);
check(filemtime($sizeDir) === $dirMtime, 'truncating a file must not change the fixture directory mtime');
check(
    Filesize::getCachedSize($sizeDir, true, false) === filesize($sizeDir) + filesize($sizeFile),
    'an expired folder-size cache entry must detect truncation of an existing file',
);
$persistentCache->setValue(null, null);
$requestCache->setValue(null, []);
unlink($sizeFile);
rmdir($sizeDir);

unlink($root . '/outside-link.txt');
unlink($root . '/_h5ai.header.html');
unlink($root . '/_h5ai.headers.html');
unlink($root . '/_h5ai.footer.html');
unlink($root . '/_h5ai/public/internal.txt');
unlink($root . '/_h5ai/private/internal.txt');
rmdir($root . '/_h5ai/public');
rmdir($root . '/_h5ai/private');
rmdir($root . '/_h5ai');
foreach (glob($root . '/*') as $file) {
    unlink($file);
}
rmdir($root);
unlink($outside);
unlink($conf . '/options.json');
unlink($conf . '/types.json');
rmdir($conf);
unlink($httpRoot . '/first.txt');
unlink($httpRoot . '/second.txt');
unlink($httpRoot . '/_h5ai/conf/options.json');
rmdir($httpRoot . '/_h5ai/conf');
rmdir($httpRoot . '/_h5ai/public');
rmdir($httpRoot . '/_h5ai/private');
rmdir($httpRoot . '/_h5ai');
rmdir($httpRoot);
rmdir($tmp);

echo "PHP security tests passed\n";
require __DIR__ . '/http.php';
