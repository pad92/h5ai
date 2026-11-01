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

    private function on_logout(): never {
        Util::json_exit(['asAdmin' => $this->context->logout_admin()]);
    }
}
