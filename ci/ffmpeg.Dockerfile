# Build an ffmpeg that only decodes. h5ai runs it to grab one video
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
# SHA-256 of GitHub's source archive for the official n9.0.2 mirror tag.
ARG FFMPEG_SHA256=6e374ed621e48faa40639307dff48ba6fe574a509977956d2cce9669b7cc27e9

# BuildKit fetches the tarball itself and fails the build on a checksum
# mismatch; a remote archive is not unpacked by ADD.
ADD --checksum=sha256:${FFMPEG_SHA256} "https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n${FFMPEG_VERSION}.tar.gz" /tmp/ffmpeg.tar.gz

RUN apk add --no-cache build-base dav1d-dev nasm pkgconf xz zlib-dev \
    && mkdir /src \
    && tar -C /src --strip-components=1 -xzf /tmp/ffmpeg.tar.gz \
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
    && rm -rf /src /tmp/ffmpeg.tar.gz /opt/ffmpeg/include /opt/ffmpeg/lib/pkgconfig /opt/ffmpeg/share

RUN LD_LIBRARY_PATH=/opt/ffmpeg/lib /opt/ffmpeg/bin/ffmpeg -version \
    && LD_LIBRARY_PATH=/opt/ffmpeg/lib /opt/ffmpeg/bin/ffprobe -version

FROM scratch AS package
COPY --from=ffmpeg-builder /opt/ffmpeg /opt/ffmpeg
