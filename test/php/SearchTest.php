<?php

declare(strict_types=1);

final class SearchTest extends H5aiTestCase {
    private const INDEX = '/cache/search-index.txt';
    private const TREE = '/cache/search-index.tree.json';

    private function searchContext(array $options = [], array $setup = []): SearchTestContext {
        return $this->context($options, $setup, [], SearchTestContext::class);
    }

    // Waits for a new second, then past the kernel's coarse timestamp tick,
    // so that files written next carry the current second.
    private static function startOfASecond(): int {
        $start = time();
        while (time() === $start) {
            usleep(1000);
        }
        usleep(100000);
        return time();
    }

    // Replaces the index header fields given in $fields.
    private function rewriteHeader(array $fields): void {
        $lines = explode("\n", (string) file_get_contents($this->tmp . self::INDEX), 2);
        $lines[0] = (string) json_encode($fields + json_decode($lines[0], true));
        file_put_contents($this->tmp . self::INDEX, implode("\n", $lines));
    }

    public function testInvalidPatternsDoNotThrow(): void {
        $this->write($this->root('file.txt'), 'x');
        self::assertSame([], (new Search($this->searchContext()))->get_paths($this->root(), '(unclosed'));
    }

    public function testWithoutAnIndexTheWalkAnswersAndARefreshIsRequested(): void {
        $file = $this->write($this->root('sub/found.txt'), 'x');
        $context = $this->searchContext();

        self::assertSame([$file], (new Search($context))->get_paths($this->root(), 'found'));
        self::assertSame(1, $context->indexRefreshes);
        self::assertFileDoesNotExist($this->tmp . self::INDEX, 'a search never builds the index itself');
    }

    // The index must give the walk's results, in the walk's order: hidden
    // names, unmanaged folders, symlinked folders listed but not followed,
    // and the result limit.
    public function testTheIndexAnswersLikeTheWalk(): void {
        $this->write($this->root('match-a.txt'), 'x');
        $this->write($this->root('sub/match-b.txt'), 'x');
        $this->write($this->root('sub/deep/match-c.txt'), 'x');
        $this->write($this->root('sub/.match-hidden.txt'), 'x');
        $this->write($this->root('unmanaged/index.html'), 'x');
        $this->write($this->root('unmanaged/match-inside.txt'), 'x');
        mkdir($this->root('match-dir'));
        symlink($this->root('sub'), $this->root('match-link'));
        $options = ['view' => ['hidden' => ['^\\.'], 'unmanaged' => ['index.html']]];

        $results = [];
        foreach ([1000, 3] as $max_results) {
            $context = $this->searchContext($options + ['search' => ['maxResults' => $max_results]]);
            @unlink($this->tmp . self::INDEX);
            $walked = (new Search($context))->get_paths($this->root(), 'match');
            self::assertTrue((new Search($context))->refresh_index());
            $results[$max_results] = (new Search($context))->get_paths($this->root(), 'match');

            self::assertSame($walked, $results[$max_results], "maxResults {$max_results}");
        }
        $all = $results[1000];
        sort($all);
        self::assertSame(
            [$this->root('match-a.txt'), $this->root('match-dir'), $this->root('match-link'), $this->root('sub/deep/match-c.txt'), $this->root('sub/match-b.txt')],
            $all,
        );
        self::assertCount(3, $results[3]);
    }

    public function testMaxDepthCountsFromTheSearchRoot(): void {
        $file = $this->write($this->root('a/b/c/f.txt'), 'x');
        $context = $this->searchContext(['search' => ['maxDepth' => 1]]);

        self::assertSame([$file], (new Search($context))->get_paths($this->root('a/b'), '^f'), 'walk');
        self::assertTrue((new Search($context))->refresh_index());
        self::assertSame([$file], (new Search($context))->get_paths($this->root('a/b'), '^f'), 'index');
        self::assertSame([], (new Search($context))->get_paths($this->root(), '^f'), 'three levels below the root');
    }

    public function testADeletedFileIsNotReturnedByAnUnchangedIndex(): void {
        $file = $this->write($this->root('sub/gone.txt'), 'x');
        $context = $this->searchContext();
        self::assertTrue((new Search($context))->refresh_index());
        $index = file_get_contents($this->tmp . self::INDEX);

        unlink($file);

        self::assertSame([], (new Search($context))->get_paths($this->root(), 'gone'));
        self::assertSame($index, file_get_contents($this->tmp . self::INDEX), 'the search reads the index without rewriting it');
        self::assertSame(0, $context->indexRefreshes, 'a fresh index needs no refresh');
    }

