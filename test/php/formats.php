<?php

declare(strict_types=1);

// Regression tests for configuration parsing, thumbnail capture output,
// streamed TAR entries and cache warming. Loaded by run.php, which provides
// check(), TestSetup and the class files.

require_once __DIR__ . '/../../src/_h5ai/private/php/ext/class-cachedb.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-cachewarmer.php';

$formatsTmp = sys_get_temp_dir() . '/h5ai-formats-' . bin2hex(random_bytes(6));
$formatsStore = [];
mkdir($formatsTmp, 0700, true);

function remove_tree(string $path): void {
    if (is_dir($path) && !is_link($path)) {
        foreach (scandir($path) as $name) {
            if ($name !== '.' && $name !== '..') {
                remove_tree($path . '/' . $name);
            }
        }
        rmdir($path);
    } elseif (file_exists($path) || is_link($path)) {
        unlink($path);
    }
}

try {
    // --- Json: comments are stripped outside strings only -----------------
    $jsonPath = $formatsTmp . '/commented.json';
    file_put_contents($jsonPath, <<<'JSON'
        {
            // a line comment
            "drive": "C:\\", // a backslash ends this string, not the comment
            "quoted": "say \"hi\" // not a comment",
            "url": "http://example.org/*not-a-comment*/", /* block
            comment */
            "last": true
        }
        JSON);
    check(
        Json::load($jsonPath) === [
            'drive' => 'C:\\',
            'quoted' => 'say "hi" // not a comment',
            'url' => 'http://example.org/*not-a-comment*/',
            'last' => true,
        ],
        'commented JSON must survive a string ending with an escaped backslash',
    );

    // --- Thumb: capture output signatures ---------------------------------
    check(Thumb::has_capture_signature("\xFF\xD8\xFF\xE0\0\x10JFIF"), 'JPEG capture output (ffmpeg) must be accepted');
    check(Thumb::has_capture_signature("RIFF\x24\0\0\0WEBPVP8 "), 'WebP capture output (convert/gm) must be accepted');
    check(!Thumb::has_capture_signature("RIFF\x24\0\0\0WAVEfmt "), 'non-image RIFF output must be rejected');
    check(!Thumb::has_capture_signature(''), 'empty capture output must be rejected');

    // A capture command whose output is not an image must fail before any
    // decoding, so the caller can fall back to another handler.
    $fakeBin = $formatsTmp . '/bin';
    mkdir($fakeBin);
    file_put_contents($fakeBin . '/convert', "#!/bin/sh\nprintf 'not an image'\n");
    chmod($fakeBin . '/convert', 0700);
    $capturePath = getenv('PATH');
    putenv('PATH=' . $fakeBin . ':' . $capturePath);
    try {
        $captureSetup = new TestSetup([
            'ROOT_PATH' => $formatsTmp, 'ROOT_HREF' => '/', 'CONF_PATH' => $formatsTmp,
            'CACHE_PUB_PATH' => $formatsTmp . '/capture-pub', 'CACHE_PUB_HREF' => '/cache/',
            'CACHE_PRV_PATH' => $formatsTmp, 'HAS_PHP_ZIP' => false, 'HAS_PHP_RAR' => false,
            'HAS_PHP_FILEINFO' => false, 'HAS_CMD_FFMPEG' => false, 'HAS_CMD_AVCONV' => false,
            'HAS_CMD_GM' => false, 'HAS_CMD_CONVERT' => true,
        ]);
        $captureContext = new Context(new Session($formatsStore), new Request([], ''), $captureSetup);
        file_put_contents($formatsTmp . '/doc.pdf', '%PDF-1.4');
        $captureMessage = null;
        try {
            (new Thumb($captureContext, $formatsTmp . '/doc.pdf', 'x-pdf'))->do_capture(Thumb::CONVERT_CMDV);
        } catch (Exception $exception) {
            $captureMessage = $exception->getMessage();
        }
        check($captureMessage === 'thumbnail command produced no image', 'non-image capture output must be rejected before decoding');
    } finally {
        putenv($capturePath === false ? 'PATH' : 'PATH=' . $capturePath);
    }

    // --- CacheWarmer: warms exactly what the listing requests -------------
    $warmRoot = $formatsTmp . '/root';
    $warmConf = $formatsTmp . '/conf';
    $warmCachePub = $formatsTmp . '/cache-pub';
    $warmCachePrv = $formatsTmp . '/cache-prv';
    foreach ([$warmRoot, $warmConf, $warmCachePub . '/thumbs', $warmCachePrv] as $dir) {
        mkdir($dir, 0700, true);
    }
    foreach (['a.jpg', 'b.pdf', 'c.zip', 'd.txt'] as $name) {
        file_put_contents($warmRoot . '/' . $name, 'x');
    }
    file_put_contents($warmConf . '/types.json', json_encode([
        'img-jpg' => ['glob' => ['*.jpg']],
        'x-pdf' => ['glob' => ['*.pdf']],
        'ar-zip' => ['glob' => ['*.zip']],
    ]));
    file_put_contents($warmConf . '/options.json', json_encode([
        'view' => ['hidden' => [], 'unmanaged' => []],
        'foldersize' => ['enabled' => false],
        'thumbnails' => [
            'enabled' => true,
            // 200 * 4/3 = 266.67: floor (served) and round (old warmer) differ.
            'size' => 200,
            'img' => ['img-jpg'],
            'doc' => ['x-pdf'],
            'ar' => ['ar-zip'],
            'blocklist' => ['x-pdf'],
        ],
    ]));
    $warmSetup = new TestSetup([
        'ROOT_PATH' => $warmRoot, 'ROOT_HREF' => '/',
        'PUBLIC_PATH' => $formatsTmp . '/public', 'PRIVATE_PATH' => $formatsTmp . '/private',
        'CONF_PATH' => $warmConf, 'HAS_CMD_DU' => false,
        'CACHE_PUB_PATH' => $warmCachePub, 'CACHE_PUB_HREF' => '/_h5ai/public/cache/',
        'CACHE_PRV_PATH' => $warmCachePrv,
        'HAS_PHP_WEBP' => true, 'HAS_PHP_EXIF' => false, 'HAS_PHP_FILEINFO' => false,
        'HAS_PHP_ZIP' => false, 'HAS_PHP_RAR' => false,
        'HAS_CMD_FFMPEG' => false, 'HAS_CMD_AVCONV' => false, 'HAS_CMD_GM' => false, 'HAS_CMD_CONVERT' => false,
    ]);
    $warmContext = new Context(new Session($formatsStore), new Request([], ''), $warmSetup);
    check(Thumb::default_dimensions($warmContext) === [266, 200], 'listing thumbnails must be 4:3 with a floored width');

    // Pre-seed the cache entries a listing request would hit, so the real
    // lookup runs without GD or any capture command.
    $seededHrefs = [];
    foreach (['a.jpg', 'c.zip'] as $name) {
        $thumbName = 'thumb-' . sha1($warmRoot . '/' . $name) . '-266x200.webp';
        file_put_contents($warmCachePub . '/thumbs/' . $thumbName, 'webp');
        $seededHrefs['/' . $name] = '/_h5ai/public/cache/thumbs/' . $thumbName;
    }

    $recordingThumb = new class($warmContext) extends Thumb {
        public array $calls = [];

        public function thumb_for(string $type, string $source_href, int $width, int $height): ?string {
            $href = parent::thumb_for($type, $source_href, $width, $height);
            $this->calls[] = [$type, $source_href, $width, $height, $href];
            return $href;
        }
    };
    (new CacheWarmer($warmContext, $recordingThumb))->warm();
    check(
        $recordingThumb->calls === [
            ['img-jpg', '/a.jpg', 266, 200, $seededHrefs['/a.jpg']],
            ['ar-zip', '/c.zip', 266, 200, $seededHrefs['/c.zip']],
        ],
        'the cache warmer must request each configured, unblocked type once at the listing size: '
            . json_encode($recordingThumb->calls),
    );

    [$servedHrefs] = $warmContext->get_thumbs([
        ['type' => 'img-jpg', 'href' => '/a.jpg'],
        ['type' => 'ar-zip', 'href' => '/c.zip'],
    ]);
    check($servedHrefs === array_values($seededHrefs), 'listing requests must be served the thumbnails the warmer produced');

    // --- Archive: each entry is exactly as long as its header announces ----
    $archiveFile = $formatsTmp . '/entry.bin';
    file_put_contents($archiveFile, 'abc');
    $archive = new Archive($warmContext);
    // Archive output is flushed as it streams, so collect every flushed chunk.
    $captureArchive = static function (string $method, mixed ...$args) use ($archive): array {
        $written = '';
        ob_start(static function (string $chunk) use (&$written): string {
            $written .= $chunk;
            return '';
        });
        // php_tar() announces Content-Length; the CLI test run has already
        // written output, so only that header warning is expected here.
        set_error_handler(
            static fn(int $errno, string $message): bool => str_starts_with($message, 'Cannot modify header information'),
            E_WARNING,
        );
        try {
            $ok = (new ReflectionMethod($archive, $method))->invoke($archive, ...$args);
        } finally {
            restore_error_handler();
            ob_end_clean();
        }
        return [$ok, $written];
    };
    $captureEntry = static fn(string $file, int $size): array => $captureArchive('print_file', $file, $size);
    check($captureEntry($archiveFile, 3) === [true, 'abc'], 'an unchanged file must be archived as is');
    check($captureEntry($archiveFile, 5) === [true, "abc\0\0"], 'a file that shrank must be padded to its announced size');
    check($captureEntry($archiveFile, 2) === [true, 'ab'], 'a file that grew must be cut at its announced size');
    check(
        $captureEntry($formatsTmp . '/vanished.bin', 70000) === [true, str_repeat("\0", 70000)],
        'an unreadable file must keep its announced size',
    );

    [$tarOk, $tar] = $captureArchive('php_tar', [$warmRoot => 'root'], [$archiveFile => 'root/entry.bin']);
    check($tarOk && strlen($tar) % 512 === 0, 'a PHP TAR stream must consist of whole 512-byte blocks');
    $tarPath = $formatsTmp . '/out.tar';
    file_put_contents($tarPath, $tar);
    exec('tar -tf ' . escapeshellarg($tarPath) . ' 2>&1', $tarListing, $tarStatus);
    check($tarStatus === 0 && $tarListing === ['root', 'root/entry.bin'], 'a PHP TAR stream must list its entries: ' . implode(', ', $tarListing));
} finally {
    remove_tree($formatsTmp);
}

echo "Format, archive and cache warmer tests passed\n";
