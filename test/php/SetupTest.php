<?php

declare(strict_types=1);

// Setup fails loudly and keeps its command cache (cmds.json) current.
final class SetupTest extends H5aiTestCase {
    private const ALL_CMDS = ['command', 'which', 'where', 'avconv', 'avprobe', 'convert', 'du', 'ffmpeg', 'ffprobe', 'gm', 'magick', 'tar', 'zip'];

    private ReflectionClass $class;

    protected function setUp(): void {
        parent::setUp();
        $this->class = new ReflectionClass(Setup::class);
    }

    // A Setup holding only its cache path, so no real host path is touched.
    private function bareSetup(): Setup {
        $setup = $this->class->newInstanceWithoutConstructor();
        $this->class->getProperty('refresh')->setValue($setup, false);
        $this->set($setup, 'CACHE_PRV_PATH', $this->tmp . '/cache');
        return $setup;
    }

    private function set(Setup $setup, string $key, string|bool $value): void {
        $this->class->getMethod('set')->invoke($setup, $key, $value);
    }

    private function probedSetup(): Setup {
        $setup = $this->bareSetup();
        $this->class->getMethod('add_sys_cmd_checks')->invoke($setup);
        return $setup;
    }

    public function testAMissingKeyRaisesAnError(): void {
        $this->expectExceptionObject(new LogicException('setup key not found: MISSING_KEY'));
        $this->bareSetup()->get('MISSING_KEY');
    }

    public function testRedefiningAKeyRaisesAnError(): void {
        $this->expectExceptionObject(new LogicException('setup key already taken: CACHE_PRV_PATH'));
        $this->set($this->bareSetup(), 'CACHE_PRV_PATH', 'again');
    }

    public function testAnOutdatedCommandCacheIsProbedAgain(): void {
        // Written by a release that did not probe ffprobe/avprobe yet.
        $this->write($this->tmp . '/cache/cmds.json', json_encode(array_fill_keys(
            ['command', 'which', 'where', 'avconv', 'convert', 'du', 'ffmpeg', 'gm', 'tar', 'zip'],
            false,
        )));
        $setup = $this->probedSetup();
        self::assertIsBool($setup->get('HAS_CMD_FFPROBE'));
        self::assertIsBool($setup->get('HAS_CMD_AVPROBE'));
        self::assertIsBool($setup->get('HAS_CMD_MAGICK'));
    }

    public function testACompleteCommandCacheIsReusedAsIs(): void {
        $cmds = array_fill_keys(self::ALL_CMDS, false);
        $cmds['zip'] = true; // Not necessarily what probing this host would find.
        $path = $this->write($this->tmp . '/cache/cmds.json', json_encode($cmds));
        self::assertTrue($this->probedSetup()->get('HAS_CMD_ZIP'));
        self::assertSame($cmds, json_decode((string) file_get_contents($path), true), 'reusing the cache must not rewrite it');
    }

    public function testTheInfoPageReportsProbeToolsToAdministrators(): void {
        $this->write($this->tmp . '/cache/cmds.json', json_encode(array_fill_keys(self::ALL_CMDS, false)));
        $setup = $this->probedSetup();
        foreach ([
            'PUBLIC_HREF', 'ROOT_HREF', 'VERSION', 'PHP_VERSION', 'MIN_PHP_VERSION', 'PHP_ARCH', 'HAS_PHP_EXIF',
            'HAS_PHP_WEBP', 'HAS_PHP_FILEINFO', 'HAS_PHP_ZIP', 'HAS_PHP_RAR', 'HAS_PHP_SQLITE3', 'SERVER_NAME',
            'SERVER_VERSION', 'HAS_SERVER', 'INDEX_HREF', 'HAS_WRITABLE_CACHE_PUB', 'HAS_WRITABLE_CACHE_PRV',
        ] as $key) {
            $this->set($setup, $key, '');
        }
        $info = $setup->to_jsono(true);
        self::assertArrayHasKey('HAS_CMD_FFPROBE', $info);
        self::assertArrayHasKey('HAS_CMD_AVPROBE', $info);
        self::assertArrayHasKey('HAS_CMD_MAGICK', $info);
    }
}
