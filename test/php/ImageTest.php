<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\RequiresFunction;

final class ImageTest extends H5aiTestCase {
    #[RequiresFunction('imagecreatetruecolor')]
    public function testWideImagesDoNotCauseThumbnailDimensionErrors(): void {
        $wide = imagecreatetruecolor(4097, 1);
        $stream = fopen('php://temp', 'r+');
        imagepng($wide, $stream);
        $image = new Image();
        self::assertTrue($image->set_source_data($stream));
        $image->thumb(4096, 0);
        fclose($stream);
    }
}
