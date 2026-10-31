<?php

declare(strict_types=1);

// Regression tests for shared building blocks: type matching, the
// thumbnail capture pipeline and the CLI worker bootstrap. Loaded by run.php
// after robustness.php, which provides install_fake_tools() and
// read_tool_log().

require_once __DIR__ . '/../../src/_h5ai/private/php/class-bootstrap.php';

$structTmp = sys_get_temp_dir() . '/h5ai-struct-' . bin2hex(random_bytes(6));
$structStore = [];
mkdir($structTmp, 0700, true);

try {
    // --- TypeMatcher --------------------------------------------------------
    $matcher = new TypeMatcher([
        'broken' => 'not a definition',
        'ar-gz' => ['glob' => ['*.tar.gz', '*.tgz']],
        'ar' => ['glob' => ['*.gz']],
        'img-jpg' => ['glob' => ['*.jpg', '*.jpeg'], 'mime' => ['jpeg']],
        'vid-mp4' => ['mime' => ['video/mp4']],
        'txt-dot' => ['glob' => ['a.b|c']],
    ]);
    check($matcher->type_of_name('PHOTO.JPG') === 'img-jpg', 'name patterns must ignore case');
    check($matcher->type_of_name('backup.tar.gz') === 'ar-gz', 'the first matching type in file order must win');
    check($matcher->type_of_name('notes.gz') === 'ar', 'later types must match names earlier ones do not');
    check($matcher->type_of_name('jpg') === TypeMatcher::UNKNOWN, 'a glob must match the whole name');
    check($matcher->type_of_name('a.b|c') === 'txt-dot', 'glob characters other than * must match literally');
    check($matcher->type_of_name('axb') === TypeMatcher::UNKNOWN, 'a dot in a glob must not match any character');
    check($matcher->type_of_mime('image/jpeg') === 'img-jpg', 'a MIME fragment must match');
    check($matcher->type_of_mime('application/octet-stream') === TypeMatcher::UNKNOWN, 'an unknown MIME type must be reported as such');

    // --- Capture pipeline: each handler at most once ----------------------
    $pipeRoot = $structTmp . '/root';
    $pipeConf = $structTmp . '/conf';
    $pipeCache = $structTmp . '/cache';
    foreach ([$pipeRoot, $pipeConf, $pipeCache] as $dir) {
        mkdir($dir, 0700, true);
    }
    file_put_contents($pipeRoot . '/doc.pdf', "%PDF-1.4\n");
    // An MP4 file carrying a PDF name.
    file_put_contents($pipeRoot . '/clip.pdf', "\0\0\0\x18ftypmp42\0\0\0\0mp42isom" . str_repeat("\0", 64));
    file_put_contents($pipeRoot . '/second.pdf', "%PDF-1.4\n");
    file_put_contents($pipeConf . '/types.json', json_encode([
        'x-pdf' => ['glob' => ['*.pdf']],
        'vid-mp4' => ['glob' => ['*.mp4'], 'mime' => ['video/mp4']],
    ]));
    file_put_contents($pipeConf . '/options.json', json_encode([
        'view' => ['hidden' => [], 'unmanaged' => []],
        'thumbnails' => ['enabled' => true],
    ]));
    $pipeSetup = new TestSetup([
        'ROOT_PATH' => $pipeRoot, 'ROOT_HREF' => '/', 'CONF_PATH' => $pipeConf,
        'PUBLIC_PATH' => $structTmp . '/public', 'PRIVATE_PATH' => $structTmp . '/private',
        'CACHE_PRV_PATH' => $pipeCache, 'CACHE_PUB_PATH' => $pipeCache, 'CACHE_PUB_HREF' => '/cache/',
        'HAS_PHP_EXIF' => false, 'HAS_PHP_FILEINFO' => extension_loaded('fileinfo'), 'HAS_PHP_ZIP' => false,
        'HAS_PHP_RAR' => false, 'HAS_CMD_CONVERT' => true, 'HAS_CMD_GM' => false,
        'HAS_CMD_FFMPEG' => true, 'HAS_CMD_FFPROBE' => false, 'HAS_CMD_AVCONV' => false, 'HAS_CMD_AVPROBE' => false,
    ]);
    $pipeContext = new Context(new Session($structStore), new Request([], ''), $pipeSetup);
    $savedPath = install_fake_tools($structTmp, [
        'convert' => "printf 'not an image'",
        'ffmpeg' => "printf 'not an image'",
    ]);
    $toolRuns = static fn(string $tool): int => substr_count(read_tool_log($structTmp, $tool), "\n");
    $resetToolLogs = static function () use ($structTmp): void {
        foreach (['convert', 'ffmpeg'] as $tool) {
            @unlink($structTmp . '/' . $tool . '.log');
        }
    };
    try {
        $pdfThumb = new Thumb($pipeContext, $pipeRoot . '/doc.pdf', 'x-pdf');
        check($pdfThumb->thumb(320, 240) === null, 'a failing document capture must yield no thumbnail');
        check($toolRuns('convert') === 1, 'a failing document capture must run convert once, ran ' . $toolRuns('convert'));
        check($toolRuns('ffmpeg') === 0, 'a document recognised by name and content must not be tried as a video');

        $resetToolLogs();
        $unknownThumb = new Thumb($pipeContext, $pipeRoot . '/doc.pdf', 'file');
        $unknownThumb->thumb(320, 240);
        check($toolRuns('convert') === 1, 'a file sent with an unknown type must be identified by its name');

        if (extension_loaded('fileinfo')) {
            $resetToolLogs();
            $misnamed = new Thumb($pipeContext, $pipeRoot . '/clip.pdf', 'x-pdf');
            $misnamed->thumb(320, 240);
            check($toolRuns('convert') === 1 && $toolRuns('ffmpeg') === 1, 'a misnamed file must be retried once by its content type');
            check($misnamed->get_type()->name === 'vid-mp4' && $misnamed->get_type()->was_wrong(), 'a misnamed file must report its content type');

            // One instance reused for another source must not keep its state.
            $resetToolLogs();
            $misnamed->thumb_for('x-pdf', '/second.pdf', 320, 240);
            check(
                $misnamed->get_type()->name === 'x-pdf' && !$misnamed->get_type()->was_wrong(),
                'a reused thumbnail generator must start from the new source type',
            );
            check($toolRuns('convert') === 1 && $toolRuns('ffmpeg') === 0, 'a reused thumbnail generator must try the new source afresh');
        }

        // Without an archive reader the archive is reported unhandled once
        // (cached negatively) instead of being retried by other handlers.
        $resetToolLogs();
        file_put_contents($pipeRoot . '/comics.zip', 'PK');
        $archiveThumb = new Thumb($pipeContext, $pipeRoot . '/comics.zip', 'ar-zip');
        check($archiveThumb->thumb(320, 240) === null, 'an unreadable archive must yield no thumbnail');
        check($toolRuns('convert') + $toolRuns('ffmpeg') === 0, 'an unhandled archive must not be tried with other tools');
        if (extension_loaded('sqlite3')) {
            check(
                ((new CacheDB($pipeSetup))->select(sha1($pipeRoot . '/comics.zip'))['type'] ?? null) === 'ar-zip',
                'an unhandled archive must be cached negatively',
            );
        }

        // A custom thumbnail replaces the source and is served from cache.
        mkdir($pipeRoot . '/_thumb');
        file_put_contents($pipeRoot . '/_thumb/doc.png', 'png');
        $customName = 'thumb-' . sha1($pipeRoot . '/_thumb/doc.png') . '-320x240.webp';
        file_put_contents($pipeCache . '/thumbs/' . $customName, 'webp');
        $customThumb = new Thumb($pipeContext, $pipeRoot . '/doc.pdf', 'x-pdf');
        check($customThumb->thumb(320, 240) === '/cache/thumbs/' . $customName, 'a custom thumbnail must be served when present');
        check($customThumb->get_type()->name === 'img', 'a custom thumbnail must be handled as an image');
    } finally {
        putenv('PATH=' . $savedPath);
    }

    // --- CLI bootstrap -----------------------------------------------------
    $cliRoot = $structTmp . '/share';
    mkdir($cliRoot . '/sub', 0700, true);
    file_put_contents($cliRoot . '/sub/data.bin', str_repeat('x', 1000));
    $srcCache = realpath(__DIR__ . '/../../src/_h5ai/private/cache');
    $cacheBefore = scandir($srcCache);
    $serverBefore = $_SERVER;
    $rootEnvBefore = getenv('H5AI_ROOT_PATH');
    $magickEnvBefore = getenv('MAGICK_CONFIGURE_PATH');
    putenv('H5AI_ROOT_PATH=' . $cliRoot);
    try {
        $cliContext = Bootstrap::cli_context();
        check($cliContext->get_setup()->get('ROOT_PATH') === $cliRoot, 'CLI workers must index H5AI_ROOT_PATH');
        check($cliContext->get_setup()->get('REQUEST_METHOD') === 'GET', 'CLI workers must behave as a GET request');
        check(!$cliContext->is_admin(), 'CLI workers must not run as administrator');
    } finally {
        $_SERVER = $serverBefore;
        putenv($rootEnvBefore === false ? 'H5AI_ROOT_PATH' : 'H5AI_ROOT_PATH=' . $rootEnvBefore);
        putenv($magickEnvBefore === false ? 'MAGICK_CONFIGURE_PATH' : 'MAGICK_CONFIGURE_PATH=' . $magickEnvBefore);
        // Setup caches the detected commands next to the sources; keep the
        // checkout as it was.
        foreach (array_diff(scandir($srcCache), $cacheBefore) as $created) {
            unlink($srcCache . '/' . $created);
        }
    }

    // Both workers, run as the cron job or the web request would run them,
    // on a copy of the application so their caches stay out of the checkout.
    $appDir = $structTmp . '/app/_h5ai';
    mkdir($appDir . '/public/cache', 0700, true);
    exec('cp -R ' . escapeshellarg(__DIR__ . '/../../src/_h5ai/private') . ' ' . escapeshellarg($appDir . '/private'), $unused, $copyStatus);
    check($copyStatus === 0, 'the application copy for the CLI workers must succeed');
    file_put_contents($appDir . '/private/conf/options.json', json_encode([
        'foldersize' => ['enabled' => true, 'type' => 'php'],
        'thumbnails' => ['enabled' => false],
    ]));
    $runWorker = static function (string $script, array $args = []) use ($appDir, $cliRoot): array {
        $command = 'H5AI_ROOT_PATH=' . escapeshellarg($cliRoot) . ' ' . escapeshellarg(PHP_BINARY)
            . ' ' . escapeshellarg($appDir . '/private/php/' . $script);
        foreach ($args as $arg) {
            $command .= ' ' . escapeshellarg($arg);
        }
        exec($command . ' 2>&1', $output, $status);
        return [$status, implode("\n", $output)];
    };
    $cachedSizes = static fn(): array => json_decode((string) @file_get_contents($appDir . '/private/cache/foldersizes.json'), true) ?: [];

    touch($appDir . '/private/cache/refresh.requested');
    [$refreshStatus, $refreshOutput] = $runWorker('refresh-cache.php', [$cliRoot . '/sub']);
    check($refreshStatus === 0, 'the refresh worker must succeed: ' . $refreshOutput);
    check(($cachedSizes()[$cliRoot . '/sub']['size'] ?? 0) >= 1000, 'the refresh worker must cache the requested folder size');
    check(!file_exists($appDir . '/private/cache/refresh.requested'), 'the refresh worker must clear its request marker');

    [$warmStatus, $warmOutput] = $runWorker('warm-cache.php');
    check($warmStatus === 0 && str_contains($warmOutput, 'Cache warming completed'), 'the cache warmer must complete: ' . $warmOutput);
    check(($cachedSizes()[$cliRoot]['size'] ?? 0) >= 1000, 'the cache warmer must cache the root folder size');
    check(is_file($appDir . '/private/cache/warmer.lastrun'), 'the cache warmer must record its last run');
} finally {
    remove_tree($structTmp);
}

echo "Type matching, capture pipeline and CLI bootstrap tests passed\n";
