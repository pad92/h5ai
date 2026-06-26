<?php

class Thumb {
    // '-protocol_whitelist file,crypto,data' confines ffmpeg/avconv to local input and
    // blocks SSRF/LFI via crafted playlist/concat/HLS files that reference remote (http)
    // or arbitrary local protocols.
    const FFMPEG_CMDV = ['ffmpeg', '-v', 'warning', '-nostdin', '-y', '-hide_banner', '-protocol_whitelist', 'file,crypto,data', '-ss', '[H5AI_DUR]', '-i', '[H5AI_SRC]', '-an', '-vframes', '1', '-f', 'image2', '-'];
    const FFMPEG_SWF_CMDV = ['ffmpeg', '-v', 'warning', '-nostdin', '-y', '-hide_banner', '-protocol_whitelist', 'file,crypto,data', '-i', '[H5AI_SRC]', '-ss', '[H5AI_DUR]', '-an', '-vframes', '1', '-f', 'image2', '-'];
    const FFPROBE_CMDV = ['ffprobe', '-v', 'warning', '-protocol_whitelist', 'file,crypto,data', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', '[H5AI_SRC]'];
    const AVCONV_CMDV = ['avconv', '-v', 'warning', '-nostdin', '-y', '-hide_banner', '-protocol_whitelist', 'file,crypto,data', '-ss', '[H5AI_DUR]', '-i', '[H5AI_SRC]', '-an', '-vframes', '1', '-f', 'image2', '-'];
    const AVCONV_SWF_CMDV = ['avconv', '-v', 'warning', '-nostdin', '-y', '-hide_banner', '-protocol_whitelist', 'file,crypto,data', '-i', '[H5AI_SRC]', '-ss', '[H5AI_DUR]', '-an', '-vframes', '1', '-f', 'image2', '-'];
    const AVPROBE_CMDV = ['avprobe', '-v', 'warning', '-protocol_whitelist', 'file,crypto,data', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', '[H5AI_SRC]'];
    const FFMPEG_AUD_CMDV = ['ffmpeg', '-v', 'warning', '-nostdin', '-y', '-hide_banner', '-protocol_whitelist', 'file,crypto,data', '-i', '[H5AI_SRC]', '-an', '-vframes', '1', '-f', 'image2', '-'];
    const AVCONV_AUD_CMDV = ['avconv', '-v', 'warning', '-nostdin', '-y', '-hide_banner', '-protocol_whitelist', 'file,crypto,data', '-i', '[H5AI_SRC]', '-an', '-vframes', '1', '-f', 'image2', '-'];
    const CONVERT_CMDV = ['convert', '-density', '200', '-quality', '100', '-strip', '[H5AI_SRC][0]', 'WEBP:-'];
    const GM_CONVERT_CMDV = ['gm', 'convert', '-density', '200', '-quality', '100', '-strip', '[H5AI_SRC][0]', 'WEBP:-'];
    const THUMB_CACHE = 'thumbs';
    const IMG_EXT = ['jpg', 'jpe', 'jpeg', 'jp2', 'jpx', 'tiff', 'webp', 'ico', 'png', 'bmp', 'gif'];

    public const HANDLED_TYPES = [
        'img' => ['img', 'img-bmp', 'img-jpg', 'img-gif', 'img-png', 'img-raw', 'img-tiff', 'img-svg', 'img-webp'],
        'mov' => ['vid-mp4', 'vid-webm', 'vid-rm', 'vid-mpg', 'vid-avi', 'vid-mkv', 'vid-mov'],
        'doc' => ['x-ps', 'x-pdf'],
        'swf' => ['vid-swf', 'vid-flv'],
        'ar-zip' => ['ar', 'ar-zip', 'ar-cbr'],
        'ar-rar' => ['ar-rar'],
        'aud' => ['aud'],
        'file' => ['file'],
    ];

    private readonly Setup $setup;
    private readonly string $thumbs_path;
    private readonly string $thumbs_href;
    private ?Image $image = null;
    private int $attempt = 0;
    private CacheDB $db;
    private ?string $source_path;
    private int|false $mtime;
    private ?FileType $type;
    private ?string $source_hash = null;
    private ?string $thumb_path = null;
    private ?string $thumb_href = null;
    private ?int $thumb_width = null;
    private ?int $thumb_height = null;

    public function __construct(
        private readonly Context $context,
        ?string $source_path = null,
        string|FileType|null $type = null,
        ?CacheDB $db = null,
    ) {
        $this->setup = $context->get_setup();
        $this->db = $db ?? new CacheDB($this->setup);
        $this->thumbs_path = $this->setup->get('CACHE_PUB_PATH') . '/' . self::THUMB_CACHE;
        $this->thumbs_href = $this->setup->get('CACHE_PUB_HREF') . self::THUMB_CACHE;
        $this->source_path = $source_path;
        if ($source_path !== null) {
            $this->source_hash = sha1($source_path);
            $this->mtime = @filemtime($this->source_path);
        }
        $this->type = is_string($type) ? new FileType($context, $type) : $type;

        if (!is_dir($this->thumbs_path)) {
            @mkdir($this->thumbs_path, 0755, true);
        }
    }

    public function __destruct() {
        unset($this->image);
    }

    public function get_type(): ?FileType {
        return $this->type;
    }

    private function check_custom_thumb(string $source_path): ?string {
        $supported_formats = ['png', 'jpg', 'jpeg', 'webp'];

        if (is_dir($source_path)) {
            $thumb_dir = $source_path . '/_thumb';
            if (is_dir($thumb_dir)) {
                $files = @scandir($thumb_dir);
                if ($files) {
                    $match = array_find($files, fn(string $file): bool => in_array(strtolower(pathinfo($file, PATHINFO_EXTENSION)), $supported_formats, true));
                    return $match !== null ? $thumb_dir . '/' . $match : null;
                }
            }
        } else {
            $fileparts = pathinfo($source_path);
            $match = array_find($supported_formats, fn(string $format): bool => file_exists($fileparts['dirname'] . '/_thumb/' . $fileparts['filename'] . '.' . $format));
            if ($match !== null) {
                return $fileparts['dirname'] . '/_thumb/' . $fileparts['filename'] . '.' . $match;
            }
        }
        return null;
    }

    public function thumb(int|string $arg1, ?int $arg2 = null, ?int $arg3 = null, ?int $arg4 = null): ?string {
        if ($arg3 !== null && $arg4 !== null) {
            $type = $arg1;
            $source_href = $arg2;
            $width = $arg3;
            $height = $arg4;

            $this->source_path = $this->context->to_path($source_href);
            $this->source_hash = sha1($this->source_path);
            $this->mtime = @filemtime($this->source_path);
            $this->type = new FileType($this->context, $type);
            $this->attempt = 0;
            $this->image = null;
        } else {
            $width = (int) $arg1;
            $height = (int) $arg2;
        }

        $this->thumb_width = $width;
        $this->thumb_height = $height;

        if (!file_exists($this->source_path)
            || str_starts_with($this->source_path, $this->setup->get('CACHE_PUB_PATH'))) {
            return null;
        }

        $is_directory = is_dir($this->source_path);
        $custom_thumb_source_path = $this->check_custom_thumb($this->source_path);

        if ($custom_thumb_source_path) {
            $this->source_path = $custom_thumb_source_path;
            $this->mtime = @filemtime($this->source_path);
            $this->source_hash = sha1($this->source_path);
            $this->type = new FileType($this->context, 'img');
        } elseif ($is_directory) {
            return null;
        }
        $name = 'thumb-' . $this->source_hash . '-' . $width . 'x' . $height . '.webp';
        $this->thumb_path = $this->thumbs_path . '/' . $name;
        $this->thumb_href = $this->thumbs_href . '/' . $name;

        if (file_exists($this->thumb_path) && $this->mtime <= filemtime($this->thumb_path)) {
            $row = $this->db->select($this->source_hash);
            if ($row) {
                $this->type->name = $row['type'];
            }
            return $this->thumb_href;
        }

        $row = $this->db->select($this->source_hash);
        if ($row && !$this->db->obsolete_entry($row, $this->mtime)) {
            return null;
        }

        if ($this->image !== null) {
            return $this->thumb_href($width, $height);
        }

        $handlers = self::get_handlers_array(self::type_to_handler($this->type->name));
        $thumb_href = null;

        foreach ($handlers as $handler) {
            if (!$this->capture($handler)) {
                if ($this->type->name === 'file') {
                    break;
                }
                continue;
            }
            $thumb_href = $this->thumb_href($width, $height);
            if ($thumb_href !== null) {
                if ($this->type->was_wrong()) {
                    $this->db->insert($this->source_hash, $this->type->name);
                }
                return $thumb_href;
            } elseif (!$this->type->was_wrong()) {
                break;
            }
        }
        return $thumb_href;
    }

    private function thumb_href(int $width, int $height): ?string {
        if (file_exists($this->thumb_path)) {
            return $this->thumb_href;
        }
        if (!isset($this->image)) {
            return null;
        }
        $this->image->thumb($width, $height);
        $this->image->save_dest_webp($this->thumb_path, 80);

        if ($this->thumb_path !== null && file_exists($this->thumb_path)) {
            return $this->thumb_href;
        }
        unset($this->image);
        $this->image = null;
        return null;
    }

    private function ext_to_type(string $path): string {
        $name = basename($path);
        return array_find_key(
            $this->context->get_types(),
            fn(array $values): bool => isset($values['glob']) && array_any(
                $values['glob'],
                fn(string $pattern): bool => (bool) preg_match('/^' . str_replace('\*', '.*', preg_quote($pattern, '/')) . '$/i', $name),
            ),
        ) ?? 'file';
    }

    private function capture(string $handler): bool {
        if ($this->attempt >= count(self::HANDLED_TYPES)) {
            return false;
        }
        ++$this->attempt;

        return match ($handler) {
            'file' => $this->capture_file(),
            'img' => $this->capture_img(),
            'mov' => $this->capture_mov(),
            'swf' => $this->capture_swf(),
            'aud' => $this->capture_aud(),
            'doc' => $this->capture_doc(),
            default => str_contains($handler, 'ar') ? $this->capture_archive($handler) : false,
        };
    }

    private function capture_file(): bool {
        $type = $this->ext_to_type($this->source_path);
        if ($type === 'file' && $this->setup->get('HAS_PHP_FILEINFO')) {
            $type = $this->type->mime_to_type(Util::get_mimetype($this->source_path));
        }
        $handler = self::type_to_handler($type);
        $this->type->name = $type;

        if ($handler === 'file') {
            return false;
        }
        return $this->capture($handler);
    }

    private function capture_img(): bool {
        if ($this->setup->get('HAS_PHP_EXIF') && !in_array($this->type->name, ['img-raw', 'img-svg', 'img-webp'], true)) {
            $exiftype = exif_imagetype($this->source_path);
            if (!$exiftype) {
                return $this->capture('file');
            }
            if ($exiftype === 4 || $exiftype === 13) {
                $this->type->name = 'vid-swf';
                return $this->capture('swf');
            }
        }
        return $this->do_capture_img($this->source_path) ?: $this->capture('file');
    }

    private function capture_mov(): bool {
        if ($this->setup->get('HAS_CMD_FFMPEG')) {
            $probe_cmd = self::FFPROBE_CMDV;
            $conv_cmd = self::FFMPEG_CMDV;
        } elseif ($this->setup->get('HAS_CMD_AVCONV')) {
            $probe_cmd = self::AVPROBE_CMDV;
            $conv_cmd = self::AVCONV_CMDV;
        } else {
            return false;
        }
        try {
            $timestamp = $this->compute_duration($probe_cmd, $this->source_path);
            return $this->do_capture($conv_cmd, $timestamp);
        } catch (\Exception) {
            return $this->capture('file');
        }
    }

    private function capture_swf(): bool {
        if ($this->setup->get('HAS_CMD_FFMPEG')) {
            $probe_cmd = self::FFPROBE_CMDV;
            $conv_cmd = self::FFMPEG_SWF_CMDV;
        } elseif ($this->setup->get('HAS_CMD_AVCONV')) {
            $probe_cmd = self::AVPROBE_CMDV;
            $conv_cmd = self::AVCONV_SWF_CMDV;
        } else {
            return false;
        }
        try {
            $timestamp = $this->compute_duration($probe_cmd, $this->source_path);
            // SWF/FLV needs the seek (-ss) placed after the input (-i); see FFMPEG_SWF_CMDV.
            return $this->do_capture($conv_cmd, $timestamp);
        } catch (\Exception) {
            return $this->capture('file');
        }
    }

    private function capture_aud(): bool {
        if ($this->setup->get('HAS_CMD_FFMPEG')) {
            $cmdv = self::FFMPEG_AUD_CMDV;
        } elseif ($this->setup->get('HAS_CMD_AVCONV')) {
            $cmdv = self::AVCONV_AUD_CMDV;
        } else {
            return false;
        }
        try {
            foreach ($cmdv as &$arg) {
                $arg = str_replace('[H5AI_SRC]', $this->source_path, $arg);
            }
            unset($arg);
            $capture_data = fopen('php://temp/maxmemory:' . 2 * 1024 * 1024, 'r+');
            $error = null;
            Util::proc_open_cmdv($cmdv, $capture_data, $error);
            rewind($capture_data);
            $content = stream_get_contents($capture_data);
            if (empty($content)) {
                fclose($capture_data);
                return false;
            }
            rewind($capture_data);
            return $this->do_capture_img($capture_data);
        } catch (\Exception) {
            return false;
        }
    }

    private function capture_doc(): bool {
        try {
            if ($this->setup->get('HAS_CMD_GM')) {
                return $this->do_capture(self::GM_CONVERT_CMDV);
            }
            if ($this->setup->get('HAS_CMD_CONVERT')) {
                return $this->do_capture(self::CONVERT_CMDV);
            }
            return false;
        } catch (\Exception) {
            return $this->capture('file');
        }
    }

    private function capture_archive(string $handler): bool {
        try {
            return $this->do_capture_archive($this->source_path, $handler);
        } catch (UnhandledArchive $e) {
            Util::log("Unhandled {$this->source_path}: " . $e->getMessage());
            $this->db->insert($this->source_hash, $this->type->name, $e->getCode());
            return true;
        } catch (WrongType) {
            return $this->capture('file');
        } catch (\Exception $e) {
            Util::log("Unhandled exception while reading archive {$this->source_path} of type {$handler}: " . $e->getMessage());
        }
        return false;
    }

    public function do_capture_img(mixed $source): bool {
        $capture_data = fopen('php://temp/maxmemory:' . 2 * 1024 * 1024, 'r+');

        $et = false;
        if ($this->setup->get('HAS_PHP_EXIF')
            && $this->context->query_option('thumbnails.exif', false) === true) {
            $et = @exif_thumbnail($source);
        }
        if ($et !== false) {
            $image = new Image($source);
            rewind($capture_data);
            fwrite($capture_data, $et);

            $is_valid = $image->set_source_data($capture_data);
            $image->normalize_exif_orientation($source);
            fclose($capture_data);
            if ($is_valid) {
                $this->image = $image;
                return true;
            }
            return false;
        }

        if (is_string($source) && class_exists('Imagick')) {
            try {
                $im = new \Imagick();
                $im->setResourceLimit(\Imagick::RESOURCETYPE_MEMORY, 128 * 1024 * 1024);
                $im->setResourceLimit(\Imagick::RESOURCETYPE_MAP, 256 * 1024 * 1024);
                $im->readImage($source);
                $orientation = $im->getImageOrientation();
                match ($orientation) {
                    \Imagick::ORIENTATION_BOTTOMRIGHT => $im->rotateImage('#000', 180),
                    \Imagick::ORIENTATION_RIGHTTOP => $im->rotateImage('#000', 90),
                    \Imagick::ORIENTATION_LEFTBOTTOM => $im->rotateImage('#000', 270),
                    default => null,
                };
                $im->setImageOrientation(\Imagick::ORIENTATION_TOPLEFT);

                $req_width = $this->thumb_width;
                $req_height = $this->thumb_height;
                if (!isset($req_width) || $req_width <= 0) {
                    $height_opt = $this->context->query_option('thumbnails.size', 240);
                    $req_width = (int) floor($height_opt * (4 / 3));
                }
                $req_height ??= 0;
                if ($req_height < 0) {
                    $req_height = 0;
                }

                if ($req_height === 0) {
                    $im->thumbnailImage($req_width, 0);
                } else {
                    $im->cropThumbnailImage($req_width, $req_height);
                }

                $im->setImageFormat('webp');
                $im->setImageCompressionQuality(80);
                $im->stripImage();
                $im->writeImage($this->thumb_path);
                $im->clear();
                $im->destroy();
                fclose($capture_data);
                return true;
            } catch (\Exception) {
                // fall through to GD
            }
        }

        $image = new Image($source);
        if (is_resource($source)) {
            $is_valid = $image->set_source_data($source);
            fclose($source);
        } else {
            $input_file = fopen($source, 'r');
            stream_copy_to_stream($input_file, $capture_data);
            fclose($input_file);
            $is_valid = $image->set_source_data($capture_data);
        }
        fclose($capture_data);

        if (!$is_valid) {
            unset($image);
            return false;
        }
        $this->image ??= $image;
        return true;
    }

    public function do_capture(array $cmdv, ?string $timestamp = null): bool {
        $replacements = ['[H5AI_SRC]' => $this->source_path];
        if ($timestamp !== null) {
            $replacements['[H5AI_DUR]'] = $timestamp;
        }
        $cmdv = str_replace(array_keys($replacements), array_values($replacements), $cmdv);

        $image = new Image($this->source_path);

        $capture_data = fopen('php://temp/maxmemory:' . 2 * 1024 * 1024, 'r+');

        $error = null;
        Util::proc_open_cmdv($cmdv, $capture_data, $error);

        rewind($capture_data);
        $magic = fread($capture_data, 3);
        $is_image = !empty($magic) && bin2hex($magic) === 'ffd8ff';

        if (!$is_image) {
            fclose($capture_data);
            throw new \Exception($error);
        }
        $success = $image->set_source_data($capture_data);
        fclose($capture_data);
        if (!$success) {
            return false;
        }
        $this->image ??= $image;
        return true;
    }

    private function compute_duration(array $cmdv, string $source_path): string {
        foreach ($cmdv as &$arg) {
            $arg = str_replace('[H5AI_SRC]', $source_path, $arg);
        }
        unset($arg);
        $output = null;
        $error = null;
        Util::proc_open_cmdv($cmdv, $output, $error);
        if (empty($output) || !is_numeric($output) || is_infinite((float) $output)) {
            if (!empty($error) && str_contains($error, 'misdetection possible')) {
                throw new \Exception($error);
            }
            return '0.1';
        }
        $duration = (float) $output;
        return (string) round(
            $duration * (float) $this->context->query_option('thumbnails.seek', 50) / 100,
            1,
            PHP_ROUND_HALF_UP,
        );
    }

    public static function get_handlers_array(string $handler): array {
        return [$handler, ...array_diff(array_keys(self::HANDLED_TYPES), [$handler])];
    }

    public static function type_to_handler(string $type): string {
        return array_find_key(self::HANDLED_TYPES, fn(array $types): bool => in_array($type, $types, true)) ?? 'file';
    }

    public function do_capture_archive(string $path, string $type): bool {
        $extracted = $this->extract_from_archive($type);
        if (!$extracted) {
            throw new UnhandledArchive('No file found in archive.', 1);
        }
        $success = $this->do_capture_img($extracted);
        if (!$success) {
            throw new UnhandledArchive('Failed processing selected thumbnail candidate from archive.', 2);
        }
        return $success;
    }

    public function extract_from_archive(string $type): mixed {
        if ($type === 'ar-zip' && $this->setup->get('HAS_PHP_ZIP')) {
            $za = new \ZipArchive();
            $err = $za->open($this->source_path, \ZipArchive::RDONLY);
            if ($err === true) {
                $extracted = false;
                for ($i = 0; $i < $za->numFiles; $i++) {
                    $entry = $za->getNameIndex($i);
                    if (str_ends_with($entry, '/')) {
                        continue;
                    }
                    $stat = $za->statIndex($i);
                    $ext = pathinfo($stat['name'], PATHINFO_EXTENSION);
                    if ($ext !== '' && in_array(strtolower($ext), self::IMG_EXT, true)) {
                        $extracted = fopen('php://temp/maxmemory:' . 2 * 1024 * 1024, 'r+');
                        fwrite($extracted, $za->getFromIndex($i));
                        break;
                    }
                }
                $za->close();
                return $extracted;
            }
            if ($err === \ZipArchive::ER_NOZIP) {
                throw new WrongType('Not a zip file', $err);
            }
            throw new \Exception("Unhandled Zip error code: {$err}", 5);
        }

        if ($type === 'ar-rar' && $this->setup->get('HAS_PHP_RAR')) {
            $rar = \RarArchive::open($this->source_path);
            if (!$rar) {
                throw new UnhandledArchive('Error opening rar archive', 4);
            }
            $extracted = false;
            $entries = $rar->getEntries();
            sort($entries, SORT_NATURAL);
            foreach ($entries as $entry) {
                if ($entry->isDirectory()) {
                    continue;
                }
                $ext = pathinfo($entry->getName(), PATHINFO_EXTENSION);
                if ($ext !== '' && in_array(strtolower($ext), self::IMG_EXT, true)) {
                    $stream = $entry->getStream();
                    if ($stream !== false) {
                        $extracted = fopen('php://temp/maxmemory:' . 2 * 1024 * 1024, 'r+');
                        fwrite($extracted, stream_get_contents($stream));
                        fclose($stream);
                        break;
                    }
                }
            }
            $rar->close();
            return $extracted;
        }
        throw new UnhandledArchive("No handler for archive of type {$type}.", 2);
    }
}

class Image {
    private ?string $source_file;
    private ?\GdImage $source = null;
    private ?int $width = null;
    private ?int $height = null;
    private ?\GdImage $dest = null;

    public function __construct(?string $filename = null) {
        $this->source_file = $filename;
    }

    public function __destruct() {
        $this->release_source();
        $this->release_dest();
    }

    public function set_source_data(mixed $fp): bool {
        $this->release_dest();

        rewind($fp);
        try {
            $this->source = @imagecreatefromstring(stream_get_contents($fp));
        } catch (\Exception) {
            $this->source = null;
            return false;
        }
        if (!$this->source) {
            $this->source = null;
            return false;
        }
        $this->width = imagesx($this->source);
        $this->height = imagesy($this->source);

        if (!$this->width || !$this->height) {
            $this->release_source();
            $this->source_file = null;
            $this->width = null;
            $this->height = null;
            return false;
        }
        return true;
    }

    public function save_dest_webp(string $filename, int $quality = 80): void {
        if ($this->dest !== null) {
            @imagewebp($this->dest, $filename, $quality);
            @chmod($filename, 0775);
        }
    }

    public function release_dest(): void {
        $this->dest = null;
    }

    public function release_source(): void {
        $this->source_file = null;
        $this->source = null;
        $this->width = null;
        $this->height = null;
    }

    public function thumb(int $width, int $height): void {
        if ($this->source === null) {
            return;
        }

        $src_r = 1.0 * $this->width / $this->height;

        if ($height === 0) {
            if ($src_r >= 1) {
                $height = (int) (1.0 * $width / $src_r);
            } else {
                $height = $width;
                $width = (int) (1.0 * $height * $src_r);
            }
            if ($width > $this->width) {
                $width = $this->width;
                $height = $this->height;
            }
        }

        $ratio = 1.0 * $width / $height;

        if ($src_r <= $ratio) {
            $src_w = $this->width;
            $src_h = (int) ($src_w / $ratio);
            $src_x = 0;
        } else {
            $src_h = $this->height;
            $src_w = (int) ($src_h * $ratio);
            $src_x = (int) (0.5 * ($this->width - $src_w));
        }

        $this->dest = imagecreatetruecolor($width, $height);
        $icol = imagecolorallocate($this->dest, 255, 255, 255);
        imagefill($this->dest, 0, 0, $icol);
        imagecopyresampled($this->dest, $this->source, 0, 0, $src_x, 0, $width, $height, $src_w, $src_h);
    }

    public function rotate(int $angle): void {
        if ($this->source === null || !in_array($angle, [90, 180, 270], true)) {
            return;
        }

        $this->source = imagerotate($this->source, $angle, 0);
        if ($angle === 90 || $angle === 270) {
            [$this->width, $this->height] = [$this->height, $this->width];
        }
    }

    public function normalize_exif_orientation(mixed $exif_source_file = null): void {
        if ($this->source === null || !function_exists('exif_read_data')) {
            return;
        }

        $exif_source_file ??= $this->source_file;

        $exif = exif_read_data($exif_source_file);
        match ($exif['Orientation'] ?? null) {
            3 => $this->rotate(180),
            6 => $this->rotate(270),
            8 => $this->rotate(90),
            default => null,
        };
    }
}

class FileType {
    private bool $name_changed = false;

    public string $name {
        set(string $value) {
            if (isset($this->name) && $value !== $this->name) {
                $this->name_changed = true;
            }
            $this->name = $value;
        }
    }

    public function __construct(
        private readonly Context $context,
        ?string $name = null,
    ) {
        $this->name = $name ?? '';
    }

    public function was_wrong(): bool {
        return $this->name_changed;
    }

    public function mime_to_type(string $mime): string {
        return array_find_key(
            $this->context->get_types(),
            fn(array $values): bool => isset($values['mime']) && array_any(
                $values['mime'],
                fn(string $test): bool => str_contains($mime, $test),
            ),
        ) ?? 'file';
    }
}

class UnhandledArchive extends \Exception {}
class WrongType extends \Exception {}
