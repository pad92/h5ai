<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\RequiresPhpExtension;

// The SQLite thumbnail type cache degrades instead of failing a request.
#[RequiresPhpExtension('sqlite3')]
final class CacheDbTest extends H5aiTestCase {
    private function db(string $cachePath): CacheDB {
        return new CacheDB(new TestSetup($this->setupValues(['CACHE_PRV_PATH' => $cachePath])));
    }

    public function testAnUnopenableCacheIsDisabled(): void {
        $db = $this->db($this->tmp . '/does-not-exist');
        $db->insert('hash', 'img', 0);
        self::assertNull($db->select('hash'));
    }

    // Left by a concurrent request or an interrupted first run.
    public function testADatabaseWithoutTablesGetsItsSchema(): void {
        $this->write($this->tmp . '/cache/thumbs_cache.db', '');
        $db = $this->db($this->tmp . '/cache');
        $db->insert('hash', 'img-jpg', 0);
        self::assertSame('img-jpg', $db->select('hash')['type'] ?? null);
    }

    public function testACorruptDatabaseIsIgnored(): void {
        $this->write($this->tmp . '/cache/thumbs_cache.db', str_repeat('not a database ', 100));
        // SQLite reports the corruption as warnings, which reach the error log.
        set_error_handler(static fn(int $errno, string $message): bool => str_contains($message, 'not a database'), E_WARNING);
        try {
            $db = $this->db($this->tmp . '/cache');
            $db->insert('hash', 'img-jpg', 0);
            self::assertNull($db->select('hash'));
        } finally {
            restore_error_handler();
        }
    }
}
