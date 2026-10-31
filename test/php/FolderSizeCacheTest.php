<?php

declare(strict_types=1);

// The persistent folder-size cache: storage size, subtree invalidation, du
// passes, expiry, and folders visited once per walk.
final class FolderSizeCacheTest extends H5aiTestCase {
    private const FOLDER_COUNT = 1 + 20 + 3;

    private string $deepest;
    private string $cacheFile;

    // root/l1/l2/.../l20 (one file each) and root/a/{x,y}.
    protected function setUp(): void {
        parent::setUp();
        $chain = $this->root();
        for ($level = 1; $level <= 20; $level++) {
            $chain .= '/l' . $level;
            $this->write($chain . '/data.bin', str_repeat('x', 10));
        }
        $this->deepest = $chain;
        mkdir($this->root('a/x'), 0700, true);
        $this->write($this->root('a/y/data.bin'), str_repeat('y', 100));
        $this->cacheFile = $this->tmp . '/foldersizes.json';
        self::resetFolderSizes($this->cacheFile);
    }

    // Apparent size as a PHP walk counts it: files and folders alike.
    private static function treeSize(string $path): int {
        $size = (int) filesize($path);
        if (is_dir($path) && !is_link($path)) {
            foreach (array_diff(scandir($path), ['.', '..']) as $name) {
                $size += self::treeSize($path . '/' . $name);
            }
        }
        return $size;
    }

    // du implementations disagree on what a folder itself weighs (GNU
    // counts 0, busybox its size): compare du results with the du in use.
    private function useRealDu(): string {
        $du = trim((string) shell_exec('command -v du'));
        $this->fakeTools(['du' => 'exec ' . escapeshellarg($du) . ' "$@"']);
        return $du;
    }

    private static function duSize(string $du, string $path): int {
        return (int) shell_exec(escapeshellarg($du) . ' -sb ' . escapeshellarg($path));
    }

    private function warmer(string $type): CacheWarmer {
        return new CacheWarmer($this->context(['foldersize' => ['enabled' => true, 'type' => $type]], ['HAS_CMD_DU' => true]));
    }

    public function testStorageGrowsWithTheNumberOfFoldersNotTheirDepth(): void {
        self::assertSame(self::treeSize($this->root()), Filesize::getSize($this->root(), true, false));
        $entries = self::folderSizeEntries();
        self::assertCount(self::FOLDER_COUNT, $entries, 'a PHP walk must cache every folder');
        self::assertSame(
            self::FOLDER_COUNT - 1,
            array_sum(array_map(static fn(array $entry): int => count($entry['children']), $entries)),
            'each folder must be referenced once, by its parent',
        );
        $children = $entries[$this->root('a')]['children'];
        sort($children);
        self::assertSame([$this->root('a/x'), $this->root('a/y')], $children);
    }

    public function testAChangeDeepBelowInvalidatesTheRootEntry(): void {
        Filesize::getSize($this->root(), true, false);
        $entries = new ReflectionProperty(Filesize::class, 'persistent_cache');
        $requestCache = new ReflectionProperty(Filesize::class, 'cache');
        $cached = $entries->getValue();
        $entries->setValue(null, [$this->root() => ['size' => 12345] + $cached[$this->root()]] + $cached);
        $requestCache->setValue(null, []);
        self::assertSame(12345, Filesize::getCachedSize($this->root(), true, false), 'an unchanged tree must be served from cache');

        // Let the one-second resolution of filemtime() see the change.
        sleep(1);
        $this->write($this->deepest . '/new.bin', str_repeat('n', 50));
        clearstatcache();
        $requestCache->setValue(null, []);
        self::assertSame(self::treeSize($this->root()), Filesize::getCachedSize($this->root(), true, false));
    }

    public function testADuPassCachesEveryFolderItMeasured(): void {
        $du = $this->useRealDu();
        Filesize::refresh_du([$this->root('l1')], 30);
        $entries = self::folderSizeEntries();
        self::assertCount(20, $entries);
        self::assertSame(self::duSize($du, $this->root('l1')), $entries[$this->root('l1')]['size']);
        self::assertSame([$this->root('l1/l2/l3/l4')], $entries[$this->root('l1/l2/l3')]['children']);
    }

