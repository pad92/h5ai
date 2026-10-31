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
        self::assertTrue($this->context->is_managed_file($this->root('inside.txt')), 'regular files inside root must be managed');
    }

    public function testFileSymlinksEscapingTheRootAreRejected(): void {
        self::assertFalse($this->context->is_managed_file($this->root('outside-link.txt')), 'file symlinks escaping root must be rejected');
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
        $archive->output('unsupported', '/', ['/outside-link.txt']);
        self::assertSame([], (new ReflectionProperty($archive, 'dirs'))->getValue($archive));
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
}
