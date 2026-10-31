<?php

declare(strict_types=1);

// Regression tests for the persistent folder-size cache: storage size,
// subtree invalidation, du passes and expiry. Loaded by run.php after
// structure.php; uses install_fake_tools() and read_tool_log() from
// robustness.php.

$sizesTmp = sys_get_temp_dir() . '/h5ai-sizes-' . bin2hex(random_bytes(6));
$sizesStore = [];
mkdir($sizesTmp, 0700, true);

// Apparent size of a tree as `du -sb` reports it: files and folders alike.
function tree_size(string $path): int {
    $size = (int) filesize($path);
    if (is_dir($path) && !is_link($path)) {
        foreach (scandir($path) as $name) {
            if ($name !== '.' && $name !== '..') {
                $size += tree_size($path . '/' . $name);
            }
        }
    }
    return $size;
}

$filesizeState = [];
foreach (['cache', 'persistent_cache', 'persistent_cache_path', 'persistent_cache_dirty', 'dirty_entries'] as $property) {
    $filesizeState[$property] = new ReflectionProperty(Filesize::class, $property);
}
// Starts every case from an empty cache saved to $file instead of the checkout.
$resetSizes = static function (?string $file) use ($filesizeState): void {
    $filesizeState['cache']->setValue(null, []);
    $filesizeState['persistent_cache']->setValue(null, $file === null ? null : []);
    $filesizeState['persistent_cache_path']->setValue(null, $file);
    $filesizeState['persistent_cache_dirty']->setValue(null, false);
    $filesizeState['dirty_entries']->setValue(null, []);
};
$entries = static fn(): array => $filesizeState['persistent_cache']->getValue();

