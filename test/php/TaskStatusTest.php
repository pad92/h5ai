<?php

declare(strict_types=1);

// Background task progress as the toolbar indicator reads it.
final class TaskStatusTest extends H5aiTestCase {
    private const NOW = 1_000_000;

    private function cache(): string {
        return $this->tmp . '/cache';
    }

    // Holds <name>.lock like a running worker until the handle is closed.
    private function holdLock(string $name) {
        $handle = fopen($this->cache() . '/' . $name . '.lock', 'c+');
        flock($handle, LOCK_EX);
        return $handle;
    }

    private function writeJson(string $file, array $data): void {
        file_put_contents($this->cache() . '/' . $file, json_encode($data));
    }

    private function workerStatus(string $phase, int $done, ?int $total, int $elapsed, int $phaseElapsed): array {
        return [
            'phase' => $phase, 'done' => $done, 'total' => $total,
            'started' => self::NOW - $elapsed, 'phaseStarted' => self::NOW - $phaseElapsed,
        ];
    }

    public function testAStatusWithoutItsLockHeldIsAWorkerThatDied(): void {
        $this->writeJson('task-warmer.json', $this->workerStatus('files', 5, null, 10, 10));
        self::assertSame([], TaskStatus::running($this->cache(), self::NOW));
        self::assertFileDoesNotExist($this->cache() . '/warmer.lock', 'checking must not create the lock');
    }

    public function testAFirstRunHasNoEstimate(): void {
        $lock = $this->holdLock('warmer');
        $this->writeJson('task-warmer.json', $this->workerStatus('files', 5, null, 10, 10));
        self::assertSame([['id' => 'warmer', 'percent' => null, 'remaining' => null]], TaskStatus::running($this->cache(), self::NOW));
        fclose($lock);
    }

    // Previous run: 1000 files in 30 s, then sizes in 10 s. Half the files
    // after 20 s is 0.5 * 30 / 40 = 37.5 % of the expected time.
    public function testPhasesAreWeighedByThePreviousRun(): void {
        $lock = $this->holdLock('warmer');
        $this->writeJson('task-warmer.last.json', ['files' => ['done' => 1000, 'seconds' => 30], 'sizes' => ['done' => 0, 'seconds' => 10]]);
        $this->writeJson('task-warmer.json', $this->workerStatus('files', 500, null, 20, 20));
        self::assertSame([['id' => 'warmer', 'percent' => 37, 'remaining' => 33]], TaskStatus::running($this->cache(), self::NOW));

        // Sizes count nothing: time against the previous 10 s, after 30 s of files.
        $this->writeJson('task-warmer.json', $this->workerStatus('sizes', 0, null, 35, 5));
        self::assertSame([['id' => 'warmer', 'percent' => 87, 'remaining' => 5]], TaskStatus::running($this->cache(), self::NOW));
        fclose($lock);
    }

    public function testAnEstimateNeverReachesAHundredPercent(): void {
        $lock = $this->holdLock('refresh');
        $this->writeJson('task-refresh.last.json', ['sizes' => ['done' => 0, 'seconds' => 2]]);
        $this->writeJson('task-refresh.json', $this->workerStatus('sizes', 0, null, 60, 60));
        self::assertSame([['id' => 'refresh', 'percent' => 99, 'remaining' => 1]], TaskStatus::running($this->cache(), self::NOW));
        fclose($lock);
    }

    public function testAGivenTotalIsFollowedByItemCount(): void {
        $lock = $this->holdLock('refresh');
        $this->writeJson('task-refresh.json', $this->workerStatus('sizes', 1, 4, 3, 3));
        self::assertSame([['id' => 'refresh', 'percent' => 25, 'remaining' => 9]], TaskStatus::running($this->cache(), self::NOW));
        fclose($lock);
    }

    public function testOnlyARunningTaskCanBeAskedToStopAndANewRunIgnoresAnOldRequest(): void {
        self::assertFalse(TaskStatus::request_stop($this->cache(), 'refresh'), 'nothing runs');
        self::assertFileDoesNotExist($this->cache() . '/task-refresh.stop');

        $lock = $this->holdLock('refresh');
        $this->writeJson('task-refresh.json', $this->workerStatus('sizes', 0, null, 1, 1));
        self::assertTrue(TaskStatus::request_stop($this->cache(), 'refresh'));
        self::assertTrue(TaskStatus::is_stopping($this->cache(), 'refresh'));
        self::assertTrue(new TaskStatus($this->cache(), 'warmer')->stop_requested() === false, 'another task is not concerned');
        fclose($lock);

        $next = new TaskStatus($this->cache(), TaskStatus::REFRESH);
        self::assertFalse($next->stop_requested(), 'a request for an earlier run');
        self::assertFalse(TaskStatus::is_stopping($this->cache(), 'refresh'));
    }

