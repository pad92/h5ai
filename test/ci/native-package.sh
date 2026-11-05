#!/bin/sh
# Exercise registry decisions without Docker, credentials or network access.
set -eu
root=$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
mkdir -p "$work/repo/scripts" "$work/repo/ci" "$work/bin" "$work/registry"
cp "$root/scripts/native-package.sh" "$work/repo/scripts/"
cp "$root/ci/ffmpeg.Dockerfile" "$root/ci/php-rar.Dockerfile" "$work/repo/ci/"
export MOCK_ROOT="$work"
export CI=true CI_API_V4_URL=https://registry.invalid/api/v4 CI_PROJECT_ID=1 CI_JOB_TOKEN=test-only
export PATH="$work/bin:$PATH"
cat > "$work/bin/docker" <<'MOCK'
#!/bin/sh
set -eu
echo build >> "$MOCK_ROOT/builds"
printf '%s\n' "$*" >> "$MOCK_ROOT/argv"
env >> "$MOCK_ROOT/environ"
recipe= previous=
for arg do
    [ "$previous" != --file ] || recipe=$arg
    case "$arg" in type=local,dest=*) dest=${arg#type=local,dest=} ;; esac
    previous=$arg
done
case "$recipe" in
    ci/ffmpeg.Dockerfile)
        mkdir -p "$dest/opt/ffmpeg/bin" "$dest/opt/ffmpeg/lib"
        printf '#!/bin/sh\nexit 0\n' > "$dest/opt/ffmpeg/bin/ffmpeg"
        cp "$dest/opt/ffmpeg/bin/ffmpeg" "$dest/opt/ffmpeg/bin/ffprobe"
        chmod +x "$dest/opt/ffmpeg/bin/"*
        printf library > "$dest/opt/ffmpeg/lib/libavutil.so.1"
        ln -s libavutil.so.1 "$dest/opt/ffmpeg/lib/libavutil.so"
        ;;
    ci/php-rar.Dockerfile)
        # MOCK_EMPTY: a recipe whose package stage lost its file.
        mkdir -p "$dest/opt/php-rar"
        [ "${MOCK_EMPTY:-0}" = 1 ] || printf extension > "$dest/opt/php-rar/rar.so"
        ;;
    *) echo "unexpected recipe: $recipe" >&2; exit 1 ;;
esac
# Reproducible like a real rebuild of the same recipe can be.
find "$dest" -exec touch -h -d '2000-01-01 00:00:00' {} +
MOCK
cat > "$work/bin/curl" <<'MOCK'
#!/bin/sh
# Like curl, --location resends custom headers to the redirect host.
set -eu
printf '%s\n' "$*" >> "$MOCK_ROOT/argv"
env >> "$MOCK_ROOT/environ"
out= upload= url= header= writeout= follow=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --output) out=$2; shift ;;
        --upload-file) upload=$2; shift ;;
        --header) header=$2; shift ;;
        --write-out) writeout=$2; shift ;;
        --location) follow=1 ;;
        --proto|--proto-redir|--connect-timeout|--max-time|--retry) shift ;;
        https://*) url=$1 ;;
    esac
    shift
done
reply() {
    [ -z "$writeout" ] || printf '%s' "$writeout" | sed "s|%{http_code}|$1|; s|%{redirect_url}|$2|"
}
case "$url" in
    https://storage.invalid/*)
        [ -z "$header" ] || echo "$header" >> "$MOCK_ROOT/leaked"
        cp "$MOCK_ROOT/registry/${url#https://storage.invalid/}" "$out"
        reply 200 ''
        exit 0
        ;;
esac
relative=${url##*/generic/}
file="$MOCK_ROOT/registry/$relative"
if [ -n "$upload" ]; then
    echo "$relative" >> "$MOCK_ROOT/uploads"
    case "$relative" in *.sha256) [ "${FAIL_MANIFEST:-0}" != 1 ] || exit 22 ;; esac
    mkdir -p "$(dirname "$file")"
    cp "$upload" "$file"
elif [ -n "${HTTP_ERROR:-}" ]; then
    : > "$out"
    reply "$HTTP_ERROR" ''
elif [ -f "$file" ] && [ "${MOCK_REDIRECT:-0}" = 1 ]; then
    location="https://storage.invalid/$relative"
    if [ "$follow" = 1 ]; then
        exec "$0" --header "$header" --output "$out" --write-out "$writeout" "$location"
    fi
    : > "$out"
    reply 302 "$location"
elif [ -f "$file" ]; then
    cp "$file" "$out"
    reply 200 ''
else
    : > "$out"
    reply 404 ''
