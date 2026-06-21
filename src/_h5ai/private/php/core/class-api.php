<?php

class Api {
    private readonly Request $request;
    private readonly Setup $setup;

    public function __construct(private readonly Context $context) {
        $this->request = $context->get_request();
        $this->setup = $context->get_setup();
    }

    public function apply(): never {
        $action = $this->request->query('action');
        $supported = ['download', 'get', 'login', 'logout'];
        Util::json_fail(Util::ERR_UNSUPPORTED, 'unsupported action', !in_array($action, $supported, true));

        $methodname = 'on_' . $action;
        $this->$methodname();
        exit;
    }

    private function on_download(): never {
        Util::json_fail(Util::ERR_DISABLED, 'download disabled', !$this->context->query_option('download.enabled', false));

        $as = $this->request->query('as');
        $type = $this->request->query('type');
        $base_href = $this->request->query('baseHref');
        $hrefs = $this->request->query('hrefs', '');

        $as = preg_replace('/[^\w.\-]/', '_', $as);

        $archive = new Archive($this->context);

        set_time_limit(0);
        session_write_close();
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="' . $as . '"');
        header('Connection: close');
        $ok = $archive->output($type, $base_href, $hrefs);

        Util::json_fail(Util::ERR_FAILED, 'packaging failed', !$ok);
        exit;
    }

    private function on_get(): never {
        $response = [];

        foreach (['langs', 'options', 'types'] as $name) {
            if ($this->request->query_boolean($name, false)) {
                $methodname = 'get_' . $name;
                $response[$name] = $this->context->$methodname();
            }
        }

        if ($this->request->query_boolean('setup', false)) {
            $response['setup'] = $this->setup->to_jsono($this->context->is_admin());
        }

        if ($this->request->query_boolean('theme', false)) {
            $response['theme'] = new Theme($this->context)->get_icons();
        }

        if ($this->request->query('items', false)) {
            $href = $this->request->query('items.href');
            $what = $this->request->query_numeric('items.what');
            $response['items'] = $this->context->get_items($href, $what);
        }

        if ($this->request->query('custom', false)) {
            Util::json_fail(Util::ERR_DISABLED, 'custom disabled', !$this->context->query_option('custom.enabled', false));
            $href = $this->request->query('custom');
            $response['custom'] = new Custom($this->context)->get_customizations($href);
        }

        if ($this->request->query('l10n', false)) {
            Util::json_fail(Util::ERR_DISABLED, 'l10n disabled', !$this->context->query_option('l10n.enabled', false));
            $iso_codes = array_filter($this->request->query_array('l10n'));
            $response['l10n'] = $this->context->get_l10n($iso_codes);
        }

        if ($this->request->query('search', false)) {
            Util::json_fail(Util::ERR_DISABLED, 'search disabled', !$this->context->query_option('search.enabled', false));
            $href = $this->request->query('search.href');
            $pattern = $this->request->query('search.pattern');
            $ignorecase = $this->request->query_boolean('search.ignorecase', false);
            $response['search'] = new Search($this->context)->get_items($href, $pattern, $ignorecase);
        }

        if ($this->request->query('thumbs', false)) {
            Util::json_fail(Util::ERR_DISABLED, 'thumbnails disabled', !$this->context->query_option('thumbnails.enabled', false));
            Util::json_fail(Util::ERR_UNSUPPORTED, 'thumbnails not supported', !$this->setup->get('HAS_PHP_WEBP'));
            $thumbs = $this->request->query_array('thumbs');
            [$response['thumbs'], $response['filetypes']] = $this->context->get_thumbs($thumbs);
        }

        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
        header('Expires: 0');
        Util::json_exit($response);
    }

    private function on_login(): never {
        $pass = $this->request->query('pass');
        Util::json_exit(['asAdmin' => $this->context->login_admin($pass)]);
    }

    private function on_logout(): never {
        Util::json_exit(['asAdmin' => $this->context->logout_admin()]);
    }
}
