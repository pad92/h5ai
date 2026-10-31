<?php

declare(strict_types=1);

// Setup with explicit values instead of probing the host. Every key a test
// does not set has a neutral default; an unknown key fails loudly.
final class TestSetup extends Setup {
    private readonly array $values;

    public function __construct(array $values) {
        $this->values = $values;
    }

    public function get(string $key): string|bool {
        if (!array_key_exists($key, $this->values)) {
            throw new RuntimeException("missing test setup key: {$key}");
        }
        return $this->values[$key];
    }
}
