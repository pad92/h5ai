<?php

declare(strict_types=1);

// Icon themes live in public/images/themes/<view.theme>/.
final class ThemeTest extends H5aiTestCase {
    private function icons(string $theme): array {
        $context = $this->context(
            ['view' => ['hidden' => [], 'unmanaged' => [], 'theme' => $theme]],
            ['PUBLIC_PATH' => $this->tmp . '/public'],
        );
        return (new Theme($context))->get_icons();
    }

    public function testImagesOfTheThemeFolderAreItsIcons(): void {
        $folder = $this->tmp . '/public/images/themes/mine';
        $this->write($folder . '/folder.svg', '<svg/>');
        $this->write($folder . '/file.PNG', 'png');
        $this->write($folder . '/notes.txt', 'not an icon');
        mkdir($folder . '/nested.svg');
        $icons = $this->icons('mine');
        ksort($icons);
        self::assertSame(['file' => 'mine/file.PNG', 'folder' => 'mine/folder.svg'], $icons);
    }

    public function testAMissingThemeHasNoIcons(): void {
        self::assertSame([], $this->icons('missing'));
    }

    public function testAnUnreadableThemeHasNoIcons(): void {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            self::markTestSkipped('root reads every folder');
        }
        $folder = $this->tmp . '/public/images/themes/locked';
        $this->write($folder . '/folder.svg', '<svg/>');
        chmod($folder, 0);
        try {
            self::assertSame([], $this->icons('locked'));
        } finally {
            chmod($folder, 0700);
        }
    }
}