    public function testANewFileShowsAfterTheNextRefresh(): void {
        $this->write($this->root('sub/old.txt'), 'x');
        $context = $this->searchContext();
        self::assertTrue((new Search($context))->refresh_index());

        $new = $this->write($this->root('sub/new.txt'), 'x');
        self::assertSame([], (new Search($context))->get_paths($this->root(), 'new'), 'a fresh index answers until the next refresh');

        self::assertTrue((new Search($context))->refresh_index());
        self::assertSame([$new], (new Search($context))->get_paths($this->root(), 'new'));
    }

    // A change in the second the previous refresh read the folder leaves its
    // mtime and ctime as they were: the folder must be listed again anyway.
    public function testAChangeInTheSecondOfTheRefreshIsSeen(): void {
        $context = $this->searchContext();
        $second = self::startOfASecond();
        $this->write($this->root('first.txt'), 'x');
        self::assertTrue((new Search($context))->refresh_index());
        $new = $this->write($this->root('second.txt'), 'x');
        if (time() !== $second) {
            self::markTestSkipped('the second ended before the change');
        }

        self::assertTrue((new Search($context))->refresh_index());
        self::assertSame([$new], (new Search($context))->get_paths($this->root(), 'second'));
    }

    // The refresh trusts the entries of a folder whose state did not change
    // since an older refresh, and lists a changed folder again. The tree is
    // written by hand so that the trusted entries are recognisable.
    public function testOnlyChangedFoldersAreListedAgain(): void {
        $this->write($this->root('same/real.txt'), 'x');
        $this->write($this->root('changed/real.txt'), 'x');
        $context = $this->searchContext();
        self::assertTrue((new Search($context))->refresh_index());
        $tree = json_decode((string) file_get_contents($this->tmp . self::TREE), true);
        $tree['built'] = time() + 10;
        $tree['dirs']['same']['e'][] = 'fghost-same.txt';
        $tree['dirs']['changed']['e'][] = 'fghost-changed.txt';
        $tree['dirs']['changed']['s']['mtime']--;
        file_put_contents($this->tmp . self::TREE, json_encode($tree));

        self::assertTrue((new Search($context))->refresh_index());

        $index = (string) file_get_contents($this->tmp . self::INDEX);
        self::assertStringContainsString("fsame/ghost-same.txt\n", $index, 'an unchanged folder is not listed again');
        self::assertStringNotContainsString('ghost-changed.txt', $index, 'a changed folder is listed again');
        self::assertSame([], (new Search($context))->get_paths($this->root(), 'ghost'), 'an indexed name that does not exist is never returned');
    }

    public function testAStaleIndexStillAnswersAndRequestsARefresh(): void {
        $file = $this->write($this->root('file.txt'), 'x');
        $fresh = $this->searchContext(['search' => ['indexTtl' => 300]]);
        self::assertTrue((new Search($fresh))->refresh_index());
        $this->write($this->root('later.txt'), 'x');

        self::assertSame([$file], (new Search($fresh))->get_paths($this->root(), '\.txt$'));
        self::assertSame(0, $fresh->indexRefreshes);

        $stale = $this->searchContext(['search' => ['indexTtl' => 0]]);
        self::assertSame([$file], (new Search($stale))->get_paths($this->root(), '\.txt$'), 'the stale index answers, not the walk');
        self::assertSame(1, $stale->indexRefreshes);
    }

    public function testAnIndexWrittenByAnotherUserIsIgnored(): void {
        if (!function_exists('posix_geteuid')) {
            self::markTestSkipped('needs the posix extension');
        }
        $context = $this->searchContext();
        self::assertTrue((new Search($context))->refresh_index());
        $new = $this->write($this->root('new.txt'), 'x');
        $this->rewriteHeader(['uid' => posix_geteuid() + 1]);

        self::assertSame([$new], (new Search($context))->get_paths($this->root(), 'new'), 'the walk answers');
        self::assertSame(1, $context->indexRefreshes);
    }

    public function testAnIndexForAnotherConfigurationIsIgnored(): void {
        $this->write($this->root('.dot.txt'), 'x');
        self::assertTrue((new Search($this->searchContext()))->refresh_index());

        $context = $this->searchContext(['view' => ['hidden' => ['^\\.'], 'unmanaged' => []]]);
        self::assertSame([], (new Search($context))->get_paths($this->root(), 'dot'));
        self::assertSame(1, $context->indexRefreshes);
    }

