<?php

class Session {
    private const KEY_PREFIX = '__H5AI__';

    public function __construct(private array &$store) {}

    public function set(string $key, mixed $value): void {
        $this->store[self::KEY_PREFIX . $key] = $value;
    }

    public function get(string $key, mixed $default = null): mixed {
        $prefixed = self::KEY_PREFIX . $key;
        return $this->store[$prefixed] ?? $default;
    }

    public function regenerate(): void {
        // Only meaningful for a real PHP session (no-op in CLI/test context).
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
        }
    }
}
