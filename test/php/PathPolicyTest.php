<?php

declare(strict_types=1);

// The served-root boundary shared by listings, custom files, search and
// downloads: symlinks escaping the share or pointing into h5ai internals.
final class PathPolicyTest extends H5aiTestCase {
    private Context $context;

    protected function setUp(): void {
        parent::setUp();
        $this->write($this->tmp . '/outside.txt', 'secret');
        $this->write($this->root('_h5ai/public/internal.txt'), 'public internal');
        $this->write($this->root('_h5ai/private/internal.txt'), 'private internal');
        $this->write($this->root('inside.txt'), 'inside');
        for ($i = 0; $i < 5; $i++) {
            $this->write($this->root("match-{$i}.txt"), 'x');
        }
        symlink($this->tmp . '/outside.txt', $this->root('outside-link.txt'));
        $this->context = $this->context(
            ['custom' => ['enabled' => true], 'search' => ['maxResults' => 2, 'maxDepth' => 4]],
            ['PUBLIC_PATH' => $this->root('_h5ai/public'), 'PRIVATE_PATH' => $this->root('_h5ai/private')],
        );
    }

    public function testFilesInsideTheRootAreManaged(): void {
        self::assertTrue($this->context->paths()->is_managed_file($this->root('inside.txt')), 'regular files inside root must be managed');
    }

    public function testFileSymlinksEscapingTheRootAreRejected(): void {
        self::assertFalse($this->context->paths()->is_managed_file($this->root('outside-link.txt')), 'file symlinks escaping root must be rejected');
    }

    public function testCustomFilesSkipSymlinksOutsideOrIntoInternals(): void {
        symlink($this->tmp . '/outside.txt', $this->root('_h5ai.header.html'));
        symlink($this->root('_h5ai/public/internal.txt'), $this->root('_h5ai.headers.html'));
        symlink($this->root('_h5ai/private/internal.txt'), $this->root('_h5ai.footer.html'));
        $this->write($this->root('_h5ai.header.md'), '# Allowed header');
        $this->write($this->root('_h5ai.footer.md'), 'Allowed footer');

        $custom = (new Custom($this->context))->get_customizations('/');
        self::assertSame(['content' => '# Allowed header', 'type' => 'md'], $custom['header'], 'custom headers must skip outside symlinks and preserve hidden Markdown files');
        self::assertSame(['content' => 'Allowed footer', 'type' => 'md'], $custom['footer'], 'custom footers must skip h5ai internal symlinks and preserve Markdown files');
    }

    public function testOrdinaryHtmlCustomFilesRemainSupported(): void {
        $this->write($this->root('_h5ai.header.html'), '<header>Allowed HTML</header>');
        $this->write($this->root('_h5ai.footer.html'), '<footer>Allowed HTML</footer>');

        $custom = (new Custom($this->context))->get_customizations('/');
        self::assertSame(['content' => '<header>Allowed HTML</header>', 'type' => 'html'], $custom['header']);
        self::assertSame(['content' => '<footer>Allowed HTML</footer>', 'type' => 'html'], $custom['footer']);
    }

    public function testSearchEnforcesItsResultLimit(): void {
        $visited = [];
        self::assertCount(2, (new Search($this->context))->get_paths($this->root(), 'match', false, $visited));
    }

    public function testSearchRejectsFileSymlinksEscapingTheRoot(): void {
        $visited = [];
        self::assertSame([], (new Search($this->context))->get_paths($this->root(), 'outside-link', false, $visited));
    }

    public function testArchivesRejectFileSymlinksEscapingTheRoot(): void {
        $archive = new Archive($this->context);
        (new ReflectionMethod($archive, 'add_file'))->invoke($archive, $this->root('outside-link.txt'), 'outside-link.txt');
        self::assertSame([], (new ReflectionProperty($archive, 'files'))->getValue($archive));
    }

    public function testAnInvalidSelectionDoesNotArchiveTheWholeFolder(): void {
        $archive = new Archive($this->context);
        self::assertFalse($archive->prepare('php-tar', '/', ['/outside-link.txt']));
        self::assertSame([], (new ReflectionProperty($archive, 'dirs'))->getValue($archive));
        self::assertFalse($archive->prepare('unsupported', '/', ['/inside.txt']), 'an unknown archive type must be refused before streaming');
    }

