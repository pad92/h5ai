<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;

// Which thumbnail a request gets, and which capture output is accepted.
final class ThumbnailRequestTest extends H5aiTestCase {
    public static function requests(): array {
        return [
            'listing' => [[], [320, 240]],
            'width rounded up' => [['width' => 1000, 'height' => 7], [1024, 0]],
            'exact step' => [['width' => 1024, 'height' => 0], [1024, 0]],
            'tiny width' => [['width' => 1], [256, 0]],
            'invalid width' => [['width' => 'abc'], [256, 0]],
            'height only' => [['height' => 500], [256, 0]],
            'above maxDimension' => [['width' => 999999], [4096, 0]],
        ];
    }

    #[DataProvider('requests')]
    public function testExplicitSizesSnapToFewCachedVariants(array $request, array $expected): void {
        $context = $this->context(['thumbnails' => ['enabled' => true, 'size' => 240, 'maxDimension' => 4096]]);
        self::assertSame($expected, Thumb::request_dimensions($context, $request));
    }

    public function testEveryExplicitWidthSharesOneOfSixteenVariants(): void {
        $context = $this->context(['thumbnails' => ['enabled' => true, 'maxDimension' => 4096]]);
        $variants = [];
        for ($width = 1; $width <= 4096; $width++) {
            $variants[implode('x', Thumb::request_dimensions($context, ['width' => $width, 'height' => $width]))] = true;
        }
        self::assertCount(16, $variants);
    }

    public function testSnappedWidthsRespectMaxDimension(): void {
        $context = $this->context(['thumbnails' => ['enabled' => true, 'maxDimension' => 1000]]);
        self::assertSame([1000, 0], Thumb::request_dimensions($context, ['width' => 900]));
    }

    public function testAPreviewSampleIsServedFromItsSnappedVariant(): void {
        $this->write($this->root('photo.jpg'), 'x');
        $name = 'thumb-' . sha1($this->root('photo.jpg')) . '-1024x0.webp';
        $this->write($this->tmp . '/cache-pub/thumbs/' . $name, 'webp');
        $context = $this->context(['thumbnails' => ['enabled' => true]]);
        [$hrefs] = $context->get_thumbs([['type' => 'img-jpg', 'href' => '/photo.jpg', 'width' => 1000, 'height' => 0]]);
        self::assertSame(['/_h5ai/public/cache/thumbs/' . $name], $hrefs);
    }

    public function testCaptureSignatures(): void {
        self::assertTrue(Thumb::has_capture_signature("\xFF\xD8\xFF\xE0\0\x10JFIF"), 'JPEG (ffmpeg) must be accepted');
        self::assertTrue(Thumb::has_capture_signature("RIFF\x24\0\0\0WEBPVP8 "), 'WebP (convert/gm) must be accepted');
        self::assertFalse(Thumb::has_capture_signature("RIFF\x24\0\0\0WAVEfmt "), 'non-image RIFF must be rejected');
        self::assertFalse(Thumb::has_capture_signature(''), 'empty output must be rejected');
    }

    // Fails before any decoding, so the next handler can be tried.
    public function testNonImageCaptureOutputIsRejectedBeforeDecoding(): void {
        $this->fakeTools(['convert' => "printf 'not an image'"]);
        $pdf = $this->write($this->root('doc.pdf'), '%PDF-1.4');
        $thumb = new Thumb($this->context(setup: ['HAS_CMD_CONVERT' => true]), $pdf, 'x-pdf');
        $this->expectExceptionMessage('thumbnail command produced no image');
        $thumb->do_capture(Thumb::CONVERT_CMDV);
    }
}
