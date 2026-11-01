<?php

declare(strict_types=1);

// Listings, fallback pages and search answer from cached folder sizes and
// hand cold ones to the background worker, without running du themselves.
final class ListingTest extends H5aiTestCase {
    protected function setUp(): void {
        parent::setUp();
        $this->write($this->root('inside.txt'), 'inside');
        $this->write($this->root('match-0.txt'), 'x');
        $this->write($this->root('match-dir/file.txt'), 'content');
        $this->fakeTools(['du' => 'exit 1']);
        self::resetFolderSizes($this->tmp . '/foldersizes.json');
    }

    private function coldContext(): ListingTestContext {
        return $this->context(
            ['foldersize' => ['enabled' => true, 'type' => 'shell-du'], 'search' => ['enabled' => true]],
            ['HAS_CMD_DU' => true],
            class: ListingTestContext::class,
        );
    }

    public function testListingsKeepRegularFileSizes(): void {
        $context = $this->context(['foldersize' => ['enabled' => false]]);
        foreach ([1, 2] as $attempt) {
            $listing = array_column($context->get_items('/', 1), null, 'href');
            self::assertSame(6, $listing['/inside.txt']['size'], "attempt {$attempt}: regular file sizes must be listed");
            self::assertSame(1, $listing['/match-0.txt']['size'], "attempt {$attempt}: distinct sizes must be kept for sorting");
        }
    }

    public function testListingDepths(): void {
        $this->write($this->root('a/b/deep.txt'), 'd');
        $this->write($this->root('a/inner.txt'), 'i');
        $context = $this->context(['foldersize' => ['enabled' => false]]);
        $hrefs = static fn(int $what): array => array_column($context->get_items('/a/', $what), 'href');

        $folder = $hrefs(Context::LIST_FOLDER);
        self::assertContains('/a/inner.txt', $folder);
        self::assertNotContains('/inside.txt', $folder, 'a folder listing must not include its parent');
        self::assertNotContains('/a/b/deep.txt', $folder, 'a folder listing must not include its subfolders');

        $withAncestors = $hrefs(Context::LIST_WITH_ANCESTORS);
        self::assertContains('/inside.txt', $withAncestors, 'ancestor listings must include the parent content');
        self::assertNotContains('/a/b/deep.txt', $withAncestors);

        self::assertContains('/a/b/deep.txt', $hrefs(Context::LIST_WITH_SUBFOLDERS));
        self::assertSame([], $context->get_items('/../', Context::LIST_FOLDER), 'an unmanaged href must list nothing');
    }

    public function testColdApiListingsQueueFolderRefreshes(): void {
        $context = $this->coldContext();
        $listing = array_column($context->get_items('/', 1), null, 'href');
        self::assertSame(6, $listing['/inside.txt']['size'], 'cold folder caches must not hide regular file sizes');
        self::assertNull($listing['/']['size'], 'cold folder sizes must remain unknown until refreshed');
        self::assertContains($this->root(), $context->refreshPaths);
        self::assertSame('', $this->toolLog('du'), 'API listings must not execute du');
        self::assertSame([], Filesize::end_async_mode(), 'refresh queues must be drained after the listing');
    }

    public function testColdFallbackListingsQueueFolderRefreshes(): void {
        $context = $this->coldContext();
        $html = (new Fallback($context))->get_html($this->root());
        self::assertStringContainsString('inside.txt', $html);
        self::assertContains($this->root(), $context->refreshPaths);
        self::assertSame('', $this->toolLog('du'), 'initial HTML must not execute du');
    }

    public function testSearchAnswersFromCachedFolderSizes(): void {
        $context = $this->coldContext();
        $found = array_column((new Search($context))->get_items('/', 'match', false), null, 'href');
        self::assertArrayHasKey('/match-dir/', $found);
        self::assertNull($found['/match-dir/']['size'], 'search must not compute a cold folder size inline');
        self::assertSame('', $this->toolLog('du'), 'search must not run du while answering');
        self::assertContains($this->root('match-dir'), $context->refreshPaths);
    }

    // Rewriting a file leaves its folder mtime alone: an expired entry must
    // be recomputed even when the folder still matches, in both directions.
    public function testExpiredEntriesDetectRewrittenFiles(): void {
        $dir = $this->root('size-cache');
        $file = $this->write($dir . '/existing.txt', 'small');
        $dirMtime = filemtime($dir);
        $expired = static fn(int $size): array => [
            $dir => ['size' => $size, 'mtime' => $dirMtime, 'cached_at' => time() - Filesize::CACHE_TTL - 1, 'children' => []],
        ];
        $entries = new ReflectionProperty(Filesize::class, 'persistent_cache');
        $requestCache = new ReflectionProperty(Filesize::class, 'cache');

        $entries->setValue(null, $expired(5));
        Filesize::begin_async_mode();
        self::assertSame(5, Filesize::get_cached_size($file, true, false, Filesize::DEFAULT_TIMEOUT, false), 'listings must keep regular file sizes while folder sizes refresh');
        self::assertNull(Filesize::get_cached_size($dir, true, false, Filesize::DEFAULT_TIMEOUT, true), 'listings must leave an expired folder size unknown');
        self::assertSame([$dir], Filesize::end_async_mode(), 'expired listing sizes must be queued for refresh');

        foreach (['a much larger existing file', 'x'] as $content) {
            $requestCache->setValue(null, []);
            $entries->setValue(null, $expired((int) filesize($file)));
            file_put_contents($file, $content);
            clearstatcache(true, $dir);
            self::assertSame($dirMtime, filemtime($dir), 'rewriting a file must not change the folder mtime');
            self::assertSame(filesize($dir) + filesize($file), Filesize::get_cached_size($dir, true, false), 'an expired entry must be recomputed');
        }
    }

    public function testTheCurrentPathIsTheRequestedFolder(): void {
        mkdir($this->root('sub'));
        foreach (['/sub/' => $this->root('sub'), '/sub/inside.txt' => $this->root('sub'), '/' => $this->root()] as $href => $expected) {
            self::assertSame($expected, $this->context(setup: ['REQUEST_HREF' => $href])->get_current_path(), $href);
        }
    }

    // A folder with a _thumb image shows it in listings once generated.
    public function testFolderListingsCarryTheirCustomThumbnail(): void {
        $this->write($this->root('album/_thumb/cover.png'), 'png');
        $thumb = $this->seedThumbnail($this->root('album/_thumb/cover.png'), '320x240');
        $context = $this->context(['foldersize' => ['enabled' => false], 'thumbnails' => ['enabled' => true]], ['HAS_PHP_WEBP' => true]);
        $album = array_column($context->get_items('/', Context::LIST_FOLDER), null, 'href')['/album/'];
        self::assertSame('/_h5ai/public/cache/thumbs/' . $thumb, $album['thumbSquare'] ?? null);
    }
}
