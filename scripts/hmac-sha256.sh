#!/bin/sh
# Print the HMAC-SHA256 (RFC 2104) of stdin in hex, keyed by the hexadecimal
# key in HMAC_KEY (1 to 64 bytes). The key stays in this shell's variables and
# reaches sha256sum through a pipe: `openssl mac -macopt hexkey:...` would put
# it in a process argv, readable by any process of the container.
set -eu
set +x
fail() { echo "hmac-sha256: $*" >&2; exit 1; }
key=${HMAC_KEY:-}
case "$key" in ''|*[!0-9a-fA-F]*) fail 'HMAC_KEY must be hexadecimal' ;; esac
if [ $((${#key} % 2)) -ne 0 ] || [ "${#key}" -gt 128 ]; then
    fail 'HMAC_KEY must hold 1 to 64 bytes'
fi
while [ "${#key}" -lt 128 ]; do key=${key}00; done

# Set $bytes to printf %b escapes of hex $1 with each byte XORed with $2.
xor_escapes() {
    hex=$1 bytes=
    while [ -n "$hex" ]; do
        rest=${hex#??}
        byte=$((0x${hex%"$rest"} ^ $2))
        bytes="$bytes\\0$((byte / 64))$((byte / 8 % 8))$((byte % 8))"
        hex=$rest
    done
}
xor_escapes "$key" 54
inner_pad=$bytes
xor_escapes "$key" 92
outer_pad=$bytes
inner=$({ printf %b "$inner_pad"; cat; } | sha256sum)
xor_escapes "${inner%% *}" 0
{ printf %b "$outer_pad"; printf %b "$bytes"; } | sha256sum | cut -d ' ' -f 1
