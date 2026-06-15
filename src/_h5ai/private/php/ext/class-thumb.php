<?php

class Thumb {
    const FFMPEG_CMDV = ['ffmpeg', '-v', 'warning', '-nostdin', '-y', '-hide_banner', '-ss', '[H5AI_DUR]', '-i', '[H5AI_SRC]', '-an', '-vframes', '1', '-f', 'image2', '-'];
    const FFPROBE_CMDV = ['ffprobe', '-v', 'warning', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', '[H5AI_SRC]'];
    const AVCONV_CMDV = ['avconv', '-v', 'warning', '-nostdin', '-y', '-hide_banner', '-ss', '[H5AI_DUR]', '-i', '[H5AI_SRC]', '-an', '-vframes', '1', '-f', 'image2', '-'];
    const AVPROBE_CMDV = ['avprobe', '-v', 'warning', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', '[H5AI_SRC]'];
    const CONVERT_CMDV = ['convert', '-density', '200', '-quality', '100', '-strip', '[H5AI_SRC][0]', 'WEBP:-'];
    const GM_CONVERT_CMDV = ['gm', 'convert', '-density', '200', '-quality', '100', '-strip', '[H5AI_SRC][0]', 'WEBP:-'];
    const THUMB_CACHE = 'thumbs';
    const IMG_EXT = ['jpg', 'jpe', 'jpeg', 'jp2', 'jpx', 'tiff', 'webp', 'ico', 'png', 'bmp', 'gif'];

    // 'file' has to be the last key tested during fallback logic.
    public const HANDLED_TYPES = array(
        'img' => ['img', 'img-bmp', 'img-jpg', 'img-gif', 'img-png', 'img-raw', 'img-tiff', 'img-svg', 'img-webp'],
        'mov' => ['vid-mp4', 'vid-webm', 'vid-rm', 'vid-mpg', 'vid-avi', 'vid-mkv', 'vid-mov'],
        'doc' => ['x-ps', 'x-pdf'],
        'swf' => ['vid-swf', 'vid-flv'],
        'ar-zip' => ['ar', 'ar-zip', 'ar-cbr'],
        'ar-rar' => ['ar-rar'],
        'file' => ['file']
    );

    private $context;
    private $setup;
    private $thumbs_path;
    private $thumbs_href;
    private $image;
    private $attempt;
    private $db;
    private $source_path;
    private $mtime;
    private $type;
    private $source_hash;
    private $thumb_path;
    private $thumb_href;

    public function __construct($context, $source_path = null, $type = null, $db = null) {
        $this->context = $context;
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
        $this->thumb_path = null;
        $this->thumb_href = null;
        $this->image = null;
        $this->attempt = 0;

        if (!is_dir($this->thumbs_path)) {
            @mkdir($this->thumbs_path, 0755, true);
        }
    }

    public function __destruct() {
        if ($this->image !== null) {
            unset($this->image);
        }
    }

    public function get_type() {
        return $this->type ?? null;
    }

    private function check_custom_thumb($source_path) {
        $supported_formats = ['png', 'jpg', 'jpeg', 'webp'];

        if (is_dir($source_path)) {
            $thumb_dir = $source_path . '/_thumb';
            if (is_dir($thumb_dir)) {
                $files = @scandir($thumb_dir);
                if ($files) {
                    foreach ($files as $file) {
                        $extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));
                        if (in_array($extension, $supported_formats)) {
                            return $thumb_dir . '/' . $file;
                        }
                    }
                }
            }
        } else {
            $fileparts = pathinfo($source_path);
            foreach ($supported_formats as $format) {
                $custom_path = $fileparts['dirname'] . '/_thumb/' . $fileparts['filename'] . '.' . $format;
                if (file_exists($custom_path)) {
                    return $custom_path;
                }
            }
        }
        return null;
    }

