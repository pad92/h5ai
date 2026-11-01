<?php

// Empties one cache of the info page on the administrator's request,
// completely: the files and the database rows that describe them go
// together, so the purge also clears any inconsistency between them. Only
// files the cache owns are touched, and nothing runs while a background task
// could refill or read the cache halfway.
class CachePurge {
    public const THUMBNAILS = 'thumbnails';
    public const FOLDER_SIZES = 'folderSizes';
    public const CACHES = [self::THUMBNAILS, self::FOLDER_SIZES];

    private readonly string $private_cache;

    public function __construct(private readonly Context $context) {
        $this->private_cache = $context->get_setup()->get('CACHE_PRV_PATH');
    }

    // The background task running now, if any: no cache is purged meanwhile.
    public function blocking_task(): ?string {
        $running = array_column(TaskStatus::running($this->private_cache), 'id');
        return $running[0] ?? null;
    }

    // What was removed, by kind: thumbnail files and recorded sources, or
    // folder size entries.
    public function purge(string $cache): array {
        return match ($cache) {
            self::THUMBNAILS => $this->purge_thumbnails(),
            self::FOLDER_SIZES => ['entries' => Filesize::purge_cache($this->private_cache . '/foldersizes.json')],
            default => throw new InvalidArgumentException('unknown cache: ' . $cache),
        };
    }

    // Every file of the thumbnail folder (a symlink is removed, never
    // followed), every row of the thumbnail database, which records their
    // sources and capture outcomes, and the coverage the warmer counted with
    // them.
    private function purge_thumbnails(): array {
        $folder = $this->context->get_setup()->get('CACHE_PUB_PATH') . '/' . Thumb::THUMB_CACHE;
        $files = 0;
        foreach (@scandir($folder) ?: [] as $name) {
            $path = $folder . '/' . $name;
            if ((is_link($path) || is_file($path)) && @unlink($path)) {
                $files++;
            }
        }
        $sources = CacheDB::purge($this->private_cache . '/thumbs_cache.db');
        @unlink($this->private_cache . '/' . CacheWarmer::COVERAGE_FILE);
        return ['files' => $files, 'sources' => $sources];
    }
}
