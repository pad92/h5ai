#!/bin/sh
# Prints the version a build shows, from the only source of truth: Git.
# The first answer wins:
#   1. H5AI_VERSION when set (the Docker build passes it: the image has no .git)
#   2. the tag of a GitLab tag pipeline, without its leading "v"
#   3. the commit of any other GitLab pipeline (CI_COMMIT_SHORT_SHA)
#   4. the release tag on HEAD in a local clone, without its leading "v"
#   5. the short commit id of HEAD in a local clone
#   6. "dev" when none of the above is available
# package.json carries no version: the tag alone names a release.
set -eu

if [ -n "${H5AI_VERSION:-}" ]; then
    printf '%s\n' "$H5AI_VERSION"
    exit 0
fi
if [ -n "${CI_COMMIT_TAG:-}" ]; then
    printf '%s\n' "${CI_COMMIT_TAG#v}"
    exit 0
fi
if [ -n "${CI_COMMIT_SHORT_SHA:-}" ]; then
    printf '%s\n' "$CI_COMMIT_SHORT_SHA"
    exit 0
fi
if command -v git >/dev/null 2>&1; then
    if tag=$(git describe --exact-match --tags --match 'v[0-9]*' HEAD 2>/dev/null); then
        printf '%s\n' "${tag#v}"
        exit 0
    fi
    if sha=$(git rev-parse --short=8 HEAD 2>/dev/null); then
        printf '%s\n' "$sha"
        exit 0
    fi
fi
printf '%s\n' dev