    public function thumb($arg1, $arg2 = null, $arg3 = null, $arg4 = null) {
        if ($arg3 !== null && $arg4 !== null) {
            // Old signature: thumb($type, $source_href, $width, $height)
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
            // New signature: thumb($width, $height)
            $width = $arg1;
            $height = $arg2;
        }

        if (!file_exists($this->source_path)
            || Util::starts_with($this->source_path,
                $this->setup->get('CACHE_PUB_PATH'))) {
            return null;
        }

        $is_directory = is_dir($this->source_path);
        $custom_thumb_source_path = $this->check_custom_thumb($this->source_path);

        if ($custom_thumb_source_path) {
            $this->source_path = $custom_thumb_source_path;
            $this->mtime = @filemtime($this->source_path);
            $this->source_hash = sha1($this->source_path);
            $this->type = new FileType($this->context, 'img');
        } else if ($is_directory) {
            return null;
        }
        $name = 'thumb-' . $this->source_hash . '-' . $width . 'x' . $height . '.webp';
        $this->thumb_path = $this->thumbs_path . '/' . $name;
        $this->thumb_href = $this->thumbs_href . '/' . $name;

        if (file_exists($this->thumb_path)
            && $this->mtime <= filemtime($this->thumb_path)) {
            if ($this->db) {
                $row = $this->db->select($this->source_hash);
                if ($row) {
                    $this->type->name = $row['type'];
                }
            }
            return $this->thumb_href;
        }

        if ($this->db) {
            $row = $this->db->select($this->source_hash);
            if ($row && !$this->db->obsolete_entry($row, $this->mtime)) {
                return null;
            }
        }

        if ($this->image !== null) {
            return $this->thumb_href($width, $height);
        }

        $handlers = self::get_handlers_array(
            self::type_to_handler($this->type->name));
        $thumb_href = null;

        foreach($handlers as $handler) {
            if (!$this->capture($handler)) {
                if ($this->type->name === 'file') {
                    break;
                }
                continue;
            }
            $thumb_href = $this->thumb_href($width, $height);
            if (!is_null($thumb_href)) {
                if ($this->type->was_wrong() && $this->db) {
                    $this->db->insert($this->source_hash, $this->type->name);
                }
                return $thumb_href;
            } else if (!$this->type->was_wrong()) {
                break;
            }
        }
        return $thumb_href;
    }

    private function thumb_href($width, $height) {
        if (file_exists($this->thumb_path)) {
            return $this->thumb_href;
        }
        if (!isset($this->image)) {
            return null;
        }
        $this->image->thumb($width, $height);
        $this->image->save_dest_webp($this->thumb_path, 80);

        if (!is_null($this->thumb_path) && file_exists($this->thumb_path)) {
            return $this->thumb_href;
        }
        unset($this->image);
        $this->image = null;
        return null;
    }

    private function capture($handler) {
        if ($this->attempt >= count(array_keys(self::HANDLED_TYPES))) {
            return false;
        }
        ++$this->attempt;
        if ($handler === 'file') {
            if ($this->setup->get('HAS_PHP_FILEINFO')) {
                $type = $this->type->mime_to_type(
                    Util::get_mimetype($this->source_path));
                $handler = self::type_to_handler($type);
                $this->type->name = $type;

                if ($handler === 'file') {
                    return false;
                }
                return $this->capture($handler);
            }
            else {
                $this->type->name = 'file';
                return false;
            }
        }
        else if ($handler === 'img') {
            if ($this->setup->get('HAS_PHP_EXIF')) {
                $exiftype = exif_imagetype($this->source_path);
                if (!$exiftype) {
                    return $this->capture('file');
                }
                else if ($exiftype === 4 || $exiftype === 13) {
                    $this->type->name = 'vid-swf';
                    return $this->capture('swf');
                }
            }
            $success = $this->do_capture_img($this->source_path);
            return $success ? $success : $this->capture('file');
        }
        else if ($handler === 'mov') {
            if ($this->setup->get('HAS_CMD_FFMPEG')) {
                $probe_cmd = self::FFPROBE_CMDV;
                $conv_cmd = self::FFMPEG_CMDV;
            } else if ($this->setup->get('HAS_CMD_AVCONV')) {
                $probe_cmd = self::AVPROBE_CMDV;
                $conv_cmd = self::AVCONV_CMDV;
            } else {
                return false;
            }
            try {
                $timestamp = $this->compute_duration($probe_cmd, $this->source_path);
                return $this->do_capture($conv_cmd, $timestamp);
            } catch (Exception $e) {
                return $this->capture('file');
            }
        }
        else if ($handler === 'swf'){
            if ($this->setup->get('HAS_CMD_FFMPEG')) {
                $probe_cmd = self::FFPROBE_CMDV;
                $conv_cmd = self::FFMPEG_CMDV;
            } else if ($this->setup->get('HAS_CMD_AVCONV')) {
                $probe_cmd = self::AVPROBE_CMDV;
                $conv_cmd = self::AVCONV_CMDV;
            } else {
                return false;
            }
            try {
                $timestamp = $this->compute_duration($probe_cmd, $this->source_path);
                $conv_cmd[6] = '-i';
                $conv_cmd[7] = '[H5AI_SRC]';
                $conv_cmd[8] = '-ss';
                $conv_cmd[9] = '[H5AI_DUR]';
                return $this->do_capture($conv_cmd, $timestamp);
            } catch (Exception $e) {
                return $this->capture('file');
            }
        }
        else if ($handler === 'doc') {
            try {
                if ($this->setup->get('HAS_CMD_GM')) {
                    return $this->do_capture(self::GM_CONVERT_CMDV);
                } else if ($this->setup->get('HAS_CMD_CONVERT')) {
                    return $this->do_capture(self::CONVERT_CMDV);
                } else {
                    return false;
                }
            } catch (Exception $e) {
                return $this->capture('file');
            }
        }
        else if (strpos($handler, 'ar') !== false) {
            try {
                return $this->do_capture_archive($this->source_path, $handler);
            } catch (UnhandledArchive $e) {
                Util::log("Unhandled $this->source_path: ". $e->getMessage());
                if ($this->db) {
                    $this->db->insert($this->source_hash, $this->type->name, $e->getCode());
                }
                return true;
            } catch (WrongType $e) {
                return $this->capture('file');
            } catch (Exception $e) {
                Util::log(
                    "Unhandled exception while reading archive $this->source_path of type $handler: ". $e->getMessage());
            }
        }
        return false;
    }

