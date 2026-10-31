#!/bin/sh

set -eu

image=${1:?Usage: test-php-tar.sh IMAGE [HOST]}
host=${2:-localhost}
container="h5ai-test-pax-$$"
fixture_dir=$(mktemp -d /tmp/h5ai-pax-test.XXXXXX)
extract_dir="$fixture_dir/extracted"
url="http://$host:8890/_h5ai/public/index.php"

cleanup() {
	docker rm -f "$container" >/dev/null 2>&1 || true
	rm -rf "$fixture_dir"
}
trap cleanup EXIT HUP INT TERM

long_basename="$(printf '%0100d' 0 | tr '0' 'a').txt"
collision_suffix="$(printf '%095d' 0 | tr '0' 's').txt"
collision_a="A-$collision_suffix"
collision_b="B-$collision_suffix"
segment="segment$(printf '%062d' 0 | tr '0' 'x')"
deep_relative="$segment/$segment/$segment/leaf$(printf '%080d' 0 | tr '0' 'z').txt"
unicode_name='café-資料.txt'

mkdir -p "$fixture_dir/$(dirname "$deep_relative")" "$extract_dir"
chmod 755 \
	"$fixture_dir" \
	"$fixture_dir/$segment" \
	"$fixture_dir/$segment/$segment" \
	"$fixture_dir/$(dirname "$deep_relative")" \
	"$extract_dir"
printf 'long basename\n' > "$fixture_dir/$long_basename"
printf 'collision A\n' > "$fixture_dir/$collision_a"
printf 'collision B\n' > "$fixture_dir/$collision_b"
printf 'deep path\n' > "$fixture_dir/$deep_relative"
printf 'unicode path\n' > "$fixture_dir/$unicode_name"
chmod 644 \
	"$fixture_dir/$long_basename" \
	"$fixture_dir/$collision_a" \
	"$fixture_dir/$collision_b" \
	"$fixture_dir/$deep_relative" \
	"$fixture_dir/$unicode_name"

docker run -d --name "$container" -p 8890:80 -v "$fixture_dir:/share:ro" "$image" >/dev/null

ready=false
for _ in $(seq 1 20); do
	if curl -fsSI "http://$host:8890/" >/dev/null 2>&1; then
		ready=true
		break
	fi
	sleep 1
done
if [ "$ready" != true ]; then
	echo 'FAIL: PHP TAR test container did not become ready' >&2
	docker logs "$container" >&2
	exit 1
fi

curl -fsS -D "$fixture_dir/headers" -o "$fixture_dir/archive.tar" \
	--data-urlencode 'action=download' \
	--data-urlencode 'as=pax-regression.tar' \
	--data-urlencode 'type=php-tar' \
	--data-urlencode 'baseHref=/' \
	--data-urlencode "hrefs[0]=/$long_basename" \
	--data-urlencode "hrefs[1]=/$collision_a" \
	--data-urlencode "hrefs[2]=/$collision_b" \
	--data-urlencode "hrefs[3]=/$deep_relative" \
	--data-urlencode "hrefs[4]=/$unicode_name" \
	"$url"

content_length=$(awk 'tolower($1) == "content-length:" { gsub("\r", "", $2); value = $2 } END { print value }' "$fixture_dir/headers")
archive_size=$(wc -c < "$fixture_dir/archive.tar" | tr -d ' ')
if [ "$content_length" != "$archive_size" ]; then
	echo "FAIL: Content-Length $content_length does not match archive size $archive_size" >&2
	exit 1
fi

tar -xf "$fixture_dir/archive.tar" -C "$extract_dir"
for path in "$long_basename" "$collision_a" "$collision_b" "$deep_relative" "$unicode_name"; do
	if [ ! -f "$extract_dir/$path" ]; then
		echo "FAIL: extracted archive is missing path: $path" >&2
		exit 1
	fi
	cmp "$fixture_dir/$path" "$extract_dir/$path"
done

echo 'PASS: PHP TAR preserves long, deep, Unicode and colliding names with the exact Content-Length'
