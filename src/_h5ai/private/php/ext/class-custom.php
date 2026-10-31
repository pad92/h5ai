<?php

class Custom {
    private const EXTENSIONS = ['html', 'md'];

    public function __construct(private readonly Context $context) {}

    private function read_custom_file(string $path, string $name, ?string &$content, ?string &$type): void {
        $file_prefix = $this->context->get_setup()->get('FILE_PREFIX');
        $setup = $this->context->get_setup();
        $root_path = realpath($setup->get('ROOT_PATH'));
        $public_path = realpath($setup->get('PUBLIC_PATH'));
        $private_path = realpath($setup->get('PRIVATE_PATH'));
        $root_prefix = $root_path === false ? null : rtrim($root_path, '/') . '/';
        $public_prefix = $public_path === false ? null : rtrim($public_path, '/') . '/';
        $private_prefix = $private_path === false ? null : rtrim($private_path, '/') . '/';

        foreach (self::EXTENSIONS as $ext) {
            $file = $path . '/' . $file_prefix . '.' . $name . '.' . $ext;
            $real_file = realpath($file);
            if ($root_prefix !== null && $real_file !== false
                && str_starts_with($real_file, $root_prefix)
                && ($public_prefix === null || !str_starts_with($real_file, $public_prefix))
                && ($private_prefix === null || !str_starts_with($real_file, $private_prefix))
                && is_file($real_file) && is_readable($real_file)) {
                $content = file_get_contents($real_file);
                $type = $ext;
                return;
            }
        }
    }

    public function get_customizations(string $href): array {
        $empty = [
            'header' => ['content' => null, 'type' => null],
            'footer' => ['content' => null, 'type' => null],
        ];

        if (!$this->context->query_option('custom.enabled', false)) {
            return $empty;
        }

        $root_path = $this->context->get_setup()->get('ROOT_PATH');
        $path = $this->context->to_path($href);
        if (!$this->context->is_managed_path($path)) {
            return $empty;
        }

        $header = null;
        $header_type = null;
        $footer = null;
        $footer_type = null;

        $this->read_custom_file($path, 'header', $header, $header_type);
        $this->read_custom_file($path, 'footer', $footer, $footer_type);

        while ($header === null || $footer === null) {
            if ($header === null) {
                $this->read_custom_file($path, 'headers', $header, $header_type);
            }
            if ($footer === null) {
                $this->read_custom_file($path, 'footers', $footer, $footer_type);
            }
            if ($path === $root_path) {
                break;
            }
            $parent_path = Util::normalize_path(dirname($path));
            if ($parent_path === $path) {
                break;
            }
            $path = $parent_path;
        }

        return [
            'header' => ['content' => $header, 'type' => $header_type],
            'footer' => ['content' => $footer, 'type' => $footer_type],
        ];
    }
}