    public function do_capture_img($source) {
        $capture_data = fopen("php://temp/maxmemory:". 2 * 1024 * 1024, 'r+');

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
                $im = new Imagick($source);
                $orientation = $im->getImageOrientation();
                switch ($orientation) {
                    case Imagick::ORIENTATION_BOTTOMRIGHT:
                        $im->rotateImage('#000', 180);
                        break;
                    case Imagick::ORIENTATION_RIGHTTOP:
                        $im->rotateImage('#000', 90);
                        break;
                    case Imagick::ORIENTATION_LEFTBOTTOM:
                        $im->rotateImage('#000', 270);
                        break;
                }
                $im->setImageOrientation(Imagick::ORIENTATION_TOPLEFT);

                $height = $this->context->query_option('thumbnails.size', 240);
                $width = floor($height * (4 / 3));

                if ($height == 0) {
                    $im->thumbnailImage($width, 0);
                } else {
                    $im->cropThumbnailImage($width, $height);
                }

                $im->setImageFormat('webp');
                $im->setImageCompressionQuality(80);
                $im->stripImage();
                $im->writeImage($this->thumb_path);
                $im->clear();
                $im->destroy();
                fclose($capture_data);
                return true;
            } catch (Exception $e) {
                // fall through to GD
            }
        }

        $image = new Image($source);
        if (is_resource($source)) {
            $is_valid = $image->set_source_data($source);
            fclose($source);
        } else {
            $input_file  = fopen($source, 'r');
            stream_copy_to_stream($input_file, $capture_data);
            fclose($input_file);
            $is_valid = $image->set_source_data($capture_data);
        }
        fclose($capture_data);

        if (!$is_valid) {
            unset($image);
            return false;
        }
        if ($this->image === null) {
            $this->image = $image;
        }
        return true;
    }

    public function do_capture($cmdv, $timestamp = null) {
        if (is_null($timestamp)){
            foreach ($cmdv as &$arg) {
                $arg = str_replace('[H5AI_SRC]', $this->source_path, $arg);
            }
        } else {
            foreach ($cmdv as &$arg) {
                $arg = str_replace(
                    ['[H5AI_SRC]', '[H5AI_DUR]'],
                    [$this->source_path, $timestamp],
                    $arg
                );
            }
        }
        $image = new Image($this->source_path);

        $capture_data = fopen("php://temp/maxmemory:". 2 * 1024 * 1024, 'r+');

        $error = null;
        $exit = Util::proc_open_cmdv($cmdv, $capture_data, $error);

        rewind($capture_data);
        $magic = fread($capture_data, 3);
        $is_image = (!empty($magic)) ? (bin2hex($magic) === 'ffd8ff') : false;

        if (!$is_image) {
            fclose($capture_data);
            throw new Exception($error);
        }
        $success = $image->set_source_data($capture_data);
        fclose($capture_data);
        if (!$success) {
            return false;
        }
        if ($this->image === null) {
            $this->image = $image;
        }
        return true;
    }

    private function compute_duration($cmdv, $source_path) {
        foreach ($cmdv as &$arg) {
            $arg = str_replace('[H5AI_SRC]', $source_path, $arg);
        }
        $output = null;
        $error = null;
        $exit = Util::proc_open_cmdv($cmdv, $output, $error);
        if (empty($output) || !is_numeric($output) || is_infinite((float)$output)) {
            if (!empty($error) && strpos($error, 'misdetection possible') !== false) {
                throw new Exception($error);
            }
            return '0.1';
        }
        $duration = floatval($output);
        return strval(
            round(
            ($duration *
            floatval($this->context->query_option('thumbnails.seek', 50)) / 100),
            1, PHP_ROUND_HALF_UP)
        );
    }

    public static function get_handlers_array($handler) {
        $available = array_keys(self::HANDLED_TYPES);
        $handlers[] = $handler;
        foreach($available as $item) {
            if ($item === $handler)
                continue;
            $handlers[] = $item;
        }
        return $handlers;
    }

    public static function type_to_handler($type) {
        foreach(array_keys(self::HANDLED_TYPES) as $key) {
            if (array_search($type,
                    self::HANDLED_TYPES[$key]) !== false) {
                return $key;
            }
        }
        return 'file';
    }

    public function do_capture_archive($path, $type) {
        $extracted = $this->extract_from_archive($type);
        if (!$extracted) {
            throw new UnhandledArchive("No file found in archive.", 1);
        }
        $success = $this->do_capture_img($extracted);
        if (!$success){
            throw new UnhandledArchive(
                "Failed processing selected thumbnail candidate from archive.", 2);
        }
        return $success;
    }

    public function extract_from_archive($type) {
        if (($type === "ar-zip") && ($this->setup->get('HAS_PHP_ZIP'))) {
            $za = new ZipArchive();
            $err = $za->open($this->source_path, ZipArchive::RDONLY);
            $extracted = false;
            if ($err === true) {
                for($i = 0; $i < $za->numFiles; $i++) {
                    $entry = $za->getNameIndex($i);
                    if (substr($entry, -1, 1) == '/') {
                        continue;
                    }
                    $stat = $za->statIndex($i);
                    $label =  $stat['name'];
                    $tmp = explode(".", $label);
                    $ext = end($tmp);
                    if (!empty($ext)
                        && array_search($ext, self::IMG_EXT) !== false) {
                        $extracted = fopen(
                            "php://temp/maxmemory:". 2 * 1024 * 1024, 'r+');
                        fwrite($extracted, $za->getFromIndex($i));
                        break;
                    }
                }
                $za->close();
                return $extracted;
            } else if ($err === ZipArchive::ER_NOZIP) {
                throw new WrongType("Not a zip file", $err);
            } else {
                throw new Exception("Unhandled Zip error code: $err", 5);
            }
        }
        if (($type === "ar-rar") && ($this->setup->get('HAS_PHP_RAR'))) {
            $rar = RarArchive::open($this->source_path);
            if (!$rar) {
                throw new UnhandledArchive("Error opening rar archive", 4);
            }
            $extracted = false;
            $entries = $rar->getEntries();
            sort($entries, SORT_NATURAL);
            foreach ($entries as $entry) {
                if ($entry->isDirectory()) continue;
                $label = $entry->getName();
                $tmp = explode(".", $label);
                $ext = end($tmp);
                if (!empty($ext) && array_search($ext, self::IMG_EXT) !== false) {
                    $stream = $entry->getStream();
                    if ($stream !== false) {
                        $extracted = fopen(
                            "php://temp/maxmemory:". 2 * 1024 * 1024, 'r+');
                        fwrite($extracted, stream_get_contents($stream));
                        fclose($stream);
                        break;
                    }
                }
            }
            $rar->close();
            return $extracted;
        }
        throw new UnhandledArchive("No handler for archive of type $type.", 2);
    }
}

