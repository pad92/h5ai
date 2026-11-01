<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\RunInSeparateProcess;

final class SessionTest extends H5aiTestCase {
    public function testValuesAreKeptUnderAPrefix(): void {
        $store = [];
        $session = new Session($store);
        $session->set('key', 'value');
        self::assertSame('value', $session->get('key'));
        self::assertSame('fallback', $session->get('missing', 'fallback'));
        self::assertSame(['__H5AI__key' => 'value'], $store);
    }

    // A real session gets a new id, as after a login.
    #[RunInSeparateProcess]
    public function testAnActiveSessionGetsANewId(): void {
        ini_set('session.use_cookies', '0');
        ini_set('session.cache_limiter', '');
        session_save_path($this->tmp);
        session_start();
        $before = session_id();
        $store = [];
        (new Session($store))->regenerate();
        self::assertNotSame($before, session_id());
        session_destroy();
    }
}
