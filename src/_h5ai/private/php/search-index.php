<?php

if (php_sapi_name() !== 'cli') {
    exit("This script can only be run from the command line.\n");
}

require_once __DIR__ . '/class-bootstrap.php';
$context = Bootstrap::cli_context();
// Removed whatever happens, so the next stale search can request again.
$request_marker = $context->get_setup()->get('CACHE_PRV_PATH') . '/search-index.requested';
register_shutdown_function(static fn() => @unlink($request_marker));

// Search::refresh_index() takes its own lock and returns at once when
// another refresh, such as the cache warmer's, is running.
(new Search($context))->refresh_index();