    public function testWholeFolderArchivesEnforceTheEntryLimit(): void {
        $context = $this->context(
            ['download' => ['maxEntries' => 2, 'maxBytes' => 1024]],
            ['PUBLIC_PATH' => $this->root('_h5ai/public'), 'PRIVATE_PATH' => $this->root('_h5ai/private')],
        );
        $archive = new Archive($context);
        (new ReflectionMethod($archive, 'add_dir'))->invoke($archive, $this->root(), '.');
        self::assertTrue((new ReflectionProperty($archive, 'limit_exceeded'))->getValue($archive));
    }

    // A sibling whose name starts like the root is outside it.
    public function testItemsOutsideTheRootAreRefused(): void {
        $this->write($this->tmp . '/root2/file.txt', 'x');
        $cache = [];
        self::assertNull(Item::get($this->context, $this->tmp . '/root2/file.txt', $cache));
        self::assertNotNull(Item::get($this->context, $this->root('inside.txt'), $cache));
        self::assertNotNull(Item::get($this->context, $this->root(), $cache));
    }

    public function testSearchRespectsItsDepthAndRejectsBadPatterns(): void {
        $this->write($this->root('d1/d2/match-deep.txt'), 'x');
        $context = $this->context(
            ['search' => ['maxResults' => 100, 'maxDepth' => 1, 'maxPatternLength' => 8]],
            ['PUBLIC_PATH' => $this->root('_h5ai/public'), 'PRIVATE_PATH' => $this->root('_h5ai/private')],
        );
        $search = new Search($context);
        $found = $search->get_paths($this->root(), 'match');
        self::assertCount(5, $found, 'files two levels down must stay out of reach');
        self::assertNotContains($this->root('d1/d2/match-deep.txt'), $found);
        self::assertSame([], $search->get_paths($this->root(), '(unclosed'), 'an invalid pattern finds nothing');
        self::assertSame([], $search->get_paths($this->root(), 'way-too-long'), 'an oversized pattern finds nothing');
        self::assertSame([], $search->get_paths($this->root(), ''), 'an empty pattern finds nothing');
    }

    public function testOnlyExistingFilesAndFoldersInsideTheRootAreManaged(): void {
        self::assertFalse($this->context->paths()->is_managed_file($this->root()), 'a folder is not a managed file');
        self::assertFalse($this->context->paths()->is_managed_path($this->root('missing')));
        self::assertFalse($this->context->paths()->is_managed_path($this->tmp), 'a folder outside the root');
    }

    public function testUnmanagedMarkersAndNestedInstallsLeaveFoldersUnmanaged(): void {
        $this->write($this->root('skipped/.nomedia'), '');
        mkdir($this->root('nested/_h5ai/private/conf'), 0700, true);
        mkdir($this->root('nested/sub'));
        $paths = $this->context(['view' => ['hidden' => [], 'unmanaged' => ['.nomedia']]])->paths();
        self::assertFalse($paths->is_managed_path($this->root('skipped')));
        self::assertFalse($paths->is_managed_path($this->root('nested/sub')), 'a folder below another h5ai installation');
        self::assertTrue($paths->is_managed_path($this->root()), 'the root itself stays managed');
    }

    // Paths are compared as written: one reaching the root through another
    // name never meets ROOT_PATH on its way up, and is refused.
    public function testAPathSpellingTheRootDifferentlyIsRefused(): void {
        symlink($this->root(), $this->tmp . '/root-link');
        mkdir($this->root('sub'));
        self::assertFalse($this->context->paths()->is_managed_path($this->tmp . '/root-link/sub'));
    }

    public function testUnreadableEntriesAreListedUnlessHiddenOn403(): void {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            self::markTestSkipped('root reads every file');
        }
        $this->write($this->root('locked.txt'), 'x');
        chmod($this->root('locked.txt'), 0);
        try {
            self::assertContains('locked.txt', $this->context->paths()->read_dir($this->root()));
            $hiding = $this->context(['view' => ['hidden' => [], 'unmanaged' => [], 'hideIf403' => true]])->paths();
            self::assertNotContains('locked.txt', $hiding->read_dir($this->root()));
        } finally {
            chmod($this->root('locked.txt'), 0600);
        }
    }
}
