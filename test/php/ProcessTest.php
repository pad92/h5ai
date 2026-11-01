<?php

declare(strict_types=1);

// Child processes (thumbnails, du) are bounded by their timeout.
final class ProcessTest extends H5aiTestCase {
    public function testChildProcessesAreTerminatedAfterTheirTimeout(): void {
        $output = '';
        $error = '';
        $startedAt = microtime(true);
        self::assertSame(124, Util::proc_open_cmdv([PHP_BINARY, '-r', 'sleep(3);'], $output, $error, 1));
        self::assertLessThan(2.5, microtime(true) - $startedAt, 'child process timeout must return promptly');
    }

    // The partial tree a cut-off du already wrote must not be parsed: it
    // would persist a too-small size. A mount hung in uninterruptible I/O
    // cannot be simulated portably; nothing recovers from that case.
    public function testATimedOutFolderSizeCommandYieldsNoPartialSizes(): void {
        $class = new ReflectionClass(Filesize::class);
        $sizer = $class->newInstanceWithoutConstructor();
        $class->getConstructor()->invoke($sizer, 1);
        $startedAt = microtime(true);
        $lines = $class->getMethod('exec')->invoke($sizer, [PHP_BINARY, '-r', 'fwrite(STDOUT, "123\t/tmp\n"); sleep(3);']);
        self::assertLessThan(2.5, microtime(true) - $startedAt, 'folder-size commands must be bounded by their timeout');
        self::assertSame([], $lines);
    }
}
