<?php

declare(strict_types=1);

// Regression tests for request-time cost and degraded environments: cached
// folder sizes in search, thumbnail size variants, Setup command probing and
// the SQLite thumbnail cache. Loaded by run.php after formats.php, which
// provide check(), TestSetup, ListingTestContext and remove_tree().

$robustTmp = sys_get_temp_dir() . '/h5ai-robust-' . bin2hex(random_bytes(6));
$robustStore = [];
mkdir($robustTmp, 0700, true);

// Puts executables named after $tools first on PATH; each appends its
// arguments to $tmp/<tool>.log and runs $body.
function install_fake_tools(string $tmp, array $tools): string {
    $bin = $tmp . '/bin';
    if (!is_dir($bin)) {
        mkdir($bin);
    }
    foreach ($tools as $tool => $body) {
        $log = escapeshellarg($tmp . '/' . $tool . '.log');
        file_put_contents($bin . '/' . $tool, "#!/bin/sh\necho \"\$*\" >> {$log}\n{$body}\n");
        chmod($bin . '/' . $tool, 0700);
    }
    $previous = getenv('PATH');
    putenv('PATH=' . $bin . ':' . $previous);
    return $previous === false ? '' : $previous;
}

function read_tool_log(string $tmp, string $tool): string {
    $log = $tmp . '/' . $tool . '.log';
    return is_file($log) ? (string) file_get_contents($log) : '';
}

