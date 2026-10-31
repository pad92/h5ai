<?php

declare(strict_types=1);

// The warmer must produce exactly the thumbnails listings ask for.
final class CacheWarmerTest extends H5aiTestCase {
    public function testItWarmsEachConfiguredTypeOnceAtTheListingSize(): void {
        foreach (['a.jpg', 'b.pdf', 'c.zip', 'd.txt'] as $name) {
            $this->write($this->root($name), 'x');
        }
        $context = $this->context(
            ['thumbnails' => [
                'enabled' => true,
                // 200 * 4/3 = 266.67: floored when served, rounded by the old warmer.
                'size' => 200,
                'img' => ['img-jpg'], 'doc' => ['x-pdf'], 'ar' => ['ar-zip'],
                'blocklist' => ['x-pdf'],
            ]],
            ['HAS_PHP_WEBP' => true],
            ['img-jpg' => ['glob' => ['*.jpg']], 'x-pdf' => ['glob' => ['*.pdf']], 'ar-zip' => ['glob' => ['*.zip']]],
        );
        self::assertSame([266, 200], Thumb::default_dimensions($context));

        // Seed the cache entries a listing would hit, so the real lookup
        // runs without GD or any capture tool.
        $seeded = [];
        foreach (['a.jpg', 'c.zip'] as $name) {
            $thumb = 'thumb-' . sha1($this->root($name)) . '-266x200.webp';
            $this->write($this->tmp . '/cache-pub/thumbs/' . $thumb, 'webp');
            $seeded['/' . $name] = '/_h5ai/public/cache/thumbs/' . $thumb;
        }
        $recorder = new class($context) extends Thumb {
            public array $calls = [];

            public function thumb_for(string $type, string $source_href, int $width, int $height): ?string {
                $href = parent::thumb_for($type, $source_href, $width, $height);
                $this->calls[] = [$type, $source_href, $width, $height, $href];
                return $href;
            }
        };
        (new CacheWarmer($context, $recorder))->warm();
        self::assertSame(
            [['img-jpg', '/a.jpg', 266, 200, $seeded['/a.jpg']], ['ar-zip', '/c.zip', 266, 200, $seeded['/c.zip']]],
            $recorder->calls,
        );

        [$served] = $context->get_thumbs([['type' => 'img-jpg', 'href' => '/a.jpg'], ['type' => 'ar-zip', 'href' => '/c.zip']]);
        self::assertSame(array_values($seeded), $served, 'listings must be served the thumbnails the warmer produced');
    }
}
