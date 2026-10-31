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
}
