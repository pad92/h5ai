<?php

define('H5AI_VERSION', '{{VERSION}}');
define('MIN_PHP_VERSION', '8.4.0');
define('TESTED_PHP_VERSION', '8.4.0');

if (!function_exists('version_compare') || version_compare(PHP_VERSION, MIN_PHP_VERSION, '<')) {
    header('Content-type: text/plain;charset=utf-8');
    exit('[ERR] h5ai was tested with PHP '. TESTED_PHP_VERSION . ' and requires at least PHP ' . MIN_PHP_VERSION . ' or later, but found PHP ' . PHP_VERSION);
}

if (str_starts_with(H5AI_VERSION, '{')) {
    header('Content-type: text/plain;charset=utf-8');
    exit('[ERR] h5ai sources must be preprocessed to work correctly');
}

require_once __DIR__ . '/../private/php/class-bootstrap.php';
Bootstrap::run();
