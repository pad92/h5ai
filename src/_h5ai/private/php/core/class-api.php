<?php

class Api {
    private readonly Request $request;
    private readonly Setup $setup;

    public function __construct(private readonly Context $context) {
        $this->request = $context->get_request();
        $this->setup = $context->get_setup();
    }

    public function apply(): never {
        // Explicit calls, so that no handler looks unused to a reader or a tool.
        match ($this->request->query_string('action')) {
            'download' => $this->on_download(),
            'get' => $this->on_get(),
            'login' => $this->on_login(),
            'logout' => $this->on_logout(),
            'purge' => $this->on_purge(),
            'start' => $this->on_start(),
            'stop' => $this->on_stop(),
            default => Util::json_error(Util::ERR_UNSUPPORTED, 'unsupported action'),
        };
    }

    private function on_download(): never {
        Util::json_fail(Util::ERR_DISABLED, 'download disabled', !$this->context->query_option('download.enabled', false));

        $as = $this->request->query_string('as');
        $type = $this->request->query_string('type');
        $base_href = $this->request->query_string('baseHref');
        $hrefs = $this->request->query('hrefs', '');
        Util::json_fail(
            Util::ERR_ILLEGAL_PARAM,
            'hrefs must be a string or an array of strings',
            !is_string($hrefs) && (!is_array($hrefs) || !array_all(
                $hrefs,
                static fn(mixed $href): bool => is_string($href),
            )),
        );

        $as = preg_replace('/[^\w.\-]/', '_', $as);

        $archive = new Archive($this->context);
        Util::json_fail(Util::ERR_FAILED, 'nothing to package', !$archive->prepare($type, $base_href, $hrefs));

        set_time_limit(max(1, (int) $this->context->query_option('download.timeout', 300)));
        session_write_close();
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="' . $as . '"');
        header('Connection: close');
        if (!$archive->stream()) {
            // The first flush() sends the headers. Until then nothing reached
            // the client (php-tar may have buffered some bytes), so the answer
            // can still become an error instead of an attachment. Afterwards,
            // appending JSON would only corrupt the archive: the client gets a
            // truncated download.
            if (!headers_sent()) {
                while (ob_get_level() > 0) {
                    ob_end_clean();
                }
                header_remove('Content-Disposition');
                Util::json_error(Util::ERR_FAILED, 'packaging failed');
            }
            Util::log('archive: download of ' . $as . ' failed after it started');
        }
        exit;
    }

    private function on_get(): never {
        $response = [];

        if ($this->request->query_boolean('langs', false)) {
            $response['langs'] = $this->context->get_langs();
        }

        if ($this->request->query_boolean('options', false)) {
            $response['options'] = $this->context->get_options();
        }

        if ($this->request->query_boolean('types', false)) {
            $response['types'] = $this->context->get_types();
        }

        if ($this->request->query_boolean('tasks', false)) {
            Util::json_fail(Util::ERR_DISABLED, 'tasks disabled', !$this->context->query_option('tasks.enabled', false));
            $response['tasks'] = TaskStatus::running($this->setup->get('CACHE_PRV_PATH'));
        }

        if ($this->request->query_boolean('metrics', false)) {
            Util::json_fail(Util::ERR_DISABLED, 'metrics need an admin session', !$this->context->is_admin());
            $response['metrics'] = new Metrics($this->context)->collect();
        }

        if ($this->request->query_boolean('setup', false)) {
            $response['setup'] = $this->setup->to_jsono($this->context->is_admin());
        }

        if ($this->request->query_boolean('theme', false)) {
            $response['theme'] = new Theme($this->context)->get_icons();
        }

        if ($this->request->query('items', false)) {
            $href = $this->request->query_string('items.href');
            $what = $this->request->query_numeric('items.what');
            $response['items'] = $this->context->get_items($href, $what);
        }

        if ($this->request->query('custom', false)) {
            Util::json_fail(Util::ERR_DISABLED, 'custom disabled', !$this->context->query_option('custom.enabled', false));
            $href = $this->request->query_string('custom');
            $response['custom'] = new Custom($this->context)->get_customizations($href);
        }

        if ($this->request->query('l10n', false)) {
            Util::json_fail(Util::ERR_DISABLED, 'l10n disabled', !$this->context->query_option('l10n.enabled', false));
            $iso_codes = array_values(array_filter(
                $this->request->query_array('l10n'),
                is_string(...),
            ));
            $response['l10n'] = $this->context->get_l10n($iso_codes);
        }

        if ($this->request->query('search', false)) {
            Util::json_fail(Util::ERR_DISABLED, 'search disabled', !$this->context->query_option('search.enabled', false));
            $href = $this->request->query_string('search.href');
            $pattern = $this->request->query_string('search.pattern');
            $ignorecase = $this->request->query_boolean('search.ignorecase', false);
            $response['search'] = new Search($this->context)->get_items($href, $pattern, $ignorecase);
        }

        if ($this->request->query('thumbs', false)) {
            Util::json_fail(Util::ERR_DISABLED, 'thumbnails disabled', !$this->context->query_option('thumbnails.enabled', false));
            Util::json_fail(Util::ERR_UNSUPPORTED, 'thumbnails not supported', !$this->setup->get('HAS_PHP_WEBP'));
            $thumbs = $this->request->query_array('thumbs');
            $max_batch = max(1, (int) $this->context->query_option('thumbnails.maxBatchSize', 40));
            Util::json_fail(Util::ERR_ILLEGAL_PARAM, 'too many thumbnail requests', count($thumbs) > $max_batch);
            [$response['thumbs'], $response['filetypes']] = $this->context->get_thumbs($thumbs);
        }

        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
        header('Expires: 0');
        Util::json_exit($response);
    }

