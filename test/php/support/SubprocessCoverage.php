<?php

declare(strict_types=1);

// Line coverage of PHP subprocesses, such as the `php -S` server of
// HttpApiTest. While PHPUnit measures coverage, a subprocess started with
// php_arguments() and env() loads coverage-prepend.php, which dumps the
// Xdebug data of each request into a folder; collect() adds that data to
// the running test. It relies on internal classes of the PHPUnit phar that
// the Makefile pins: outside a coverage run, all of this does nothing.
final class SubprocessCoverage {
    private const RAW_DATA_CLASSES = [
        'PHPUnitPHAR\\SebastianBergmann\\CodeCoverage\\Data\\RawCodeCoverageData',
        'SebastianBergmann\\CodeCoverage\\Data\\RawCodeCoverageData',
    ];

    public function __construct(private readonly string $dir) {}

    public static function is_active(): bool {
        return function_exists('xdebug_get_code_coverage')
            && class_exists(\PHPUnit\Runner\CodeCoverage::class)
            && \PHPUnit\Runner\CodeCoverage::instance()->isActive();
    }

    // Arguments for the PHP binary of the subprocess.
    public function php_arguments(): array {
        if (!self::is_active()) {
            return [];
        }
        if (!is_dir($this->dir)) {
            mkdir($this->dir, 0700, true);
        }
        return ['-d', 'auto_prepend_file=' . __DIR__ . '/coverage-prepend.php', '-d', 'xdebug.mode=coverage'];
    }

    // Environment entries for the subprocess.
    public function env(): array {
        return self::is_active() ? ['H5AI_COVERAGE_DIR' => $this->dir] : [];
    }

    // Adds the dumped coverage to the running test. Call it once the
    // subprocess has ended.
    public function collect(): void {
        if (!self::is_active() || !is_dir($this->dir)) {
            return;
        }
        $raw_data_class = array_find(self::RAW_DATA_CLASSES, class_exists(...));
        if ($raw_data_class === null) {
            return;
        }
        $coverage = \PHPUnit\Runner\CodeCoverage::instance()->codeCoverage();
        foreach (glob($this->dir . '/*.cov') ?: [] as $file) {
            $data = unserialize((string) file_get_contents($file), ['allowed_classes' => false]);
            if (is_array($data)) {
                $coverage->append($raw_data_class::fromXdebugWithoutPathCoverage($data));
            }
        }
    }
}
