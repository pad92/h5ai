# Stage 1: Build h5ai application from source
FROM node:24.17.0-slim@sha256:862263c612aa437e3037674b85419622a9d93bff80aa1eee5398dfe686375532 AS h5ai-builder

WORKDIR /build
ARG H5AI_VERSION
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ ./src/
COPY test/ ./test/
COPY gulpfile.js eslint.config.js LICENSE ./
COPY scripts/package-name.js ./scripts/
RUN H5AI_VERSION="${H5AI_VERSION}" npm run build

# Stage 2: Build an ffmpeg that only decodes. h5ai runs it to grab one video
# frame or an audio cover as a JPEG, and ffprobe to read a duration. Alpine's
# ffmpeg links every encoder (x265, aom, SVT-AV1, rav1e, vpx, x264) and a
# Vulkan stack: about 39 MB of the compressed image, against about 5 MB here.
# The lists cover the types h5ai thumbnails (thumbnails.mov and .aud):
# demuxers for the containers, decoders for the codecs they carry, and the
# picture codecs of embedded covers. AV1 goes through libdav1d, which the
# final stage installs from Alpine. Grype reads the version in the binary and
# gates it like the packages: a finding means bumping FFMPEG_VERSION.
# musl gives threads a 128 KiB stack unless the executable asks for more in
# its ELF header; the ffmpeg CLI demuxes in a thread, and MPEG-TS overflows
# that stack (segfault on .ts/.mts), hence the 2 MiB stack-size link flag.
FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a AS ffmpeg-builder

ARG FFMPEG_VERSION=9.0.2
# SHA-256 of the release tarball whose ffmpeg-devel GPG signature was checked
# (key FCF986EA15E6E293A5644F10B4322F04D67658D8).
ARG FFMPEG_SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e

# BuildKit fetches the tarball itself and fails the build on a checksum
# mismatch; a remote archive is not unpacked by ADD.
ADD --checksum=sha256:${FFMPEG_SHA256} "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" /tmp/ffmpeg.tar.xz

RUN apk add --no-cache build-base dav1d-dev nasm pkgconf xz zlib-dev \
    && mkdir /src \
    && tar -C /src --strip-components=1 -xJf /tmp/ffmpeg.tar.xz \
    && cd /src \
    && ./configure --prefix=/opt/ffmpeg \
        --disable-everything --disable-autodetect --disable-doc --disable-debug --disable-network \
        --enable-shared --disable-static --disable-ffplay --enable-ffmpeg --enable-ffprobe --disable-avdevice \
        --enable-zlib --enable-libdav1d --enable-swscale \
        --enable-protocol=file,pipe,crypto,data \
        --enable-demuxer=mov,matroska,avi,flv,swf,asf,mpegts,mpegps,mpegvideo,rm,ogg,mp3,flac,aac,wav,aiff,m4v,h264,hevc,image2 \
        --enable-decoder=h264,hevc,mpeg1video,mpeg2video,mpeg4,msmpeg4v1,msmpeg4v2,msmpeg4v3,wmv1,wmv2,wmv3,vc1,vp8,vp9,libdav1d,theora,flv,h263,h263p,rv10,rv20,rv30,rv40,vp6,vp6a,vp6f,flashsv,flashsv2,mjpeg,png,bmp,gif,webp,prores,dvvideo \
        --enable-parser=h264,hevc,mpegvideo,mpeg4video,vc1,vp8,vp9,av1,mjpeg,png \
        --enable-encoder=mjpeg --enable-muxer=image2 --enable-filter=scale,format,null \
        --extra-ldexeflags=-Wl,-z,stack-size=2097152 \
    && make -j"$(nproc)" \
    && make install \
    && strip /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe /opt/ffmpeg/lib/lib*.so.* \
    && rm -rf /src /tmp/ffmpeg.tar.xz /opt/ffmpeg/include /opt/ffmpeg/lib/pkgconfig /opt/ffmpeg/share

