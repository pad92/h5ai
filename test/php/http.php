<?php

// Exercise the HTTP transport and inspect archives with an independent reader.
function http_test_check(bool $ok, string $message): void {
    if (!$ok) {
        throw new RuntimeException($message);
    }
}

function http_test_remove_tree(string $path): void {
    if (is_dir($path) && !is_link($path)) {
        foreach (scandir($path) as $name) {
            if ($name !== '.' && $name !== '..') {
                http_test_remove_tree($path . '/' . $name);
            }
        }
        rmdir($path);
    } else {
        unlink($path);
    }
}

function http_test_post(string $url, string $body, string $type): string {
    $result = file_get_contents($url, false, stream_context_create(['http' => [
        'method' => 'POST',
        'header' => 'Content-Type: ' . $type,
        'content' => $body,
        'timeout' => 5,
        'ignore_errors' => true,
    ]]));
    http_test_check($result !== false, 'HTTP request failed');
    foreach ($http_response_header as $header) {
        if (preg_match('/^Content-Length: (\d+)$/i', $header, $match)) {
            http_test_check(strlen($result) === (int) $match[1], 'archive Content-Length must match its bytes');
        }
    }
    return $result;
}

function http_test_extract(string $file, string $directory): void {
    mkdir($directory, 0700);
    $process = proc_open(['tar', '-xf', $file, '-C', $directory], [
        0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w'],
    ], $pipes);
    http_test_check(is_resource($process), 'cannot start tar to verify downloaded archive');
    fclose($pipes[0]);
    $output = stream_get_contents($pipes[1]);
    $error = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    http_test_check(proc_close($process) === 0, 'archive must extract successfully: ' . $output . $error);
}

$httpTestTmp = sys_get_temp_dir() . '/h5ai-http-' . bin2hex(random_bytes(6));
mkdir($httpTestTmp, 0700);
$httpTestRoot = $httpTestTmp . '/root';
mkdir($httpTestRoot . '/_h5ai/private/conf', 0700, true);
mkdir($httpTestRoot . '/_h5ai/public', 0700, true);
file_put_contents($httpTestRoot . '/_h5ai/private/conf/options.json', json_encode([
    'view' => ['hidden' => ['^_h5ai'], 'unmanaged' => []],
    'custom' => ['enabled' => true],
    'download' => ['enabled' => true],
]));
file_put_contents($httpTestTmp . '/outside.txt', 'OUTSIDE_TEST_MARKER');
file_put_contents($httpTestRoot . '/_h5ai/private/internal.txt', 'PRIVATE_TEST_MARKER');
file_put_contents($httpTestRoot . '/inside.txt', 'inside');

