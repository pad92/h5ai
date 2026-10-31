<?php

declare(strict_types=1);

final class AdminLoginTest extends H5aiTestCase {
    public function testLoginIsDisabledWithoutAConfiguredHash(): void {
        self::assertFalse($this->context(['passhash' => ''])->login_admin(''));
    }

    public function testModernPasswordHashesAreVerified(): void {
        $context = $this->context(['passhash' => password_hash('modern-admin-password', PASSWORD_DEFAULT)]);
        self::assertTrue($context->login_admin('modern-admin-password'));
        self::assertFalse($context->login_admin('wrong-password'));
    }

    public function testLegacySha512DigestsAreStillVerified(): void {
        $context = $this->context(['passhash' => hash('sha512', 'legacy-admin-password')]);
        self::assertTrue($context->login_admin('legacy-admin-password'));
    }

    public function testAnAdministratorSessionIsRecognised(): void {
        $store = [];
        $session = new Session($store);
        $session->set('AS_ADMIN', true);
        self::assertTrue($this->context(session: $session)->is_admin());
    }

    private function contextFrom(string $client, string $password): Context {
        $this->context(['passhash' => password_hash($password, PASSWORD_DEFAULT)]); // writes the options
        $store = [];
        return new Context(new Session($store), new Request([], '', '', $client), new TestSetup($this->setupValues()));
    }

    public function testRepeatedFailuresBlockTheClientOnly(): void {
        for ($attempt = 1; $attempt <= LoginThrottle::MAX_FAILURES; $attempt++) {
            self::assertFalse($this->contextFrom('203.0.113.7', 'secret')->login_admin('guess-' . $attempt));
        }
        self::assertFalse($this->contextFrom('203.0.113.7', 'secret')->login_admin('secret'), 'a throttled client must be refused even with the right password');
        self::assertTrue($this->contextFrom('198.51.100.2', 'secret')->login_admin('secret'), 'other clients must not be affected');
    }

    public function testASuccessfulLoginForgetsEarlierFailures(): void {
        for ($attempt = 1; $attempt < LoginThrottle::MAX_FAILURES; $attempt++) {
            $this->contextFrom('203.0.113.7', 'secret')->login_admin('wrong');
        }
        self::assertTrue($this->contextFrom('203.0.113.7', 'secret')->login_admin('secret'));
        for ($attempt = 1; $attempt < LoginThrottle::MAX_FAILURES; $attempt++) {
            $this->contextFrom('203.0.113.7', 'secret')->login_admin('wrong');
        }
        self::assertTrue($this->contextFrom('203.0.113.7', 'secret')->login_admin('secret'), 'failures before a success must not count');
    }

    public function testFailuresExpireAfterTheWindow(): void {
        $path = $this->tmp . '/cache/failures.json';
        $start = 1_000_000;
        for ($attempt = 0; $attempt < LoginThrottle::MAX_FAILURES; $attempt++) {
            (new LoginThrottle($path, $start + $attempt))->record('client', false);
        }
        self::assertTrue((new LoginThrottle($path, $start + LoginThrottle::WINDOW - 1))->is_blocked('client'));
        self::assertFalse((new LoginThrottle($path, $start + LoginThrottle::WINDOW))->is_blocked('client'), 'the oldest failure has expired');
    }

    public function testClientsAreStoredHashed(): void {
        $this->contextFrom('203.0.113.7', 'secret')->login_admin('wrong');
        $stored = (string) file_get_contents($this->tmp . '/cache/login-failures.json');
        self::assertStringNotContainsString('203.0.113.7', $stored);
        self::assertArrayHasKey(hash('sha256', '203.0.113.7'), json_decode($stored, true));
    }

    public function testAnUnusableStoreNeverBlocksLogins(): void {
        $throttle = new LoginThrottle($this->tmp . '/missing/failures.json');
        for ($attempt = 0; $attempt <= LoginThrottle::MAX_FAILURES; $attempt++) {
            $throttle->record('client', false);
        }
        self::assertFalse($throttle->is_blocked('client'));
    }

    public function testDisabledLoginRecordsNothing(): void {
        $store = [];
        $this->context(['passhash' => '']);
        (new Context(new Session($store), new Request([], '', '', '203.0.113.7'), new TestSetup($this->setupValues())))->login_admin('x');
        self::assertFileDoesNotExist($this->tmp . '/cache/login-failures.json');
    }

    public function testLegacyDigestsLogADeprecationWarning(): void {
        $log = $this->tmp . '/error.log';
        $previous = ini_set('error_log', $log);
        try {
            self::assertTrue($this->context(['passhash' => hash('sha512', 'legacy')])->login_admin('legacy'));
        } finally {
            ini_set('error_log', (string) $previous);
        }
        self::assertStringContainsString('deprecated: passhash is an unsalted SHA-512 digest', (string) file_get_contents($log));
    }
}
