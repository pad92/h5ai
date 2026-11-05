# Build the php-rar extension from git source: PECL 4.2.0 is incompatible
# with the PHP 8.4 zend_resolve_path API. The main image loads rar.so into
# Alpine's php84, which shares this PHP version's extension API; bump the
# base image below with the PHP version the main Dockerfile requires.
FROM php:8.4.27-alpine3.24@sha256:d8784155c4d37986be9ddd7a8950df7e78998cc48e35472cd69e2b9371424a65 AS php-rar-builder

ARG PHP_RAR_COMMIT=9c8fcd9ebc9feaf36f945d6d7407fdcd57b7136f
RUN apk add --no-cache git autoconf g++ make \
    && git clone https://github.com/cataphract/php-rar.git /tmp/php-rar \
    && cd /tmp/php-rar \
    && git checkout ${PHP_RAR_COMMIT} \
    && phpize \
    && ./configure \
    && make -j"$(nproc)" \
    && make install \
    && mkdir -p /opt/php-rar \
    && cp "$(php-config --extension-dir)/rar.so" /opt/php-rar/rar.so \
    && rm -rf /tmp/php-rar

RUN php -d extension=/opt/php-rar/rar.so -r 'exit(extension_loaded("rar") ? 0 : 1);'

FROM scratch AS package
COPY --from=php-rar-builder /opt/php-rar /opt/php-rar
