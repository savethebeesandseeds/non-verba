# SPDX-License-Identifier: AGPL-3.0-only
# Fixed Android run-as script. The USB helper replaces only @TOKEN@ after
# validating exactly 32 lowercase hex characters. Public JSON arrives on stdin.
set -eu
test -d cache
test ! -L cache
if test ! -e cache/camera-pairing; then
    (umask 077; mkdir cache/camera-pairing)
fi
test -d cache/camera-pairing
test ! -L cache/camera-pairing
test "$(find cache/camera-pairing -mindepth 1 -maxdepth 1 | wc -l)" -lt 32
target=cache/camera-pairing/@TOKEN@.json
umask 077
set -C
# Keep any incomplete file as evidence; a new attempt requires a new token.
head -c 120001 > "$target"
test -f "$target"
test ! -L "$target"
size=$(stat -c %s "$target")
test "$size" -gt 0
test "$size" -le 120000
chmod 400 "$target"
sha256sum "$target"
