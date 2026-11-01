<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;

final class FolderSizeOptionsTest extends H5aiTestCase {
    // Out-of-range numbers are clamped; anything non-numeric falls back to
    // the documented default rather than casting to 0.
    public static function timeouts(): array {
        return [
            'above the ceiling' => [['backgroundTimeout' => 1e9], Filesize::MAX_TIMEOUT],
            'below the floor' => [['backgroundTimeout' => -5], 1],
            'not numeric' => [['backgroundTimeout' => null], Filesize::DEFAULT_BACKGROUND_TIMEOUT],
            'absent' => [[], Filesize::DEFAULT_BACKGROUND_TIMEOUT],
            // No request computes folder sizes any more: the option is ignored.
            'request timeout only' => [['timeout' => 7], Filesize::DEFAULT_BACKGROUND_TIMEOUT],
        ];
    }

    #[DataProvider('timeouts')]
    public function testTheTimeoutIsClampedOrDefaulted(array $override, int $expected): void {
        [, , $timeout] = $this->context(['foldersize' => ['enabled' => true] + $override])->foldersize_mode();
        self::assertSame($expected, $timeout);
    }

    // Written as raw JSON because json_encode() cannot represent INF.
    public function testAnOverflowingTimeoutClampsToTheCeiling(): void {
        $this->context(); // writes types.json
        file_put_contents(
            $this->tmp . '/conf/options.json',
            '{"view":{"hidden":[],"unmanaged":[]},"foldersize":{"enabled":true,"backgroundTimeout":1e9999}}',
        );
        $store = [];
        $context = new Context(new Session($store), new Request([], ''), new TestSetup($this->setupValues()));
        [, , $timeout] = $context->foldersize_mode();
        self::assertSame(Filesize::MAX_TIMEOUT, $timeout);
    }
}