class Image {
    private $source_file;
    private $source;
    private $width;
    private $height;
    private $dest;

    public function __construct($filename = null) {
        $this->source_file = null;
        $this->source = null;
        $this->width = null;
        $this->height = null;
        $this->dest = null;
        $this->source_file = $filename;
    }

    public function __destruct() {
        $this->release_source();
        $this->release_dest();
    }

    public function set_source_data($fp) {
        $this->release_dest();

        rewind($fp);
        try {
            $this->source = @imagecreatefromstring(stream_get_contents($fp));
        } catch (Exception $e) {
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

    public function save_dest_webp($filename, $quality = 80) {
        if (!is_null($this->dest)) {
            @imagewebp($this->dest, $filename, $quality);
            @chmod($filename, 0775);
        }
    }

    public function release_dest() {
        if (!is_null($this->dest)) {
            @imagedestroy($this->dest);
            $this->dest = null;
        }
    }

    public function release_source() {
        if (!is_null($this->source)) {
            @imagedestroy($this->source);
            $this->source_file = null;
            $this->source = null;
            $this->width = null;
            $this->height = null;
        }
    }

    public function thumb($width, $height) {
        if (is_null($this->source)) {
            return;
        }

        $src_r = 1.0 * $this->width / $this->height;

        if ($height == 0) {
            if ($src_r >= 1) {
                $height = 1.0 * $width / $src_r;
            } else {
                $height = $width;
                $width = 1.0 * $height * $src_r;
            }
            if ($width > $this->width) {
                $width = $this->width;
                $height = $this->height;
            }
        }

        $ratio = 1.0 * $width / $height;

        if ($src_r <= $ratio) {
            $src_w = $this->width;
            $src_h = $src_w / $ratio;
            $src_x = 0;
        } else {
            $src_h = $this->height;
            $src_w = $src_h * $ratio;
            $src_x = 0.5 * ($this->width - $src_w);
        }

        $width = intval($width);
        $height = intval($height);
        $src_x = intval($src_x);
        $src_w = intval($src_w);
        $src_h = intval($src_h);

        $this->dest = imagecreatetruecolor($width, $height);
        $icol = imagecolorallocate($this->dest, 255, 255, 255);
        imagefill($this->dest, 0, 0, $icol);
        imagecopyresampled($this->dest, $this->source, 0, 0, $src_x, 0, $width, $height, $src_w, $src_h);
    }

    public function rotate($angle) {
        if (is_null($this->source) || ($angle !== 90 && $angle !== 180 && $angle !== 270)) {
            return;
        }

        $this->source = imagerotate($this->source, $angle, 0);
        if ( $angle === 90 || $angle === 270 ) {
            list($this->width, $this->height) = [$this->height, $this->width];
        }
    }

    public function normalize_exif_orientation($exif_source_file = null) {
        if (is_null($this->source) || !function_exists('exif_read_data')) {
            return;
        }

        if ($exif_source_file === null) {
            $exif_source_file = $this->source_file;
        }

        $exif = exif_read_data($exif_source_file);
        switch (@$exif['Orientation']) {
            case 3:
                $this->rotate(180);
                break;
            case 6:
                $this->rotate(270);
                break;
            case 8:
                $this->rotate(90);
                break;
        }
    }
}

class FileType {
    private $name;
    private $name_changed;
    private $context;

    public function __construct($context, $name = null) {
        $this->name = $name;
        $this->context = $context;
        $this->name_changed = false;
    }

    public function __get($property) {
        if (property_exists($this, $property)) {
            return $this->$property;
        }
    }

    public function __set($property, $value) {
        if (property_exists($this, $property)) {
            $pv = $this->name;
            if ($value !== $this->$property) {
                $this->$property = $value;
                if ($this->name !== $pv) {
                    $this->name_changed = true;
                }
            }
        }
        return $this;
    }

    public function was_wrong() {
        return $this->name_changed;
    }

    public function mime_to_type($mime) {
        foreach($this->context->get_types() as $key => $values) {
            if (count($values) < 2) {
                continue;
            }
            foreach($values['mime'] as $test) {
                if (strpos($mime, $test) !== false) {
                    return $key;
                }
            }
        }
        return 'file';
    }
}

class UnhandledArchive extends Exception {}
class WrongType extends Exception {}
