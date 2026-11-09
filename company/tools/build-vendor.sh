#!/usr/bin/env bash
# Reconstruit company/vendor/three.bundle.js (Three.js 0.170.0 + GLTFLoader, SkeletonUtils, RoomEnvironment, RoundedBoxGeometry).
# Usage : company/tools/build-vendor.sh   (réseau npm requis ; le résultat est versionné, le navigateur ne charge rien d'externe)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cd "$WORK" && npm init -y >/dev/null && npm i --no-audit --no-fund three@0.170.0 esbuild@0.24.0 >/dev/null
cp "$HERE/vendor-entry.js" entry.js
npx esbuild entry.js --bundle --format=esm --minify --target=es2020 --legal-comments=linked --outfile="$HERE/../vendor/three.bundle.js"
ls -la "$HERE/../vendor/three.bundle.js"
