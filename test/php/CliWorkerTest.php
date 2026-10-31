<?php

declare(strict_types=1);

// warm-cache.php and refresh-cache.php, the CLI workers started by cron
// or by a web request.
final class CliWorkerTest extends H5aiTestCase {
    private string $app;

    protected function setUp(): void {
        parent::setUp();
        $this->write($this->root('sub/data.bin'), str_repeat('x', 1000));
    }

    public function testTheCliContextIndexesTheConfiguredRoot(): void {
        // Setup caches its command probes next to the sources: restore the
        // checkout afterwards.
        $sourceCache = realpath(__DIR__ . '/../../src/_h5ai/private/cache');
        $cacheBefore = scandir($sourceCache);
        $server = $_SERVER;
        $root = getenv('H5AI_ROOT_PATH');
        $magick = getenv('MAGICK_CONFIGURE_PATH');
        putenv('H5AI_ROOT_PATH=' . $this->root());
        try {
            $context = Bootstrap::cli_context();
            self::assertSame($this->root(), $context->get_setup()->get('ROOT_PATH'));
            self::assertSame('GET', $context->get_setup()->get('REQUEST_METHOD'));
            self::assertFalse($context->is_admin());
        } finally {
            $_SERVER = $server;
            putenv($root === false ? 'H5AI_ROOT_PATH' : 'H5AI_ROOT_PATH=' . $root);
            putenv($magick === false ? 'MAGICK_CONFIGURE_PATH' : 'MAGICK_CONFIGURE_PATH=' . $magick);
            foreach (array_diff(scandir($sourceCache), $cacheBefore) as $created) {
                unlink($sourceCache . '/' . $created);
            }
        }
    }

    // Run on a copy of the application so their caches stay out of the checkout.
    private function copyApplication(): void {
        $this->app = $this->tmp . '/app/_h5ai';
        mkdir($this->app . '/public/cache', 0700, true);
        exec('cp -R ' . escapeshellarg(__DIR__ . '/../../src/_h5ai/private') . ' ' . escapeshellarg($this->app . '/private'), $unused, $status);
        self::assertSame(0, $status);
        file_put_contents($this->app . '/private/conf/options.json', json_encode([
            'foldersize' => ['enabled' => true, 'type' => 'php'],
            'thumbnails' => ['enabled' => false],
        ]));
    }

    private function runWorker(string $script, array $args = []): string {
        $command = 'H5AI_ROOT_PATH=' . escapeshellarg($this->root()) . ' ' . escapeshellarg(PHP_BINARY)
            . ' ' . escapeshellarg($this->app . '/private/php/' . $script);
        foreach ($args as $arg) {
            $command .= ' ' . escapeshellarg($arg);
        }
        exec($command . ' 2>&1', $output, $status);
        self::assertSame(0, $status, implode("\n", $output));
        return implode("\n", $output);
    }

    private function cachedSizes(): array {
        return json_decode((string) @file_get_contents($this->app . '/private/cache/foldersizes.json'), true) ?: [];
    }

    public function testTheRefreshWorkerCachesTheRequestedFolders(): void {
        $this->copyApplication();
        touch($this->app . '/private/cache/refresh.requested');
        $this->runWorker('refresh-cache.php', [$this->root('sub')]);
        self::assertGreaterThanOrEqual(1000, $this->cachedSizes()[$this->root('sub')]['size'] ?? 0);
        self::assertFileDoesNotExist($this->app . '/private/cache/refresh.requested', 'the request marker must be cleared');
    }

    public function testTheCacheWarmerCachesTheRootFolder(): void {
        $this->copyApplication();
        self::assertStringContainsString('Cache warming completed', $this->runWorker('warm-cache.php'));
        self::assertGreaterThanOrEqual(1000, $this->cachedSizes()[$this->root()]['size'] ?? 0);
        self::assertFileExists($this->app . '/private/cache/warmer.lastrun');
    }
}
