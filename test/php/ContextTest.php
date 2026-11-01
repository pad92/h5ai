<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\RequiresPhpExtension;

// Request kinds, HTML head extras, languages and thumbnail batches.
final class ContextTest extends H5aiTestCase {
    public function testTheRequestKindComesFromMethodPathAndAgent(): void {
        $context = $this->context([], [
            'REQUEST_METHOD' => 'POST', 'REQUEST_HREF' => '/_h5ai/public', 'HTTP_USER_AGENT' => 'Lynx/2.9',
        ]);
        self::assertTrue($context->is_api_request());
        self::assertTrue($context->is_info_request());
        self::assertTrue($context->is_text_browser());
        self::assertTrue($context->is_fallback_mode());

        $browser = $this->context(['view' => ['hidden' => [], 'unmanaged' => [], 'fallbackMode' => false]], [
            'REQUEST_METHOD' => 'GET', 'REQUEST_HREF' => '/photos/', 'HTTP_USER_AGENT' => 'Mozilla/5.0',
        ]);
        self::assertFalse($browser->is_api_request());
        self::assertFalse($browser->is_info_request());
        self::assertFalse($browser->is_fallback_mode());
    }

    public function testExtraHeadResourcesAndFontsAreEscaped(): void {
        $context = $this->context([
            'resources' => ['styles' => ['theme.css', 'https://cdn.example.org/a.css'], 'scripts' => ['/abs.js']],
            'view' => ['hidden' => [], 'unmanaged' => [], 'fonts' => ['Ubuntu', 'Say "hi"'], 'fontsMono' => ['Mono\\Font']],
        ]);
        self::assertSame(
            '<link rel="stylesheet" href="/_h5ai/public/ext/theme.css" class="x-head">'
            . '<link rel="stylesheet" href="https://cdn.example.org/a.css" class="x-head">'
            . '<script src="/abs.js" class="x-head"></script>'
            . '<style class="x-head">#root,input,select{font-family:"Ubuntu","Say \"hi\""!important}'
            . 'pre,code{font-family:"Mono\\\\Font"!important}</style>',
            $context->get_x_head_html(),
        );
        self::assertSame('<style class="x-head"></style>', $this->context()->get_x_head_html());
    }

    public function testLanguagesAreListedFromTheirFilesAndOnlyKnownOnesLoad(): void {
        $this->write($this->tmp . '/conf/l10n/fr.json', '{"lang": "français"}');
        $this->write($this->tmp . '/conf/l10n/de.json', '{"lang": "deutsch"}');
        $this->write($this->tmp . '/conf/l10n/readme.txt', 'not a language');
        $context = $this->context();
        self::assertSame(['de' => 'deutsch', 'fr' => 'français'], $context->get_langs());
        self::assertSame(['fr' => ['lang' => 'français', 'isoCode' => 'fr']], $context->get_l10n(['fr', '../secret']));
        self::assertSame([], $this->context([], ['CONF_PATH' => $this->tmp . '/missing'])->get_langs());
    }

    public function testThumbnailEntriesThatCannotHaveOneAnswerNull(): void {
        $this->write($this->root('notes.txt'), 'x');
        $context = $this->context(['thumbnails' => ['enabled' => true]]);
        [$hrefs, $types] = $context->get_thumbs([
            'not an entry',
            ['type' => 'blocked', 'href' => '/notes.txt'],
            ['type' => 'img', 'href' => '/missing.jpg'],
            ['type' => 'file', 'href' => '/notes.txt'],
            ['type' => 'img', 'href' => '/notes.txt'],
        ]);
        self::assertSame([null, null, null, null, null], $hrefs);
        self::assertSame([null, null, null, null, 'file'], $types, 'a source already known as a plain file is not captured again');
    }

    // Waits for the background launch, which the shell runs asynchronously.
    private function niceRuns(): int {
        for ($attempt = 0; $attempt < 100 && $this->toolRuns('nice') === 0; $attempt++) {
            usleep(20000);
        }
        return $this->toolRuns('nice');
    }

    public function testStaleFoldersStartOneRefreshWorker(): void {
        $this->fakeTools(['nice' => 'exit 0']);
        $marker = $this->tmp . '/cache/refresh.requested';
        $context = $this->context();

        $context->trigger_folder_refresh([]);
        self::assertFileDoesNotExist($marker, 'nothing to refresh');

        touch($marker);
        $context->trigger_folder_refresh([$this->root()]);
        usleep(200000);
        self::assertSame(0, $this->toolRuns('nice'), 'a refresh is already requested');

        touch($marker, time() - 301);
        $context->trigger_folder_refresh([$this->root()]);
        self::assertSame(1, $this->niceRuns(), 'a request older than five minutes is taken over');
        self::assertSame('-n 19 php ' . $this->tmp . '/private/php/refresh-cache.php ' . $this->root() . "\n", $this->toolLog('nice'));
        self::assertFileExists($marker);
    }

    // The browser sent a PDF type for an MP3 file: the capture finds the
    // audio cover and reports the corrected type.
    #[RequiresPhpExtension('gd')]
    public function testACorrectedTypeIsReported(): void {
        $cover = imagecreatetruecolor(8, 8);
        ob_start();
        imagepng($cover);
        $png = $this->write($this->tmp . '/cover.png', (string) ob_get_clean());
        $this->fakeTools(['ffmpeg' => 'cat ' . escapeshellarg($png)]);
        $this->write($this->root('song.mp3'), 'ID3');
        $context = $this->context(
            ['thumbnails' => ['enabled' => true]],
            ['HAS_CMD_FFMPEG' => true, 'HAS_PHP_WEBP' => function_exists('imagewebp')],
            ['aud' => ['glob' => ['*.mp3']], 'x-pdf' => ['glob' => ['*.pdf']]],
        );
        [$hrefs, $types] = $context->get_thumbs([['type' => 'x-pdf', 'href' => '/song.mp3']]);
        self::assertNotNull($hrefs[0]);
        self::assertSame(['aud'], $types);
    }

    // Shared hosts often disable exec() and proc_open(): commands fail
    // instead of ending the request, and the refresh request is withdrawn
    // so that a later listing can ask again.
    public function testWithoutProcessFunctionsCommandsFailQuietly(): void {
        $coverage = new SubprocessCoverage($this->tmp . '/coverage');
        $command = 'H5AI_TEST_ROOT=' . escapeshellarg($this->root()) . ' H5AI_TEST_CACHE=' . escapeshellarg($this->tmp . '/cache')
            . ' ' . $coverage->shell_php() . ' -d disable_functions=exec,proc_open ' . escapeshellarg(__DIR__ . '/fixtures/without-processes.php');
        exec($command . ' 2>&1', $output, $status);
        $coverage->collect();
        self::assertSame(0, $status, implode("\n", $output));
        self::assertSame(['marker removed', 'exec_0: false', 'proc_open_cmdv: -1', 'passthru_cmd: -1'], $output);
    }
}