    public function testADuSizeRequestMeasuresTheFolderAndItsSubfolders(): void {
        $du = $this->useRealDu();
        self::assertSame(100, Filesize::getSize($this->root('a/y/data.bin'), true, true), 'a file size is its own size');
        self::assertSame(self::duSize($du, $this->root('a')), Filesize::getSize($this->root('a'), true, true));
        self::assertArrayHasKey($this->root('a/x'), self::folderSizeEntries());
    }

    public function testTheWarmerMeasuresTheShareInOneDuPass(): void {
        $du = $this->useRealDu();
        $this->warmer('shell-du')->warm();
        self::assertSame(['-b ' . $this->root()], array_values(array_filter(explode("\n", $this->toolLog('du')))));
        $entries = self::folderSizeEntries();
        self::assertCount(self::FOLDER_COUNT, $entries);
        self::assertSame(self::duSize($du, $this->root()), $entries[$this->root()]['size']);
    }

    public function testAFailedDuPassCachesNothing(): void {
        $this->fakeTools(['du' => 'exit 1']);
        $this->warmer('shell-du')->warm();
        self::assertSame([], self::folderSizeEntries(), 'a partial tree would understate sizes');
    }

    public function testAPhpWalkReusesTheEntryOfAnUnchangedSubfolder(): void {
        $this->useRealDu();
        Filesize::refresh_du([$this->root('a')], 30);
        $entries = new ReflectionProperty(Filesize::class, 'persistent_cache');
        $cached = $entries->getValue();
        $entries->setValue(null, [$this->root('a') => ['size' => 999] + $cached[$this->root('a')]] + $cached);
        $this->warmer('php')->warm();
        self::assertSame(
            self::treeSize($this->root()) - self::treeSize($this->root('a')) + 999,
            self::folderSizeEntries()[$this->root()]['size'],
        );
    }

    // A folder reached a second time (bind mount, ...) is counted once.
    public function testAFolderAlreadyCountedIsSkipped(): void {
        $class = new ReflectionClass(Filesize::class);
        $visited = [realpath($this->root('a/y')) => true];
        $size = $class->getMethod('php_folder_size')->invokeArgs($class->newInstanceWithoutConstructor(), [$this->root('a'), &$visited]);
        self::assertSame(self::treeSize($this->root('a')) - self::treeSize($this->root('a/y')), $size);
        self::assertSame([$this->root('a/x')], self::folderSizeEntries()[$this->root('a')]['children']);
    }

    public function testSavingDropsExpiredAndOutdatedEntries(): void {
        file_put_contents($this->cacheFile, json_encode([
            '/expired' => ['size' => 1, 'mtime' => 1, 'cached_at' => time() - Filesize::CACHE_TTL - 1, 'children' => []],
            '/other-process' => ['size' => 2, 'mtime' => 1, 'cached_at' => time(), 'children' => []],
            '/old-format' => ['size' => 3, 'cached_at' => time(), 'dirs' => []],
        ]));
        Filesize::set_persistent_cache_entry($this->root('a'), 7, []);
        Filesize::save_persistent_cache();
        self::assertSame(['/other-process', $this->root('a')], array_keys(json_decode((string) file_get_contents($this->cacheFile), true)));
    }

    public function testSearchAndArchivesTrackVisitedFoldersByRealPath(): void {
        $context = $this->context();
        $visited = [realpath($this->root('l1')) => true];
        self::assertSame([$this->root('l1')], (new Search($context))->get_paths($this->root(), '^l\d+$', false, $visited));
        self::assertArrayHasKey(realpath($this->root('a/x')), $visited);

        $archive = new Archive($context);
        $addDir = new ReflectionMethod($archive, 'add_dir');
        $archiveVisited = [realpath($this->root('a')) => true];
        $addDir->invokeArgs($archive, [$this->root('a'), 'a', &$archiveVisited]);
        self::assertSame([], (new ReflectionProperty($archive, 'dirs'))->getValue($archive));
        $addDir->invokeArgs($archive, [$this->root('l1/l2'), 'l2', &$archiveVisited]);
        self::assertArrayHasKey(realpath($this->deepest), $archiveVisited);
    }
}
