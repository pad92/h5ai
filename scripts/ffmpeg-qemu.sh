#!/bin/sh
# Called under the CI docker-build resource group, also for PHP-RAR arm64.
set -eu
docker run --privileged --rm tonistiigi/binfmt:qemu-v10.2.3-68@sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0 --uninstall 'qemu-*' || true
docker run --privileged --rm tonistiigi/binfmt:qemu-v10.2.3-68@sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0 --install all
builder=$(docker buildx inspect --bootstrap h5ai-ci)
case "$builder" in
    *linux/arm64*) ;;
    *)
        docker buildx stop h5ai-ci
        builder=$(docker buildx inspect --bootstrap h5ai-ci)
        case "$builder" in
            *linux/arm64*) ;;
            *) echo 'Builder h5ai-ci cannot emulate linux/arm64' >&2; exit 1 ;;
        esac
        ;;
esac