    public function testASymlinkedRootKeepsItsIndex(): void {
        mkdir($this->tmp . '/real');
        file_put_contents($this->tmp . '/real/file.txt', 'x');
        symlink($this->tmp . '/real', $this->tmp . '/link');
        $context = $this->searchContext([], ['ROOT_PATH' => $this->tmp . '/link']);

        self::assertTrue((new Search($context))->refresh_index());
        self::assertSame([$this->tmp . '/link/file.txt'], (new Search($context))->get_paths($this->tmp . '/link', 'file'));
        self::assertSame(0, $context->indexRefreshes);
        self::assertTrue((new Search($context))->refresh_index(), 'a second refresh succeeds too');
    }

    public function testNamesWithLineBreaksAndBackslashesAreFound(): void {
        $break = $this->write($this->root("sub/line\nbreak.txt"), 'x');
        $slash = $this->write($this->root('sub/back\\slash.txt'), 'x');
        $context = $this->searchContext();
        self::assertTrue((new Search($context))->refresh_index());

        self::assertSame([$break], (new Search($context))->get_paths($this->root(), 'line\nbreak'));
        self::assertSame([$slash], (new Search($context))->get_paths($this->root(), 'back\\\\slash'));
        self::assertSame([], (new Search($context))->get_paths($this->root(), '^break'), 'a line break never starts a new entry');
    }

    public function testARunningRefreshIsNotDoubled(): void {
        $lock = fopen($this->tmp . '/cache/search-index.lock', 'c+');
        flock($lock, LOCK_EX);
        try {
            self::assertFalse((new Search($this->searchContext()))->refresh_index());
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        self::assertFileDoesNotExist($this->tmp . self::INDEX);
    }

    public function testAnUnwritableCacheIsLogged(): void {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            self::markTestSkipped('root writes everywhere');
        }
        $this->write($this->root('file.txt'), 'x');
        $log = $this->tmp . '/error.log';
        $previous_log = ini_set('error_log', $log);
        // The lock of an earlier refresh stays usable in a read-only folder.
        touch($this->tmp . '/cache/search-index.lock');
        chmod($this->tmp . '/cache', 0500);
        try {
            self::assertFalse((new Search($this->searchContext()))->refresh_index());
        } finally {
            chmod($this->tmp . '/cache', 0700);
            ini_set('error_log', (string) $previous_log);
        }
        self::assertStringContainsString('search index: the private cache is not writable', (string) @file_get_contents($log));
        self::assertFileDoesNotExist($this->tmp . self::INDEX);
    }

    public function testHideIf403UsesCurrentFilePermissionsWithTheIndex(): void {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            self::markTestSkipped('root reads every file');
        }
        $file = $this->write($this->root('permission.txt'), 'x');
        chmod($file, 0600);
        $context = $this->searchContext(['view' => ['hidden' => [], 'unmanaged' => [], 'hideIf403' => true]]);
        self::assertTrue((new Search($context))->refresh_index());
        $search = new Search($context);

        self::assertSame([$file], $search->get_paths($this->root(), 'permission'));
        chmod($file, 0000);
        self::assertSame([], $search->get_paths($this->root(), 'permission'), 'an indexed name is hidden as soon as it becomes unreadable');
        chmod($file, 0600);
        self::assertSame([$file], $search->get_paths($this->root(), 'permission'), 'an indexed name returns when it becomes readable again');
        self::assertSame(0, $context->indexRefreshes);
    }

    public function testStatsAndPurgeUseTheHeaderAndRemoveEveryFile(): void {
        $this->write($this->root('sub/a.txt'), 'x');
        self::assertTrue((new Search($this->searchContext()))->refresh_index());
        touch($this->tmp . '/cache/search-index.txt.0123456789ab.tmp');
        $header = json_decode(explode("\n", (string) file_get_contents($this->tmp . self::INDEX))[0], true);

        self::assertSame(
            ['bytes' => filesize($this->tmp . self::INDEX) + filesize($this->tmp . self::TREE), 'entries' => 2, 'directories' => 2, 'updated' => $header['built']],
            Search::stats($this->tmp . '/cache'),
        );
        self::assertSame(['entries' => 2, 'directories' => 2], Search::purge($this->tmp . '/cache'));
        self::assertSame(['search-index.lock'], array_values(array_diff(scandir($this->tmp . '/cache'), ['.', '..'])));
    }
}
