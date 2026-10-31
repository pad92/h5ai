<?php

use PHPUnit\Framework\TestCase;

final class RegressionTest extends TestCase {
    public function testRegressionSuite(): void {
        // Existing checks throw on failure; keep the standalone entry point usable.
        require __DIR__ . '/run.php';
        $this->addToAssertionCount(1);
    }
}
