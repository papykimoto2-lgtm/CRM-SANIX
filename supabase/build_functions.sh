#!/bin/sh
# Empaquette chaque fonction Edge en UN fichier autonome (le code partagé de _shared est inclus) : supabase/deploy/<fonction>/index.ts
# Utilisation : coller ce fichier dans Supabase → Edge Functions → Deploy a new function → Via Editor (voir DEPLOIEMENT.md).
# À régénérer après toute modification de supabase/functions : sh supabase/build_functions.sh   (nécessite Node)
cd "$(dirname "$0")" || exit 1
for f in ai-company ai-sales-director whatsapp-webhook; do
  mkdir -p "deploy/$f"
  npx --yes esbuild@0.24.0 "functions/$f/index.ts" --bundle --format=esm --platform=neutral --target=esnext \
    --external:'npm:*' --legal-comments=none --log-level=warning --outfile="deploy/$f/index.ts" || exit 1
  printf '%s : %s octets\n' "$f" "$(wc -c < "deploy/$f/index.ts")"
done
