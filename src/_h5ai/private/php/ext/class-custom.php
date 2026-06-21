<?php

class Custom {
    private const EXTENSIONS = ['html', 'md'];

    public function __construct(private readonly Context $context) {}

    private function read_custom_file(string $path, string $name, ?string &$content, ?string &$type): void {
        $file_prefix = $this->context->get_setup()->get('FILE_PREFIX');

        foreach (self::EXTENSIONS as $ext) {
            $file = $path . '/' . $file_prefix . '.' . $name . '.' . $ext;
            if (is_readable($file)) {
                $content = file_get_contents($file);
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