# Stage 3: Fetch s6-overlay and compile the php-rar extension
FROM php:8.4.27-alpine3.24@sha256:d8784155c4d37986be9ddd7a8950df7e78998cc48e35472cd69e2b9371424a65 AS deps-builder

ARG S6_OVERLAY_VERSION=3.2.3.2
ARG TARGETARCH
ARG S6_NOARCH_SHA256=5379750ed30a84bbd2e2dd74847ba6b5bd29cd0b2e3ea2ec58049b57eb2eda12
ARG S6_X86_64_SHA256=e6befcc96a437a3831386ecfc51808c5d3e939dc5fe3c02ae9284599e8aa2408
ARG S6_AARCH64_SHA256=b17f17a82e7a515c682a91edaf2ffdabb73f891981b6c1fd712115693a2f8b4c

RUN case "${TARGETARCH}" in \
    "amd64") S6_ARCH="x86_64" ;; \
    "arm64") S6_ARCH="aarch64" ;; \
    *) echo "Unsupported TARGETARCH: '${TARGETARCH}'" >&2; exit 1 ;; \
    esac \
    && apk add --no-cache curl unzip xz \
    && curl --fail --location --proto '=https' --tlsv1.2 -o /tmp/s6-overlay-noarch.tar.xz "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" \
    && curl --fail --location --proto '=https' --tlsv1.2 -o /tmp/s6-overlay-arch.tar.xz "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" \
    && echo "${S6_NOARCH_SHA256}  /tmp/s6-overlay-noarch.tar.xz" | sha256sum -c - \
    && if [ "${S6_ARCH}" = "x86_64" ]; then echo "${S6_X86_64_SHA256}  /tmp/s6-overlay-arch.tar.xz" | sha256sum -c -; else echo "${S6_AARCH64_SHA256}  /tmp/s6-overlay-arch.tar.xz" | sha256sum -c -; fi \
    && mkdir -p /s6-overlay \
    && tar -C /s6-overlay -Jxpf /tmp/s6-overlay-noarch.tar.xz \
    && tar -C /s6-overlay -Jxpf /tmp/s6-overlay-arch.tar.xz \
    && rm -f /tmp/s6-overlay-noarch.tar.xz /tmp/s6-overlay-arch.tar.xz

COPY --from=h5ai-builder /build/build/h5ai-*.zip /tmp/h5ai.zip
RUN mkdir -p /h5ai/build/_h5ai \
    && unzip /tmp/h5ai.zip -d /h5ai/build/_h5ai \
    && rm /tmp/h5ai.zip

# Build php-rar extension from git source because PECL 4.2.0 is incompatible with PHP 8.4 zend_resolve_path API
ARG PHP_RAR_COMMIT=9c8fcd9ebc9feaf36f945d6d7407fdcd57b7136f
RUN apk add --no-cache --virtual .build-deps git autoconf g++ make \
    && git clone https://github.com/cataphract/php-rar.git /tmp/php-rar \
    && cd /tmp/php-rar \
    && git checkout ${PHP_RAR_COMMIT} \
    && phpize \
    && ./configure \
    && make -j$(nproc) \
    && make install \
    && cp $(php-config --extension-dir)/rar.so /tmp/rar.so \
    && apk del .build-deps \
    && rm -rf /tmp/php-rar

FROM docker.angie.software/angie:1.12.4-minimal@sha256:91305b12951efced43afae0d872bc972655d5f7053721c94eff9d28e54b8ab9c

ARG H5AI_VERSION
ENV H5AI_VERSION=${H5AI_VERSION}
ENV S6_KEEP_ENV=1
ENV S6_CMD_WAIT_FOR_SERVICES_MAXTIME=30000
ENV H5AI_ROOT_PATH=/share

