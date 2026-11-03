#!/bin/sh

# Thumbnails that need a tool shipped in the image: PDF (poppler's pdftoppm,
# the image has no Ghostscript) and TIFF (an ImageMagick delegate). Each must
# come back from the API as a WebP file.

set -eu

. "$(dirname "$0")/lib.sh"

image=${1:?Usage: test-document-thumbs.sh IMAGE}
container="h5ai-test-docthumbs-$$"
fixture_dir=$(mktemp -d /tmp/h5ai-docthumbs-test.XXXXXX)

cleanup() {
	docker rm -f "$container" >/dev/null 2>&1 || true
	rm -rf "$fixture_dir"
}
trap cleanup EXIT HUP INT TERM

# Small committed fixtures (a red page, a blue picture), so a missing
# delegate shows up in the thumbnail request rather than in the setup.
cp "$(dirname "$0")/fixtures/doc.pdf" "$(dirname "$0")/fixtures/image.tiff" "$fixture_dir/"
chmod 755 "$fixture_dir"
chmod 644 "$fixture_dir/doc.pdf" "$fixture_dir/image.tiff"

start_h5ai "$container" "$image" "$fixture_dir"

curl -fsS -o "$fixture_dir/response.json" -H 'Content-Type: application/json' \
	--data '{"action":"get","thumbs":[{"type":"x-pdf","href":"/doc.pdf"},{"type":"img-tiff","href":"/image.tiff"}]}' \
	"$base/_h5ai/public/index.php"

# "thumbs":["\/_h5ai\/...webp","\/_h5ai\/...webp"] -> one href per line, null for a failure.
hrefs=$(sed -n 's/.*"thumbs":\[\([^]]*\)\].*/\1/p' "$fixture_dir/response.json" | tr ',' '\n' | tr -d '"' | sed 's#\\/#/#g')
for kind in PDF TIFF; do
	href=$(printf '%s\n' "$hrefs" | sed -n 1p)
	hrefs=$(printf '%s\n' "$hrefs" | sed 1d)
	if [ -z "$href" ] || [ "$href" = null ]; then
		echo "FAIL: no $kind thumbnail: $(cat "$fixture_dir/response.json")" >&2
		docker logs "$container" 2>&1 | tail -20 >&2
		exit 1
	fi
	curl -fsS -o "$fixture_dir/thumb.webp" "$base$href"
	if [ "$(head -c 4 "$fixture_dir/thumb.webp")" != RIFF ] || [ "$(head -c 12 "$fixture_dir/thumb.webp" | tail -c 4)" != WEBP ]; then
		echo "FAIL: $kind thumbnail is not a WebP image: $href" >&2
		exit 1
	fi
	echo "PASS: $kind thumbnail rendered as WebP"
done
