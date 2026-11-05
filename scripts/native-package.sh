#!/bin/sh
# Resolve a native package by recipe and architecture, from the registry or by
# compiling ci/<package>.Dockerfile. No registry credentials enter Docker.
# Usage: native-package.sh ffmpeg|php-rar [amd64|arm64]...
set -eu
# Never trace this script: it handles the package signing key.
set +x
cd "$(dirname "$0")/.."

name=${1:-}
fail() { echo "${name:-native-package}: $*" >&2; exit 1; }
# Files each package must hold under opt/, checked after download or build.
case "$name" in
    ffmpeg) executables='opt/ffmpeg/bin/ffmpeg opt/ffmpeg/bin/ffprobe' files= ;;
    php-rar) executables= files='opt/php-rar/rar.so' ;;
    *) fail 'Usage: native-package.sh ffmpeg|php-rar [amd64|arm64]...' ;;
esac
shift
# The key covers what shapes the binaries: the build recipe and the archive
# layout. Edits to this script's logic keep reusing published packages; bump
# PACKAGE_FORMAT only when the archive content or layout changes.
PACKAGE_FORMAT=1
# The recipe file differs between packages, so a signature over one package's
# recipe never validates another's. Keep this formula: changing it renames
# every published package and recompiles arm64 under QEMU.
recipe=$({ printf 'format %s\n' "$PACKAGE_FORMAT"; cat "ci/$name.Dockerfile"; } | sha256sum | cut -d ' ' -f 1)
registry=
if [ -n "${CI:-}" ]; then
    : "${CI_API_V4_URL:?}" "${CI_PROJECT_ID:?}" "${CI_JOB_TOKEN:?}"
    case "$CI_API_V4_URL" in https://*) ;; *) fail 'Registry requires HTTPS' ;; esac
    registry="$CI_API_V4_URL/projects/$CI_PROJECT_ID/packages/generic/$name/$recipe"
fi
# Any branch job token can write to the registry, so publishing pipelines only
# reuse packages signed with a key that protected refs alone receive. Missing
# key: fail before compiling rather than publish unsigned packages. The key
# signs every package; its name predates php-rar and stays for the existing
# CI/CD variable.
signing=0 signing_key=
if [ -n "$registry" ] && [ "${PACKAGE_PUBLISH:-0}" = 1 ]; then
    [ -n "${FFMPEG_SIGNING_KEY:-}" ] || fail 'PACKAGE_PUBLISH=1 requires FFMPEG_SIGNING_KEY: define it as a protected, masked CI/CD variable and publish from protected branches and tags only (doc/development.md)'
    case "$FFMPEG_SIGNING_KEY" in *[!0-9a-fA-F]*) fail 'FFMPEG_SIGNING_KEY must be hexadecimal (openssl rand -hex 32)' ;; esac
    [ "${#FFMPEG_SIGNING_KEY}" -eq 64 ] || fail 'FFMPEG_SIGNING_KEY must be 64 hexadecimal characters (openssl rand -hex 32)'
    # Keep the key out of the environment of docker, curl and tar.
    signing=1 signing_key=$FFMPEG_SIGNING_KEY
    unset FFMPEG_SIGNING_KEY
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
mkdir -p ".$name"
work=$(mktemp -d ".$name/tmp.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM

# Only 404 means missing. Authentication, server and transport failures stop CI.
# Redirects are not followed with the job token: curl resends custom headers to
# every redirect host, and storage redirects are pre-signed URLs anyway.
fetch() {
    result=$(curl --silent --show-error --proto '=https' \
        --connect-timeout 20 --max-time 300 --retry 3 \
        --header "JOB-TOKEN: $CI_JOB_TOKEN" --output "$2" \
        --write-out '%{http_code} %{redirect_url}' "$registry/$1") || fail 'Registry download failed'
    status=${result%% *}
    case "$status" in
        200) return 0 ;;
        404) return 1 ;;
        301|302|303|307|308)
            location=${result#* }
            case "$location" in https://*) ;; *) fail 'Registry redirect is not HTTPS' ;; esac
            curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
                --connect-timeout 20 --max-time 300 --retry 3 \
                --output "$2" "$location" || fail 'Package storage download failed'
            return 0 ;;
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
# Set $mac to the signature of package $1 with checksum $2. openssl takes the
# key on its command line; the job environment already holds it, so hiding it
# from argv would not protect it from code running in the job. Callers may run
# with errexit suspended (inside if), so failures are checked here.
sign() {
    mac=$(printf '%s %s %s' "$recipe" "$1" "$2" |
        openssl dgst -sha256 -mac HMAC -macopt "hexkey:$signing_key" -r) ||
        fail 'Package signing failed'
    mac=${mac%% *}
    case "$mac" in *[!0-9a-f]*) fail 'Package signing failed' ;; esac
    [ "${#mac}" -eq 64 ] || fail 'Package signing failed'
}
distrust() {
    echo "WARNING: $name: registry $arch package ($recipe) $1; rebuilding and republishing it" >&2
}
# Leave the published package in $work/package.tar.gz, or return 1 to build it.
# Publishing pipelines rebuild what they cannot trust instead of failing: a
# branch job writing to the registry must not be able to block a release.
# Other pipelines publish nothing and fail on an inconsistent package.
download() {
    fetch "$manifest" "$work/checksum" || return 1
    checksum=$(cat "$work/checksum")
    if [ "$signing" -eq 1 ]; then
        if ! fetch "$signature" "$work/signature"; then
            distrust 'has no signature'
            return 1
        fi
        sign "$arch" "$checksum"
        # Plain string equality: no pattern matching on registry content.
        if [ "$(cat "$work/signature")" != "$mac" ]; then
            distrust 'has an invalid signature'
            return 1
        fi
    fi
    case "$checksum" in ''|*[!0-9a-f]*) fail 'Invalid package checksum' ;; esac
    [ "${#checksum}" -eq 64 ] || fail 'Invalid checksum length'
    archive="linux-$arch-$checksum.tar.gz"
    # A manifest is a completed publication: missing payload is corruption.
    if ! fetch "$archive" "$work/package.tar.gz"; then
        [ "$signing" -eq 1 ] || fail 'Package payload is missing'
        distrust 'payload is missing'
        return 1
    fi
    if ! printf '%s  %s\n' "$checksum" "$work/package.tar.gz" | sha256sum -c -; then
        [ "$signing" -eq 1 ] || fail 'Package payload does not match its checksum'
        distrust 'payload does not match its checksum'
        return 1
    fi
}

