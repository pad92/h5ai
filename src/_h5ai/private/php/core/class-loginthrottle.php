<?php

// Failed administrator logins per client, kept in the private cache. A
// client with MAX_FAILURES failures within WINDOW seconds is refused until
// the oldest one expires. Clients are stored as hashes, not addresses.
// Behind a reverse proxy without real_ip configured, every visitor shares
// the proxy's address and therefore one budget.
class LoginThrottle {
    public const MAX_FAILURES = 5;
    public const WINDOW = 900;

    // $now pins the clock for tests.
    public function __construct(private readonly string $path, private readonly ?int $now = null) {}

    public function is_blocked(string $client): bool {
        return count($this->update(static fn(array $failures): array => $failures)[$this->key($client)] ?? [])
            >= self::MAX_FAILURES;
    }

    // Reserves one password check for the client and returns whether it may
    // run. The reservation counts as a failure until forget() clears it, and
    // the check and the reservation share one lock: concurrent requests
    // cannot all pass a separate is_blocked() before any failure is stored.
    public function try_attempt(string $client): bool {
        $key = $this->key($client);
        $now = $this->now ?? time();
        $allowed = false;
        $this->update(static function (array $failures) use ($key, $now, &$allowed): array {
            if (count($failures[$key] ?? []) >= self::MAX_FAILURES) {
                return $failures;
            }
            $allowed = true;
            $failures[$key][] = $now;
            return $failures;
        });
        return $allowed;
    }

    // A success forgets the client's failures.
    public function forget(string $client): void {
        $key = $this->key($client);
        $this->update(static function (array $failures) use ($key): array {
            unset($failures[$key]);
            return $failures;
        });
    }

    private function key(string $client): string {
        return hash('sha256', $client);
    }

    // Applies $change to the stored failures (expired ones dropped) under an
    // exclusive lock and returns the result. Without a usable file, nothing
    // is remembered and $change runs on an empty set, so logins are never
    // refused because the cache is broken.
    private function update(callable $change): array {
        $handle = @fopen($this->path, 'c+');
        if ($handle === false) {
            Util::log('login throttle disabled, cannot open ' . $this->path);
            $change([]);
            return [];
        }
        try {
            if (!flock($handle, LOCK_EX)) {
                $change([]);
                return [];
            }
            $stored = json_decode((string) stream_get_contents($handle), true);
            $since = ($this->now ?? time()) - self::WINDOW;
            $failures = [];
            foreach (is_array($stored) ? $stored : [] as $key => $times) {
                $recent = array_values(array_filter((array) $times, static fn(mixed $time): bool => is_int($time) && $time > $since));
                if ($recent !== []) {
                    $failures[$key] = $recent;
                }
            }
            $failures = $change($failures);
            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, json_encode((object) $failures));
            return $failures;
        } finally {
            fclose($handle);
        }
    }
}
