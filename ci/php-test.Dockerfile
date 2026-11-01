# PHP test environment shared by the `test:php` CI job and `make coverage`:
# GD with JPEG and WebP as in the runtime image, Xdebug for coverage, and a
# checksum-verified PHPUnit phar at /usr/local/bin/phpunit.phar. Built with
# an empty context; the Docker layer cache keeps it until a pin changes.
ARG PHP_IMAGE=php:8.4.27-cli@sha256:a4ae1f57e22b89a0a69c5e085b3010ee727d094e1542d249e48a01bec3c44810
FROM ${PHP_IMAGE}

# The checksum check below pipes into sha256sum.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG XDEBUG_VERSION=3.5.3
ARG PHPUNIT_VERSION=12.5.42
ARG PHPUNIT_SHA256=bcd5cef3751188d7953f46efafd407c1acf37c5f49dbf7933e413eb20e933ac5

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
