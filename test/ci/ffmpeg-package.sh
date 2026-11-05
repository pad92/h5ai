#!/bin/sh
# Exercise registry decisions without Docker, credentials or network access.
set -eu
root=$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
mkdir -p "$work/repo/scripts" "$work/repo/ci" "$work/bin" "$work/registry"
cp "$root/scripts/ffmpeg-package.sh" "$work/repo/scripts/"
cp "$root/ci/ffmpeg.Dockerfile" "$work/repo/ci/"
export MOCK_ROOT="$work"
export CI=true CI_API_V4_URL=https://registry.invalid/api/v4 CI_PROJECT_ID=1 CI_JOB_TOKEN=test-only
export PATH="$work/bin:$PATH"
cat > "$work/bin/docker" <<'MOCK'
#!/bin/sh
set -eu
echo build >> "$MOCK_ROOT/builds"
for arg do
    case "$arg" in type=local,dest=*) dest=${arg#type=local,dest=} ;; esac
done
mkdir -p "$dest/opt/ffmpeg/bin" "$dest/opt/ffmpeg/lib"
printf '#!/bin/sh\nexit 0\n' > "$dest/opt/ffmpeg/bin/ffmpeg"
cp "$dest/opt/ffmpeg/bin/ffmpeg" "$dest/opt/ffmpeg/bin/ffprobe"
chmod +x "$dest/opt/ffmpeg/bin/"*
printf library > "$dest/opt/ffmpeg/lib/libavutil.so.1"
ln -s libavutil.so.1 "$dest/opt/ffmpeg/lib/libavutil.so"
MOCK
cat > "$work/bin/curl" <<'MOCK'
#!/bin/sh
set -eu
out= upload= url=
while [ "$#" -gt 0 ]; do
    case "$1" in
        --output) out=$2; shift ;;
        --upload-file) upload=$2; shift ;;
        --header|--write-out|--proto|--proto-redir|--connect-timeout|--max-time|--retry) shift ;;
        https://*) url=$1 ;;
    esac
    shift
done
relative=${url##*/generic/}
file="$MOCK_ROOT/registry/$relative"
if [ -n "$upload" ]; then
    echo "$relative" >> "$MOCK_ROOT/uploads"
    case "$relative" in *.sha256) [ "${FAIL_MANIFEST:-0}" != 1 ] || exit 22 ;; esac
    mkdir -p "$(dirname "$file")"
    cp "$upload" "$file"
elif [ -n "${HTTP_ERROR:-}" ]; then
    : > "$out"
    printf '%s' "$HTTP_ERROR"
elif [ -f "$file" ]; then
    cp "$file" "$out"
    printf 200
else
    : > "$out"
    printf 404
fi
MOCK
chmod +x "$work/bin/"*
cd "$work/repo"
run() { sh scripts/ffmpeg-package.sh "$@" > "$work/log" 2>&1; }
count() { wc -l < "$1" | tr -d ' '; }
expect_failure() {
    if run amd64; then echo 'Expected failure' >&2; exit 1; fi
}
export FFMPEG_PUBLISH=1
run amd64 arm64
[ "$(count "$work/builds")" = 2 ]
[ "$(count "$work/uploads")" = 4 ]
[ -L .ffmpeg/arm64/opt/ffmpeg/lib/libavutil.so ]
run amd64 arm64
[ "$(count "$work/builds")" = 2 ]
[ "$(count "$work/uploads")" = 4 ]
echo 'PASS: publish both architectures, then reuse without compiling or uploading'
for HTTP_ERROR in 401 403 500; do
    export HTTP_ERROR
    expect_failure
    [ "$(count "$work/builds")" = 2 ]
done
unset HTTP_ERROR
echo 'PASS: registry errors never trigger compilation'
manifest=$(find "$work/registry" -name linux-amd64.sha256)
cp "$manifest" "$work/good-checksum"
printf invalid > "$manifest"
expect_failure
cp "$work/good-checksum" "$manifest"
payload="$(dirname "$manifest")/linux-amd64-$(cat "$manifest").tar.gz"
cp "$payload" "$work/good-payload"
printf corrupt > "$payload"
expect_failure
rm "$payload"
expect_failure
cp "$work/good-payload" "$payload"
[ "$(count "$work/builds")" = 2 ]
echo 'PASS: malformed checksum, corrupt and missing payloads fail closed'
printf '\n# recipe update\n' >> ci/ffmpeg.Dockerfile
export FFMPEG_PUBLISH=0
run amd64
[ "$(count "$work/builds")" = 3 ]
[ "$(count "$work/uploads")" = 4 ]
echo 'PASS: recipe change rebuilds, branches do not publish'
export FFMPEG_PUBLISH=1 FAIL_MANIFEST=1
expect_failure
unset FAIL_MANIFEST
run amd64
before=$(count "$work/builds")
run amd64
[ "$(count "$work/builds")" = "$before" ]
echo 'PASS: interrupted publication recovers and becomes reusable'
unset CI CI_JOB_TOKEN
run amd64
[ "$(count "$work/builds")" = "$before" ]
echo 'PASS: local preparation reuses matching recipe'
if run ../bad; then echo 'Invalid architecture accepted' >&2; exit 1; fi
echo 'PASS: invalid architecture rejected'
