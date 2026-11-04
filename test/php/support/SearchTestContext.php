<?php

declare(strict_types=1);

// Counts the search index refreshes a request asks for instead of launching
// the worker.
final class SearchTestContext extends Context {
    public int $indexRefreshes = 0;

    public function trigger_search_index_refresh(): bool {
        $this->indexRefreshes++;
        return true;
    }
}