try {
    $robustRoot = $robustTmp . '/root';
    $robustConf = $robustTmp . '/conf';
    $robustCache = $robustTmp . '/cache';
    foreach ([$robustRoot . '/match-dir', $robustConf, $robustCache . '/thumbs'] as $dir) {
        mkdir($dir, 0700, true);
    }
    file_put_contents($robustRoot . '/match-dir/file.txt', 'content');
    file_put_contents($robustRoot . '/movie.mp4', 'not really a movie');
    file_put_contents($robustRoot . '/photo.jpg', 'x');
    file_put_contents($robustConf . '/types.json', '{}');
    $writeOptions = static fn(array $options): int|false => file_put_contents(
        $robustConf . '/options.json',
        json_encode(['view' => ['hidden' => [], 'unmanaged' => []]] + $options),
    );
    $robustValues = [
        'ROOT_PATH' => $robustRoot, 'ROOT_HREF' => '/', 'CONF_PATH' => $robustConf,
        'PUBLIC_PATH' => $robustTmp . '/public', 'PUBLIC_HREF' => '/_h5ai/public/',
        'PRIVATE_PATH' => $robustTmp . '/private', 'CACHE_PRV_PATH' => $robustCache,
        'CACHE_PUB_PATH' => $robustCache, 'CACHE_PUB_HREF' => '/_h5ai/public/cache/',
        'HAS_CMD_DU' => true, 'HAS_PHP_WEBP' => true, 'HAS_PHP_EXIF' => false, 'HAS_PHP_FILEINFO' => false,
        'HAS_PHP_ZIP' => false, 'HAS_PHP_RAR' => false, 'HAS_CMD_GM' => false, 'HAS_CMD_CONVERT' => false,
        'HAS_CMD_FFMPEG' => true, 'HAS_CMD_FFPROBE' => false, 'HAS_CMD_AVCONV' => false, 'HAS_CMD_AVPROBE' => false,
    ];

    // --- Search serves folder sizes from the cache only --------------------
    $writeOptions([
        'foldersize' => ['enabled' => true, 'type' => 'shell-du'],
        'search' => ['enabled' => true],
    ]);
    $searchContext = new ListingTestContext(new Session($robustStore), new Request([], ''), new TestSetup($robustValues));
    $savedPath = install_fake_tools($robustTmp, ['du' => 'exit 1']);
    $filesizeCache = new ReflectionProperty(Filesize::class, 'cache');
    $filesizePersistentCache = new ReflectionProperty(Filesize::class, 'persistent_cache');
    try {
        $filesizeCache->setValue(null, []);
        $filesizePersistentCache->setValue(null, []);
        $found = array_column((new Search($searchContext))->get_items('/', 'match', false), null, 'href');
        check(isset($found['/match-dir/']), 'search must still find matching folders');
        check($found['/match-dir/']['size'] === null, 'search must not compute a cold folder size inline');
        check(read_tool_log($robustTmp, 'du') === '', 'search must not run du while answering');
        check(
            in_array($robustRoot . '/match-dir', $searchContext->refreshPaths, true),
            'search must queue cold folder sizes for the background refresh',
        );
    } finally {
        putenv('PATH=' . $savedPath);
        $filesizeCache->setValue(null, []);
        $filesizePersistentCache->setValue(null, null);
    }

    // --- Explicit thumbnail sizes snap to a few cached variants ------------
    $writeOptions(['thumbnails' => ['enabled' => true, 'size' => 240, 'maxDimension' => 4096]]);
    $thumbContext = new Context(new Session($robustStore), new Request([], ''), new TestSetup($robustValues));
    foreach ([
        [[], [320, 240]],
        [['width' => 1000, 'height' => 7], [1024, 0]],
        [['width' => 1024, 'height' => 0], [1024, 0]],
        [['width' => 1], [256, 0]],
        [['width' => 'abc'], [256, 0]],
        [['height' => 500], [256, 0]],
        [['width' => 999999], [4096, 0]],
    ] as [$request, $expected]) {
        check(
            Thumb::request_dimensions($thumbContext, $request) === $expected,
            'thumbnail request ' . json_encode($request) . ' must map to ' . json_encode($expected),
        );
    }
    $variants = [];
    for ($width = 1; $width <= 4096; $width++) {
        $variants[implode('x', Thumb::request_dimensions($thumbContext, ['width' => $width, 'height' => $width]))] = true;
    }
    check(count($variants) === 16, 'explicit widths up to 4096 must share 16 cached variants, got ' . count($variants));

    $writeOptions(['thumbnails' => ['enabled' => true, 'maxDimension' => 1000]]);
    $cappedContext = new Context(new Session($robustStore), new Request([], ''), new TestSetup($robustValues));
    check(Thumb::request_dimensions($cappedContext, ['width' => 900]) === [1000, 0], 'snapped widths must respect thumbnails.maxDimension');

    $sampleName = 'thumb-' . sha1($robustRoot . '/photo.jpg') . '-1024x0.webp';
    file_put_contents($robustCache . '/thumbs/' . $sampleName, 'webp');
    [$sampleHrefs] = $thumbContext->get_thumbs([['type' => 'img-jpg', 'href' => '/photo.jpg', 'width' => 1000, 'height' => 0]]);
    check(
        $sampleHrefs === ['/_h5ai/public/cache/thumbs/' . $sampleName],
        'a preview sample request must be served from its snapped cache variant',
    );

    // --- Only an administrator can force Setup to probe the host again -----
    $refreshRequest = new Request(['refresh' => '1'], '');
    $anonymousStore = [];
    check(
        !Context::wants_setup_refresh($refreshRequest, new Session($anonymousStore)),
        'an anonymous refresh request must not re-probe host commands',
    );
    $adminStore = [];
    $adminSession = new Session($adminStore);
    $adminSession->set('AS_ADMIN', true);
    check(Context::wants_setup_refresh($refreshRequest, $adminSession), 'an administrator refresh request must re-probe host commands');
    check(
        !Context::wants_setup_refresh(new Request([], ''), $adminSession),
        'an administrator request without refresh must reuse the command cache',
    );
    check(
        (new Context($adminSession, new Request([], ''), new TestSetup($robustValues)))->is_admin(),
        'an administrator session must be recognised by its context',
    );

    // --- Setup fails loudly and repairs an outdated command cache ---------
    $setupClass = new ReflectionClass(Setup::class);
    $newSetup = static function (bool $refresh, string $cachePath) use ($setupClass): Setup {
        $setup = $setupClass->newInstanceWithoutConstructor();
        $setupClass->getProperty('refresh')->setValue($setup, $refresh);
        $setupClass->getMethod('set')->invoke($setup, 'CACHE_PRV_PATH', $cachePath);
        return $setup;
    };
    $setupMessage = null;
    try {
        $newSetup(false, $robustCache)->get('MISSING_KEY');
    } catch (LogicException $exception) {
        $setupMessage = $exception->getMessage();
    }
    check($setupMessage === 'setup key not found: MISSING_KEY', 'a missing setup key must raise an error instead of a blank page');
    $setupMessage = null;
    try {
        $setupClass->getMethod('set')->invoke($newSetup(false, $robustCache), 'CACHE_PRV_PATH', 'again');
    } catch (LogicException $exception) {
        $setupMessage = $exception->getMessage();
    }
    check($setupMessage === 'setup key already taken: CACHE_PRV_PATH', 'redefining a setup key must raise an error');

    $cmdsPath = $robustCache . '/cmds.json';
    $probeSetup = static function (bool $refresh) use ($newSetup, $setupClass, $robustCache): Setup {
        $setup = $newSetup($refresh, $robustCache);
        $setupClass->getMethod('add_sys_cmd_checks')->invoke($setup);
        return $setup;
    };
    // Written by a release that did not probe ffprobe/avprobe yet.
    file_put_contents($cmdsPath, json_encode([
        'command' => true, 'which' => false, 'where' => false, 'avconv' => false, 'convert' => false,
        'du' => true, 'ffmpeg' => false, 'gm' => false, 'tar' => true, 'zip' => false,
    ]));
    $upgradedSetup = $probeSetup(false);
    check(is_bool($upgradedSetup->get('HAS_CMD_FFPROBE')), 'an outdated command cache must be probed again');
    check(is_bool($upgradedSetup->get('HAS_CMD_AVPROBE')), 'probe tools must be detected');
    $completeCmds = array_fill_keys(
        ['command', 'which', 'where', 'avconv', 'avprobe', 'convert', 'du', 'ffmpeg', 'ffprobe', 'gm', 'tar', 'zip'],
        false,
    );
    $completeCmds['zip'] = true; // A value no probe of this host would necessarily return.
    file_put_contents($cmdsPath, json_encode($completeCmds));
    check($probeSetup(false)->get('HAS_CMD_ZIP') === true, 'a complete command cache must be reused without probing');
    check(json_decode((string) file_get_contents($cmdsPath), true) === $completeCmds, 'reusing the command cache must not rewrite it');
    $adminSetup = $probeSetup(false);
    $setKey = $setupClass->getMethod('set');
    foreach ([
        'PUBLIC_HREF', 'ROOT_HREF', 'VERSION', 'PHP_VERSION', 'MIN_PHP_VERSION', 'PHP_ARCH', 'HAS_PHP_EXIF',
        'HAS_PHP_WEBP', 'HAS_PHP_FILEINFO', 'HAS_PHP_ZIP', 'HAS_PHP_RAR', 'HAS_PHP_SQLITE3', 'SERVER_NAME',
        'SERVER_VERSION', 'HAS_SERVER', 'INDEX_HREF', 'HAS_WRITABLE_CACHE_PUB', 'HAS_WRITABLE_CACHE_PRV',
    ] as $key) {
        $setKey->invoke($adminSetup, $key, '');
    }
    $adminInfo = $adminSetup->to_jsono(true);
    check(
        array_key_exists('HAS_CMD_FFPROBE', $adminInfo) && array_key_exists('HAS_CMD_AVPROBE', $adminInfo),
        'the info page must report the probe tools to administrators',
    );

    // --- Video thumbnails without a duration probe -------------------------
    $writeOptions(['thumbnails' => ['enabled' => true, 'seek' => 50]]);
    $savedPath = install_fake_tools($robustTmp, [
        'ffmpeg' => "printf 'not an image'",
        'ffprobe' => 'echo 10',
    ]);
    try {
        $runHandler = new ReflectionMethod(Thumb::class, 'run_handler');
        $videoThumb = static function (bool $hasProbe) use ($robustValues, $robustStore, $robustRoot): Thumb {
            $setup = new TestSetup(['HAS_CMD_FFPROBE' => $hasProbe] + $robustValues);
            $context = new Context(new Session($robustStore), new Request([], ''), $setup);
            return new Thumb($context, $robustRoot . '/movie.mp4', 'vid-mp4');
        };
        $runHandler->invoke($videoThumb(false), 'mov');
        check(read_tool_log($robustTmp, 'ffprobe') === '', 'a missing ffprobe must not be run');
        check(
            str_contains(read_tool_log($robustTmp, 'ffmpeg'), '-ss 0.1 -i ' . $robustRoot . '/movie.mp4'),
            'without a probe the video thumbnail must seek to an early frame',
        );
        unlink($robustTmp . '/ffmpeg.log');
        $runHandler->invoke($videoThumb(true), 'mov');
        check(read_tool_log($robustTmp, 'ffprobe') !== '', 'an available ffprobe must measure the duration');
        check(str_contains(read_tool_log($robustTmp, 'ffmpeg'), '-ss 5 -i '), 'the probed duration must set the seek position');

        unlink($robustTmp . '/ffmpeg.log');
        $runHandler->invoke($videoThumb(false), 'swf');
        check(
            str_contains(read_tool_log($robustTmp, 'ffmpeg'), '-i ' . $robustRoot . '/movie.mp4 -ss 0.1 '),
            'SWF/FLV thumbnails must seek after opening the input',
        );

        install_fake_tools($robustTmp, ['ffprobe' => 'echo N/A']);
        unlink($robustTmp . '/ffmpeg.log');
        $runHandler->invoke($videoThumb(true), 'mov');
        check(str_contains(read_tool_log($robustTmp, 'ffmpeg'), '-ss 0.1 -i '), 'an unknown duration must seek to an early frame');

        install_fake_tools($robustTmp, ['avconv' => "printf 'not an image'"]);
        $avconvSetup = new TestSetup(['HAS_CMD_FFMPEG' => false, 'HAS_CMD_AVCONV' => true] + $robustValues);
        $avconvContext = new Context(new Session($robustStore), new Request([], ''), $avconvSetup);
        $runHandler->invoke(new Thumb($avconvContext, $robustRoot . '/movie.mp4', 'vid-mp4'), 'mov');
        check(
            str_contains(read_tool_log($robustTmp, 'avconv'), '-ss 0.1 -i '),
            'avconv must be used, without a probe, when ffmpeg is missing',
        );
    } finally {
        putenv('PATH=' . $savedPath);
    }

    // --- The SQLite thumbnail cache degrades instead of failing ------------
    if (extension_loaded('sqlite3')) {
        $missingCacheSetup = new TestSetup(['CACHE_PRV_PATH' => $robustTmp . '/does-not-exist'] + $robustValues);
        $missingDb = new CacheDB($missingCacheSetup);
        $missingDb->insert('hash', 'img');
        check($missingDb->select('hash') === null, 'an unopenable thumbnail cache must be disabled, not fatal');

        // A database file left without tables (interrupted first run).
        $emptyCache = $robustTmp . '/empty-cache';
        mkdir($emptyCache);
        touch($emptyCache . '/thumbs_cache.db');
        $emptyDb = new CacheDB(new TestSetup(['CACHE_PRV_PATH' => $emptyCache] + $robustValues));
        $emptyDb->insert('hash', 'img-jpg');
        check(($emptyDb->select('hash')['type'] ?? null) === 'img-jpg', 'a database without tables must get its schema');

        $corruptCache = $robustTmp . '/corrupt-cache';
        mkdir($corruptCache);
        file_put_contents($corruptCache . '/thumbs_cache.db', str_repeat('not a database ', 100));
        // SQLite reports the corruption as warnings, which reach the error log.
        set_error_handler(static fn(int $errno, string $message): bool => str_contains($message, 'not a database'), E_WARNING);
        try {
            $corruptDb = new CacheDB(new TestSetup(['CACHE_PRV_PATH' => $corruptCache] + $robustValues));
            $corruptDb->insert('hash', 'img-jpg');
            check($corruptDb->select('hash') === null, 'a corrupt thumbnail cache must be ignored, not fatal');
        } finally {
            restore_error_handler();
        }
    } else {
        echo "SQLite3 extension missing: thumbnail cache database tests skipped\n";
    }
} finally {
    remove_tree($robustTmp);
}

echo "Search, thumbnail size, setup and cache database tests passed\n";