fi
MOCK
chmod +x "$work/bin/"*
cd "$work/repo"
run() { sh scripts/native-package.sh ffmpeg "$@" > "$work/log" 2>&1; }
run_rar() { sh scripts/native-package.sh php-rar "$@" > "$work/log" 2>&1; }
count() { wc -l < "$1" | tr -d ' '; }
expect_failure() {
    if run amd64; then echo 'Expected failure' >&2; exit 1; fi
}
# Test-only keys. The script must never pass them to another program's argv
# or environment, nor print them.
key=8f36a95c0b1e7d24c3f05a6b9e8d7c1f2a3b4c5d6e7f80916a5c36b4e2d1f0a9
other_key=0b7e5c36d1a2f4e8c9b0a1d2e3f4c5b6a7d8e9f0c1b2a3d4e5f6a7b8c9d0e1f2
# HMAC-SHA256 oracle for the script's signatures, itself checked against
# RFC 4231 test case 2 so a broken oracle cannot agree with a broken script.
hmac() { printf '%s' "$2" | openssl mac -digest SHA256 -macopt "hexkey:$1" HMAC | tr 'A-F' 'a-f'; }
[ "$(hmac 4a656665 'what do ya want for nothing?')" = 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843 ]
assert_signed() {
    sum=$(cat "$dir/linux-$1.sha256")
    [ "$(cat "$dir/linux-$1.sha256.hmac")" = "$(hmac "$key" "$recipe $1 $sum")" ]
    [ -f "$dir/linux-$1-$sum.tar.gz" ]
    printf '%s  %s\n' "$sum" "$dir/linux-$1-$sum.tar.gz" | sha256sum -c - > /dev/null
}
# errexit ignores a negated command: fail explicitly.
refute() {
    if "$@"; then echo "Unexpected success: $*" >&2; exit 1; fi
}
assert_no_leak() {
    refute grep -F -q -e "$key" -e "$other_key" "$work/argv" "$work/environ" "$work/log"
}
export PACKAGE_PUBLISH=1 FFMPEG_SIGNING_KEY="$key"
run amd64 arm64
[ "$(count "$work/builds")" = 2 ]
[ "$(count "$work/uploads")" = 6 ]
[ -L .ffmpeg/arm64/opt/ffmpeg/lib/libavutil.so ]
dir=$(echo "$work"/registry/ffmpeg/*)
recipe=${dir##*/}
assert_signed amd64
assert_signed arm64
# Payload, signature, then the manifest that marks the package ready.
[ "$(grep linux-amd64 "$work/uploads" | sed 's|.*/||')" = "$(printf '%s\n' \
    "linux-amd64-$(cat "$dir/linux-amd64.sha256").tar.gz" linux-amd64.sha256.hmac linux-amd64.sha256)" ]
run amd64 arm64
[ "$(count "$work/builds")" = 2 ]
[ "$(count "$work/uploads")" = 6 ]
assert_no_leak
echo 'PASS: publish signed packages for both architectures, then reuse without compiling or uploading'
# Packages published before php-rar joined keep their key: another formula
# would recompile FFmpeg for arm64 under QEMU (about 45 minutes).
[ "$recipe" = "$({ printf 'format 1\n'; cat ci/ffmpeg.Dockerfile; } | sha256sum | cut -d ' ' -f 1)" ]
echo 'PASS: the FFmpeg package key keeps its formula'
printf '\n# logic change\n' >> scripts/native-package.sh
run amd64 arm64
[ "$(count "$work/builds")" = 2 ]
echo 'PASS: editing the package script keeps reusing published packages'
rm -rf .ffmpeg
MOCK_REDIRECT=1 run amd64
[ ! -e "$work/leaked" ]
[ -x .ffmpeg/amd64/opt/ffmpeg/bin/ffmpeg ]
[ "$(count "$work/builds")" = 2 ]
echo 'PASS: storage redirects are followed without the job token'
for HTTP_ERROR in 401 403 500; do
    export HTTP_ERROR
    expect_failure
    [ "$(count "$work/builds")" = 2 ]
done
unset HTTP_ERROR
echo 'PASS: registry errors never trigger compilation'
uploads=$(count "$work/uploads")
calls=$(count "$work/argv")
unset FFMPEG_SIGNING_KEY
expect_failure
grep -q 'requires FFMPEG_SIGNING_KEY' "$work/log"
for FFMPEG_SIGNING_KEY in "${key%?}" "${key}0" "${key%?}g" "$key "; do
    export FFMPEG_SIGNING_KEY
    expect_failure
    grep -q 'FFMPEG_SIGNING_KEY must be' "$work/log"
    refute grep -F -q -e "$FFMPEG_SIGNING_KEY" "$work/log"
