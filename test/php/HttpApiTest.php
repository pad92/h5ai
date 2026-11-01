<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;

// The API behind a real HTTP server (php -S with fixtures/api.php), with
// downloaded archives checked by an independent reader (tar).
final class HttpApiTest extends H5aiTestCase {
    private ?PhpServer $server = null;
    private string $url;
    private array $lastHeaders = [];

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

        // $tmp/bin comes first on PATH so tests can replace tar.
        $this->server = new PhpServer(
            __DIR__ . '/fixtures/api.php',
            ['H5AI_TEST_ROOT' => $this->root(), 'PATH' => $this->tmp . '/bin:' . getenv('PATH')],
            $this->tmp . '/server.log',
            new SubprocessCoverage($this->tmp . '/coverage'),
        );
        $this->url = $this->server->url;
    }

    protected function tearDown(): void {
        $this->server?->stop();
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
        $headers = $this->lastHeaders = http_get_last_response_headers() ?? [];
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

    // The first request of the client page: without its answer nothing is
    // displayed.
    public function testTheInitialGetAnswersOptionsTypesAndLangs(): void {
        $response = $this->postJson(['action' => 'get', 'options' => true, 'types' => true, 'langs' => true]);
        self::assertSame(['view', 'custom', 'download', 'hasCustomPasshash'], array_keys($response['options'] ?? []));
        self::assertIsArray($response['types'] ?? null);
        self::assertIsArray($response['langs'] ?? null);
    }

    private const DOWNLOAD =['action' => 'download', 'as' => 'package.tar', 'type' => 'php-tar', 'baseHref' => '/', 'hrefs' => ''];

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
        self::assertStringContainsString(Util::ERR_ILLEGAL_PARAM, $form);
        self::assertSame(Util::ERR_ILLEGAL_PARAM, $this->postJson(['hrefs' => [['nested' => 'invalid']]] + self::DOWNLOAD)['err'] ?? null);
    }

    public function testInvalidJsonBodiesAreRejected(): void {
        foreach (['[]', 'null', '{broken'] as $invalid) {
            self::assertSame(Util::ERR_ILLEGAL_PARAM, $this->postJson($invalid)['err'] ?? null, "body {$invalid} must be rejected");
        }
        $response = $this->post('{"action":', 'application/json', '?action=download');
        self::assertStringContainsString(Util::ERR_ILLEGAL_PARAM, $response, 'malformed JSON must not fall back to query parameters');
    }

    private function sentAttachment(): bool {
        return array_any($this->lastHeaders, static fn(string $header): bool => stripos($header, 'Content-Disposition: attachment') === 0);
    }

    private function shellTarDownload(): string {
        return $this->post(http_build_query(['type' => 'shell-tar', 'hrefs' => '/inside.txt'] + self::DOWNLOAD), 'application/x-www-form-urlencoded');
    }

    public function testAnEmptyOrInvalidSelectionIsAnErrorNotAnAttachment(): void {
        $response = $this->post(http_build_query(['hrefs' => '/missing.txt'] + self::DOWNLOAD), 'application/x-www-form-urlencoded');
        self::assertSame(Util::ERR_FAILED, json_decode($response, true)['err'] ?? null);
        self::assertFalse($this->sentAttachment(), 'an error must not be offered as a download');
    }

    public function testAnArchiverFailingBeforeOutputIsAnError(): void {
        $this->fakeTools(['tar' => 'exit 2']);
        self::assertSame(Util::ERR_FAILED, json_decode($this->shellTarDownload(), true)['err'] ?? null);
        self::assertFalse($this->sentAttachment());
    }

    // Once the archiver has written anything, its first flush() has sent the
    // headers: the download has started for the client, whatever the size.
    public function testAnArchiverFailingAfterWritingIsNotAppendedTo(): void {
        foreach ([100, 10000] as $written) {
            $this->fakeTools(['tar' => "head -c {$written} /dev/zero\nexit 2"]);
            $response = $this->shellTarDownload();
            self::assertTrue($this->sentAttachment(), "{$written} bytes: the download had started");
            self::assertSame(str_repeat("\0", $written), $response, "{$written} bytes: no error may be appended");
        }
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

    // Rewrites options.json; every request reads it again.
    private function writeOptions(array $options): void {
        $this->write($this->root('_h5ai/private/conf/options.json'), json_encode(
            $options + ['view' => ['hidden' => ['^_h5ai'], 'unmanaged' => []]],
        ));
    }

    // Setup values beyond the fixture's, read by every request.
    private function writeSetup(array $overrides): void {
        $this->write($this->root('_h5ai/private/conf/test-setup.json'), json_encode($overrides + $this->setupValues([
            'ROOT_PATH' => $this->root(), 'CONF_PATH' => $this->root('_h5ai/private/conf'),
            'PUBLIC_PATH' => $this->root('_h5ai/public'), 'PRIVATE_PATH' => $this->root('_h5ai/private'),
            'CACHE_PRV_PATH' => $this->tmp . '/cache', 'VERSION' => 'test',
        ])));
    }

    public function testAnUnknownActionIsUnsupported(): void {
        self::assertSame(Util::ERR_UNSUPPORTED, $this->postJson(['action' => 'nope'])['err'] ?? null);
    }

    public function testAWrongPasswordLeavesTheVisitorAnonymous(): void {
        self::assertSame(['asAdmin' => false], $this->postJson(['action' => 'login', 'pass' => 'wrong']));
        self::assertSame(['asAdmin' => false], $this->postJson(['action' => 'logout']));
    }

    public function testOneGetAnswersEveryRequestedPart(): void {
        $this->writeOptions([
            'custom' => ['enabled' => true], 'l10n' => ['enabled' => true], 'search' => ['enabled' => true],
            'tasks' => ['enabled' => true], 'thumbnails' => ['enabled' => true],
        ]);
        $this->writeSetup(['HAS_PHP_WEBP' => true]);
        $this->write($this->root('_h5ai/private/conf/l10n/fr.json'), '{"lang": "français"}');
        $data = $this->postJson([
            'action' => 'get', 'setup' => true, 'theme' => true, 'tasks' => true,
            'items' => ['href' => '/', 'what' => 1], 'custom' => '/', 'l10n' => ['fr', 7],
            'search' => ['href' => '/', 'pattern' => 'first', 'ignorecase' => true],
            'thumbs' => [['type' => 'file', 'href' => '/first.txt']],
        ]);
        self::assertSame(['AS_ADMIN' => false, 'PUBLIC_HREF' => '/_h5ai/public/', 'ROOT_HREF' => '/', 'VERSION' => 'test'], $data['setup']);
        self::assertSame([], $data['theme']);
        self::assertSame([], $data['tasks']);
        self::assertContains('/first.txt', array_column($data['items'], 'href'));
        self::assertSame(['fr' => ['lang' => 'français', 'isoCode' => 'fr']], $data['l10n'], 'non-string language codes are dropped');
        self::assertSame(['/first.txt'], array_column($data['search'], 'href'));
        self::assertSame([null], $data['thumbs']);
    }

    public static function disabledParts(): array {
        return [
            'tasks' => [['tasks' => true]],
            'custom' => [['custom' => '/']],
            'l10n' => [['l10n' => ['en']]],
            'search' => [['search' => ['href' => '/', 'pattern' => 'x']]],
            'thumbs' => [['thumbs' => [['type' => 'file', 'href' => '/first.txt']]]],
        ];
    }

    #[DataProvider('disabledParts')]
    public function testADisabledPartIsRefused(array $part): void {
        $this->writeOptions([]);
        self::assertSame(Util::ERR_DISABLED, $this->postJson(['action' => 'get'] + $part)['err'] ?? null);
    }

    public function testMetricsAreRefusedOutsideAnAdminSession(): void {
        $answer = $this->postJson(['action' => 'get', 'metrics' => true]);
        self::assertSame(Util::ERR_DISABLED, $answer['err'] ?? null);
        self::assertArrayNotHasKey('metrics', $answer);
    }

    public function testPurgeIsRefusedOutsideAnAdminSession(): void {
        $entry = ['size' => 1, 'mtime' => 1, 'cached_at' => time(), 'children' => []];
        $this->writeSetup([]);
        $sizes = $this->write($this->tmp . '/cache/foldersizes.json', json_encode(['/a' => $entry]));
        $answer = $this->postJson(['action' => 'purge', 'cache' => 'folderSizes']);
        self::assertSame(Util::ERR_DISABLED, $answer['err'] ?? null);
        self::assertStringContainsString('/a', (string) file_get_contents($sizes), 'nothing was purged');
    }

    public function testAnAdminPurgesOneKnownCacheWhenNoTaskRuns(): void {
        $entry = ['size' => 1, 'mtime' => 1, 'cached_at' => time(), 'children' => []];
        $this->writeSetup(['TEST_SESSION' => ['__H5AI__AS_ADMIN' => true]]);
        $sizes = $this->write($this->tmp . '/cache/foldersizes.json', json_encode(['/a' => $entry, '/b' => $entry]));

        self::assertSame(Util::ERR_ILLEGAL_PARAM, $this->postJson(['action' => 'purge', 'cache' => 'conf'])['err'] ?? null);

        $lock = fopen($this->tmp . '/cache/refresh.lock', 'c+');
        flock($lock, LOCK_EX);
        $this->write($this->tmp . '/cache/task-refresh.json', json_encode(['phase' => 'sizes', 'done' => 0, 'total' => null, 'started' => time(), 'phaseStarted' => time()]));
        $busy = $this->postJson(['action' => 'purge', 'cache' => 'folderSizes']);
        self::assertSame(Util::ERR_FAILED, $busy['err'] ?? null);
        self::assertStringContainsString('refresh', $busy['msg'] ?? '');
        fclose($lock);

        self::assertSame(['purged' => 'folderSizes', 'removed' => ['entries' => 2]], $this->postJson(['action' => 'purge', 'cache' => 'folderSizes']));
        self::assertFileDoesNotExist($sizes);
    }

    public function testTaskActionsNeedAnAdminAndAKnownTask(): void {
        foreach (['start', 'stop'] as $action) {
            self::assertSame(Util::ERR_DISABLED, $this->postJson(['action' => $action, 'task' => 'warmer'])['err'] ?? null);
        }
        $this->writeSetup(['TEST_SESSION' => ['__H5AI__AS_ADMIN' => true]]);
        foreach (['start', 'stop'] as $action) {
            self::assertSame(Util::ERR_ILLEGAL_PARAM, $this->postJson(['action' => $action, 'task' => 'rm'])['err'] ?? null);
        }
        $stop = $this->postJson(['action' => 'stop', 'task' => 'warmer']);
        self::assertSame(Util::ERR_FAILED, $stop['err'] ?? null);
        self::assertStringContainsString('not running', $stop['msg'] ?? '');
    }

    public function testARunningTaskIsStoppedNotStartedAgain(): void {
        $this->writeSetup(['TEST_SESSION' => ['__H5AI__AS_ADMIN' => true]]);
        $lock = fopen($this->tmp . '/cache/refresh.lock', 'c+');
        flock($lock, LOCK_EX);
        $this->write($this->tmp . '/cache/task-refresh.json', json_encode(['phase' => 'sizes', 'done' => 0, 'total' => null, 'started' => time(), 'phaseStarted' => time()]));

        $start = $this->postJson(['action' => 'start', 'task' => 'refresh']);
        self::assertSame(Util::ERR_FAILED, $start['err'] ?? null);
        self::assertStringContainsString('already running', $start['msg'] ?? '');
        self::assertSame(['stopping' => 'refresh'], $this->postJson(['action' => 'stop', 'task' => 'refresh']));
        self::assertFileExists($this->tmp . '/cache/task-refresh.stop');
        fclose($lock);
    }

    public function testRefreshCannotStartWithoutFolderSizes(): void {
        $this->writeSetup(['TEST_SESSION' => ['__H5AI__AS_ADMIN' => true]]);
        self::assertSame(Util::ERR_DISABLED, $this->postJson(['action' => 'start', 'task' => 'refresh'])['err'] ?? null);
    }

    public function testThumbnailsNeedWebpAndABoundedBatch(): void {
        $this->writeOptions(['thumbnails' => ['enabled' => true, 'maxBatchSize' => 1]]);
        $thumbs = ['action' => 'get', 'thumbs' => [['type' => 'file', 'href' => '/first.txt'], ['type' => 'file', 'href' => '/second.txt']]];
        self::assertSame(Util::ERR_UNSUPPORTED, $this->postJson($thumbs)['err'] ?? null);
        $this->writeSetup(['HAS_PHP_WEBP' => true]);
        self::assertSame(Util::ERR_ILLEGAL_PARAM, $this->postJson($thumbs)['err'] ?? null);
    }

    public function testParametersOfTheWrongKindAreRejected(): void {
        self::assertStringContainsString(Util::ERR_ILLEGAL_PARAM, $this->post('action=get', 'text/plain'));
        self::assertSame(Util::ERR_ILLEGAL_PARAM, $this->postJson(['action' => 'get', 'items' => ['href' => '/', 'what' => 'all']])['err'] ?? null);
    }
}
