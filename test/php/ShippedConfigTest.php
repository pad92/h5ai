<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;

// The options.json and types.json shipped in conf/: every type an option
// names exists, every thumbnail the options request has a server handler and
// the other way round, and common file names and MIME types resolve to the
// type their handlers expect.
final class ShippedConfigTest extends H5aiTestCase {
    private const THUMBNAIL_GROUPS = ['img', 'mov', 'doc', 'ar', 'aud'];

    private static function options(): array {
        return json_decode((string) file_get_contents(self::sourcePrivate() . '/conf/options.json'), true, flags: JSON_THROW_ON_ERROR);
    }

    private static function types(): array {
        return json_decode((string) file_get_contents(self::sourcePrivate() . '/conf/types.json'), true, flags: JSON_THROW_ON_ERROR);
    }

    private static function requestedThumbnailTypes(): array {
        $thumbnails = self::options()['thumbnails'];
        return array_merge(...array_map(static fn(string $group): array => $thumbnails[$group], self::THUMBNAIL_GROUPS));
    }

    public function testEveryTypeNamedByAnOptionExists(): void {
        $options = self::options();
        $named = array_merge(
            $options['preview-aud']['types'],
            $options['preview-img']['types'],
            $options['preview-vid']['types'],
            array_keys($options['preview-txt']['styles']),
            self::requestedThumbnailTypes(),
            $options['thumbnails']['blocklist'],
        );
        $missing = array_values(array_diff($named, array_keys(self::types())));
        self::assertSame([], $missing, 'options must only name types defined in types.json');
    }

    public function testRequestedThumbnailsMatchTheServerHandlers(): void {
        $requested = self::requestedThumbnailTypes();
        $handled = array_merge(...array_values(array_diff_key(Thumb::HANDLED_TYPES, ['file' => true])));
        sort($requested);
        sort($handled);
        self::assertSame(
            array_values(array_unique($handled)),
            array_values(array_unique($requested)),
            'a requested thumbnail without a handler never appears, and a handled type nobody requests is dead code',
        );
    }

    public function testBrowserImageFormatsArePreviewed(): void {
        foreach (['img-avif', 'img-webp', 'img-jpg', 'img-png', 'img-gif', 'img-svg'] as $type) {
            self::assertContains($type, self::options()['preview-img']['types'], "{$type} must open in the image preview");
        }
    }

    public static function namesAndTypes(): array {
        return [
            ['photo.avif', 'img-avif'], ['IMG_0001.HEIC', 'img-heic'], ['photo.heif', 'img-heic'], ['photo.jxl', 'img-jxl'],
            ['song.opus', 'aud'], ['song.aac', 'aud'], ['book.m4b', 'aud'], ['song.oga', 'aud'], ['live.mka', 'aud'],
            ['clip.ogv', 'vid'], ['phone.3gp', 'vid'], ['camera.mts', 'vid-ts'], ['movie.wmv', 'vid-wmv'],
            ['movie.srt', 'txt'], ['movie.vtt', 'txt'], ['release.nfo', 'txt'],
            ['README', 'txt-readme'], ['LICENSE', 'txt-license'], ['COPYING', 'txt-license'],
            ['AUTHORS', 'txt-authors'], ['INSTALL', 'txt-install'], ['main.ts', 'txt-ts'],
            ['README.md', 'txt-md'], ['Makefile', 'txt-script'],
        ];
    }

    #[DataProvider('namesAndTypes')]
    public function testCommonNamesResolve(string $name, string $type): void {
        self::assertSame($type, (new TypeMatcher(self::types()))->type_of_name($name));
    }

    public static function mimeTypesAndTypes(): array {
        return [
            ['video/x-ms-wmv', 'vid-wmv'], ['video/x-ms-asf', 'vid-wmv'], ['video/quicktime', 'vid-mov'],
            ['application/zip', 'ar-zip'], ['application/x-zip-compressed', 'ar-zip'],
            ['application/gzip', TypeMatcher::UNKNOWN], ['application/x-gzip', TypeMatcher::UNKNOWN],
            ['application/x-lzma', 'ar-zip'], ['application/x-rar', 'ar-rar'], ['application/vnd.rar', 'ar-rar'],
            ['image/avif', 'img-avif'], ['image/heic', 'img-heic'], ['image/heif', 'img-heic'], ['image/jxl', 'img-jxl'],
            ['image/jpeg', 'img-jpg'], ['image/x-canon-cr2', 'img-raw'], ['application/pdf', 'x-pdf'],
            ['video/mp4', 'vid-mp4'], ['video/x-matroska', 'vid-mkv'],
        ];
    }

    #[DataProvider('mimeTypesAndTypes')]
    public function testRealMimeTypesResolve(string $mime, string $type): void {
        self::assertSame($type, (new TypeMatcher(self::types()))->type_of_mime($mime));
    }

    public static function qrColorPairs(): array {
        return [['qrFill', 'qrBack'], ['qrFillDark', 'qrBackDark']];
    }

    // Many scanners do not read inverted codes (light modules on a dark
    // background), and pale modules scan poorly.
    #[DataProvider('qrColorPairs')]
    public function testQrCodesAreDarkOnLightWithHighContrast(string $fill, string $back): void {
        $info = self::options()['info'];
        $fill_luminance = self::luminance($info[$fill]);
        $back_luminance = self::luminance($info[$back]);
        self::assertLessThan($back_luminance, $fill_luminance, "{$fill} must be darker than {$back}");
        self::assertGreaterThanOrEqual(7.0, ($back_luminance + 0.05) / ($fill_luminance + 0.05), "{$fill} on {$back} needs a 7:1 contrast");
    }

    // WCAG relative luminance of a #rgb or #rrggbb color.
    private static function luminance(string $color): float {
        $hex = ltrim($color, '#');
        if (strlen($hex) === 3) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }
        $channels = array_map(static function (string $pair): float {
            $value = hexdec($pair) / 255;
            return $value <= 0.03928 ? $value / 12.92 : (($value + 0.055) / 1.055) ** 2.4;
        }, str_split($hex, 2));
        return 0.2126 * $channels[0] + 0.7152 * $channels[1] + 0.0722 * $channels[2];
    }
}
