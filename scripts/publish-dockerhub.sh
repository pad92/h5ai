#!/bin/sh

set -eu

PUBLISH_IMAGE=${1:?Docker Hub image is required}
CANDIDATE_REF=${2:?candidate reference is required}
CANDIDATE_DIGEST=${3:?candidate digest is required}
IMMUTABLE_TAGS=${4:-}
MOVING_TAGS=${5:-}

case "$PUBLISH_IMAGE" in
    docker.io/*) REPOSITORY=${PUBLISH_IMAGE#docker.io/} ;;
    *) echo "ERROR: expected a docker.io image, got $PUBLISH_IMAGE" >&2; exit 1 ;;
esac

if ! printf '%s\n' "$CANDIDATE_DIGEST" | grep -Eq '^sha256:[[:xdigit:]]{64}$'; then
    echo "ERROR: invalid candidate digest" >&2
    exit 1
fi

validate_tags() {
    for tag in $1; do
        if ! printf '%s\n' "$tag" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'; then
            echo "ERROR: invalid Docker tag: $tag" >&2
            return 1
        fi
    done
}

validate_tags "$IMMUTABLE_TAGS"
validate_tags "$MOVING_TAGS"

TMP_DIR=$(mktemp -d)
trap 'rm -f "$TMP_DIR/token.json" "$TMP_DIR/headers"; rmdir "$TMP_DIR"' EXIT
trap 'exit 1' HUP INT TERM

if ! curl --fail --silent --show-error --get \
    --data-urlencode 'service=registry.docker.io' \
    --data-urlencode "scope=repository:$REPOSITORY:pull" \
    --output "$TMP_DIR/token.json" \
    https://auth.docker.io/token; then
    echo "ERROR: could not obtain a Docker Hub registry token" >&2
    exit 1
fi
if ! TOKEN=$(jq --exit-status --raw-output '.token // .access_token // empty' "$TMP_DIR/token.json") || [ -z "$TOKEN" ]; then
    echo "ERROR: Docker Hub returned no registry token" >&2
    exit 1
fi

registry_digest() {
    tag=$1
    if ! status=$(curl --silent --show-error --head \
        --output /dev/null --dump-header "$TMP_DIR/headers" --write-out '%{http_code}' \
        --header "Authorization: Bearer $TOKEN" \
        --header 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
        "https://registry-1.docker.io/v2/$REPOSITORY/manifests/$tag"); then
        echo "ERROR: registry lookup failed for $PUBLISH_IMAGE:$tag" >&2
        return 1
    fi

    case "$status" in
        200)
            digest=$(awk 'tolower($1) == "docker-content-digest:" { sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }' "$TMP_DIR/headers")
            if [ -z "$digest" ]; then
                echo "ERROR: registry returned no manifest digest for $PUBLISH_IMAGE:$tag" >&2
                return 1
            fi
            printf '%s\n' "$digest"
            ;;
        404) printf '%s\n' missing ;;
        *)
            echo "ERROR: registry lookup for $PUBLISH_IMAGE:$tag returned HTTP $status" >&2
            return 1
            ;;
    esac
}

PROMOTION_TAGS=
for tag in $IMMUTABLE_TAGS; do
    if ! existing_digest=$(registry_digest "$tag"); then
        exit 1
    fi
    case "$existing_digest" in
        missing) PROMOTION_TAGS="$PROMOTION_TAGS -t $PUBLISH_IMAGE:$tag" ;;
        "$CANDIDATE_DIGEST") echo "Skipping $PUBLISH_IMAGE:$tag; it already has the candidate digest" ;;
        *)
            echo "ERROR: immutable tag $PUBLISH_IMAGE:$tag has digest $existing_digest, expected $CANDIDATE_DIGEST; publish a new version" >&2
            exit 1
            ;;
    esac
done

for tag in $MOVING_TAGS; do
    PROMOTION_TAGS="$PROMOTION_TAGS -t $PUBLISH_IMAGE:$tag"
done

if [ -n "$PROMOTION_TAGS" ]; then
    echo "Promoting candidate $CANDIDATE_REF to Docker Hub"
    # Tag values were validated above and contain no shell metacharacters.
    set -f
    # shellcheck disable=SC2086
    docker buildx imagetools create $PROMOTION_TAGS "$CANDIDATE_REF"
else
    echo "All requested immutable tags already match the candidate"
fi

for tag in $IMMUTABLE_TAGS $MOVING_TAGS; do
    if ! published_digest=$(registry_digest "$tag"); then
        exit 1
    fi
    if [ "$published_digest" != "$CANDIDATE_DIGEST" ]; then
        echo "ERROR: verification failed for $PUBLISH_IMAGE:$tag (found $published_digest)" >&2
        exit 1
    fi
done

echo "Verified all Docker Hub tags against $CANDIDATE_DIGEST"
