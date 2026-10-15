#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 || [ ! -d node_modules ]; then
    bash ./setup.sh
fi

node index.js
