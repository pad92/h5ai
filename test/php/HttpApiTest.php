<?php

declare(strict_types=1);

// The API behind a real HTTP server (php -S with fixtures/api.php), with
// downloaded archives checked by an independent reader (tar).
final class HttpApiTest extends H5aiTestCase {
    private $server = null;
    private string $url;

    protected function setUp(): void {
        parent::setUp();
        $this->write($this->root('_h5ai/private/conf/options.json'), json_encode([
            'view' => ['hidden' => ['^_h5ai'], 'unmanaged' => []],
            'custom' => ['enabled' => true],
            'download' => ['enabled' => true],
        ]));
        mkdir($this->root('_h5ai/public'), 0700, true);
        $this->write($this->tmp . '/outside.txt', 'OUTSIDE_TEST_MARKER');
        $this->write($this->root('_h5ai/private/internal.txt'), 'PRIVATE_TEST_MARKER');
        $this->write($this->root('_h5ai/public/internal.txt'), 'PUBLIC_TEST_MARKER');
        $this->write($this->root('inside.txt'), 'inside');
        $this->write($this->root('first.txt'), 'first');
        $this->write($this->root('second.txt'), 'second');

        $socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        self::assertNotFalse($socket, 'cannot reserve an HTTP test port: ' . $error);
        $address = stream_socket_get_name($socket, false);
        fclose($socket);
        $log = $this->tmp . '/server.log';
        $this->server = proc_open(
            [PHP_BINARY, '-S', $address, __DIR__ . '/fixtures/api.php'],
            [0 => ['pipe', 'r'], 1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']],
            $pipes,
            null,
            ['H5AI_TEST_ROOT' => $this->root()],
        );
        self::assertIsResource($this->server, 'cannot start the HTTP test server');
        fclose($pipes[0]);
        for ($attempt = 0; $attempt < 100; $attempt++) {
            $connection = @stream_socket_client('tcp://' . $address, $errno, $error, 0.05);
            if ($connection !== false) {
                fclose($connection);
                $this->url = 'http://' . $address . '/';
                return;
            }
            usleep(20000);
        }
        self::fail('the HTTP test server did not start: ' . @file_get_contents($log));
    }

    protected function tearDown(): void {
        if (is_resource($this->server)) {
            proc_terminate($this->server);
            proc_close($this->server);
        }
        parent::tearDown();
    }

    private function post(string $body, string $type, string $query = ''): string {
        $result = file_get_contents($this->url . $query, false, stream_context_create(['http' => [
            'method' => 'POST',
            'header' => 'Content-Type: ' . $type,
            'content' => $body,
            'timeout' => 5,
            'ignore_errors' => true,
        ]]));
        self::assertIsString($result, 'HTTP request failed');
        $headers = http_get_last_response_headers() ?? [];
        self::assertStringStartsWith('HTTP/1.1 200', $headers[0] ?? '');
        foreach ($headers as $header) {
            if (preg_match('/^Content-Length: (\d+)$/i', $header, $match)) {
                self::assertSame((int) $match[1], strlen($result), 'Content-Length must match the body');
            }
        }
        return $result;
    }

    private function postJson(array|string $data): array {
        $body = is_string($data) ? $data : json_encode($data);
        return json_decode($this->post($body, 'application/json'), true) ?? [];
    }

    // Extracts $tar with the system tar and returns the extraction folder.
    private function extract(string $tar, string $name): string {
        $file = $this->tmp . '/' . $name . '.tar';
        file_put_contents($file, $tar);
        $directory = $this->tmp . '/' . $name;
        mkdir($directory);
        exec('tar -xf ' . escapeshellarg($file) . ' -C ' . escapeshellarg($directory) . ' 2>&1', $output, $status);
        self::assertSame(0, $status, 'archive must extract: ' . implode("\n", $output));
        return $directory;
    }

    private const DOWNLOAD = ['action' => 'download', 'as' => 'package.tar', 'type' => 'php-tar', 'baseHref' => '/', 'hrefs' => ''];

    public function testUrlEncodedFormDownloadsIncludeEverySelectedFile(): void {
        $body = http_build_query(self::DOWNLOAD);
        foreach (['/first.txt', '/second.txt'] as $index => $href) {
            $body .= '&' . http_build_query(["hrefs[{$index}]" => $href]);
        }
        $files = $this->extract($this->post($body, 'application/x-www-form-urlencoded'), 'form');
        self::assertSame('first', file_get_contents($files . '/first.txt'));
        self::assertSame('second', file_get_contents($files . '/second.txt'));
    }

    public function testMultipartFormDownloadsIncludeEverySelectedFile(): void {
        $fields = self::DOWNLOAD + ['hrefs[0]' => '/first.txt', 'hrefs[1]' => '/second.txt'];
        $body = '';
        foreach ($fields as $name => $value) {
            $body .= "--h5ai-test-boundary\r\nContent-Disposition: form-data; name=\"{$name}\"\r\n\r\n{$value}\r\n";
        }
        $body .= "--h5ai-test-boundary--\r\n";
        $files = $this->extract($this->post($body, 'multipart/form-data; boundary=h5ai-test-boundary'), 'multipart');
        self::assertFileExists($files . '/first.txt');
        self::assertFileExists($files . '/second.txt');
    }

    public function testAStringSelectionDownloadsOnlyThatFile(): void {
        $download = ['hrefs' => '/inside.txt'] + self::DOWNLOAD;
        $form = $this->post(http_build_query($download), 'application/x-www-form-urlencoded');
        self::assertSame('ustar', substr($form, 257, 5), 'a form download must return a TAR archive');
        $files = $this->extract($form, 'selected');
        self::assertSame('inside', file_get_contents($files . '/inside.txt'));
        self::assertCount(3, scandir($files), 'only the selected file must be archived');
        self::assertSame($form, $this->post(json_encode($download), 'application/json'), 'JSON and form downloads must return the same archive');
    }

    public function testSelectionsWithNonStringEntriesAreRejected(): void {
        $form = $this->post(
            'action=download&as=bad.tar&type=php-tar&baseHref=%2F&hrefs%5B0%5D=%2Ffirst.txt&hrefs%5B1%5D%5Bx%5D=invalid',
            'application/x-www-form-urlencoded',
        );
        self::assertStringContainsString(Util::ERR_ILLIGAL_PARAM, $form);
        self::assertSame(Util::ERR_ILLIGAL_PARAM, $this->postJson(['hrefs' => [['nested' => 'invalid']]] + self::DOWNLOAD)['err'] ?? null);
    }

    public function testInvalidJsonBodiesAreRejected(): void {
        foreach (['[]', 'null', '{broken'] as $invalid) {
            self::assertSame(Util::ERR_ILLIGAL_PARAM, $this->postJson($invalid)['err'] ?? null, "body {$invalid} must be rejected");
        }
        $response = $this->post('{"action":', 'application/json', '?action=download');
        self::assertStringContainsString(Util::ERR_ILLIGAL_PARAM, $response, 'malformed JSON must not fall back to query parameters');
    }

    public function testArchivesKeepLongAndNonAsciiNames(): void {
        // Valid names that used to collide after silent truncation.
        $names = ['A' . str_repeat('x', 99), 'B' . str_repeat('x', 99), str_repeat('long', 40), str_repeat('é', 80), 'a & b.txt'];
        $names[] = str_repeat('d', 160) . '/nested.txt';
        foreach ($names as $index => $name) {
            $this->write($this->root($name), 'content-' . $index);
        }
        $hrefs = array_map(static fn(string $name): string => '/' . implode('/', array_map(rawurlencode(...), explode('/', $name))), $names);
        $files = $this->extract($this->post(http_build_query(['hrefs' => $hrefs] + self::DOWNLOAD), 'application/x-www-form-urlencoded'), 'long');
        foreach ($names as $index => $name) {
            self::assertSame('content-' . $index, @file_get_contents($files . '/' . $name), 'archive must keep the complete name: ' . $name);
        }
    }

    public function testAnEmptySelectionDownloadsTheVisibleFolder(): void {
        $this->write($this->root('_h5ai.header.html'), '<p>header</p>');
        $files = $this->extract($this->post(http_build_query(self::DOWNLOAD), 'application/x-www-form-urlencoded'), 'whole');
        self::assertSame('inside', file_get_contents($files . '/inside.txt'));
        self::assertFileDoesNotExist($files . '/_h5ai', 'h5ai internals must be excluded');
        self::assertFileDoesNotExist($files . '/_h5ai.header.html', 'hidden custom files must be excluded');
    }

    // Custom files are hidden from listings but must stay inside the share.
    public function testCustomFilesRejectSymlinksOutsideTheShare(): void {
        $targets = [$this->tmp . '/outside.txt', $this->root('_h5ai/private/internal.txt'), $this->root('_h5ai/public/internal.txt')];
        foreach ($targets as $index => $target) {
            mkdir($this->root('case-' . $index));
            symlink($target, $this->root('case-' . $index . '/_h5ai.header.html'));
            $data = $this->postJson(['action' => 'get', 'custom' => '/case-' . $index . '/']);
            self::assertArrayHasKey('custom', $data);
            self::assertNull($data['custom']['header']['content'], 'symlink to ' . $target . ' must be rejected');
        }
    }

    public function testCustomFilesInsideTheShareAreServedAndInherited(): void {
        $this->write($this->root('_h5ai.header.html'), '<p>safe header</p>');
        self::assertSame('<p>safe header</p>', $this->postJson(['action' => 'get', 'custom' => '/'])['custom']['header']['content']);

        mkdir($this->root('child'));
        $this->write($this->root('_h5ai.footers.md'), 'inherited footer');
        symlink($this->root('inside.txt'), $this->root('child/_h5ai.header.md'));
        $data = $this->postJson(['action' => 'get', 'custom' => '/child/']);
        self::assertSame('inside', $data['custom']['header']['content'], 'symlinks inside the share must work');
        self::assertSame('inherited footer', $data['custom']['footer']['content'], 'custom content must inherit from parents');
    }
}
