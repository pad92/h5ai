<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;

// The view.hidden list shipped in options.json: NAS and OS metadata stays out
// of listings, while user files that merely contain a hidden name stay visible.
final class DefaultHiddenTest extends H5aiTestCase {
    private PathPolicy $paths;

    protected function setUp(): void {
        parent::setUp();
        $shipped = json_decode((string) file_get_contents(self::sourcePrivate() . '/conf/options.json'), true);
        $this->paths = $this->context(['view' => ['hidden' => $shipped['view']['hidden'], 'unmanaged' => []]])->paths();
    }

    public static function hiddenNames(): array {
        return array_map(static fn(string $name): array => [$name], [
            '.DS_Store', '._photo.jpg', '.@__thumb', '_h5ai', 'robots.txt', 'ads.txt',
            'Thumbs.db', 'thumbs.db', 'ehthumbs.db', 'ehthumbs_vista.db', 'desktop.ini', 'Desktop.ini',
            '$RECYCLE.BIN', '$Recycle.Bin', 'System Volume Information', "Icon\r", '__MACOSX', 'lost+found',
            '@eaDir', '#recycle', '#snapshot', '@Recycle', '@Recently-Snapshot',
        ]);
    }

    public static function visibleNames(): array {
        return array_map(static fn(string $name): array => [$name], [
            'downloads.txt', 'uploads.txt', 'leads.txt', 'robots.txt.bak', 'my-robots.txt',
            'Thumbs.db.txt', 'Desktop', 'Icon', 'photo@eaDir.jpg', 'recycle', '_draft.md', 'song.mp3',
        ]);
    }

    #[DataProvider('hiddenNames')]
    public function testSystemNamesAreHidden(string $name): void {
        self::assertTrue($this->paths->is_hidden($name), "{$name} must be hidden by default");
    }

    #[DataProvider('visibleNames')]
    public function testUserNamesStayVisible(string $name): void {
        self::assertFalse($this->paths->is_hidden($name), "{$name} must stay visible by default");
        self::assertFalse($this->paths->is_hidden('/music/' . $name), "the href of {$name} must not match either");
    }
}
