<?php

declare(strict_types=1);

final class TypeMatcherTest extends H5aiTestCase {
    private TypeMatcher $matcher;

    protected function setUp(): void {
        parent::setUp();
        $this->matcher = new TypeMatcher([
            'broken' => 'not a definition',
            'ar-gz' => ['glob' => ['*.tar.gz', '*.tgz']],
            'ar' => ['glob' => ['*.gz']],
            'img-jpg' => ['glob' => ['*.jpg', '*.jpeg'], 'mime' => ['jpeg']],
            'vid-mp4' => ['mime' => ['video/mp4']],
            'txt-dot' => ['glob' => ['a.b|c']],
        ]);
    }

    public function testNamePatternsIgnoreCase(): void {
        self::assertSame('img-jpg', $this->matcher->type_of_name('PHOTO.JPG'));
    }

    public function testTheFirstMatchingTypeInFileOrderWins(): void {
        self::assertSame('ar-gz', $this->matcher->type_of_name('backup.tar.gz'));
        self::assertSame('ar', $this->matcher->type_of_name('notes.gz'));
    }

    public function testGlobsMatchWholeNamesLiterally(): void {
        self::assertSame(TypeMatcher::UNKNOWN, $this->matcher->type_of_name('jpg'), 'a glob must match the whole name');
        self::assertSame('txt-dot', $this->matcher->type_of_name('a.b|c'), 'characters other than * must match literally');
        self::assertSame(TypeMatcher::UNKNOWN, $this->matcher->type_of_name('axb'), 'a dot must not match any character');
    }

    public function testMimeFragmentsMatch(): void {
        self::assertSame('img-jpg', $this->matcher->type_of_mime('image/jpeg'));
        self::assertSame(TypeMatcher::UNKNOWN, $this->matcher->type_of_mime('application/octet-stream'));
    }
}
