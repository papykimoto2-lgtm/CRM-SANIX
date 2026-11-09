#!/usr/bin/env bash
# Déploiement par l'API de gestion (supabase/tools/deploy_functions.sh) contre un faux serveur (mock_management_api.py) :
# multipart exact, repli sur l'API historique, Verify JWT, CRON_SECRET copié du Vault sans jamais s'afficher, jeton mal formé,
# suppression encadrée, planificateur. Prérequis : bash, curl, jq, python3. Usage : ./deploy_functions_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SUP="$HERE/../.."; SCRIPT="$SUP/tools/deploy_functions.sh"
TMP="$(mktemp -d)"; PID=""; PORT=""; RC=0
stop() { [ -z "$PID" ] || { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; PID=""; }; }
trap 'stop; rm -rf "$TMP"' EXIT
hex() { python3 -c 'import secrets;print(secrets.token_hex(20))'; }
TOKEN="sbp_$(hex)"
ok()  { echo "  ✓ $1"; }
bad() { echo "  ✗ $1"; sed 's/^/      /' "$TMP/out.txt" 2>/dev/null | tail -30; exit 1; }
start() {   # start MODE [VAR=valeur…]
  stop; rm -f "$TMP/port" "$TMP/state.json"
  env MOCK_TOKEN="$TOKEN" MOCK_MODE="$1" MOCK_STATE="$TMP/state.json" MOCK_PORT_FILE="$TMP/port" "${@:2}" python3 "$HERE/mock_management_api.py" & PID=$!
  for _ in $(seq 1 60); do [ -s "$TMP/port" ] && break; sleep 0.1; done
  PORT="$(cat "$TMP/port")"
}
run() {     # run [VAR=valeur…] : sortie dans $TMP/out.txt, code de retour dans $RC
  set +e
  env SUPABASE_ACCESS_TOKEN="${TOKENIN:-$TOKEN}" PROJECT_REF=testref API_BASE="http://127.0.0.1:$PORT" FUNCTIONS_BASE="http://127.0.0.1:$PORT/functions/v1" WAIT_CRON=1 "$@" bash "$SCRIPT" >"$TMP/out.txt" 2>&1
  RC=$?; set -e
}
st()  { jq -rc "$1" "$TMP/state.json"; }
expect()     { [ "$(st "$2")" = "$3" ] && ok "$1" || { echo "  attendu $3, obtenu $(st "$2")"; bad "$1"; }; }
has()        { grep -q -- "$2" "$TMP/out.txt" && ok "$1" || bad "$1 : « $2 » absent de la sortie"; }
hasnt()      { ! grep -q -- "$2" "$TMP/out.txt" && ok "$1" || bad "$1 : « $2 » présent dans la sortie"; }
rc()         { [ "$RC" = "$2" ] && ok "$1" || bad "$1 : code de retour $RC (attendu $2)"; }

echo "— Cas nominal (jeton collé avec « Bearer » et retour à la ligne)"
start normal
TOKENIN=$'Bearer '"$TOKEN"$'\n' run
rc "déploiement sans échec" 0
expect "3 déploiements multipart, entrypoint index.ts, Verify JWT désactivé dans les métadonnées" "(.deploys|length)==3 and (.deploys|all(.meta.verify_jwt==false and .filename==\"index.ts\"))" true
sizes_ok=true; for f in ai-company ai-sales-director whatsapp-webhook; do
  [ "$(st ".deploys[]|select(.slug==\"$f\")|.size")" = "$(wc -c < "$SUP/deploy/$f/index.ts")" ] || sizes_ok=false; done
$sizes_ok && ok "le fichier envoyé est exactement le bundle du dépôt (octet pour octet)" || bad "taille des bundles"
expect "CRON_SECRET des fonctions = secret du Vault" ".cron_secret_matches_vault" true
hasnt "le jeton n'apparaît jamais dans la sortie" "$TOKEN"
hasnt "le secret du Vault n'apparaît jamais dans la sortie" "$(st ".vault")"
has "clé IA absente signalée" "ANTHROPIC_API_KEY ABSENT"
has "tâche restante annoncée" "À FAIRE"
has "les fonctions répondent (401 avec un faux secret)" "ai-company : en ligne"
has "le planificateur atteint les fonctions" "le planificateur atteint les fonctions"
has "bilan" "Déploiement terminé sans échec"

echo "— Clé IA déjà posée"
start normal MOCK_ANTHROPIC=1
run; rc "sans échec" 0; has "clé IA présente" "ANTHROPIC_API_KEY présent"; hasnt "plus de tâche restante" "À FAIRE"

echo "— API de déploiement absente : repli sur l'API historique"
start legacy
run; rc "sans échec" 0
expect "3 créations historiques avec Verify JWT désactivé" "(.deploys|length)==3 and (.deploys|all(.legacy==\"create\" and .verify_jwt==false))" true
has "repli signalé" "essai par l'API historique"

echo "— Verify JWT resté actif après déploiement : corrigé par PATCH"
start jwton
run; rc "sans échec" 0
expect "Verify JWT désactivé sur les 3 fonctions" "(.functions|to_entries|all(.value.verify_jwt==false))" true
expect "un PATCH par fonction" "[.calls[]|select(.m==\"PATCH\")]|length" 3

echo "— Jeton refusé par l'API"
start normal
TOKENIN="sbp_$(hex)" run
rc "échec" 1; has "message clair" "Jeton refusé (401"
expect "aucun déploiement tenté" ".deploys|length" 0

echo "— Jeton mal formé : refusé avant tout appel réseau"
start normal
TOKENIN="pas-un-jeton" run
rc "échec" 1; has "message clair" "mauvais format"
expect "aucun appel à l'API" ".calls|length" 0

echo "— Secret du planificateur absent du Vault"
start novault
run; rc "échec" 1; has "indication claire" "schedule_cron.sql"

echo "— Fonction étrangère et suppression encadrée"
start normal MOCK_PRESET_FUNCTION=clever-endpoint
run; rc "sans échec" 0; has "fonction étrangère signalée, non supprimée" "fonction étrangère à SANIX AI : « clever-endpoint »"
expect "rien supprimé" ".deleted" "[]"
start normal MOCK_PRESET_FUNCTION=clever-endpoint
run DELETE_FUNCTIONS=clever-endpoint; rc "sans échec" 0
expect "clever-endpoint supprimée" ".deleted" '["clever-endpoint"]'
start normal
run DELETE_FUNCTIONS=ai-company; rc "échec" 1; has "refus de supprimer une fonction de SANIX AI" "refus"
expect "rien supprimé" ".deleted" "[]"
start normal
run 'DELETE_FUNCTIONS=../etc'; rc "échec" 1; has "nom invalide refusé" "nom de fonction invalide"

echo "— Le planificateur n'atteint pas les fonctions"
start normal MOCK_NET=bad
run; rc "échec" 1; has "diagnostic" "aucune réponse 202 / 200"
echo "Déploiement par l'API de gestion : TOUT EST OK"
