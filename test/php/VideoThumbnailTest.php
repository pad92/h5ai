<?php

declare(strict_types=1);

// Which frame a video thumbnail captures, with or without a duration probe.
final class VideoThumbnailTest extends H5aiTestCase {
    private string $movie;

    protected function setUp(): void {
        parent::setUp();
        $this->movie = $this->write($this->root('movie.mp4'), 'not really a movie');
        $this->fakeTools(['ffmpeg' => "printf 'not an image'", 'ffprobe' => 'echo 10', 'avconv' => "printf 'not an image'"]);
    }

    private function capture(string $handler, array $setup): void {
        $context = $this->context(['thumbnails' => ['enabled' => true, 'seek' => 50]], $setup + ['HAS_CMD_FFMPEG' => true]);
        (new ReflectionMethod(Thumb::class, 'run_handler'))->invoke(new Thumb($context, $this->movie, 'vid-mp4'), $handler);
    }

    public function testWithoutAProbeAnEarlyFrameIsUsed(): void {
        $this->capture('mov', []);
        self::assertSame('', $this->toolLog('ffprobe'), 'a missing ffprobe must not be run');
        self::assertStringContainsString('-ss 0.1 -i ' . $this->movie, $this->toolLog('ffmpeg'));
    }

    public function testTheProbedDurationSetsTheSeekPosition(): void {
        $this->capture('mov', ['HAS_CMD_FFPROBE' => true]);
        self::assertNotSame('', $this->toolLog('ffprobe'));
        self::assertStringContainsString('-ss 5 -i ', $this->toolLog('ffmpeg'));
    }

    public function testAnUnknownDurationFallsBackToAnEarlyFrame(): void {
        $this->fakeTools(['ffprobe' => 'echo N/A']);
        $this->capture('mov', ['HAS_CMD_FFPROBE' => true]);
        self::assertStringContainsString('-ss 0.1 -i ', $this->toolLog('ffmpeg'));
    }

    public function testSwfThumbnailsSeekAfterOpeningTheInput(): void {
        $this->capture('swf', []);
        self::assertStringContainsString('-i ' . $this->movie . ' -ss 0.1 ', $this->toolLog('ffmpeg'));
    }

    public function testAvconvIsUsedWhenFfmpegIsMissing(): void {
        $this->capture('mov', ['HAS_CMD_FFMPEG' => false, 'HAS_CMD_AVCONV' => true]);
        self::assertStringContainsString('-ss 0.1 -i ', $this->toolLog('avconv'));
        self::assertSame('', $this->toolLog('ffmpeg'));
    }
}
