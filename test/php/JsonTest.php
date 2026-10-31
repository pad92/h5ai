<?php

declare(strict_types=1);

final class JsonTest extends H5aiTestCase {
    public function testCommentsAreStrippedOutsideStringsOnly(): void {
        $path = $this->write($this->tmp . '/commented.json', <<<'JSON'
            {
                // a line comment
                "drive": "C:\\", // a backslash ends this string, not the comment
                "quoted": "say \"hi\" // not a comment",
                "url": "http://example.org/*not-a-comment*/", /* block
                comment */
                "last": true
            }
            JSON);
        self::assertSame(
            ['drive' => 'C:\\', 'quoted' => 'say "hi" // not a comment', 'url' => 'http://example.org/*not-a-comment*/', 'last' => true],
            Json::load($path),
        );
    }
}