    private function on_login(): never {
        $pass = $this->request->query_string('pass');
        Util::json_exit(['asAdmin' => $this->context->login_admin($pass)]);
    }

    // Admin only. Refused while a background task runs: it would refill the
    // cache halfway or read it while it is emptied.
    private function on_purge(): never {
        Util::json_fail(Util::ERR_DISABLED, 'purge needs an admin session', !$this->context->is_admin());
        $cache = $this->request->query_string('cache');
        Util::json_fail(Util::ERR_ILLEGAL_PARAM, 'unknown cache', !in_array($cache, CachePurge::CACHES, true));
        $purge = new CachePurge($this->context);
        $task = $purge->blocking_task();
        Util::json_fail(Util::ERR_FAILED, 'a background task is running: ' . $task, $task !== null);
        try {
            $removed = $purge->purge($cache);
        } catch (Exception $exception) {
            Util::log('purge of ' . $cache . ' failed: ' . $exception->getMessage());
            Util::json_error(Util::ERR_FAILED, 'purge failed');
        }
        Util::log('admin purged the ' . $cache . ' cache: ' . json_encode($removed));
        Util::json_exit(['purged' => $cache, 'removed' => $removed]);
    }

    // Admin only: starts a background task now, unless it already runs.
    private function on_start(): never {
        $task = $this->admin_task('start');
        $cache = $this->setup->get('CACHE_PRV_PATH');
        Util::json_fail(Util::ERR_FAILED, $task . ' is already running', in_array($task, array_column(TaskStatus::running($cache), 'id'), true));
        if ($task === TaskStatus::REFRESH) {
            [$with_foldersize] = $this->context->foldersize_mode();
            Util::json_fail(Util::ERR_DISABLED, 'folder sizes are disabled', !$with_foldersize);
            $started = $this->context->trigger_folder_refresh([$this->setup->get('ROOT_PATH')]);
        } else {
            $started = CacheWarmer::launch_now($this->context);
        }
        Util::json_fail(Util::ERR_FAILED, $task . ' could not start (already starting, or commands disabled)', !$started);
        Util::log('admin started the ' . $task . ' task');
        Util::json_exit(['started' => $task]);
    }

    // Admin only: asks a running task to stop at its next consistent point.
    private function on_stop(): never {
        $task = $this->admin_task('stop');
        Util::json_fail(Util::ERR_FAILED, $task . ' is not running', !TaskStatus::request_stop($this->setup->get('CACHE_PRV_PATH'), $task));
        Util::log('admin asked the ' . $task . ' task to stop');
        Util::json_exit(['stopping' => $task]);
    }

    // The `task` parameter of an admin-only task action, checked.
    private function admin_task(string $verb): string {
        Util::json_fail(Util::ERR_DISABLED, $verb . ' needs an admin session', !$this->context->is_admin());
        $task = $this->request->query_string('task');
        Util::json_fail(Util::ERR_ILLEGAL_PARAM, 'unknown task', !in_array($task, TaskStatus::names(), true));
        return $task;
    }

    private function on_logout(): never {
        Util::json_exit(['asAdmin' => $this->context->logout_admin()]);
    }
}
