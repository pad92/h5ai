<?php

declare(strict_types=1);

// Purging a cache from the info page removes all of it, files and database
// rows together, so no inconsistency between them survives; nothing outside
// the cache is touched, and nothing is purged while a background task runs.
final class CachePurgeTest extends H5aiTestCase {
    private function cache(string $file = ''): string {
        return $this->tmp . '/cache' . ($file === '' ? '' : '/' . $file);
    }

    private function thumbs(string $file = ''): string {
        return $this->tmp . '/cache-pub/thumbs' . ($file === '' ? '' : '/' . $file);
    }

    private function purge(): CachePurge {
        return new CachePurge($this->context());
    }

    public function testThumbnailsGoWithEveryFileOfTheirFolderAndTheirCoverage(): void {
        $this->write($this->root('a.jpg'), 'x');
        $this->seedThumbnail($this->root('a.jpg'), '266x200');
        $this->seedThumbnail($this->root('a.jpg'), '512x384');
        // Not named like a thumbnail: an interrupted write or an older release.
        $this->write($this->thumbs('stray.tmp'), 'partial');
        mkdir($this->thumbs('unexpected'));
        $this->write($this->cache(CacheWarmer::COVERAGE_FILE), '{"at":1,"categories":{}}');
        $kept = [
            $this->write($this->tmp . '/cache-pub/README.md', 'keep'),
            $this->write($this->cache('cmds.json'), '{}'),
            $this->write($this->cache('login-failures.json'), '{}'),
            $this->write($this->cache('foldersizes.json'), '{}'),
        ];

        $removed = $this->purge()->purge(CachePurge::THUMBNAILS);

        self::assertSame(3, $removed['files']);
        self::assertSame(['.', '..', 'unexpected'], scandir($this->thumbs()), 'folders are left alone');
        self::assertNull(CacheWarmer::last_coverage($this->cache()), 'the coverage described the deleted thumbnails');
        foreach ($kept as $file) {
            self::assertFileExists($file);
        }
        self::assertSame(0, $this->purge()->purge(CachePurge::THUMBNAILS)['files'], 'purging an empty cache is harmless');
    }

    public function testASymlinkInTheThumbnailFolderIsRemovedNotFollowed(): void {
        $target = $this->write($this->root('precious.webp'), 'precious');
        mkdir($this->thumbs(), 0700, true);
        symlink($target, $this->thumbs('thumb-' . sha1('x') . '-1x1.webp'));

        self::assertSame(1, $this->purge()->purge(CachePurge::THUMBNAILS)['files']);
        self::assertSame('precious', file_get_contents($target));
        self::assertSame(['.', '..'], scandir($this->thumbs()));
    }

    public function testTheThumbnailDatabaseIsEmptiedWithTheThumbnailsAndStillWorks(): void {
        if (!extension_loaded('sqlite3')) {
            self::markTestSkipped('needs SQLite3');
        }
        $db = new CacheDB(new TestSetup($this->setupValues()));
        $db->record_source(sha1('/a'), '/a');
        $db->record_source(sha1('/b'), '/b');
        unset($db);

        self::assertSame(['files' => 0, 'sources' => 2], $this->purge()->purge(CachePurge::THUMBNAILS));

        self::assertSame(0, CacheDB::stats($this->cache('thumbs_cache.db'))['sources']);
        self::assertSame(0, (int) @filesize($this->cache('thumbs_cache.db-wal')), 'no row survives in the WAL');
        $db = new CacheDB(new TestSetup($this->setupValues()));
        $db->record_source(sha1('/c'), '/c');
        self::assertSame(['/c'], array_values($db->sources()), 'the emptied database still works');
    }

    public function testWithoutSqliteTheDatabaseFilesAreDeleted(): void {
        if (extension_loaded('sqlite3')) {
            self::markTestSkipped('only without SQLite3');
        }
        foreach (['', '-wal', '-shm'] as $suffix) {
            $this->write($this->cache('thumbs_cache.db' . $suffix), 'x');
        }
        $this->purge()->purge(CachePurge::THUMBNAILS);
        self::assertSame([], glob($this->cache('thumbs_cache.db*')));
    }

    public function testFolderSizesGoWithTheTemporaryFilesOfInterruptedSaves(): void {
        $entry = ['size' => 1, 'mtime' => 1, 'cached_at' => time(), 'children' => []];
        $this->write($this->cache('foldersizes.json'), json_encode(['/a' => $entry, '/b' => $entry]));
        $this->write($this->cache('foldersizes.Ab3dE9'), '{"partial');
        $lock = $this->write($this->cache('foldersizes.json.lock'), '');
        $kept = $this->write($this->cache('foldersizes.backup.json'), '{}');

        self::assertSame(['entries' => 2], $this->purge()->purge(CachePurge::FOLDER_SIZES));

        self::assertFileDoesNotExist($this->cache('foldersizes.json'));
        self::assertFileDoesNotExist($this->cache('foldersizes.Ab3dE9'));
        self::assertFileExists($lock, 'other requests may hold the lock');
        self::assertFileExists($kept, 'only tempnam() names are leftovers');
        self::assertSame(0, Filesize::cache_stats($this->cache('foldersizes.json'))['entries']);
        self::assertSame(['entries' => 0], $this->purge()->purge(CachePurge::FOLDER_SIZES));
    }

    public function testARunningTaskBlocksEveryPurge(): void {
        self::assertNull($this->purge()->blocking_task());
        $lock = fopen($this->cache('refresh.lock'), 'c+');
        flock($lock, LOCK_EX);
        $this->write($this->cache('task-refresh.json'), json_encode(['phase' => 'sizes', 'done' => 0, 'total' => null, 'started' => time(), 'phaseStarted' => time()]));

        self::assertSame('refresh', $this->purge()->blocking_task());
        fclose($lock);
        self::assertNull($this->purge()->blocking_task(), 'a worker that died does not block');
    }

    public function testAnUnknownCacheIsRejected(): void {
        $this->expectException(InvalidArgumentException::class);
        $this->purge()->purge('../conf');
    }
}
