<?php

class Theme {
    private const EXTENSIONS = ['svg', 'png', 'jpg', 'jpeg', 'webp'];

    public function __construct(private readonly Context $context) {}

    public function get_icons(): array {
        $public_path = $this->context->get_setup()->get('PUBLIC_PATH');
        $theme = $this->context->query_option('view.theme', '-NONE-');
        $theme_path = $public_path . '/images/themes/' . $theme;

        $icons = [];
        if (!is_dir($theme_path)) {
            return $icons;
        }

        foreach (self::EXTENSIONS as $ext) {
            foreach (glob($theme_path . '/*.' . $ext) as $file) {
                $parts = pathinfo($file);
                $icons[$parts['filename']] = $theme . '/' . $parts['basename'];
            }
        }

        return $icons;
    }
}
