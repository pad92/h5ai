#!/bin/sh

set -eu

TAG=${1:-}
BRANCH=${2:-}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
IMMUTABLE_TAGS=
MOVING_TAGS=

add_immutable_tag() {
    case " $IMMUTABLE_TAGS " in
        *" $1 "*) ;;
        *) IMMUTABLE_TAGS="${IMMUTABLE_TAGS}${IMMUTABLE_TAGS:+ }$1" ;;
    esac
}

add_moving_tag() {
    case " $MOVING_TAGS " in
        *" $1 "*) ;;
        *) MOVING_TAGS="${MOVING_TAGS}${MOVING_TAGS:+ }$1" ;;
    esac
}

if [ -n "$TAG" ]; then
    case "$TAG" in
        v[0-9]*|[0-9]*)
            if printf '%s\n' "$TAG" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9]+)?$'; then
                VERSION=${TAG#v}
                add_immutable_tag "$TAG"
                add_immutable_tag "$VERSION"
                if printf '%s\n' "$VERSION" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
                    if sh "$SCRIPT_DIR/is-latest-stable-release.sh" "$VERSION"; then
                        MAJOR=$(printf '%s\n' "$VERSION" | cut -d. -f1)
                        MINOR=$(printf '%s\n' "$VERSION" | cut -d. -f2)
                        add_moving_tag latest
                        add_moving_tag "$MAJOR.$MINOR"
                        add_moving_tag "$MAJOR"
                    else
                        status=$?
                        if [ "$status" -ne 3 ]; then
                            exit "$status"
                        fi
                        echo "Skipping stable aliases for $VERSION; a newer stable tag exists" >&2
                    fi
                fi
            elif printf '%s\n' "$TAG" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+-[0-9A-Za-z.-]+$'; then
                VERSION=${TAG#v}
                add_moving_tag "$TAG"
                add_moving_tag "$VERSION"
            else
                add_moving_tag "$TAG"
            fi
            ;;
        *) add_moving_tag "$TAG" ;;
    esac
elif [ "$BRANCH" = master ]; then
    add_moving_tag devel
fi

printf '%s\n%s\n' "$IMMUTABLE_TAGS" "$MOVING_TAGS"
