<?php

declare(strict_types=1);

final class SearchTest extends H5aiTestCase {
    public function testAnInvalidPatternFindsNothing(): void {
        $this->write($this->root('file.txt'), 'x');
        self::assertSame([], (new Search($this->context()))->get_paths($this->root(), '(unclosed'));
    }
}
