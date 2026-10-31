#!/bin/sh

set -eu

TEST_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$TEST_DIR/../.." && pwd)
TMP_DIR=$(mktemp -d)
trap 'rm -f "$TMP_DIR"/*; rmdir "$TMP_DIR"' EXIT
trap 'exit 1' HUP INT TERM

export PATH="$TEST_DIR/mocks:$PATH"
export REGISTRY_STATE="$TMP_DIR/registry-state"
export DOCKER_LOG="$TMP_DIR/docker.log"
export EXPECTED_DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
IMAGE=docker.io/pad92/docker-h5ai
CANDIDATE_REF=registry.gitlab.example/pascal/h5ai:ci-test@$EXPECTED_DIGEST
PUBLISHER=$PROJECT_DIR/scripts/publish-dockerhub.sh

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

lookup_digest() {
    awk -v tag="$1" '$1 == tag { print $2; exit }' "$REGISTRY_STATE"
}

run_publisher() {
    sh "$PUBLISHER" "$IMAGE" "$CANDIDATE_REF" "$EXPECTED_DIGEST" "$1" "$2"
}

run_ok() {
    if ! run_publisher "$1" "$2" > "$TMP_DIR/output" 2>&1; then
        cat "$TMP_DIR/output" >&2
        fail "publisher should succeed"
    fi
}

run_fails() {
    if run_publisher "$1" "$2" > "$TMP_DIR/output" 2>&1; then
        fail "publisher should fail"
    fi
}

reset_case() {
    : > "$REGISTRY_STATE"
    : > "$DOCKER_LOG"
    unset CURL_HTTP_STATUS CURL_NETWORK_ERROR DOCKER_PARTIAL_MARKER
}

reset_case
run_ok 'v1.3.6 1.3.6' 'latest 1.3 1'
for tag in v1.3.6 1.3.6 latest 1.3 1; do
    [ "$(lookup_digest "$tag")" = "$EXPECTED_DIGEST" ] || fail "missing tag $tag after publication"
done

reset_case
printf 'v1.3.6 %s\nlatest sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n' "$EXPECTED_DIGEST" > "$REGISTRY_STATE"
run_ok 'v1.3.6 1.3.6' latest
case "$(cat "$DOCKER_LOG")" in
    *':1.3.6'*) ;;
    *) fail 'missing immutable alias was not published' ;;
esac
case "$(cat "$DOCKER_LOG")" in
    *':v1.3.6'*) fail 'matching immutable tag was sent to imagetools create' ;;
esac
[ "$(lookup_digest latest)" = "$EXPECTED_DIGEST" ] || fail 'moving alias was not updated after immutable checks'

reset_case
printf 'v1.3.6 sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\nlatest sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n' > "$REGISTRY_STATE"
run_fails 'v1.3.6 1.3.6' latest
[ ! -s "$DOCKER_LOG" ] || fail 'conflicting immutable tag allowed an alias update'
[ "$(lookup_digest latest)" = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' ] || fail 'conflict changed a moving alias'

for status in 401 429 500; do
    reset_case
    CURL_HTTP_STATUS=$status
    export CURL_HTTP_STATUS
    run_fails v1.3.6 latest
    [ ! -s "$DOCKER_LOG" ] || fail "HTTP $status lookup error allowed publication"
done

reset_case
CURL_NETWORK_ERROR=1
export CURL_NETWORK_ERROR
run_fails v1.3.6 latest
[ ! -s "$DOCKER_LOG" ] || fail 'network lookup error allowed publication'

reset_case
DOCKER_PARTIAL_MARKER=$TMP_DIR/partial
export DOCKER_PARTIAL_MARKER
run_fails 'v1.3.6 1.3.6' latest
[ "$(lookup_digest v1.3.6)" = "$EXPECTED_DIGEST" ] || fail 'partial publication fixture did not create its first immutable tag'
run_ok 'v1.3.6 1.3.6' latest
case "$(tail -n 1 "$DOCKER_LOG")" in
    *':1.3.6'*':latest'*) ;;
    *) fail 'retry did not resume with the missing version tag and moving alias' ;;
esac
case "$(tail -n 1 "$DOCKER_LOG")" in
    *':v1.3.6'*) fail 'retry attempted to overwrite an existing immutable tag' ;;
esac
[ "$(lookup_digest 1.3.6)" = "$EXPECTED_DIGEST" ] || fail 'retry did not publish the missing version tag'
[ "$(lookup_digest latest)" = "$EXPECTED_DIGEST" ] || fail 'retry did not verify the moving alias'

echo 'Docker Hub publication tests passed'
