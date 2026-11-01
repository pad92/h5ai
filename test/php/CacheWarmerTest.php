<?php

declare(strict_types=1);

// The warmer must produce exactly the thumbnails listings ask for.
final class CacheWarmerTest extends H5aiTestCase {
    public function testItWarmsEachConfiguredTypeOnceAtTheListingSize(): void {
        foreach (['a.jpg', 'b.pdf', 'c.zip', 'd.txt'] as $name) {
            $this->write($this->root($name), 'x');
        }
        $context = $this->context(
            ['thumbnails' => [
                'enabled' => true,
                // 200 * 4/3 = 266.67: floored when served, rounded by the old warmer.
                'size' => 200,
                'img' => ['img-jpg'], 'doc' => ['x-pdf'], 'ar' => ['ar-zip'],
                'blocklist' => ['x-pdf'],
            ]],
            ['HAS_PHP_WEBP' => true],
            ['img-jpg' => ['glob' => ['*.jpg']], 'x-pdf' => ['glob' => ['*.pdf']], 'ar-zip' => ['glob' => ['*.zip']]],
        );
        self::assertSame([266, 200], Thumb::default_dimensions($context));

        // Seed the cache entries a listing would hit, so the real lookup
        // runs without GD or any capture tool.
        $seeded = [];
        foreach (['a.jpg', 'c.zip'] as $name) {
            $thumb = 'thumb-' . sha1($this->root($name)) . '-266x200.webp';
            $this->write($this->tmp . '/cache-pub/thumbs/' . $thumb, 'webp');
            $seeded['/' . $name] = '/_h5ai/public/cache/thumbs/' . $thumb;
        }
        $recorder = new class($context) extends Thumb {
            public array $calls = [];

            public function thumb_for(string $type, string $source_href, int $width, int $height): ?string {
                $href = parent::thumb_for($type, $source_href, $width, $height);
                $this->calls[] = [$type, $source_href, $width, $height, $href];
                return $href;
            }
        };
        (new CacheWarmer($context, $recorder))->warm();
        self::assertSame(
            [['img-jpg', '/a.jpg', 266, 200, $seeded['/a.jpg']], ['ar-zip', '/c.zip', 266, 200, $seeded['/c.zip']]],
            $recorder->calls,
        );

        [$served] = $context->get_thumbs([['type' => 'img-jpg', 'href' => '/a.jpg'], ['type' => 'ar-zip', 'href' => '/c.zip']]);
        self::assertSame(array_values($seeded), $served, 'listings must be served the thumbnails the warmer produced');
    }

    // Warms a.jpg and b.jpg from seeded thumbnails and returns their paths.
    private function warmTwoImages(): array {
        $thumbs = [];
        foreach (['a.jpg', 'sub/b.jpg'] as $name) {
            $this->write($this->root($name), 'x');
            $thumbs[$name] = $this->write($this->tmp . '/cache-pub/thumbs/thumb-' . sha1($this->root($name)) . '-266x200.webp', 'webp');
        }
        self::assertSame(0, $this->imageWarmer()->warm());
        return $thumbs;
    }

    private function imageWarmer(): CacheWarmer {
        return new CacheWarmer($this->context(
            ['thumbnails' => ['enabled' => true, 'size' => 200, 'img' => ['img-jpg']]],
            ['HAS_PHP_WEBP' => true],
            ['img-jpg' => ['glob' => ['*.jpg']]],
        ));
    }

    public function testTheThumbnailsOfDeletedFilesArePruned(): void {
        if (!extension_loaded('sqlite3')) {
            self::markTestSkipped('sources are recorded in SQLite');
        }
        $thumbs = $this->warmTwoImages();
        unlink($this->root('sub/b.jpg'));
        self::assertSame(1, $this->imageWarmer()->warm());
        self::assertFileExists($thumbs['a.jpg']);
        self::assertFileDoesNotExist($thumbs['sub/b.jpg']);
        self::assertSame(0, $this->imageWarmer()->warm(), 'a pruned source is forgotten');
    }

    // An unmounted share looks like an empty folder: that proves nothing.
    public function testAnEmptiedShareKeepsTheThumbnails(): void {
        if (!extension_loaded('sqlite3')) {
            self::markTestSkipped('sources are recorded in SQLite');
        }
        $thumbs = $this->warmTwoImages();
        self::removeTree($this->root());
        mkdir($this->root());
        self::assertSame(0, $this->imageWarmer()->warm());
        self::assertFileExists($thumbs['a.jpg']);
        self::assertFileExists($thumbs['sub/b.jpg']);
    }

    private function launchContext(array $cache = ['warmAtStartup' => true, 'warmInterval' => 3600]): Context {
        return $this->context(['cache' => $cache]);
    }

