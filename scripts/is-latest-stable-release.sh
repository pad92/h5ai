#!/bin/sh

set -eu

VERSION=${1:?stable release version is required}
: "${CI_API_V4_URL:?CI_API_V4_URL is required}"
: "${CI_PROJECT_ID:?CI_PROJECT_ID is required}"
: "${CI_JOB_TOKEN:?CI_JOB_TOKEN is required}"

if ! printf '%s\n' "$VERSION" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
    echo "ERROR: invalid stable release version: $VERSION" >&2
    exit 2
fi

TMP_DIR=$(mktemp -d)
trap 'rm -f "$TMP_DIR/tags.json" "$TMP_DIR/names"; rmdir "$TMP_DIR"' EXIT
trap 'exit 1' HUP INT TERM

LATEST=
PAGE=1
while :; do
    if ! curl --fail --silent --show-error \
        --header "JOB-TOKEN: $CI_JOB_TOKEN" \
        --output "$TMP_DIR/tags.json" \
        "$CI_API_V4_URL/projects/$CI_PROJECT_ID/repository/tags?per_page=100&page=$PAGE"; then
        echo "ERROR: could not list repository tags (page $PAGE)" >&2
        exit 1
    fi
    if ! jq --exit-status 'type == "array"' "$TMP_DIR/tags.json" > /dev/null; then
        echo "ERROR: GitLab returned an invalid tag list (page $PAGE)" >&2
        exit 1
    fi
    PAGE_COUNT=$(jq --exit-status --raw-output 'length' "$TMP_DIR/tags.json") || {
        echo "ERROR: could not read repository tag count (page $PAGE)" >&2
        exit 1
    }
    if ! printf '%s\n' "$PAGE_COUNT" | grep -Eq '^[0-9]+$'; then
        echo "ERROR: GitLab returned an invalid tag count (page $PAGE)" >&2
        exit 1
    fi
    jq --raw-output '.[].name' "$TMP_DIR/tags.json" > "$TMP_DIR/names" || {
        echo "ERROR: could not read repository tag names (page $PAGE)" >&2
        exit 1
    }

    while IFS= read -r tag; do
        case "$tag" in v[0-9]*) candidate=${tag#v} ;; *) candidate=$tag ;; esac
        if ! printf '%s\n' "$candidate" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
            continue
        fi
        if [ -z "$LATEST" ]; then
            LATEST=$candidate
            continue
        fi
        candidate_is_newer=$(awk -F. -v candidate="$candidate" -v latest="$LATEST" '
            BEGIN {
                split(candidate, c, ".")
                split(latest, l, ".")
                for (i = 1; i <= 3; i++) {
                    if ((c[i] + 0) > (l[i] + 0)) { print "yes"; exit }
                    if ((c[i] + 0) < (l[i] + 0)) { print "no"; exit }
                }
                print "no"
            }')
        if [ "$candidate_is_newer" = yes ]; then
            LATEST=$candidate
        fi
    done < "$TMP_DIR/names"

    if [ "$PAGE_COUNT" -lt 100 ]; then
        break
    fi
    PAGE=$((PAGE + 1))
done

if [ -z "$LATEST" ]; then
    echo 'ERROR: no stable semantic-version tags were found in the repository' >&2
    exit 1
fi

if [ "$VERSION" = "$LATEST" ]; then
    exit 0
fi

exit 3