# Only extensions actually used by the h5ai PHP code are installed:
# exif/gd/imagick (thumbnails), imagemagick-heic (HEIC/HEIF photos from
# phones, through libheif), poppler-utils (pdftoppm for PDF thumbnails, about
# 9 MiB installed; Ghostscript would take 62 MiB, about 20 MiB compressed, and
# only adds PostScript thumbnails), fileinfo (download mimetypes), mbstring,
# session, sqlite3 (CacheDB uses the SQLite3 class, not PDO), zip
# (ZipArchive) plus the tar/zip CLIs for packaged downloads.
# angie-console-light ships with the base image but nothing serves it.
RUN apk upgrade --no-cache && apk add --no-cache \
    apache2-utils \
    imagemagick \
    imagemagick-heic \
    imagemagick-jxl \
    imagemagick-raw \
    libdav1d \
    libraw \
    php84 \
    php84-exif \
    php84-fileinfo \
    php84-fpm \
    php84-gd \
    php84-mbstring \
    php84-opcache \
    php84-openssl \
    php84-pecl-imagick \
    php84-session \
    php84-sqlite3 \
    php84-zip \
    poppler-utils \
    shadow \
    tzdata \
    zip \
    && apk del angie-console-light

RUN php84 -r 'if (version_compare(PHP_VERSION, "8.4.27", "<")) { fwrite(STDERR, "PHP 8.4.27 or later is required for the security fixes.\n"); exit(1); }'

COPY --from=deps-builder /h5ai/build/_h5ai /usr/share/h5ai/_h5ai
COPY --from=deps-builder /s6-overlay/ /
# ffmpeg in /usr/bin: PHP-FPM clears the environment (clear_env), and the
# default PATH of its commands stops at /usr/bin. musl finds the libraries
# in /usr/local/lib. The folder is copied whole: a wildcard COPY would turn
# each library's symlinks into two more full copies.
COPY --from=ffmpeg-builder /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe /usr/bin/
COPY --from=ffmpeg-builder /opt/ffmpeg/lib/ /usr/local/lib/
COPY --from=deps-builder /tmp/rar.so /usr/lib/php84/modules/rar.so

COPY slash/     /

RUN ln -sf "$(command -v php84)" /usr/bin/php \
    && mkdir -p /etc/angie/conf.d \
    && ln -sf /dev/stderr /var/log/php84/error.log \
    && ln -sf /dev/stdout /var/log/angie/access.log \
    && ln -sf /dev/stderr /var/log/angie/error.log \
    && chmod +x /etc/s6-overlay/s6-rc.d/init-perms-auth/up \
    && chmod +x /etc/s6-overlay/s6-rc.d/php-fpm84/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/angie/run \
    && chmod +x /usr/local/bin/init-perms-auth.sh \
    && echo "extension=rar.so" > /etc/php84/conf.d/50_rar.ini

ARG BUILD_DATE
ARG BUILD_VCSREF

LABEL maintainer="pad92" \
    org.label-schema.url="https://github.com/pad92/h5ai/blob/master/README.md" \
    org.label-schema.build-date=$BUILD_DATE \
    org.label-schema.version=$H5AI_VERSION \
    org.label-schema.vcs-url="https://github.com/pad92/h5ai.git" \
    org.label-schema.vcs-ref=$BUILD_VCSREF \
    org.label-schema.docker.dockerfile="/Dockerfile" \
    org.label-schema.description="h5ai on alpine docker image" \
    org.label-schema.schema-version="1.0"

EXPOSE 80

ENTRYPOINT ["/init"]
# The endpoint is served directly by Angie and does not execute PHP or inspect
# the mounted share. Uses busybox wget so the image does not need curl.
# 127.0.0.1 instead of localhost: busybox wget prefers ::1 while Angie
# listens on IPv4 only.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -S -T 5 -O /dev/null http://127.0.0.1/healthz 2>&1 \
    | grep -qE 'HTTP/1\.[01] 200' || exit 1
