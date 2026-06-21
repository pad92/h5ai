<?php

class Request {
    private readonly array $params;

    public function __construct(array $params, string $body) {
        $data = json_decode($body, true);
        $this->params = $data ?? $params;
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
