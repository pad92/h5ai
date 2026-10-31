<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;

final class FolderSizeOptionsTest extends H5aiTestCase {
    // Out-of-range numbers are clamped; anything non-numeric falls back to
    // the documented default rather than casting to 0.
    public static function timeouts(): array {
        return [
            'above the ceiling' => [['timeout' => 99999999, 'backgroundTimeout' => 1e9], Filesize::MAX_TIMEOUT, Filesize::MAX_TIMEOUT],
            'below the floor' => [['timeout' => 0, 'backgroundTimeout' => -5], 1, 1],
            'not numeric' => [['timeout' => 'abc', 'backgroundTimeout' => null], Filesize::DEFAULT_TIMEOUT, Filesize::DEFAULT_BACKGROUND_TIMEOUT],
            'absent' => [[], Filesize::DEFAULT_TIMEOUT, Filesize::DEFAULT_BACKGROUND_TIMEOUT],
        ];
    }

    #[DataProvider('timeouts')]
    public function testTimeoutsAreClampedOrDefaulted(array $override, int $expected, int $expectedBackground): void {
        [, , $timeout, $backgroundTimeout] = $this->context(['foldersize' => ['enabled' => true] + $override])->foldersize_mode();
        self::assertSame($expected, $timeout);
        self::assertSame($expectedBackground, $backgroundTimeout);
    }

    // Written as raw JSON because json_encode() cannot represent INF.
    public function testAnOverflowingTimeoutClampsToTheCeiling(): void {
        $this->context(); // writes types.json
        file_put_contents(
            $this->tmp . '/conf/options.json',
            '{"view":{"hidden":[],"unmanaged":[]},"foldersize":{"enabled":true,"timeout":1e9999,"backgroundTimeout":1e9999}}',
        );
        $store = [];
        $context = new Context(new Session($store), new Request([], ''), new TestSetup($this->setupValues()));
        [, , $timeout, $backgroundTimeout] = $context->foldersize_mode();
        self::assertSame(Filesize::MAX_TIMEOUT, $timeout);
        self::assertSame(Filesize::MAX_TIMEOUT, $backgroundTimeout);
    }
}
