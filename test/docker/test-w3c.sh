#!/bin/sh

# Validates the HTML h5ai serves and its style sheet with the W3C Nu Html
# Checker, the engine behind validator.w3.org, run locally in Docker: no page
# is published or sent anywhere. The pages are fetched inside the h5ai
# container and piped to the checker, so the same script works with a local
# Docker and with the CI runner's Docker socket (no port, no bind mount).
#
# Checked: the index page (the shell the JavaScript fills in), a fallback
# listing (what text browsers and `view.fallbackMode` get), the info page and
# styles.css. Any error fails; warnings and notes are printed only.

set -eu

image=${1:?Usage: test-w3c.sh IMAGE}
# vnu 26.11.2, pinned by digest like the other tool images.
vnu_image=${VNU_IMAGE:-ghcr.io/validator/validator:latest@sha256:33d21f6b3b7644e6a9897ed64076d0a8b8f5414d51154e03c35986f98f4fb80c}
container="h5ai-test-w3c-$$"
base="http://127.0.0.1"

cleanup() {
	docker rm -f "$container" >/dev/null 2>&1 || true
	rm -f "${page:-}"
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

# check <label> <vnu option or ""> <wget args...>: fetches a page inside the
# h5ai container and validates it from stdin. Returns the checker's status
# (1 on errors); the JVM banner of the image's empty JAVA_TOOL_OPTIONS is
# dropped from the report.
check() {
	label=$1
	mode=$2
	shift 2
	docker exec "$container" wget -q -O - "$@" >"$page" || { echo "FAIL: cannot fetch $label"; return 1; }
	rc=0
	# shellcheck disable=SC2086 # $mode is empty or one option
	out=$(docker run --rm -i --entrypoint java "$vnu_image" -jar /vnu.jar $mode - <"$page" 2>&1) || rc=$?
	echo "== $label"
	printf '%s\n' "$out" | grep -v '^Picked up JAVA_TOOL_OPTIONS' || true
	return "$rc"
}

page=$(mktemp)
status=0
check "index page" "" "$base/" || status=1
check "fallback listing" "" -U 'Lynx/2.9' "$base/images/" || status=1
check "info page" "" "$base/_h5ai/public/index.php" || status=1
check "styles.css" "--css" "$base/_h5ai/public/css/styles.css" || status=1
rm -f "$page"

if [ "$status" -ne 0 ]; then
	echo "FAIL: W3C validation reported errors"
	exit 1
fi
echo "PASS: HTML pages and styles.css are valid (W3C Nu Html Checker)"
