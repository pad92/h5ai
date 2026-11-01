<?php

declare(strict_types=1);

// The figures of the info page: read from the caches without creating any
// file, and without a single path of the share.
final class MetricsTest extends H5aiTestCase {
    private function cache(string $file = ''): string {
        return $this->tmp . '/cache' . ($file === '' ? '' : '/' . $file);
    }

    private function collect(array $options = []): array {
        return new Metrics($this->context($options))->collect();
    }

    public function testEmptyCachesGiveZerosAndUnknownsAndStayEmpty(): void {
        $metrics = $this->collect();

        self::assertSame(['files' => 0, 'sources' => 0, 'bytes' => 0, 'coverage' => null], $metrics['cache']['thumbnails']);
        self::assertSame(['bytes' => null, 'sources' => null], $metrics['cache']['thumbnailDb']);
        self::assertSame(['entries' => 0, 'fresh' => 0, 'bytes' => 0, 'ttl' => Filesize::CACHE_TTL, 'newest' => null], $metrics['cache']['folderSizes']);
        self::assertSame(['running' => null, 'last' => null], $metrics['tasks']['refresh']);
        self::assertSame(['enabled' => false, 'interval' => 86400, 'lastRun' => null, 'nextRun' => null], $metrics['tasks']['warmer']['schedule']);
        self::assertSame(['.', '..'], scandir($this->cache()), 'reading metrics must not create cache files');
        self::assertDirectoryDoesNotExist($this->tmp . '/cache-pub');
    }

    public function testThumbnailsAreCountedPerFileAndPerSourceWithTheLastCoverage(): void {
        $this->write($this->root('a.jpg'), 'x');
        $this->write($this->root('b.jpg'), 'x');
        $this->seedThumbnail($this->root('a.jpg'), '266x200');
        $this->seedThumbnail($this->root('a.jpg'), '512x384');
        $this->seedThumbnail($this->root('b.jpg'), '266x200');
        $this->write($this->tmp . '/cache-pub/thumbs/notes.txt', 'not a thumbnail');
        $coverage = ['at' => 1_000, 'categories' => ['img' => ['files' => 5, 'thumbnails' => 2]]];
        $this->write($this->cache(CacheWarmer::COVERAGE_FILE), json_encode($coverage));

        $thumbnails = $this->collect()['cache']['thumbnails'];

        self::assertSame(3, $thumbnails['files']);
        self::assertSame(2, $thumbnails['sources'], 'two sizes of a.jpg are one source');
        self::assertSame(12, $thumbnails['bytes'], 'three files of "webp"');
        self::assertSame($coverage, $thumbnails['coverage']);
    }

    public function testFolderSizeEntriesAreSplitIntoFreshAndExpired(): void {
        $now = time();
        $entry = static fn(int $age): array => ['size' => 1, 'mtime' => 1, 'cached_at' => $now - $age, 'children' => []];
        $json = json_encode(['/fresh' => $entry(10), '/expired' => $entry(Filesize::CACHE_TTL + 60), '/broken' => 'x']);
        $this->write($this->cache('foldersizes.json'), $json);

        self::assertSame(
            ['entries' => 3, 'fresh' => 1, 'bytes' => strlen($json), 'ttl' => Filesize::CACHE_TTL, 'newest' => $now - 10],
            $this->collect()['cache']['folderSizes'],
        );
    }

    public function testTheWarmerScheduleAndLastRunsAreReported(): void {
        $this->write($this->cache('warmer.lastrun'), '5000');
        $this->write($this->cache('task-warmer.last.json'), json_encode([
            'files' => ['done' => 120, 'seconds' => 30], 'sizes' => ['done' => 0, 'seconds' => 12], 'bogus' => ['done' => 9],
        ]));
        touch($this->cache('task-warmer.last.json'), 5000);

        $metrics = $this->collect(['cache' => ['warmAtStartup' => true, 'warmInterval' => 3600]]);

        self::assertSame(['enabled' => true, 'interval' => 3600, 'lastRun' => 5000, 'nextRun' => 8600], $metrics['tasks']['warmer']['schedule']);
        self::assertSame([
            'finished' => 5000,
            'seconds' => 42,
            'phases' => ['files' => ['done' => 120, 'seconds' => 30], 'sizes' => ['done' => 0, 'seconds' => 12]],
        ], $metrics['tasks']['warmer']['last'], 'unknown phases are dropped');
        self::assertNull($metrics['tasks']['warmer']['running'], 'no worker holds the lock');
    }

    public function testTheThumbnailDatabaseIsCountedReadOnly(): void {
        if (!extension_loaded('sqlite3')) {
            self::markTestSkipped('needs SQLite3');
        }
        $setup = new TestSetup($this->setupValues());
        $db = new CacheDB($setup);
        $db->record_source(sha1('/a'), '/a');
        $db->record_source(sha1('/b'), '/b');
        unset($db);

        $stats = $this->collect()['cache']['thumbnailDb'];
        self::assertSame(2, $stats['sources']);
        self::assertGreaterThan(0, $stats['bytes']);
    }

    public function testNoPathOfTheShareOrServerIsExposed(): void {
        $this->write($this->root('secret-folder/a.jpg'), 'x');
        $this->seedThumbnail($this->root('secret-folder/a.jpg'), '266x200');
        $this->write($this->cache('foldersizes.json'), json_encode([
            $this->root('secret-folder') => ['size' => 1, 'mtime' => 1, 'cached_at' => time(), 'children' => []],
        ]));

        $json = json_encode($this->collect());
        self::assertStringNotContainsString('secret-folder', $json);
        self::assertStringNotContainsString($this->tmp, str_replace('\/', '/', $json));
    }
}
