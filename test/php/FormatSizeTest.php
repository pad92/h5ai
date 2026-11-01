<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;

// Server-rendered sizes must read like the browser's (core/format.js).
final class FormatSizeTest extends H5aiTestCase {
    public static function sizes(): array {
        return [
            [0, false, '0 B'], [999, false, '999 B'], [1000, false, '1 KB'], [1500, false, '2 KB'],
            [999999, false, '1000 KB'], [1000000, false, '1.0 MB'], [1234567, false, '1.2 MB'],
            [5000000000000, false, '5.0 TB'], [1024, true, '1 KiB'], [1536, true, '2 KiB'],
            [1048576, true, '1.0 MiB'], [null, false, ''], [-1, false, ''],
        ];
    }

    #[DataProvider('sizes')]
    public function testSizesUseTheBrowserUnits(?int $size, bool $binary, string $expected): void {
        self::assertSame($expected, Util::format_size($size, $binary));
    }

    public function testFallbackListingsFollowViewBinaryPrefix(): void {
        $this->write($this->root('data.bin'), str_repeat('x', 1536));
        foreach ([false => '2 KB', true => '2 KiB'] as $binary => $expected) {
            $html = (new Fallback($this->context(['view' => ['hidden' => [], 'unmanaged' => [], 'binaryPrefix' => (bool) $binary]])))->get_html($this->root());
            self::assertStringContainsString('<td class="fb-s">' . $expected . '</td>', $html);
        }
    }
}
