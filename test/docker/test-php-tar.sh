#!/bin/sh

set -eu

. "$(dirname "$0")/lib.sh"

image=${1:?Usage: test-php-tar.sh IMAGE}
container="h5ai-test-pax-$$"
fixture_dir=$(mktemp -d /tmp/h5ai-pax-test.XXXXXX)
# Outside the fixtures, which are copied into the container.
extract_dir=$(mktemp -d /tmp/h5ai-pax-extract.XXXXXX)

cleanup() {
	docker rm -f "$container" >/dev/null 2>&1 || true
	rm -rf "$fixture_dir" "$extract_dir" "$extract_dir.headers" "$extract_dir.tar"
}
trap cleanup EXIT HUP INT TERM

long_basename="$(printf '%0100d' 0 | tr '0' 'a').txt"
collision_suffix="$(printf '%095d' 0 | tr '0' 's').txt"
collision_a="A-$collision_suffix"
collision_b="B-$collision_suffix"
segment="segment$(printf '%062d' 0 | tr '0' 'x')"
deep_relative="$segment/$segment/$segment/leaf$(printf '%080d' 0 | tr '0' 'z').txt"
unicode_name='café-資料.txt'

mkdir -p "$fixture_dir/$(dirname "$deep_relative")"
chmod 755 \
	"$fixture_dir" \
	"$fixture_dir/$segment" \
	"$fixture_dir/$segment/$segment" \
	"$fixture_dir/$(dirname "$deep_relative")"
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

start_h5ai "$container" "$image" "$fixture_dir"

curl -fsS -D "$extract_dir.headers" -o "$extract_dir.tar" \
	--data-urlencode 'action=download' \
	--data-urlencode 'as=pax-regression.tar' \
	--data-urlencode 'type=php-tar' \
	--data-urlencode 'baseHref=/' \
	--data-urlencode "hrefs[0]=/$long_basename" \
	--data-urlencode "hrefs[1]=/$collision_a" \
	--data-urlencode "hrefs[2]=/$collision_b" \
	--data-urlencode "hrefs[3]=/$deep_relative" \
	--data-urlencode "hrefs[4]=/$unicode_name" \
	"$base/_h5ai/public/index.php"

content_length=$(awk 'tolower($1) == "content-length:" { gsub("\r", "", $2); value = $2 } END { print value }' "$extract_dir.headers")
archive_size=$(wc -c < "$extract_dir.tar" | tr -d ' ')
if [ "$content_length" != "$archive_size" ]; then
	echo "FAIL: Content-Length $content_length does not match archive size $archive_size" >&2
	exit 1
fi

tar -xf "$extract_dir.tar" -C "$extract_dir"
for path in "$long_basename" "$collision_a" "$collision_b" "$deep_relative" "$unicode_name"; do
	if [ ! -f "$extract_dir/$path" ]; then
		echo "FAIL: extracted archive is missing path: $path" >&2
		exit 1
	fi
	cmp "$fixture_dir/$path" "$extract_dir/$path"
done

echo 'PASS: PHP TAR preserves long, deep, Unicode and colliding names with the exact Content-Length'
