<?php

declare(strict_types=1);

final class RequestTest extends H5aiTestCase {
    public function testUrlEncodedFormsUsePhpParsedParameters(): void {
        $request = new Request(
            ['action' => 'download', 'type' => 'shell-zip', 'hrefs' => ['/first.txt', '/second.txt']],
            'action=download&type=shell-zip&hrefs%5B0%5D=%2Ffirst.txt&hrefs%5B1%5D=%2Fsecond.txt',
            'application/x-www-form-urlencoded; charset=UTF-8',
        );
        self::assertSame('download', $request->query_string('action'));
        self::assertSame(['/first.txt', '/second.txt'], $request->query_array('hrefs'));
    }

    public function testMultipartFormsUsePhpParsedParameters(): void {
        $request = new Request(
            ['action' => 'download', 'hrefs' => ['/first.txt', '/second.txt']],
            'multipart body',
            'multipart/form-data; boundary=test',
        );
        self::assertSame(['/first.txt', '/second.txt'], $request->query_array('hrefs'));
    }

    public function testJsonRequestsUseTheirDecodedBody(): void {
        $request = new Request(['action' => 'wrong'], '{"action":"download"}', 'application/json; charset=utf-8');
        self::assertSame('download', $request->query_string('action'));
    }

    public function testOnlyAnAdministratorCanForceSetupProbing(): void {
        $refresh = new Request(['refresh' => '1'], '');
        $anonymousStore = [];
        self::assertFalse(Context::wants_setup_refresh($refresh, new Session($anonymousStore)));
        $adminStore = [];
        $admin = new Session($adminStore);
        $admin->set('AS_ADMIN', true);
        self::assertTrue(Context::wants_setup_refresh($refresh, $admin));
        self::assertFalse(Context::wants_setup_refresh(new Request([], ''), $admin), 'without refresh the command cache must be reused');
    }
}
