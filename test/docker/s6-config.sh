#!/bin/sh

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
overlay="$root/slash/etc/s6-overlay"
bundle="$overlay/user-bundles.d/user"

test -d "$bundle/contents.d"
test -f "$overlay/s6-rc.d/angie/type"
test -f "$overlay/s6-rc.d/php-fpm84/type"
test -f "$overlay/s6-rc.d/init-perms-auth/type"
test -f "$overlay/s6-rc.d/angie/dependencies.d/init-perms-auth"
test -f "$overlay/s6-rc.d/php-fpm84/dependencies.d/init-perms-auth"
test ! -e "$overlay/s6-rc.d/user"
test -f "$bundle/contents.d/angie"
test -f "$bundle/contents.d/php-fpm84"

echo 's6 configuration tests passed'
