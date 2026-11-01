<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

// Base class: each test gets its own temporary tree under $this->tmp and
// leaves no state behind (files, PATH, Filesize caches).
abstract class H5aiTestCase extends TestCase {
    protected string $tmp;
    private string|false|null $savedPath = null;

    protected function setUp(): void {
        $this->tmp = sys_get_temp_dir() . '/h5ai-test-' . bin2hex(random_bytes(6));
        mkdir($this->tmp . '/root', 0700, true);
        mkdir($this->tmp . '/conf', 0700, true);
        mkdir($this->tmp . '/cache', 0700, true);
        self::resetFolderSizes(null);
    }

    protected function tearDown(): void {
        if ($this->savedPath !== null) {
            putenv($this->savedPath === false ? 'PATH' : 'PATH=' . $this->savedPath);
            $this->savedPath = null;
        }
        self::resetFolderSizes(null);
        self::removeTree($this->tmp);
    }

    protected function root(string $relative = ''): string {
        return $this->tmp . '/root' . ($relative === '' ? '' : '/' . $relative);
    }

    // Writes $content to $path, creating its folders.
    protected function write(string $path, string $content): string {
        if (!is_dir(dirname($path))) {
            mkdir(dirname($path), 0700, true);
        }
        file_put_contents($path, $content);
        return $path;
    }

    protected function setupValues(array $overrides = []): array {
        return $overrides + [
            'ROOT_PATH' => $this->root(), 'ROOT_HREF' => '/',
            'CONF_PATH' => $this->tmp . '/conf',
            'PUBLIC_PATH' => $this->tmp . '/public', 'PUBLIC_HREF' => '/_h5ai/public/',
            'PRIVATE_PATH' => $this->tmp . '/private',
            'CACHE_PRV_PATH' => $this->tmp . '/cache', 'CACHE_PUB_PATH' => $this->tmp . '/cache-pub',
            'CACHE_PUB_HREF' => '/_h5ai/public/cache/', 'FILE_PREFIX' => '_h5ai',
            'HAS_PHP_WEBP' => false, 'HAS_PHP_EXIF' => false, 'HAS_PHP_FILEINFO' => false,
            'HAS_PHP_ZIP' => false, 'HAS_PHP_RAR' => false,
            'HAS_CMD_DU' => false, 'HAS_CMD_MAGICK' => false, 'HAS_CMD_CONVERT' => false, 'HAS_CMD_GM' => false,
            'HAS_CMD_FFMPEG' => false, 'HAS_CMD_FFPROBE' => false,
            'HAS_CMD_AVCONV' => false, 'HAS_CMD_AVPROBE' => false,
        ];
    }

    // A context over $this->root() with the given options and types.
    protected function context(
        array $options = [],
        array $setup = [],
        array $types = [],
        string $class = Context::class,
        ?Session $session = null,
    ): Context {
        file_put_contents($this->tmp . '/conf/options.json', json_encode(
            $options + ['view' => ['hidden' => [], 'unmanaged' => []]],
        ));
        file_put_contents($this->tmp . '/conf/types.json', json_encode((object) $types));
        $store = [];
        return new $class($session ?? new Session($store), new Request([], ''), new TestSetup($this->setupValues($setup)));
    }

    // A cached thumbnail of $source, as Thumb writes it: named after the
    // source path and carrying its mtime. Returns the thumbnail name.
    protected function seedThumbnail(string $source, string $size): string {
        $name = 'thumb-' . sha1($source) . '-' . $size . '.webp';
        $thumb = $this->write($this->tmp . '/cache-pub/thumbs/' . $name, 'webp');
        touch($thumb, filemtime($source));
        return $name;
    }

