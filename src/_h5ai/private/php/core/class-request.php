<?php

class Request {
    private readonly array $params;

    public static function from_globals(): self {
        $params = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST' ? $_POST : $_GET;
        return new self($params, file_get_contents('php://input'), $_SERVER['CONTENT_TYPE'] ?? '');
    }

    public function __construct(array $params, string $body, string $content_type = 'application/json') {
        $media_type = strtolower(trim(explode(';', $content_type, 2)[0]));
        if ($body === '' || in_array($media_type, ['application/x-www-form-urlencoded', 'multipart/form-data'], true)) {
            // PHP already decodes form fields, including hrefs[] arrays.
            $this->params = $params;
            return;
        }
        Util::json_fail(Util::ERR_ILLIGAL_PARAM, 'unsupported request content type', $media_type !== 'application/json');
        $data = json_decode($body, true);
        if (!is_array($data) || !str_starts_with(ltrim($body), '{')) {
            Util::json_fail(Util::ERR_ILLIGAL_PARAM, 'request body must be a JSON object');
        }
        $this->params = $data;
    }

    public function query(string $keypath = '', mixed $default = Util::NO_DEFAULT): mixed {
        $value = Util::array_query($this->params, $keypath, Util::NO_DEFAULT);

        if ($value === Util::NO_DEFAULT) {
            Util::json_fail(Util::ERR_MISSING_PARAM, "parameter '{$keypath}' is missing", $default === Util::NO_DEFAULT);
            return $default;
        }

        return $value;
    }

    public function query_boolean(string $keypath = '', mixed $default = Util::NO_DEFAULT): bool {
        return filter_var($this->query($keypath, $default), FILTER_VALIDATE_BOOLEAN);
    }

    public function query_string(string $keypath = '', mixed $default = Util::NO_DEFAULT): string {
        $value = $this->query($keypath, $default);
        Util::json_fail(Util::ERR_ILLIGAL_PARAM, "parameter '{$keypath}' is not a string", !is_string($value));
        return $value;
    }

    public function query_numeric(string $keypath = '', mixed $default = Util::NO_DEFAULT): int {
        $value = $this->query($keypath, $default);
        Util::json_fail(Util::ERR_ILLIGAL_PARAM, "parameter '{$keypath}' is not numeric", !is_numeric($value));
        return intval($value, 10);
    }

    public function query_array(string $keypath = '', mixed $default = Util::NO_DEFAULT): array {
        $value = $this->query($keypath, $default);
        Util::json_fail(Util::ERR_ILLIGAL_PARAM, "parameter '{$keypath}' is no array", !is_array($value));
        return $value;
    }
}
