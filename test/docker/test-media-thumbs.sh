#!/bin/sh

# Thumbnails of the formats added to the default options: each fixture is
# requested with the type the listing gives it, and must come back as a WebP
# image. The last request is the image preview's fallback for formats a
# browser cannot decode: a sample asked with the generic "img" type.

set -eu

image=${1:?Usage: test-media-thumbs.sh IMAGE [HOST]}
host=${2:-localhost}
container="h5ai-test-mediathumbs-$$"
fixture_dir=$(mktemp -d /tmp/h5ai-mediathumbs-test.XXXXXX)
base="http://$host:8891"

cleanup() {
	docker rm -f "$container" >/dev/null 2>&1 || true
	rm -rf "$fixture_dir"
}
trap cleanup EXIT HUP INT TERM

# type file: one request per line, in the order of the response.
cases='img-heic image.heic
img-avif image.avif
img-jxl image.jxl
img-ico image.ico
img image.xpm
vid-wmv video.wmv
vid-ts video.mts
vid video.ogv
vid-vob video.vob
ar-cbr comic.cbz
img image.heic'

cp "$(dirname "$0")"/fixtures/media/* "$fixture_dir/"
chmod 755 "$fixture_dir"
chmod 644 "$fixture_dir"/*

docker run -d --name "$container" -p 8891:80 -v "$fixture_dir:/share:ro" "$image" >/dev/null

ready=false
for _ in $(seq 1 20); do
	if curl -fsSI "$base/" >/dev/null 2>&1; then
		ready=true
		break
	fi
	sleep 1
done
if [ "$ready" != true ]; then
	echo 'FAIL: media thumbnail test container did not become ready' >&2
	docker logs "$container" >&2
	exit 1
fi

# The last case is the preview sample: it carries a width.
count=$(printf '%s\n' "$cases" | wc -l)
requests=$(printf '%s\n' "$cases" | awk -v last="$count" '{
	sep = NR > 1 ? "," : ""
	width = NR == last ? ",\"width\":512,\"height\":0" : ""
	printf "%s{\"type\":\"%s\",\"href\":\"/%s\"%s}", sep, $1, $2, width
}')
curl -fsS -o "$fixture_dir/response.json" -H 'Content-Type: application/json' \
	--data "{\"action\":\"get\",\"thumbs\":[$requests]}" \
	"$base/_h5ai/public/index.php"

# "thumbs":["\/_h5ai\/...webp",null,...] -> one href per line, null for a failure.
hrefs=$(sed -n 's/.*"thumbs":\[\([^]]*\)\].*/\1/p' "$fixture_dir/response.json" | tr ',' '\n' | tr -d '"' | sed 's#\\/#/#g')
failed=0
line=0
while read -r type file; do
	line=$((line + 1))
	href=$(printf '%s\n' "$hrefs" | sed -n "${line}p")
	if [ -z "$href" ] || [ "$href" = null ]; then
		echo "FAIL: no thumbnail for $file ($type)" >&2
		failed=1
		continue
	fi
	curl -fsS -o "$fixture_dir/thumb.webp" "$base$href"
	if [ "$(head -c 4 "$fixture_dir/thumb.webp")" != RIFF ] || [ "$(head -c 12 "$fixture_dir/thumb.webp" | tail -c 4)" != WEBP ]; then
		echo "FAIL: thumbnail of $file ($type) is not a WebP image: $href" >&2
		failed=1
		continue
	fi
	echo "PASS: $file ($type) rendered as WebP"
done <<CASES
$cases
CASES

if [ "$failed" -ne 0 ]; then
	echo "Response: $(cat "$fixture_dir/response.json")" >&2
	docker logs "$container" 2>&1 | grep -v ' "GET \| "HEAD \| "POST ' | tail -20 >&2
	exit 1
fi
