#!/bin/sh

set -eu

TEST_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$TEST_DIR/../.." && pwd)
TMP_DIR=$(mktemp -d)
trap 'rm -f "$TMP_DIR"/*; rmdir "$TMP_DIR"' EXIT
trap 'exit 1' HUP INT TERM

export PATH="$TEST_DIR/tag-api-mocks:$PATH"
export CI_API_V4_URL=https://gitlab.example/api/v4
export CI_PROJECT_ID=42
export CI_JOB_TOKEN=mock-token
export TAG_API_LOG="$TMP_DIR/api.log"
PLAN=$PROJECT_DIR/scripts/docker-tag-plan.sh

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

expect_plan() {
    expected_immutable=$1
    expected_moving=$2
    shift 2
    if ! actual=$(sh "$PLAN" "$@" 2> "$TMP_DIR/error"); then
        cat "$TMP_DIR/error" >&2
        fail "tag plan should succeed for $*"
    fi
    expected=$(printf '%s\n%s' "$expected_immutable" "$expected_moving")
    [ "$actual" = "$expected" ] || fail "unexpected plan for $*: $(printf '%s' "$actual" | tr '\n' '|')"
}

export TAG_PAGE1_NAMES='v1.3.6'
export TAG_PAGE1_COUNT=1
export TAG_PAGE2_NAMES=
export TAG_PAGE2_COUNT=0
: > "$TAG_API_LOG"
expect_plan 'v1.3.6 1.3.6' 'latest 1.3 1' v1.3.6 ''
expect_plan '1.3.6' 'latest 1.3 1' 1.3.6 ''

export TAG_PAGE1_NAMES='v1.4.0-rc.1 v1.3.6'
export TAG_PAGE1_COUNT=2
: > "$TAG_API_LOG"
expect_plan '' 'v1.4.0-rc.1 1.4.0-rc.1' v1.4.0-rc.1 ''
expect_plan 'v1.4.0-1 1.4.0-1' '' v1.4.0-1 ''
expect_plan '01.4.0' '' 01.4.0 ''
expect_plan '' 'release-candidate' release-candidate ''
expect_plan '' 'devel' '' master
if [ -s "$TAG_API_LOG" ]; then
    fail 'prerelease, non-version, or master plans queried stable tags'
fi

export TAG_PAGE1_NAMES='v1.3.6'
export TAG_PAGE1_COUNT=100
export TAG_PAGE2_NAMES='v2.0.0'
export TAG_PAGE2_COUNT=1
: > "$TAG_API_LOG"
expect_plan 'v2.0.0 2.0.0' 'latest 2.0 2' v2.0.0 ''
case "$(cat "$TAG_API_LOG")" in
    *'page=1'*'page=2'*) ;;
    *) fail 'stable tag lookup did not paginate through all repository tags' ;;
esac

export TAG_PAGE1_NAMES='v1.3.6 v1.4.0'
export TAG_PAGE1_COUNT=2
export TAG_PAGE2_NAMES=
export TAG_PAGE2_COUNT=0
expect_plan 'v1.3.6 1.3.6' '' v1.3.6 ''
case "$(cat "$TMP_DIR/error")" in
    *'newer stable tag exists'*) ;;
    *) fail 'older stable release did not report skipped aliases' ;;
esac

export TAG_API_FAIL_PAGE=1
if sh "$PLAN" v1.3.6 '' > "$TMP_DIR/output" 2> "$TMP_DIR/error"; then
    fail 'tag API failure allowed stable alias planning'
fi
unset TAG_API_FAIL_PAGE

echo 'Docker tag planning tests passed'
