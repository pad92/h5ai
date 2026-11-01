<?php

declare(strict_types=1);

// PHPUnit bootstrap: loads the h5ai classes and the shared test doubles.

define('H5AI_VERSION', 'test');
define('MIN_PHP_VERSION', '8.4.0');

require_once __DIR__ . '/../../src/_h5ai/private/php/class-bootstrap.php';
spl_autoload_register(Bootstrap::autoload(...));
// Classes declared next to another one, out of the autoloader's reach.
require_once __DIR__ . '/../../src/_h5ai/private/php/ext/class-thumb.php';
require_once __DIR__ . '/../../src/_h5ai/private/php/core/class-json.php';

require_once __DIR__ . '/support/TestSetup.php';
require_once __DIR__ . '/support/ListingTestContext.php';
require_once __DIR__ . '/support/H5aiTestCase.php';
require_once __DIR__ . '/support/SubprocessCoverage.php';
require_once __DIR__ . '/support/PhpServer.php';