try {
    // root/l1/l2/.../l20 (one file each) and root/a/{x,y}.
    $sizesRoot = $sizesTmp . '/root';
    $chain = $sizesRoot;
    for ($level = 1; $level <= 20; $level++) {
        $chain .= '/l' . $level;
        mkdir($chain, 0700, true);
        file_put_contents($chain . '/data.bin', str_repeat('x', 10));
    }
    $deepest = $chain;
    mkdir($sizesRoot . '/a/x', 0700, true);
    mkdir($sizesRoot . '/a/y', 0700, true);
    file_put_contents($sizesRoot . '/a/y/data.bin', str_repeat('y', 100));
    $folderCount = 1 + 20 + 3;
    $cacheFile = $sizesTmp . '/foldersizes.json';

    // --- Storage grows with the number of folders, not with their depth ---
    $resetSizes($cacheFile);
    check(Filesize::getSize($sizesRoot, true, false) === tree_size($sizesRoot), 'a PHP folder walk must add up the whole tree');
    $cached = $entries();
    check(count($cached) === $folderCount, 'a PHP folder walk must cache every folder');
    check(
        array_sum(array_map(static fn(array $entry): int => count($entry['children']), $cached)) === $folderCount - 1,
        'each folder must be referenced once, by its parent',
    );
    $aChildren = $cached[$sizesRoot . '/a']['children'];
    sort($aChildren);
    check($aChildren === [$sizesRoot . '/a/x', $sizesRoot . '/a/y'], 'an entry must list its direct subfolders');

    // --- A valid entry is served; a change deep below invalidates it -------
    $filesizeState['persistent_cache']->setValue(null, [$sizesRoot => ['size' => 12345] + $cached[$sizesRoot]] + $cached);
    $filesizeState['cache']->setValue(null, []);
    check(Filesize::getCachedSize($sizesRoot, true, false) === 12345, 'an unchanged tree must be served from its cache entry');
    // A new entry changes the mtime of the folder holding it; keep the
    // second resolution of filemtime() from hiding the change.
    sleep(1);
    file_put_contents($deepest . '/new.bin', str_repeat('n', 50));
    clearstatcache();
    $filesizeState['cache']->setValue(null, []);
    check(
        Filesize::getCachedSize($sizesRoot, true, false) === tree_size($sizesRoot),
        'a change twenty levels down must invalidate the root entry',
    );

    // --- du caches every folder it measured -------------------------------
    $realDu = trim((string) shell_exec('command -v du'));
    // du implementations disagree on what a folder itself weighs (GNU counts
    // 0, busybox its size): compare with the du in use, not with PHP.
    $duSize = static fn(string $path): int => (int) shell_exec(escapeshellarg($realDu) . ' -sb ' . escapeshellarg($path));
    $savedPath = install_fake_tools($sizesTmp, ['du' => 'exec ' . escapeshellarg($realDu) . ' "$@"']);
    try {
        $resetSizes($cacheFile);
        Filesize::refresh_du([$sizesRoot . '/l1'], 30);
        check(count($entries()) === 20, 'one du pass must cache every folder it measured');
        check($entries()[$sizesRoot . '/l1']['size'] === $duSize($sizesRoot . '/l1'), 'a cached du size must match du -sb');
        check(
            $entries()[$sizesRoot . '/l1/l2/l3']['children'] === [$sizesRoot . '/l1/l2/l3/l4'],
            'du entries must link each folder to its subfolders',
        );

        // --- The warmer measures the whole tree in one pass ----------------
        @unlink($sizesTmp . '/du.log');
        $resetSizes($cacheFile);
        $warmConf = $sizesTmp . '/conf';
        mkdir($warmConf);
        file_put_contents($warmConf . '/types.json', '{}');
        file_put_contents($warmConf . '/options.json', json_encode([
            'view' => ['hidden' => [], 'unmanaged' => []],
            'foldersize' => ['enabled' => true, 'type' => 'shell-du'],
        ]));
        $warmSetup = new TestSetup([
            'ROOT_PATH' => $sizesRoot, 'ROOT_HREF' => '/', 'CONF_PATH' => $warmConf,
            'PUBLIC_PATH' => $sizesTmp . '/public', 'PRIVATE_PATH' => $sizesTmp . '/private',
            'HAS_CMD_DU' => true, 'HAS_PHP_WEBP' => false,
        ]);
        $warmer = new CacheWarmer(new Context(new Session($sizesStore), new Request([], ''), $warmSetup));
        $warmer->warm();
        check(
            array_filter(explode("\n", read_tool_log($sizesTmp, 'du'))) === ['-b ' . $sizesRoot],
            'the cache warmer must run du once, on the root: ' . read_tool_log($sizesTmp, 'du'),
        );
        check(count($entries()) === $folderCount, 'the cache warmer must cache every folder');
        check($entries()[$sizesRoot]['size'] === $duSize($sizesRoot), 'the warmed root size must match du -sb');

        // A pass that fails caches nothing rather than understated sizes.
        file_put_contents($sizesTmp . '/bin/du', "#!/bin/sh\nexit 1\n");
        $resetSizes($cacheFile);
        $warmer->warm();
        check($entries() === [], 'a failed du pass must not cache any size');

        // Without du, a PHP walk reuses valid subfolder entries.
        file_put_contents($sizesTmp . '/bin/du', "#!/bin/sh\nexec " . escapeshellarg($realDu) . ' "$@"' . "\n");
        $resetSizes($cacheFile);
        Filesize::refresh_du([$sizesRoot . '/a'], 30);
        file_put_contents($warmConf . '/options.json', json_encode([
            'view' => ['hidden' => [], 'unmanaged' => []],
            'foldersize' => ['enabled' => true, 'type' => 'php'],
        ]));
        $filesizeState['persistent_cache']->setValue(null, [$sizesRoot . '/a' => ['size' => 999] + $entries()[$sizesRoot . '/a']] + $entries());
        (new CacheWarmer(new Context(new Session($sizesStore), new Request([], ''), $warmSetup)))->warm();
        check(
            $entries()[$sizesRoot]['size'] === tree_size($sizesRoot) - tree_size($sizesRoot . '/a') + 999,
            'a PHP walk must reuse the valid entry of an unchanged subfolder',
        );

        // Direct size requests, outside the warmer.
        $resetSizes($cacheFile);
        check(Filesize::getSize($sizesRoot . '/a/y/data.bin', true, true) === 100, 'a file size must be its own size');
        check(Filesize::getSize($sizesRoot . '/a', true, true) === $duSize($sizesRoot . '/a'), 'a du size request must measure the folder');
        check(isset($entries()[$sizesRoot . '/a/x']), 'a du size request must cache the subfolders it measured');

        // A folder reached a second time (bind mount, ...) is counted once.
        $resetSizes($cacheFile);
        $sizerClass = new ReflectionClass(Filesize::class);
        $sizer = $sizerClass->newInstanceWithoutConstructor();
        $walkVisited = [realpath($sizesRoot . '/a/y') => true];
        $walked = $sizerClass->getMethod('php_folder_size')->invokeArgs($sizer, [$sizesRoot . '/a', &$walkVisited]);
        check($walked === tree_size($sizesRoot . '/a') - tree_size($sizesRoot . '/a/y'), 'a folder already counted must not be counted again');
        check($entries()[$sizesRoot . '/a']['children'] === [$sizesRoot . '/a/x'], 'a folder already counted must not be listed as a subfolder');
    } finally {
        putenv('PATH=' . $savedPath);
    }

    // --- Saving drops expired entries -------------------------------------
    $resetSizes($cacheFile);
    file_put_contents($cacheFile, json_encode([
        '/expired' => ['size' => 1, 'mtime' => 1, 'cached_at' => time() - Filesize::CACHE_TTL - 1, 'children' => []],
        '/other-process' => ['size' => 2, 'mtime' => 1, 'cached_at' => time(), 'children' => []],
        '/old-format' => ['size' => 3, 'cached_at' => time(), 'dirs' => []],
    ]));
    Filesize::set_persistent_cache_entry($sizesRoot . '/a', 7, []);
    Filesize::save_persistent_cache();
    $saved = json_decode((string) file_get_contents($cacheFile), true);
    check(
        array_keys($saved) === ['/other-process', $sizesRoot . '/a'],
        'saving must keep fresh entries and drop expired or outdated ones: ' . implode(', ', array_keys($saved)),
    );

    // --- Visited folders are sets keyed by real path ----------------------
    file_put_contents($warmConf . '/options.json', json_encode(['view' => ['hidden' => [], 'unmanaged' => []]]));
    $plainContext = new Context(new Session($sizesStore), new Request([], ''), $warmSetup);
    $visited = [realpath($sizesRoot . '/l1') => true];
    $found = (new Search($plainContext))->get_paths($sizesRoot, '^l\d+$', false, $visited);
    check($found === [$sizesRoot . '/l1'], 'search must not descend into an already visited folder');
    check(isset($visited[realpath($sizesRoot . '/a/x')]), 'search must record visited folders by real path');

    $archive = new Archive($plainContext);
    $addDir = new ReflectionMethod($archive, 'add_dir');
    $archiveVisited = [realpath($sizesRoot . '/a') => true];
    $addDir->invokeArgs($archive, [$sizesRoot . '/a', 'a', &$archiveVisited]);
    check((new ReflectionProperty($archive, 'dirs'))->getValue($archive) === [], 'an archive must skip an already visited folder');
    $addDir->invokeArgs($archive, [$sizesRoot . '/l1/l2', 'l2', &$archiveVisited]);
    check(isset($archiveVisited[realpath($deepest)]), 'an archive must record visited folders by real path');
} finally {
    $resetSizes(null);
    remove_tree($sizesTmp);
}

echo "Folder size cache tests passed\n";
