<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;

// Each TAR entry is exactly as long as its header (and Content-Length)
// announces, whatever happened to the file since.
final class ArchiveStreamTest extends H5aiTestCase {
    private Archive $archive;
    private string $file;

    protected function setUp(): void {
        parent::setUp();
        $this->file = $this->write($this->root('entry.bin'), 'abc');
        $this->archive = new Archive($this->context());
    }

    private function entry(string $file, int $size): array {
        $method = new ReflectionMethod($this->archive, 'print_file');
        return self::captureOutput(fn(): bool => $method->invoke($this->archive, $file, $size));
    }

    public function testAnUnchangedFileIsArchivedAsIs(): void {
        self::assertSame([true, 'abc'], $this->entry($this->file, 3));
    }

    public function testAFileThatShrankIsPadded(): void {
        self::assertSame([true, "abc\0\0"], $this->entry($this->file, 5));
    }

    public function testAFileThatGrewIsCut(): void {
        self::assertSame([true, 'ab'], $this->entry($this->file, 2));
    }

    public function testAnUnreadableFileKeepsItsAnnouncedSize(): void {
        self::assertSame([true, str_repeat("\0", 70000)], $this->entry($this->root('vanished.bin'), 70000));
    }

    public function testAPhpTarStreamIsAValidArchive(): void {
        $method = new ReflectionMethod($this->archive, 'php_tar');
        [$ok, $tar] = self::captureOutput(fn(): bool => $method->invoke($this->archive, [$this->root() => 'root'], [$this->file => 'root/entry.bin']));
        self::assertTrue($ok);
        self::assertSame(0, strlen($tar) % 512, 'a TAR stream must consist of whole 512-byte blocks');
        $path = $this->write($this->tmp . '/out.tar', $tar);
        exec('tar -tf ' . escapeshellarg($path) . ' 2>&1', $listing, $status);
        self::assertSame(0, $status);
        self::assertSame(['root', 'root/entry.bin'], $listing);
    }

    public function testNothingIsStreamedWithoutAPreparedSelection(): void {
        [$ok, $output] = self::captureOutput(fn(): bool => $this->archive->stream());
        self::assertFalse($ok);
        self::assertSame('', $output);
    }

    public static function shellArchivers(): array {
        return ['shell-tar' => ['shell-tar', 'tar', 'tar -tf'], 'shell-zip' => ['shell-zip', 'zip', 'unzip -Z1']];
    }

    #[DataProvider('shellArchivers')]
    public function testShellArchivesStreamTheSelection(string $type, string $tool, string $lister): void {
        foreach ([$tool, strtok($lister, ' ')] as $command) {
            if (trim((string) shell_exec('command -v ' . escapeshellarg($command))) === '') {
                self::markTestSkipped("{$command} is not installed");
            }
        }
        $archive = new Archive($this->context());
        self::assertTrue($archive->prepare($type, '/', ['/entry.bin']));
        [$ok, $bytes] = self::captureOutput(fn(): bool => $archive->stream());
        self::assertTrue($ok);
        $path = $this->write($this->tmp . '/out', $bytes);
        exec($lister . ' ' . escapeshellarg($path) . ' 2>&1', $listing, $status);
        self::assertSame([0, ['entry.bin']], [$status, $listing]);
    }
}
