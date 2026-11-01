<?php

declare(strict_types=1);

// Bootstrap::run() behind a web server: API requests, the info page and
// listings, through public/index.php. The real pages are compiled from Pug
// by the build; minimal ones print what Bootstrap hands them.
final class BootstrapTest extends H5aiTestCase {
    private PhpServer $server;

    protected function setUp(): void {
        parent::setUp();
        $this->write($this->root('listed.txt'), 'x');
        $app = $this->copyApplication(['view' => ['hidden' => [], 'unmanaged' => []]]);
        copy(__DIR__ . '/../../src/_h5ai/public/index.php', $app . '/public/index.php');
        file_put_contents(
            $app . '/private/php/pages/index.php',
            '<?php echo "INDEX|", $fallback_mode ? "fallback" : "js", "|", $public_href, "|", $x_head_tags, "|", $fallback_html;',
        );
        file_put_contents($app . '/private/php/pages/info.php', '<?php echo "INFO|", $public_href;');
        $this->server = new PhpServer(
            __DIR__ . '/fixtures/app-router.php',
            ['H5AI_TEST_APP' => $app, 'H5AI_ROOT_PATH' => $this->root(), 'PATH' => (string) getenv('PATH')],
            $this->tmp . '/server.log',
            $this->applicationCoverage($app),
        );
    }

    protected function tearDown(): void {
        $this->server->stop();
        parent::tearDown();
    }

    private function get(string $path, string $agent = 'Mozilla/5.0'): string {
        $body = file_get_contents($this->server->url . ltrim($path, '/'), false, stream_context_create(['http' => [
            'header' => 'User-Agent: ' . $agent, 'timeout' => 10, 'ignore_errors' => true,
        ]]));
        self::assertIsString($body, (string) @file_get_contents($this->tmp . '/server.log'));
        return $body;
    }

    public function testABrowserGetsTheJavaScriptPage(): void {
        $page = $this->get('/');
        self::assertStringStartsWith('INDEX|js|/_h5ai/public/|<style class="x-head"></style>|<table>', $page);
    }

    public function testATextBrowserGetsTheFallbackListing(): void {
        $page = $this->get('/', 'curl/8.0');
        self::assertStringStartsWith('INDEX|fallback|', $page);
        self::assertStringContainsString('<a href="/listed.txt">listed.txt</a>', $page);
    }

    public function testThePublicFolderServesTheInfoPage(): void {
        self::assertSame('INFO|/_h5ai/public/', $this->get('/_h5ai/public/'));
    }

    public function testAPostIsAnApiRequest(): void {
        $answer = file_get_contents($this->server->url, false, stream_context_create(['http' => [
            'method' => 'POST', 'header' => 'Content-Type: application/json',
            'content' => '{"action":"get","setup":true}', 'timeout' => 10,
        ]]));
        self::assertSame(['AS_ADMIN' => false, 'PUBLIC_HREF' => '/_h5ai/public/', 'ROOT_HREF' => '/', 'VERSION' => 'test'], json_decode((string) $answer, true)['setup'] ?? null);
    }
}
