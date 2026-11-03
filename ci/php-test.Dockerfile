# PHP test environment shared by the `test:php` CI job and `make coverage`:
# GD with JPEG and WebP as in the runtime image, Xdebug for coverage, and a
# checksum-verified PHPUnit phar at /usr/local/bin/phpunit.phar. Built with
# an empty context; the Docker layer cache keeps it until a pin changes.
ARG PHP_IMAGE=php:8.4.27-cli@sha256:7e7413ed31b8c42b31c939cc83b3758b1cd618f7bf3803f5a0c39f98d4adcbee
FROM ${PHP_IMAGE}

# The checksum check below pipes into sha256sum.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG XDEBUG_VERSION=3.5.3
ARG PHPUNIT_VERSION=12.5.43
ARG PHPUNIT_SHA256=55350db3736f8d42170d9f7989ccd8b8e19ab4ba6be96e8c1c9cbcad430cb6d5

# The base image is pinned by digest; its Debian packages follow that
# snapshot's repositories.
# hadolint ignore=DL3008
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends libpng-dev libjpeg62-turbo-dev libwebp-dev \
    && rm -rf /var/lib/apt/lists/* \
    && docker-php-ext-configure gd --with-jpeg --with-webp \
    && docker-php-ext-install -j"$(nproc)" gd \
    && pecl install "xdebug-${XDEBUG_VERSION}" \
    && docker-php-ext-enable xdebug \
    && curl --fail --silent --show-error --location "https://phar.phpunit.de/phpunit-${PHPUNIT_VERSION}.phar" --output /usr/local/bin/phpunit.phar \
    && echo "${PHPUNIT_SHA256}  /usr/local/bin/phpunit.phar" | sha256sum --check -
