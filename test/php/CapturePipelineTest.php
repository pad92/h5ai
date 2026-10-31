<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\RequiresPhpExtension;

// Each capture tool runs at most once per source; a failure re-identifies
// the file by name, then by content.
final class CapturePipelineTest extends H5aiTestCase {
    private Context $context;

    protected function setUp(): void {
        parent::setUp();
        $this->write($this->root('doc.pdf'), "%PDF-1.4\n");
        $this->write($this->root('second.pdf'), "%PDF-1.4\n");
        // An MP4 file carrying a PDF name.
        $this->write($this->root('clip.pdf'), "\0\0\0\x18ftypmp42\0\0\0\0mp42isom" . str_repeat("\0", 64));
        $this->fakeTools(['convert' => "printf 'not an image'", 'ffmpeg' => "printf 'not an image'"]);
        $this->context = $this->context(
            ['thumbnails' => ['enabled' => true]],
            ['HAS_PHP_FILEINFO' => extension_loaded('fileinfo'), 'HAS_CMD_CONVERT' => true, 'HAS_CMD_FFMPEG' => true],
            ['x-pdf' => ['glob' => ['*.pdf']], 'vid-mp4' => ['glob' => ['*.mp4'], 'mime' => ['video/mp4']]],
        );
    }

    private function thumb(string $name, string $type): Thumb {
        return new Thumb($this->context, $this->root($name), $type);
    }

    public function testAFailingDocumentCaptureRunsConvertOnce(): void {
        self::assertNull($this->thumb('doc.pdf', 'x-pdf')->thumb(320, 240));
        self::assertSame(1, $this->toolRuns('convert'));
        self::assertSame(0, $this->toolRuns('ffmpeg'), 'a document recognised by name and content must not be tried as a video');
    }

    // ImageMagick 7 hosts run `magick`; `convert` is only the IM6 fallback.
    public function testDocumentsAreRenderedWithMagickWhenAvailable(): void {
        $this->fakeTools(['magick' => "printf 'not an image'"]);
        $context = $this->context(
            ['thumbnails' => ['enabled' => true]],
            ['HAS_CMD_MAGICK' => true, 'HAS_CMD_CONVERT' => true],
            ['x-pdf' => ['glob' => ['*.pdf']]],
        );
        (new Thumb($context, $this->root('doc.pdf'), 'x-pdf'))->thumb(320, 240);
        self::assertSame(0, $this->toolRuns('convert'));
        self::assertSame(
            '-density 200 ' . $this->root('doc.pdf') . "[0] -quality 100 -strip WEBP:-\n",
            $this->toolLog('magick'),
            'operators must follow the input image for ImageMagick 7',
        );
    }

    public function testAFileSentWithAnUnknownTypeIsIdentifiedByName(): void {
        $this->thumb('doc.pdf', 'file')->thumb(320, 240);
        self::assertSame(1, $this->toolRuns('convert'));
    }

    #[RequiresPhpExtension('fileinfo')]
    public function testAMisnamedFileIsRetriedOnceByContent(): void {
        $thumb = $this->thumb('clip.pdf', 'x-pdf');
        $thumb->thumb(320, 240);
        self::assertSame(1, $this->toolRuns('convert'));
        self::assertSame(1, $this->toolRuns('ffmpeg'));
        self::assertSame('vid-mp4', $thumb->get_type()->name);
        self::assertTrue($thumb->get_type()->was_wrong());

        // One instance reused for another source starts afresh.
        $this->clearToolLogs();
        $thumb->thumb_for('x-pdf', '/second.pdf', 320, 240);
        self::assertSame('x-pdf', $thumb->get_type()->name);
        self::assertFalse($thumb->get_type()->was_wrong());
        self::assertSame(1, $this->toolRuns('convert'));
        self::assertSame(0, $this->toolRuns('ffmpeg'));
    }

    // Without an archive reader the archive is reported unhandled once,
    // and cached negatively, instead of being tried with other tools.
    public function testAnUnreadableArchiveIsNotTriedWithOtherTools(): void {
        $this->write($this->root('comics.zip'), 'PK');
        self::assertNull($this->thumb('comics.zip', 'ar-zip')->thumb(320, 240));
        self::assertSame(0, $this->toolRuns('convert') + $this->toolRuns('ffmpeg'));
        if (extension_loaded('sqlite3')) {
            $db = new CacheDB(new TestSetup($this->setupValues()));
            self::assertSame('ar-zip', $db->select(sha1($this->root('comics.zip')))['type'] ?? null);
        }
    }

    public function testACustomThumbnailIsServedAsAnImage(): void {
        $this->write($this->root('_thumb/doc.png'), 'png');
        $name = 'thumb-' . sha1($this->root('_thumb/doc.png')) . '-320x240.webp';
        $this->write($this->tmp . '/cache-pub/thumbs/' . $name, 'webp');
        $thumb = $this->thumb('doc.pdf', 'x-pdf');
        self::assertSame('/_h5ai/public/cache/thumbs/' . $name, $thumb->thumb(320, 240));
        self::assertSame('img', $thumb->get_type()->name);
    }
}