    // A copy of the application under $tmp/app/_h5ai, so that it can run
    // with its caches out of the checkout: private/ as in the sources (with
    // the version filled in, as the build does) and an empty public/cache.
    // Returns the _h5ai folder.
    protected function copyApplication(array $options): string {
        $app = $this->tmp . '/app/_h5ai';
        mkdir($app . '/public/cache', 0700, true);
        exec('cp -R ' . escapeshellarg(self::sourcePrivate()) . ' ' . escapeshellarg($app . '/private'), $unused, $status);
        self::assertSame(0, $status);
        $version = $app . '/private/php/version.php';
        file_put_contents($version, str_replace('{{VERSION}}', 'test', (string) file_get_contents($version)));
        file_put_contents($app . '/private/conf/options.json', json_encode($options));
        return $app;
    }

    protected static function sourcePrivate(): string {
        return (string) realpath(__DIR__ . '/../../../src/_h5ai/private');
    }

    // Coverage of subprocesses running the copy made by copyApplication().
    protected function applicationCoverage(string $app): SubprocessCoverage {
        return new SubprocessCoverage($this->tmp . '/coverage', [$app . '/private/' => self::sourcePrivate() . '/']);
    }

    // Puts scripts named after $tools first on PATH until the test ends.
    // Each appends its arguments to a log read by toolLog(), then runs $body.
    protected function fakeTools(array $tools): void {
        $bin = $this->tmp . '/bin';
        if (!is_dir($bin)) {
            mkdir($bin);
        }
        foreach ($tools as $tool => $body) {
            $log = escapeshellarg($this->tmp . '/' . $tool . '.log');
            file_put_contents($bin . '/' . $tool, "#!/bin/sh\necho \"\$*\" >> {$log}\n{$body}\n");
            chmod($bin . '/' . $tool, 0700);
        }
        if ($this->savedPath === null) {
            $this->savedPath = getenv('PATH');
            putenv('PATH=' . $bin . ':' . $this->savedPath);
        }
    }

    protected function toolLog(string $tool): string {
        $log = $this->tmp . '/' . $tool . '.log';
        return is_file($log) ? (string) file_get_contents($log) : '';
    }

    protected function toolRuns(string $tool): int {
        return substr_count($this->toolLog($tool), "\n");
    }

    protected function clearToolLogs(): void {
        foreach (glob($this->tmp . '/*.log') ?: [] as $log) {
            unlink($log);
        }
    }

    // Empties the Filesize caches. With a file, the persistent cache starts
    // empty and saves there; with null it reverts to its lazy default.
    protected static function resetFolderSizes(?string $file): void {
        $values = [
            'cache' => [], 'persistent_cache' => $file === null ? null : [],
            'persistent_cache_path' => $file, 'persistent_cache_dirty' => false,
            'dirty_entries' => [], 'stale_paths' => [],
        ];
        foreach ($values as $property => $value) {
            (new ReflectionProperty(Filesize::class, $property))->setValue(null, $value);
        }
    }

    protected static function folderSizeEntries(): array {
        return (new ReflectionProperty(Filesize::class, 'persistent_cache'))->getValue() ?? [];
    }

    protected static function removeTree(string $path): void {
        if (is_dir($path) && !is_link($path)) {
            foreach (scandir($path) as $name) {
                if ($name !== '.' && $name !== '..') {
                    self::removeTree($path . '/' . $name);
                }
            }
            rmdir($path);
        } elseif (file_exists($path) || is_link($path)) {
            unlink($path);
        }
    }

    // Collects everything $run prints, including flushed output.
    protected static function captureOutput(callable $run): array {
        $written = '';
        ob_start(static function (string $chunk) use (&$written): string {
            $written .= $chunk;
            return '';
        });
        // Archive output sets headers; the CLI run has already written output.
        set_error_handler(
            static fn(int $errno, string $message): bool => str_starts_with($message, 'Cannot modify header information'),
            E_WARNING,
        );
        try {
            $result = $run();
        } finally {
            restore_error_handler();
            ob_end_clean();
        }
        return [$result, $written];
    }
}
