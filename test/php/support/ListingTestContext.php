<?php

declare(strict_types=1);

// Records the folders a request hands to the background refresh worker
// instead of launching it.
final class ListingTestContext extends Context {
    public array $refreshPaths = [];

    public function trigger_folder_refresh(array $paths): void {
        $this->refreshPaths = [...$this->refreshPaths, ...$paths];
    }
}
