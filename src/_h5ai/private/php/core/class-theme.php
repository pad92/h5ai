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

        // Case-insensitive extension match (icon.PNG must work like icon.png),
        // which glob() cannot provide portably.
        try {
            $iter = new \FilesystemIterator($theme_path, \FilesystemIterator::SKIP_DOTS);
        } catch (\UnexpectedValueException) {
            return $icons;
        }
        foreach ($iter as $file) {
            if (!$file->isFile()) {
                continue;
            }
            if (in_array(strtolower($file->getExtension()), self::EXTENSIONS, true)) {
                $icons[$file->getBasename('.' . $file->getExtension())] = $theme . '/' . $file->getFilename();
            }
        }

        return $icons;
    }
}
