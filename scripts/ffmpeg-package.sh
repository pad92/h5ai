#!/bin/sh
# Resolve FFmpeg by recipe and architecture. No registry credentials enter Docker.
set -eu
cd "$(dirname "$0")/.."

fail() { echo "ffmpeg: $*" >&2; exit 1; }
recipe=$(cat ci/ffmpeg.Dockerfile scripts/ffmpeg-package.sh | sha256sum | cut -d ' ' -f 1)
registry=
if [ -n "${CI:-}" ]; then
    : "${CI_API_V4_URL:?}" "${CI_PROJECT_ID:?}" "${CI_JOB_TOKEN:?}"
    case "$CI_API_V4_URL" in https://*) ;; *) fail 'Registry requires HTTPS' ;; esac
    registry="$CI_API_V4_URL/projects/$CI_PROJECT_ID/packages/generic/ffmpeg/$recipe"
fi
if [ "$#" -eq 0 ]; then
    case "$(docker info --format '{{.Architecture}}')" in
        x86_64|amd64) set -- amd64 ;;
        aarch64|arm64) set -- arm64 ;;
        *) fail 'Unsupported Docker host architecture' ;;
    esac
fi
for arch do
    case "$arch" in amd64|arm64) ;; *) fail "Unsupported architecture: $arch" ;; esac
done
mkdir -p .ffmpeg
work=$(mktemp -d .ffmpeg/tmp.XXXXXX)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# Only 404 means missing. Authentication, server and transport failures stop CI.
fetch() {
    status=$(curl --silent --show-error --location --proto '=https' --proto-redir '=https' \
        --connect-timeout 20 --max-time 300 --retry 3 \
        --header "JOB-TOKEN: $CI_JOB_TOKEN" --output "$2" \
        --write-out '%{http_code}' "$registry/$1") || fail 'Registry download failed'
    case "$status" in
        200) return 0 ;;
        404) return 1 ;;
        *) fail "Registry returned HTTP $status" ;;
    esac
}
upload() {
    curl --fail --silent --show-error --proto '=https' \
        --connect-timeout 20 --max-time 300 --header "JOB-TOKEN: $CI_JOB_TOKEN" \
        --upload-file "$2" "$registry/$1" > /dev/null
    fetch "$1" "$work/verified" || fail 'Uploaded package is missing'
    cmp "$2" "$work/verified" || fail 'Uploaded package differs from local file'
}

for arch do
    destination=".ffmpeg/$arch"
    if [ -z "$registry" ] && [ -f "$destination/recipe" ] && \
        [ "$(cat "$destination/recipe")" = "$recipe" ] && \
        [ -x "$destination/opt/ffmpeg/bin/ffmpeg" ]; then
        echo "ffmpeg: reuse local $arch package"
        continue
    fi
    manifest="linux-$arch.sha256"
    found=0
    if [ -n "$registry" ] && fetch "$manifest" "$work/checksum"; then
        checksum=$(cat "$work/checksum")
        case "$checksum" in ''|*[!0-9a-f]*) fail 'Invalid package checksum' ;; esac
        [ "${#checksum}" -eq 64 ] || fail 'Invalid checksum length'
        archive="linux-$arch-$checksum.tar.gz"
        # A manifest is a completed publication: missing payload is corruption.
        fetch "$archive" "$work/package.tar.gz" || fail 'Package payload is missing'
        printf '%s  %s\n' "$checksum" "$work/package.tar.gz" | sha256sum -c -
        found=1
        echo "ffmpeg: downloaded $arch package ($recipe)"
    fi
    if [ "$found" -eq 0 ]; then
        echo "ffmpeg: compiling $arch ($recipe)"
        set --
        if [ -n "${FFMPEG_BUILDER:-}" ]; then
            set -- --builder "$FFMPEG_BUILDER"
        fi
        docker buildx build "$@" --platform "linux/$arch" \
            --file ci/ffmpeg.Dockerfile --target package \
            --output "type=local,dest=$work/output-$arch" .
        tar -czf "$work/package.tar.gz" -C "$work/output-$arch" opt
        checksum=$(sha256sum "$work/package.tar.gz" | cut -d ' ' -f 1)
        printf '%s\n' "$checksum" > "$work/checksum"
        if [ -n "$registry" ] && [ "${FFMPEG_PUBLISH:-0}" = 1 ]; then
            archive="linux-$arch-$checksum.tar.gz"
            # Content-addressed payload first, completion marker last. A failed
            # upload can leave an unreferenced payload, never a ready package.
            if fetch "$archive" "$work/existing"; then
                cmp "$work/package.tar.gz" "$work/existing" || fail 'Existing payload differs'
            else
                upload "$archive" "$work/package.tar.gz"
            fi
            upload "$manifest" "$work/checksum"
        fi
    fi
    mkdir -p "$work/unpacked-$arch"
    tar -xzf "$work/package.tar.gz" -C "$work/unpacked-$arch"
    [ -x "$work/unpacked-$arch/opt/ffmpeg/bin/ffmpeg" ] || fail 'ffmpeg is missing'
    [ -x "$work/unpacked-$arch/opt/ffmpeg/bin/ffprobe" ] || fail 'ffprobe is missing'
    printf '%s\n' "$recipe" > "$work/unpacked-$arch/recipe"
    rm -rf "$destination"
    mv "$work/unpacked-$arch" "$destination"
done
