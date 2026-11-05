#!/bin/sh

# Validates the HTML h5ai serves and its style sheet with the W3C Nu Html
# Checker, the engine behind validator.w3.org, run locally in Docker: no page
# is published or sent anywhere. The pages are fetched inside the h5ai
# container and piped to the checker, so the same script works with a local
# Docker and with the Docker daemon of a CI docker:dind service (no port, no
# bind mount).
#
# Checked: the index page (the shell the JavaScript fills in), a fallback
# listing (what text browsers and `view.fallbackMode` get), the info page and
# styles.css as served, then the DOM the JavaScript builds (listings,
# previews, audio player, info page), saved by dump-dom.mjs in headless
# Chromium. Any error fails; warnings and notes are printed only.

set -eu

image=${1:?Usage: test-w3c.sh IMAGE}
# vnu 26.11.2, pinned by digest like the other tool images.
vnu_image=${VNU_IMAGE:-ghcr.io/validator/validator:latest@sha256:33d21f6b3b7644e6a9897ed64076d0a8b8f5414d51154e03c35986f98f4fb80c}
# The Node image of the Dockerfile build stage; Chromium comes from Debian.
node_image=${NODE_IMAGE:-node:24.22.2-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c}
root=$(cd "$(dirname "$0")/../.." && pwd)
container="h5ai-test-w3c-$$"
dom_container="h5ai-test-w3c-dom-$$"
base="http://127.0.0.1"
work=$(mktemp -d)

cleanup() {
	docker rm -f "$container" "$dom_container" >/dev/null 2>&1 || true
	rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM

# The fixtures give the listings real rows. docker cp streams them from the
# client, so no bind mount path has to exist on the Docker host.
docker create --name "$container" "$image" >/dev/null
docker cp "$(dirname "$0")/fixtures/." "$container:/share/"
docker start "$container" >/dev/null

ready=false
for _ in $(seq 1 30); do
	if docker exec "$container" wget -q -O /dev/null "$base/" 2>/dev/null; then
		ready=true
		break
	fi
	sleep 1
done
if [ "$ready" != true ]; then
	echo "FAIL: h5ai did not answer"
	docker logs "$container" 2>&1 | tail -20
	exit 1
fi

# validate <label> <file> [vnu option]: returns the checker's status (1 on
# errors); the JVM banner of the image's empty JAVA_TOOL_OPTIONS is dropped.
validate() {
	rc=0
	# shellcheck disable=SC2086 # $3 is empty or one option
	out=$(docker run --rm -i --entrypoint java "$vnu_image" -jar /vnu.jar ${3:-} - <"$2" 2>&1) || rc=$?
	echo "== $1"
	printf '%s\n' "$out" | grep -v '^Picked up JAVA_TOOL_OPTIONS' || true
	return "$rc"
}

# served <label> <file name> [vnu option] -- <wget args...>: fetches a page
# inside the h5ai container, then validates it.
served() {
	label=$1
	file="$work/$2"
	mode=$3
	shift 4
	docker exec "$container" wget -q -O - "$@" >"$file" || { echo "FAIL: cannot fetch $label"; return 1; }
	validate "$label" "$file" "$mode"
}

status=0
served "index page" index.html "" -- "$base/" || status=1
served "fallback listing" fallback.html "" -- -U 'Lynx/2.9' "$base/images/" || status=1
served "info page" info.html "" -- "$base/_h5ai/public/index.php" || status=1
served "styles.css" styles.css --css -- "$base/_h5ai/public/css/styles.css" || status=1

# The rendered DOM: Chromium runs in a Node container that shares the h5ai
# container's network, and the scripts are copied in rather than mounted.
mkdir "$work/dom"
docker create --name "$dom_container" --network "container:$container" -w /tmp "$node_image" sh -ec '
	apt-get update -qq
	apt-get install -y -qq --no-install-recommends chromium >/dev/null
	mkdir dom
	CHROME=chromium node test/docker/dump-dom.mjs http://127.0.0.1 dom' >/dev/null
tar -C "$root" -cf - scripts/screenshots/chrome.mjs test/docker/dump-dom.mjs | docker cp - "$dom_container:/tmp"
if docker start -a "$dom_container" && docker cp "$dom_container:/tmp/dom/." "$work/dom/"; then
	for file in "$work"/dom/*.html; do
		validate "rendered $(basename "$file" .html)" "$file" || status=1
	done
else
	echo "FAIL: could not render the pages in Chromium"
	status=1
fi

if [ "$status" -ne 0 ]; then
	echo "FAIL: W3C validation reported errors"
	exit 1
fi
echo "PASS: served and rendered HTML and styles.css are valid (W3C Nu Html Checker)"