    public function testAFinishedRunLeavesOnlyItsEstimate(): void {
        $status = new TaskStatus($this->cache(), TaskStatus::REFRESH);
        $status->phase('sizes', 3);
        $status->advance(3);
        self::assertFileExists($this->cache() . '/task-refresh.json');
        $status->finish();
        self::assertFileDoesNotExist($this->cache() . '/task-refresh.json');
        $last = json_decode((string) file_get_contents($this->cache() . '/task-refresh.last.json'), true);
        self::assertSame(3, $last['sizes']['done']);
    }

    public function testTheWarmerCountsEveryFileItWalks(): void {
        foreach (['a.txt', 'b.jpg', 'sub/c.txt'] as $name) {
            $this->write($this->root($name), 'x');
        }
        $status = new TaskStatus($this->cache(), TaskStatus::WARMER);
        (new CacheWarmer($this->context()))->warm($status);
        $status->finish();
        $last = json_decode((string) file_get_contents($this->cache() . '/task-warmer.last.json'), true);
        self::assertSame(3, $last['files']['done']);
    }

    private function running(): array {
        return TaskStatus::running($this->cache(), self::NOW);
    }

    public function testAFreeLockOrAnIncompleteStatusShowsNothing(): void {
        touch($this->cache() . '/warmer.lock');
        $this->writeJson('task-warmer.json', $this->workerStatus('files', 5, null, 10, 10));
        self::assertSame([], $this->running(), 'a lock file nobody holds');

        $lock = $this->holdLock('warmer');
        $this->writeJson('task-warmer.json', ['phase' => 'files']);
        self::assertSame([], $this->running(), 'a status without its start times');
        fclose($lock);
    }

    public function testAnUnknownPhaseHasNoEstimate(): void {
        $lock = $this->holdLock('refresh');
        $this->writeJson('task-refresh.json', $this->workerStatus('files', 1, 4, 3, 3));
        self::assertSame([['id' => 'refresh', 'percent' => null, 'remaining' => null]], $this->running());
        fclose($lock);
    }

    // Without the duration of every phase, only the first one is estimated.
    public function testAPartialPreviousRunEstimatesTheFirstPhaseOnly(): void {
        $lock = $this->holdLock('warmer');
        $this->writeJson('task-warmer.last.json', ['files' => ['done' => 100, 'seconds' => 10]]);
        $this->writeJson('task-warmer.json', $this->workerStatus('files', 50, null, 10, 10));
        self::assertSame([['id' => 'warmer', 'percent' => 50, 'remaining' => 10]], $this->running());
        $this->writeJson('task-warmer.json', $this->workerStatus('sizes', 0, null, 30, 5));
        self::assertSame([['id' => 'warmer', 'percent' => null, 'remaining' => null]], $this->running());

        // A later phase known alone cannot be placed in the whole run.
        $this->writeJson('task-warmer.last.json', ['sizes' => ['done' => 0, 'seconds' => 10]]);
        self::assertSame([['id' => 'warmer', 'percent' => null, 'remaining' => null]], $this->running());
        fclose($lock);
    }

    public function testATaskJustStartedShowsZeroWithoutATime(): void {
        $lock = $this->holdLock('refresh');
        $this->writeJson('task-refresh.json', $this->workerStatus('sizes', 0, 1000, 1, 1));
        $this->writeJson('task-refresh.last.json', ['sizes' => ['done' => 0, 'seconds' => 1000]]);
        self::assertSame([['id' => 'refresh', 'percent' => 0, 'remaining' => null]], $this->running());
        fclose($lock);
    }

    // Counting writes at most once per second.
    public function testCountingWritesOnceTheIntervalHasPassed(): void {
        $status = new TaskStatus($this->cache(), TaskStatus::REFRESH);
        $status->phase('sizes', 10);
        $status->advance();
        $file = $this->cache() . '/task-refresh.json';
        self::assertSame(0, json_decode((string) file_get_contents($file), true)['done'], 'too soon to write');
        (new ReflectionProperty(TaskStatus::class, 'last_write'))->setValue($status, 0.0);
        $status->advance();
        self::assertSame(2, json_decode((string) file_get_contents($file), true)['done']);
    }

    public function testAnUnwritableStatusIsSkipped(): void {
        (new TaskStatus($this->tmp . '/missing', TaskStatus::REFRESH))->phase('sizes');
        self::assertDirectoryDoesNotExist($this->tmp . '/missing');

        mkdir($this->cache() . '/task-refresh.json');
        (new TaskStatus($this->cache(), TaskStatus::REFRESH))->phase('sizes');
        self::assertSame(['task-refresh.json'], array_values(array_diff(scandir($this->cache()), ['.', '..'])), 'no temporary file is left');
    }
}