done
[ "$(count "$work/builds")" = 2 ]
[ "$(count "$work/uploads")" = "$uploads" ]
[ "$(count "$work/argv")" = "$calls" ]
echo 'PASS: publishing without a well-formed key fails before any registry or Docker call'
# Branch pipelines get no key and check no signature.
export PACKAGE_PUBLISH=0
unset FFMPEG_SIGNING_KEY
mv "$dir/linux-amd64.sha256.hmac" "$work/good-signature"
rm -rf .ffmpeg
run amd64
[ -x .ffmpeg/amd64/opt/ffmpeg/bin/ffmpeg ]
[ "$(count "$work/builds")" = 2 ]
[ "$(count "$work/uploads")" = "$uploads" ]
mv "$work/good-signature" "$dir/linux-amd64.sha256.hmac"
echo 'PASS: branches reuse published packages without a key'
manifest="$dir/linux-amd64.sha256"
cp "$manifest" "$work/good-checksum"
printf invalid > "$manifest"
expect_failure
cp "$work/good-checksum" "$manifest"
payload="$dir/linux-amd64-$(cat "$manifest").tar.gz"
cp "$payload" "$work/good-payload"
printf corrupt > "$payload"
expect_failure
rm "$payload"
expect_failure
cp "$work/good-payload" "$payload"
[ "$(count "$work/builds")" = 2 ]
echo 'PASS: on branches, malformed checksum, corrupt and missing payloads fail closed'
# What a compromised branch job can write with its token: a package of its
# own under the release recipe, unsigned, signed with another key, or carrying
# the signature of the genuine package.
forge() {
    rm -rf "$work/forged"
    mkdir -p "$work/forged/opt/ffmpeg/bin"
    printf '#!/bin/sh\necho forged\n' > "$work/forged/opt/ffmpeg/bin/ffmpeg"
    cp "$work/forged/opt/ffmpeg/bin/ffmpeg" "$work/forged/opt/ffmpeg/bin/ffprobe"
    chmod +x "$work/forged/opt/ffmpeg/bin/"*
    tar -czf "$work/forged.tar.gz" -C "$work/forged" opt
    forged=$(sha256sum "$work/forged.tar.gz" | cut -d ' ' -f 1)
    cp "$work/forged.tar.gz" "$dir/linux-amd64-$forged.tar.gz"
    printf '%s\n' "$forged" > "$manifest"
    case "$1" in
        unsigned) rm -f "$dir/linux-amd64.sha256.hmac" ;;
        other-key) hmac "$other_key" "$recipe amd64 $forged" > "$dir/linux-amd64.sha256.hmac" ;;
        replayed) ;;
    esac
}
# A release run rebuilds, warns and republishes a genuinely signed package.
# A rebuild need not reproduce the earlier archive byte for byte (tar follows
# the file system's directory order), so the republished package is checked
# by its signature, not compared with the first one.
assert_rebuilt() {
    [ "$(count "$work/builds")" = "$1" ]
    grep -q "^WARNING: ffmpeg: registry amd64 package ($recipe) $2; rebuilding" "$work/log"
    refute grep -q forged .ffmpeg/amd64/opt/ffmpeg/bin/ffmpeg
    [ "$(cat "$manifest")" != "${forged:-}" ]
    assert_signed amd64
}
export PACKAGE_PUBLISH=1 FFMPEG_SIGNING_KEY="$key"
builds=2
for attack in unsigned other-key replayed; do
    forge "$attack"
    rm -rf .ffmpeg
    run amd64
    builds=$((builds + 1))
    if [ "$attack" = unsigned ]; then reason='has no signature'; else reason='has an invalid signature'; fi
    assert_rebuilt "$builds" "$reason"
