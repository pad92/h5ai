<?php

// Figures of the background work and caches, shown to the administrator on
// the info page. Counts, sizes and timestamps only: no path leaves the
// server. Reading them never creates a cache file.
class Metrics {
    public function __construct(private readonly Context $context) {}

    public function collect(): array {
        $cache = $this->context->get_setup()->get('CACHE_PRV_PATH');
        return [
            'now' => time(),
            'tasks' => $this->tasks($cache),
            'cache' => [
                'thumbnails' => $this->thumbnails(),
                'thumbnailDb' => CacheDB::stats($cache . '/thumbs_cache.db'),
                'folderSizes' => Filesize::cache_stats($cache . '/foldersizes.json'),
            ],
        ];
    }

    private function tasks(string $cache): array {
        $running = [];
        foreach (TaskStatus::running($cache) as $task) {
            $running[$task['id']] = $task;
        }
        $tasks = [];
        foreach (TaskStatus::names() as $name) {
            $tasks[$name] = [
                'running' => $running[$name] ?? null,
                'stopping' => isset($running[$name]) && TaskStatus::is_stopping($cache, $name),
                'last' => TaskStatus::last_run($cache, $name),
            ];
        }
        $tasks['warmer']['schedule'] = CacheWarmer::schedule($this->context);
        return $tasks;
    }

    // The thumbnail files Thumb writes, thumb-<sha1>-<width>x<height>.webp,
    // and the coverage the last warm run counted: walking the share here
    // would make the page as slow as the warmer.
    private function thumbnails(): array {
        $folder = $this->context->get_setup()->get('CACHE_PUB_PATH') . '/' . Thumb::THUMB_CACHE;
        $files = 0;
        $bytes = 0;
        $sources = [];
        foreach (glob($folder . '/thumb-*.webp', GLOB_NOSORT) ?: [] as $thumb) {
            $size = @filesize($thumb);
            if ($size !== false) {
                $files++;
                $bytes += $size;
                // One source can have several sizes: count it once.
                $sources[substr(basename($thumb), 6, 40)] = true;
            }
        }
        return [
            'files' => $files,
            'sources' => count($sources),
            'bytes' => $bytes,
            'coverage' => CacheWarmer::last_coverage($this->context->get_setup()->get('CACHE_PRV_PATH')),
        ];
    }
}
