<?php

declare(strict_types=1);

// The Pug page templates, read as text: the JS suite also runs bundled in a
// browser, where it cannot read files.
final class PageTemplatesTest extends H5aiTestCase {
    private static function template(string $name): string {
        return (string) file_get_contents(__DIR__ . '/../../src/_h5ai/private/php/pages/' . $name);
    }

    // ext/theme appends its toggle to #toolbar: without one the info page
    // has no way to switch themes.
    public function testTheInfoPageHasAToolbarForTheThemeToggle(): void {
        self::assertMatchesRegularExpression('/^\s*div#toolbar\b/m', self::template('info.php.pug'));
    }

    // The hint shows whenever h5ai fails to start, not only in old browsers,
    // and browsehappy.com is gone.
    public function testTheStartFailureHintLinksToNoDeadSite(): void {
        $template = self::template('page.tpl.pug');
        self::assertStringNotContainsString('browsehappy', $template);
        self::assertMatchesRegularExpression('/span\.noBrowserMsg .*could not start/', $template);
    }
}