# Print the first file package tree $1 lacks; return 1 if it lacks one.
missing() {
    for file in $executables; do
        [ -x "$1/$file" ] || { echo "$file"; return 0; }
    done
    for file in $files; do
        [ -s "$1/$file" ] || { echo "$file"; return 0; }
    done
    return 1
}

for arch do
    destination=".$name/$arch"
    if [ -z "$registry" ] && [ -f "$destination/recipe" ] && \
        [ "$(cat "$destination/recipe")" = "$recipe" ] && \
        ! missing "$destination" > /dev/null; then
        echo "$name: reuse local $arch package"
        continue
    fi
    manifest="linux-$arch.sha256"
    signature="$manifest.hmac"
    found=0
    if [ -n "$registry" ] && download; then
        found=1
        echo "$name: downloaded $arch package ($recipe)"
    fi
    if [ "$found" -eq 0 ]; then
        echo "$name: compiling $arch ($recipe)"
        set --
        if [ -n "${PACKAGE_BUILDER:-}" ]; then
            set -- --builder "$PACKAGE_BUILDER"
        fi
        # The recipes copy nothing from the context: an empty one keeps the
        # checkout and the prepared package trees out of BuildKit.
        mkdir -p "$work/context"
        docker buildx build "$@" --platform "linux/$arch" \
            --file "ci/$name.Dockerfile" --target package \
            --output "type=local,dest=$work/output-$arch" "$work/context"
        # Check before publishing: a signed incomplete package would fail
        # every later pipeline until the recipe changes.
        if lacking=$(missing "$work/output-$arch"); then
            fail "$lacking is missing"
        fi
        tar -czf "$work/package.tar.gz" -C "$work/output-$arch" opt
        checksum=$(sha256sum "$work/package.tar.gz" | cut -d ' ' -f 1)
        printf '%s\n' "$checksum" > "$work/checksum"
        if [ "$signing" -eq 1 ]; then
            archive="linux-$arch-$checksum.tar.gz"
            # Content-addressed payload, then its signature, completion marker
            # last. A failed upload can leave an unreferenced payload or a
            # signature that does not match the previous manifest, never a
            # ready package without a valid signature. A different payload
            # under this name is corrupt: upload ours, the latest file wins.
            if ! fetch "$archive" "$work/existing" || ! cmp -s "$work/package.tar.gz" "$work/existing"; then
                upload "$archive" "$work/package.tar.gz"
            fi
            sign "$arch" "$checksum"
            printf '%s\n' "$mac" > "$work/signature"
            upload "$signature" "$work/signature"
            upload "$manifest" "$work/checksum"
        fi
    fi
    mkdir -p "$work/unpacked-$arch"
    tar -xzf "$work/package.tar.gz" -C "$work/unpacked-$arch"
    if lacking=$(missing "$work/unpacked-$arch"); then
        fail "$lacking is missing"
    fi
    printf '%s\n' "$recipe" > "$work/unpacked-$arch/recipe"
    rm -rf "$destination"
    mv "$work/unpacked-$arch" "$destination"
done
