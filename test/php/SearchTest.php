<?php

declare(strict_types=1);

final class SearchTest extends H5aiTestCase {
    public function testAnInvalidPatternFindsNothing(): void {
        $this->write($this->root('file.txt'), 'x');
        self::assertSame([], (new Search($this->context()))->get_paths($this->root(), '(unclosed'));
    }

    public function testTheSearchIndexIsWrittenAndInvalidatedWhenADirectoryChanges(): void {
        $this->write($this->root('first.txt'), 'x');
        $search = new Search($this->context());

        self::assertSame([$this->root('first.txt')], $search->get_paths($this->root(), 'first'));
        self::assertFileExists($this->tmp . '/cache/search-index.json');

        $this->write($this->root('second.txt'), 'x');
        touch($this->root(), time() + 2);

        self::assertSame(
            [$this->root('first.txt'), $this->root('second.txt')],
            $search->get_paths($this->root(), 'txt'),
        );
    }

    public function testHideIf403UsesCurrentFilePermissionsWithTheCachedIndex(): void {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            self::markTestSkipped('root reads every file');
        }
        $file = $this->write($this->root('permission.txt'), 'x');
        chmod($file, 0600);
        $context = $this->context(['view' => ['hidden' => [], 'unmanaged' => [], 'hideIf403' => true]]);
        $search = new Search($context);

        self::assertSame([$file], $search->get_paths($this->root(), 'permission'));
        chmod($file, 0000);
        self::assertSame([], $search->get_paths($this->root(), 'permission'), 'a cached hit is hidden as soon as it becomes unreadable');
        chmod($file, 0600);
        self::assertSame([$file], $search->get_paths($this->root(), 'permission'), 'an indexed name returns when it becomes readable again');
    }
}
