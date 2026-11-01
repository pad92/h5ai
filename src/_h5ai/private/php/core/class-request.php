<?php

// API request parameters: PHP's parsed form fields, or the JSON object body.
// The query_* accessors read a dot-separated key path ("items.href"). A
// missing parameter without default, or one of the wrong type, ends the
// request with an ERR_MISSING_PARAM / ERR_ILLEGAL_PARAM JSON answer.
class Request {
    private readonly array $params;

    public static function from_globals(): self {
        $params = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST' ? $_POST : $_GET;
        return new self($params, file_get_contents('php://input'), $_SERVER['CONTENT_TYPE'] ?? '', $_SERVER['REMOTE_ADDR'] ?? '');
    }

    // A non-form body must be a JSON object (application/json or +json);
    // anything else is rejected with ERR_ILLEGAL_PARAM.
    public function __construct(
        array $params,
        string $body,
        string $content_type = '',
        private readonly string $client_address = '',
    ) {
        $content_type = strtolower(trim(explode(';', $content_type, 2)[0]));

        if ($body === '' || in_array($content_type, ['application/x-www-form-urlencoded', 'multipart/form-data'], true)) {
            $this->params = $params;
            return;
        }

        if ($content_type !== 'application/json'
            && !(str_starts_with($content_type, 'application/') && str_ends_with($content_type, '+json'))) {
            Util::json_error(Util::ERR_ILLEGAL_PARAM, 'unsupported request body content type');
        }

        $data = json_decode($body, true);
        if (!is_array($data) || !str_starts_with(ltrim($body), '{')) {
            Util::json_error(Util::ERR_ILLEGAL_PARAM, 'request body must be a JSON object');
        }

        $this->params = $data;
    }

    // Address of the client as the web server sees it (REMOTE_ADDR).
    public function client_address(): string {
        return $this->client_address;
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
        Util::json_fail(Util::ERR_ILLEGAL_PARAM, "parameter '{$keypath}' is not a string", !is_string($value));
        return $value;
    }

    public function query_numeric(string $keypath = '', mixed $default = Util::NO_DEFAULT): int {
        $value = $this->query($keypath, $default);
        Util::json_fail(Util::ERR_ILLEGAL_PARAM, "parameter '{$keypath}' is not numeric", !is_numeric($value));
        return intval($value, 10);
    }

    public function query_array(string $keypath = '', mixed $default = Util::NO_DEFAULT): array {
        $value = $this->query($keypath, $default);
        Util::json_fail(Util::ERR_ILLEGAL_PARAM, "parameter '{$keypath}' is no array", !is_array($value));
        return $value;
    }
}
