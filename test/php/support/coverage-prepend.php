<?php

// auto_prepend_file of the subprocesses started by SubprocessCoverage: dumps
// the line coverage of this request into H5AI_COVERAGE_DIR at shutdown.

$h5ai_coverage_dir = getenv('H5AI_COVERAGE_DIR');
if (is_string($h5ai_coverage_dir) && $h5ai_coverage_dir !== '' && function_exists('xdebug_start_code_coverage')) {
    xdebug_start_code_coverage(XDEBUG_CC_UNUSED | XDEBUG_CC_DEAD_CODE);
    register_shutdown_function(static function () use ($h5ai_coverage_dir): void {
        $file = $h5ai_coverage_dir . '/' . getmypid() . '-' . bin2hex(random_bytes(6)) . '.cov';
        file_put_contents($file, serialize(xdebug_get_code_coverage()));
    });
}
unset($h5ai_coverage_dir);
