<?php

// Progress of a background worker, read by the toolbar task indicator.
//
// While it runs, a worker writes task-<name>.json in the private cache:
// its phase, the items done in that phase and when it started. It must
// hold <name>.lock meanwhile: a status whose lock is free belongs to a
// worker that died, and is ignored. On finish(), the duration and item
// count of each phase are kept in task-<name>.last.json, which the next
// run uses as its estimate. No path ever leaves the server.
class TaskStatus {
    public const WARMER = 'warmer';
    public const REFRESH = 'refresh';

    // Phases of each task, in the order they run.
    private const PHASES = [
        self::WARMER => ['files', 'sizes'],
        self::REFRESH => ['sizes'],
    ];

    // At most one status write per this many seconds while counting items.
    private const WRITE_INTERVAL = 1.0;

    // An estimate below this fraction is too noisy to extrapolate from.
    private const MIN_PROGRESS = 0.01;

    private readonly int $started;
    private readonly array $last;
    private array $phases = [];
    private ?string $phase = null;
    private int $phase_started = 0;
    private int $done = 0;
    private ?int $total = null;
    private float $last_write = 0.0;

    public function __construct(private readonly string $cache_path, private readonly string $name) {
        $this->started = time();
        $this->last = self::read_json($this->last_file());
    }

    // Starts $phase. $total is the number of items it will count with
    // advance(), when known; otherwise the previous run's count is used.
    public function phase(string $phase, ?int $total = null): void {
        $this->close_phase();
        $this->phase = $phase;
        $this->phase_started = time();
        $this->done = 0;
        $this->total = $total;
        $this->write();
    }

    public function advance(int $count = 1): void {
        $this->done += $count;
        if (microtime(true) - $this->last_write >= self::WRITE_INTERVAL) {
            $this->write();
        }
    }

    // Records this run as the estimate of the next one, and drops the status.
    public function finish(): void {
        $this->close_phase();
        self::write_json($this->last_file(), $this->phases);
        @unlink($this->status_file());
    }

    private function close_phase(): void {
        if ($this->phase !== null) {
            $this->phases[$this->phase] = ['done' => $this->done, 'seconds' => time() - $this->phase_started];
        }
    }

    private function write(): void {
        $this->last_write = microtime(true);
        self::write_json($this->status_file(), [
            'phase' => $this->phase,
            'done' => $this->done,
            'total' => $this->total,
            'started' => $this->started,
            'phaseStarted' => $this->phase_started,
        ]);
    }

    private function status_file(): string {
        return self::status_path($this->cache_path, $this->name);
    }

    private function last_file(): string {
        return $this->cache_path . '/task-' . $this->name . '.last.json';
    }

    private static function status_path(string $cache_path, string $name): string {
        return $cache_path . '/task-' . $name . '.json';
    }

    // The tasks running now: [{id, percent, remaining}], percent (0-99) and
    // remaining (seconds) being null while unknown.
    public static function running(string $cache_path, ?int $now = null): array {
        $now ??= time();
        $tasks = [];
        foreach (array_keys(self::PHASES) as $name) {
            if (!self::holds_lock($cache_path . '/' . $name . '.lock')) {
                continue;
            }
            $status = self::read_json(self::status_path($cache_path, $name));
            if (!isset($status['phase'], $status['started'], $status['phaseStarted'])) {
                continue;
            }
            $last = self::read_json($cache_path . '/task-' . $name . '.last.json');
            $tasks[] = ['id' => $name, ...self::estimate($name, $status, $last, $now)];
        }
        return $tasks;
    }

    // Weighs each phase by its duration in the previous run. Within the
    // current phase, progress is the item count against the expected
    // total, or else the time spent against the previous duration.
    private static function estimate(string $name, array $status, array $last, int $now): array {
        $unknown = ['percent' => null, 'remaining' => null];
        $phases = self::PHASES[$name];
        $current = array_search($status['phase'], $phases, true);
        if ($current === false) {
            return $unknown;
        }

        $durations = [];
        foreach ($phases as $phase) {
            $durations[$phase] = max(1, (int) ($last[$phase]['seconds'] ?? 0));
        }
        $phase = $phases[$current];
        $expected = (int) ($status['total'] ?? $last[$phase]['done'] ?? 0);
        if ($expected > 0 && (int) $status['done'] > 0) {
            $fraction = (int) $status['done'] / $expected;
        } elseif (isset($last[$phase]['seconds'])) {
            $fraction = ($now - (int) $status['phaseStarted']) / $durations[$phase];
        } else {
            return $unknown;
        }
        if (count($phases) > 1 && !array_all($phases, static fn(string $p): bool => isset($last[$p]))) {
            // Without the previous duration of every phase, the phases
            // cannot be weighed: only the first one gets an estimate.
            if ($current > 0) {
                return $unknown;
            }
            $durations = [$phase => 1];
        }

        $before = array_sum(array_slice($durations, 0, $current));
        $progress = ($before + min($fraction, 1) * $durations[$phase]) / array_sum($durations);
        $progress = min($progress, 0.99);
        if ($progress < self::MIN_PROGRESS) {
            return ['percent' => 0, 'remaining' => null];
        }
        $elapsed = max(1, $now - (int) $status['started']);
        return [
            'percent' => (int) floor($progress * 100),
            'remaining' => (int) round($elapsed / $progress - $elapsed),
        ];
    }

    // True when a running worker holds $lock_file. Opened read-only, so
    // that checking never creates the file.
    private static function holds_lock(string $lock_file): bool {
        $handle = @fopen($lock_file, 'r');
        if ($handle === false) {
            return false;
        }
        $is_free = flock($handle, LOCK_SH | LOCK_NB);
        if ($is_free) {
            flock($handle, LOCK_UN);
        }
        fclose($handle);
        return !$is_free;
    }

    private static function read_json(string $path): array {
        $content = @file_get_contents($path);
        $data = $content === false ? null : json_decode($content, true);
        return is_array($data) ? $data : [];
    }

    // Written to a temporary file next to $path and renamed, so readers never
    // see half a file. (tempnam() would fall back to the system temporary
    // folder when the cache folder is missing.)
    private static function write_json(string $path, array $data): void {
        $tmp = $path . '.' . bin2hex(random_bytes(6)) . '.tmp';
        if (@file_put_contents($tmp, json_encode($data)) === false || !@rename($tmp, $path)) {
            @unlink($tmp);
        }
    }
}
