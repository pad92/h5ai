<?php

// Router for `php -S` in BootstrapTest: hands every request to the
// public/index.php of the application copy in H5AI_TEST_APP, as a web
// server configured for h5ai does.

$app = getenv('H5AI_TEST_APP');
$_SERVER['SCRIPT_NAME'] = '/_h5ai/public/index.php';
$_SERVER['SCRIPT_FILENAME'] = $app . '/public/index.php';
require $app . '/public/index.php';