done
run amd64
[ "$(count "$work/builds")" = "$builds" ]
refute grep -q WARNING "$work/log"
assert_no_leak
echo 'PASS: release runs reject forged packages, rebuild and republish them signed'
printf invalid > "$manifest"
run amd64
builds=$((builds + 1))
assert_rebuilt "$builds" 'has an invalid signature'
# A duplicate upload under the genuine payload name is what GitLab serves.
payload="$dir/linux-amd64-$(cat "$manifest").tar.gz"
printf corrupt > "$payload"
run amd64
builds=$((builds + 1))
assert_rebuilt "$builds" 'payload does not match its checksum'
payload="$dir/linux-amd64-$(cat "$manifest").tar.gz"
rm "$payload"
run amd64
builds=$((builds + 1))
assert_rebuilt "$builds" 'payload is missing'
run amd64
[ "$(count "$work/builds")" = "$builds" ]
echo 'PASS: release runs rebuild instead of failing on malformed manifests and corrupt or missing payloads'
uploads=$(count "$work/uploads")
printf '\n# recipe update\n' >> ci/ffmpeg.Dockerfile
export PACKAGE_PUBLISH=0
unset FFMPEG_SIGNING_KEY
run amd64
[ "$(count "$work/builds")" = $((builds + 1)) ]
[ "$(count "$work/uploads")" = "$uploads" ]
echo 'PASS: recipe change rebuilds, branches do not publish'
export PACKAGE_PUBLISH=1 FFMPEG_SIGNING_KEY="$key" FAIL_MANIFEST=1
expect_failure
unset FAIL_MANIFEST
recipe=$(sed -n 's/^ffmpeg: compiling amd64 (\(.*\))$/\1/p' "$work/log")
[ -n "$recipe" ]
# Payload and signature went first; without its manifest the package is not ready.
[ ! -e "$work/registry/ffmpeg/$recipe/linux-amd64.sha256" ]
[ -f "$work/registry/ffmpeg/$recipe/linux-amd64.sha256.hmac" ]
ls "$work/registry/ffmpeg/$recipe"/linux-amd64-*.tar.gz > /dev/null
run amd64
checksum=$(cat "$work/registry/ffmpeg/$recipe/linux-amd64.sha256")
[ -f "$work/registry/ffmpeg/$recipe/linux-amd64-$checksum.tar.gz" ]
before=$(count "$work/builds")
run amd64
[ "$(count "$work/builds")" = "$before" ]
echo 'PASS: interrupted publication recovers and becomes reusable'
dir="$work/registry/ffmpeg/$recipe"
assert_signed amd64
assert_no_leak
ffmpeg_dir=$dir ffmpeg_recipe=$recipe
builds=$(count "$work/builds")
uploads=$(count "$work/uploads")
run_rar amd64 arm64
[ "$(count "$work/builds")" = $((builds + 2)) ]
[ "$(count "$work/uploads")" = $((uploads + 6)) ]
[ -s .php-rar/arm64/opt/php-rar/rar.so ]
dir=$(echo "$work"/registry/php-rar/*)
recipe=${dir##*/}
[ "$recipe" != "$ffmpeg_recipe" ]
assert_signed amd64
assert_signed arm64
run_rar amd64 arm64
run amd64
[ "$(count "$work/builds")" = $((builds + 2)) ]
assert_no_leak
echo 'PASS: php-rar is published under its own key and reused like FFmpeg'
# A branch job copies the signed FFmpeg package under the php-rar key.
for file in linux-amd64.sha256 linux-amd64.sha256.hmac "linux-amd64-$(cat "$ffmpeg_dir/linux-amd64.sha256").tar.gz"; do
    cp "$ffmpeg_dir/$file" "$dir/$file"
done
rm -rf .php-rar
run_rar amd64
[ "$(count "$work/builds")" = $((builds + 3)) ]
grep -q "^WARNING: php-rar: registry amd64 package ($recipe) has an invalid signature" "$work/log"
[ -s .php-rar/amd64/opt/php-rar/rar.so ]
[ ! -e .php-rar/amd64/opt/ffmpeg ]
assert_signed amd64
echo 'PASS: an FFmpeg signature does not validate a php-rar package'
printf '\n# recipe update\n' >> ci/php-rar.Dockerfile
run_rar amd64
[ "$(count "$work/builds")" = $((builds + 4)) ]
run amd64
[ "$(count "$work/builds")" = $((builds + 4)) ]
echo 'PASS: a php-rar recipe change rebuilds php-rar only'
printf '\n# empty package\n' >> ci/php-rar.Dockerfile
if MOCK_EMPTY=1 run_rar amd64; then echo 'Package without rar.so accepted' >&2; exit 1; fi
grep -q 'php-rar: opt/php-rar/rar.so is missing' "$work/log"
[ ! -e "$work/registry/php-rar/$(sed -n 's/^php-rar: compiling amd64 (\(.*\))$/\1/p' "$work/log")/linux-amd64.sha256" ] ||
    { echo 'Package without rar.so published' >&2; exit 1; }
echo 'PASS: a php-rar package without rar.so fails'
calls=$(count "$work/argv")
if sh scripts/native-package.sh ffmpeg-extra amd64 > "$work/log" 2>&1; then echo 'Unknown package accepted' >&2; exit 1; fi
grep -q 'Usage: native-package.sh' "$work/log"
[ "$(count "$work/argv")" = "$calls" ]
echo 'PASS: unknown package names are rejected before any registry or Docker call'
before=$(count "$work/builds")
unset CI CI_JOB_TOKEN FFMPEG_SIGNING_KEY
run amd64
[ "$(count "$work/builds")" = "$before" ]
echo 'PASS: local preparation reuses matching recipe'
if run ../bad; then echo 'Invalid architecture accepted' >&2; exit 1; fi
echo 'PASS: invalid architecture rejected'