    // Records launches; each checks that the worker could take the lock.
    private function launcher(bool $accepted = true): object {
        $lock = $this->tmp . '/cache/warmer.lock';
        return new class($lock, $accepted) {
            public array $scripts = [];
            public array $lockFree = [];

            public function __construct(private string $lock, private bool $accepted) {}

            public function __invoke(string $script): bool {
                $this->scripts[] = $script;
                $handle = fopen($this->lock, 'c+');
                $this->lockFree[] = flock($handle, LOCK_EX | LOCK_NB);
                fclose($handle);
                return $this->accepted;
            }
        };
    }

    private function marker(string $name, ?int $age): void {
        $path = $this->tmp . '/cache/warmer.' . $name;
        $age === null ? @unlink($path) : file_put_contents($path, (string) (time() - $age));
    }

    public function testNothingIsLaunchedUnlessEnabled(): void {
        $launch = $this->launcher();
        self::assertFalse(CacheWarmer::launch_if_due($this->launchContext(['warmAtStartup' => false]), $launch));
        self::assertSame([], $launch->scripts);
    }

    public function testADueWarmerIsLaunchedWithTheLockReleased(): void {
        $launch = $this->launcher();
        self::assertTrue(CacheWarmer::launch_if_due($this->launchContext(), $launch));
        self::assertSame([$this->tmp . '/private/php/warm-cache.php'], $launch->scripts);
        self::assertSame([true], $launch->lockFree, 'the worker must be able to take the lock it is launched for');
        self::assertFileExists($this->tmp . '/cache/warmer.laststart');
        self::assertFalse(CacheWarmer::launch_if_due($this->launchContext(), $launch), 'a second request must not launch another worker');
        self::assertCount(1, $launch->scripts);
    }

    public function testRecentActivityPostponesTheNextRun(): void {
        $launch = $this->launcher();
        $this->marker('lastrun', 60);
        self::assertFalse(CacheWarmer::launch_if_due($this->launchContext(), $launch), 'a recent run');
        $this->marker('lastrun', 7200);
        $this->marker('laststart', 60);
        self::assertFalse(CacheWarmer::launch_if_due($this->launchContext(), $launch), 'a start in progress');
        $this->marker('laststart', CacheWarmer::START_TIMEOUT + 1);
        self::assertTrue(CacheWarmer::launch_if_due($this->launchContext(), $launch), 'a start that never finished');
    }

    public function testARunningWorkerBlocksNewLaunches(): void {
        $launch = $this->launcher();
        $held = fopen($this->tmp . '/cache/warmer.lock', 'c+');
        flock($held, LOCK_EX);
        try {
            self::assertFalse(CacheWarmer::launch_if_due($this->launchContext(), $launch));
        } finally {
            fclose($held);
        }
        self::assertSame([], $launch->scripts);
    }

    public function testARefusedLaunchClearsItsStartMarker(): void {
        self::assertFalse(CacheWarmer::launch_if_due($this->launchContext(), $this->launcher(false)));
        self::assertFileDoesNotExist($this->tmp . '/cache/warmer.laststart');
    }

    public function testAnUnwritableCacheFolderLaunchesNothing(): void {
        $launch = $this->launcher();
        $context = $this->context(['cache' => ['warmAtStartup' => true]], ['CACHE_PRV_PATH' => $this->tmp . '/missing']);
        self::assertFalse(CacheWarmer::launch_if_due($context, $launch));
        self::assertSame([], $launch->scripts);
    }

    // Names used by older releases keep working in existing options.json files.
    public function testLegacySnakeCaseCacheOptionsStillApply(): void {
        $launch = $this->launcher();
        $this->marker('lastrun', 120);
        $legacy = ['warm_at_startup' => true, 'warm_interval' => 60];
        self::assertTrue(CacheWarmer::launch_if_due($this->launchContext($legacy), $launch), 'the legacy interval must apply');
        self::assertFalse(CacheWarmer::launch_if_due($this->launchContext(['warm_at_startup' => false]), $this->launcher()));
    }

    public function testUnmanagedFoldersAreNotWalked(): void {
        $this->write($this->root('kept/a.txt'), 'x');
        $this->write($this->root('skipped/.nomedia'), '');
        $this->write($this->root('skipped/b.txt'), 'x');
        $status = new TaskStatus($this->tmp . '/cache', TaskStatus::WARMER);
        (new CacheWarmer($this->context(['view' => ['hidden' => [], 'unmanaged' => ['.nomedia']]])))->warm($status);
        $status->finish();
        $last = json_decode((string) file_get_contents($this->tmp . '/cache/task-warmer.last.json'), true);
        self::assertSame(1, $last['files']['done'], 'only kept/a.txt is walked');
    }
}