$httpTestServer = null;
try {
    $socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
    http_test_check($socket !== false, 'cannot reserve HTTP test port: ' . $error);
    $address = stream_socket_get_name($socket, false);
    fclose($socket);
    $httpTestServer = proc_open(
        [PHP_BINARY, '-S', $address, __DIR__ . '/fixtures/api.php'],
        [0 => ['pipe', 'r'], 1 => ['file', $httpTestTmp . '/server.log', 'a'], 2 => ['file', $httpTestTmp . '/server.log', 'a']],
        $pipes,
        null,
        ['H5AI_TEST_ROOT' => $httpTestRoot],
    );
    http_test_check(is_resource($httpTestServer), 'cannot start HTTP test server');
    fclose($pipes[0]);
    $ready = false;
    for ($attempt = 0; $attempt < 100; $attempt++) {
        $connection = @stream_socket_client('tcp://' . $address, $errno, $error, 0.05);
        if ($connection !== false) {
            fclose($connection);
            $ready = true;
            break;
        }
        usleep(20000);
    }
    http_test_check($ready, 'HTTP test server did not start');
    $url = 'http://' . $address . '/';

    // Custom files are intentionally hidden from listings, but must stay inside the share.
    file_put_contents($httpTestRoot . '/_h5ai/public/internal.txt', 'PUBLIC_TEST_MARKER');
    foreach ([$httpTestTmp . '/outside.txt', $httpTestRoot . '/_h5ai/private/internal.txt', $httpTestRoot . '/_h5ai/public/internal.txt'] as $index => $target) {
        mkdir($httpTestRoot . '/case-' . $index);
        symlink($target, $httpTestRoot . '/case-' . $index . '/_h5ai.header.html');
        $data = json_decode(http_test_post($url, json_encode(['action' => 'get', 'custom' => '/case-' . $index . '/']), 'application/json'), true);
        http_test_check(array_key_exists('custom', $data), 'custom API must return customizations');
        http_test_check($data['custom']['header']['content'] === null, 'custom API must reject external and private symlink targets');
    }
    file_put_contents($httpTestRoot . '/_h5ai.header.html', '<p>safe header</p>');
    $data = json_decode(http_test_post($url, '{"action":"get","custom":"/"}', 'application/json; charset=utf-8'), true);
    http_test_check($data['custom']['header']['content'] === '<p>safe header</p>', 'ordinary hidden custom files must still work');
    mkdir($httpTestRoot . '/child');
    file_put_contents($httpTestRoot . '/_h5ai.footers.md', 'inherited footer');
    symlink($httpTestRoot . '/inside.txt', $httpTestRoot . '/child/_h5ai.header.md');
    $data = json_decode(http_test_post($url, '{"action":"get","custom":"/child/"}', 'application/json'), true);
    http_test_check($data['custom']['header']['content'] === 'inside', 'custom symlinks inside the share must still work');
    http_test_check($data['custom']['footer']['content'] === 'inherited footer', 'custom content must inherit from the root');

    $download = ['action' => 'download', 'as' => 'package.tar', 'type' => 'php-tar', 'baseHref' => '/', 'hrefs' => ['/inside.txt']];
    $body = http_test_post($url, http_build_query($download), 'application/x-www-form-urlencoded');
    http_test_check(substr($body, 257, 5) === 'ustar', 'browser form download must return a TAR archive: ' . substr($body, 0, 200));
    file_put_contents($httpTestTmp . '/selected.tar', $body);
    http_test_extract($httpTestTmp . '/selected.tar', $httpTestTmp . '/selected');
    http_test_check(file_get_contents($httpTestTmp . '/selected/inside.txt') === 'inside', 'selected download must preserve file content');
    http_test_check(count(scandir($httpTestTmp . '/selected')) === 3, 'selected download must contain only the selected file');

    $jsonBody = http_test_post($url, json_encode($download), 'application/json');
    http_test_check($jsonBody === $body, 'JSON and form downloads must return the same archive');
    $invalidDownload = $download;
    $invalidDownload['hrefs'] = [['nested' => 'invalid']];
    $data = json_decode(http_test_post($url, json_encode($invalidDownload), 'application/json'), true);
    http_test_check(($data['err'] ?? null) === 'ERR_ILLIGAL_PARAM', 'download selections must reject non-string entries');

    foreach (['[]', 'null', '{broken'] as $invalid) {
        $data = json_decode(http_test_post($url, $invalid, 'application/json'), true);
        http_test_check(($data['err'] ?? null) === 'ERR_ILLIGAL_PARAM', 'JSON bodies must be valid objects');
    }

    // Valid filesystem names that used to collide after silent truncation.
    $names = ['A' . str_repeat('x', 99), 'B' . str_repeat('x', 99), str_repeat('long', 40), str_repeat('é', 80), 'a & b.txt'];
    $longDirectory = str_repeat('d', 160);
    mkdir($httpTestRoot . '/' . $longDirectory);
    $names[] = $longDirectory . '/nested.txt';
    foreach ($names as $index => $name) {
        file_put_contents($httpTestRoot . '/' . $name, 'content-' . $index);
    }
    $download['hrefs'] = array_map(static fn(string $name): string => '/' . implode('/', array_map(rawurlencode(...), explode('/', $name))), $names);
    $body = http_test_post($url, http_build_query($download), 'application/x-www-form-urlencoded');
    file_put_contents($httpTestTmp . '/long.tar', $body);
    http_test_extract($httpTestTmp . '/long.tar', $httpTestTmp . '/long');
    foreach ($names as $index => $name) {
        http_test_check(is_file($httpTestTmp . '/long/' . $name), 'archive must preserve the complete name: ' . $name);
        http_test_check(file_get_contents($httpTestTmp . '/long/' . $name) === 'content-' . $index, 'archive must preserve distinct file contents');
    }
    $download['hrefs'] = '';
    $body = http_test_post($url, http_build_query($download), 'application/x-www-form-urlencoded');
    file_put_contents($httpTestTmp . '/whole.tar', $body);
    http_test_extract($httpTestTmp . '/whole.tar', $httpTestTmp . '/whole');
    http_test_check(file_get_contents($httpTestTmp . '/whole/inside.txt') === 'inside', 'empty selection must download the whole folder');
    http_test_check(!file_exists($httpTestTmp . '/whole/_h5ai'), 'whole-folder archive must exclude h5ai internals');
    http_test_check(!file_exists($httpTestTmp . '/whole/_h5ai.header.html'), 'whole-folder archive must exclude hidden custom files');
} catch (Throwable $exception) {
    if (is_file($httpTestTmp . '/server.log')) {
        fwrite(STDERR, file_get_contents($httpTestTmp . '/server.log'));
    }
    throw $exception;
} finally {
    if (is_resource($httpTestServer)) {
        proc_terminate($httpTestServer);
        proc_close($httpTestServer);
    }
    http_test_remove_tree($httpTestTmp);
}

echo "HTTP and archive regression tests passed\n";
