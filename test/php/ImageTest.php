<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\RequiresFunction;

#[RequiresFunction('imagecreatefromstring')]
final class ImageTest extends H5aiTestCase {
    private static function stream(string $data) {
        $stream = fopen('php://temp', 'r+');
        fwrite($stream, $data);
        return $stream;
    }

    public function testWideImagesDoNotCauseThumbnailDimensionErrors(): void {
        $wide = imagecreatetruecolor(4097, 1);
        $stream = fopen('php://temp', 'r+');
        imagepng($wide, $stream);
        $image = new Image();
        self::assertTrue($image->set_source_data($stream));
        $image->thumb(4096, 0);
    }

    // GD has no TIFF decoder; a corrupt file or an empty capture behaves alike.
    public function testDataGdCannotDecodeYieldsNoImage(): void {
        foreach ([
            'TIFF' => (string) file_get_contents(__DIR__ . '/../docker/fixtures/image.tiff'),
            'garbage' => 'not an image',
            'empty' => '',
        ] as $name => $data) {
            self::assertFalse((new Image())->set_source_data(self::stream($data)), $name);
        }
    }

    // One undecodable source must not fail the other entries of the batch.
    public function testAnUndecodableImageDoesNotFailTheWholeRequest(): void {
        $this->write($this->root('broken.png'), 'not an image');
        $this->write($this->root('cached.png'), 'x');
        $cached = 'thumb-' . sha1($this->root('cached.png')) . '-320x240.webp';
        $this->write($this->tmp . '/cache-pub/thumbs/' . $cached, 'webp');

        $context = $this->context(['thumbnails' => ['enabled' => true]], ['HAS_PHP_WEBP' => true]);
        [$hrefs] = $context->get_thumbs([['type' => 'img-png', 'href' => '/broken.png'], ['type' => 'img-png', 'href' => '/cached.png']]);
        self::assertSame([null, '/_h5ai/public/cache/thumbs/' . $cached], $hrefs);
    }
}
