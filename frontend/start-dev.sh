#!/bin/sh
set -eu

lock_hash="$(sha256sum package-lock.json | cut -d ' ' -f 1)"
installed_hash=""
if [ -f node_modules/.pesc-mate-lock-hash ]; then
  installed_hash="$(head -n 1 node_modules/.pesc-mate-lock-hash)"
fi

if [ "$installed_hash" != "$lock_hash" ]; then
  npm ci --prefer-offline --no-audit --no-fund
  printf '%s\n' "$lock_hash" > node_modules/.pesc-mate-lock-hash
fi

exec npm run dev -- --host 0.0.0.0
