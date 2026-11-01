<?php

declare(strict_types=1);

// ustar headers, with POSIX PAX records for what ustar cannot hold.
final class TarHeaderTest extends H5aiTestCase {
    // [name, prefix, octal size, octal mtime] of the last 512-byte block.
    private static function fields(string $headers): array {
        $block = substr($headers, -512);
        return [
            rtrim(substr($block, 0, 100), "\0"),
            rtrim(substr($block, 345, 155), "\0"),
            rtrim(substr($block, 124, 11), "\0"),
            rtrim(substr($block, 136, 11), "\0"),
        ];
    }

    public function testALongPathIsSplitAtASlashIntoPrefixAndName(): void {
        $folder = str_repeat('d', 120);
        $headers = TarHeader::encode($folder . '/file.txt', 3, 0, '0');
        self::assertSame(512, strlen($headers), 'no PAX record is needed');
        self::assertSame(['file.txt', $folder, '00000000003', '00000000000'], self::fields($headers));
    }

    public function testASizeBeyondElevenOctalDigitsGoesToAPaxRecord(): void {
        $headers = TarHeader::encode('big.bin', 8589934592, 0, '0');
        self::assertStringContainsString(" size=8589934592\n", $headers);
        self::assertSame('00000000000', self::fields($headers)[2]);
    }

    public function testAnMtimeBeforeTheEpochGoesToAPaxRecord(): void {
        $headers = TarHeader::encode('old.txt', 1, -60, '0');
        self::assertStringContainsString(" mtime=-60\n", $headers);
        self::assertSame('00000000000', self::fields($headers)[3]);
    }

    public function testAMissingMtimeIsTheEpoch(): void {
        self::assertSame('00000000000', self::fields(TarHeader::encode('file.txt', 1, false, '0'))[3]);
    }
}
