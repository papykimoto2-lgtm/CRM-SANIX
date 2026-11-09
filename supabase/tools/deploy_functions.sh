#!/usr/bin/env bash
# Déploie les trois fonctions Edge de SANIX AI par l'API de gestion Supabase, copie le secret du planificateur (Vault → CRON_SECRET)
# et contrôle le résultat. Aucun secret n'est affiché : le jeton passe par un fichier de configuration anonyme, CRON_SECRET est masqué.
#
# Variables : SUPABASE_ACCESS_TOKEN (obligatoire : jeton personnel « sbp_… »), PROJECT_REF (défaut : izgpvhwhbrgeagjfhfli),
#             DELETE_FUNCTIONS (noms séparés par des virgules, à supprimer ; jamais les trois fonctions de SANIX AI),
#             WAIT_CRON (secondes d'attente avant le contrôle du planificateur, défaut 100).
# Dépendances : bash, curl, jq.  Usage : SUPABASE_ACCESS_TOKEN=sbp_… bash supabase/tools/deploy_functions.sh
# Prérequis : schéma appliqué et supabase/schedule_cron.sql exécuté (c'est lui qui crée le secret dans le Vault).
set -euo pipefail
set +x
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REF="${PROJECT_REF:-izgpvhwhbrgeagjfhfli}"
API="${API_BASE:-https://api.supabase.com}/v1/projects/$REF"
FN="${FUNCTIONS_BASE:-https://$REF.supabase.co/functions/v1}"
NAMES=(ai-company ai-sales-director whatsapp-webhook)
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
FAILS=0; TODO=()

log()  { printf '%s\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ⚠ %s\n' "$*"; [ -z "${GITHUB_ACTIONS:-}" ] || printf '::warning::%s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*"; [ -z "${GITHUB_ACTIONS:-}" ] || printf '::error::%s\n' "$*"; FAILS=$((FAILS + 1)); }
die()  { fail "$*"; exit 1; }
section() { printf '\n== %s\n' "$*"; }

# Jeton : espaces et préfixe « Bearer » retirés (erreur de collage fréquente), format contrôlé sans jamais l'afficher
TOKEN="$(printf '%s' "${SUPABASE_ACCESS_TOKEN:-}" | tr -d '[:space:]')"; TOKEN="${TOKEN#Bearer}"
[ -n "$TOKEN" ] || die "SUPABASE_ACCESS_TOKEN manquant (secret GitHub « SUPABASE_ACCESS_TOKEN » ou variable d'environnement)."
[[ "$TOKEN" =~ ^sbp_[A-Za-z0-9_]{20,}$ ]] || die "Jeton au mauvais format : il doit commencer par « sbp_ » (Supabase → avatar → Access Tokens), sans « Bearer », sans guillemets ni espace."
[ -z "${GITHUB_ACTIONS:-}" ] || printf '::add-mask::%s\n' "$TOKEN"
auth() { printf 'header = "Authorization: Bearer %s"\n' "$TOKEN"; }

# api MÉTHODE CHEMIN [options curl…] → code HTTP sur la sortie standard, corps dans $WORK/out.json
api() {
  local m="$1" p="$2"; shift 2
  curl -sS -m 120 -o "$WORK/out.json" -w '%{http_code}' -X "$m" --config <(auth) "$API$p" "$@" 2>"$WORK/curl.err" || { cat "$WORK/curl.err" >&2; echo 000; }
}
err() { jq -r '(.message // .error // .) | tostring' "$WORK/out.json" 2>/dev/null | head -c 300 || true; }
sqlq() { jq -cn --arg q "$1" '{query:$q}' | api POST /database/query -H 'Content-Type: application/json' -d @-; }

# ── 1. Accès au projet ──────────────────────────────────────────────
section "1. Accès au projet $REF"
code=$(api GET "")
case "$code" in
  200) ok "projet « $(jq -r .name "$WORK/out.json") » : $(jq -r .status "$WORK/out.json")" ;;
  401) die "Jeton refusé (401 : $(err)). Générer un nouveau jeton « sbp_… » (Supabase → avatar → Access Tokens) et le remplacer." ;;
  403|404) die "Ce jeton n'a pas accès au projet $REF (HTTP $code : $(err)). Utiliser un jeton du compte propriétaire du projet." ;;
  *) die "API de gestion injoignable ou en erreur (HTTP $code : $(err))." ;;
esac

c=$(sqlq "select now()::text as t"); T0="$(jq -r '.[0].t // empty' "$WORK/out.json" 2>/dev/null || true)"   # horloge de la base : repère des réponses du planificateur

# ── 2. Déploiement des fonctions ────────────────────────────────────
deploy() {
  local n="$1" f="$HERE/deploy/$1/index.ts" meta body c
  [ -s "$f" ] || { fail "$n : fichier $f absent (générer : sh supabase/build_functions.sh)"; return; }
  meta=$(jq -cn --arg n "$n" '{entrypoint_path:"index.ts", name:$n, verify_jwt:false}')
  c=$(api POST "/functions/deploy?slug=$n" --form-string "metadata=$meta" -F "file=@$f;filename=index.ts")
  if [[ "$c" != 2* ]]; then
    warn "$n : API de déploiement HTTP $c ($(err)) — essai par l'API historique"
    body=$(jq -n --arg s "$n" --rawfile b "$f" '{slug:$s, name:$s, body:$b, verify_jwt:false}')
    c=$(printf '%s' "$body" | api PATCH "/functions/$n" -H 'Content-Type: application/json' -d @-)
    [ "$c" != 404 ] || c=$(printf '%s' "$body" | api POST /functions -H 'Content-Type: application/json' -d @-)
    [[ "$c" == 2* ]] || { fail "$n : déploiement refusé (HTTP $c : $(err))"; return; }
  fi
  c=$(api GET "/functions/$n")
  [ "$c" = 200 ] || { fail "$n : lecture impossible après déploiement (HTTP $c : $(err))"; return; }
  if [ "$(jq -r .verify_jwt "$WORK/out.json")" != false ]; then
    c=$(api PATCH "/functions/$n" -H 'Content-Type: application/json' -d '{"verify_jwt":false}')
    [[ "$c" == 2* ]] || { fail "$n : impossible de désactiver Verify JWT (HTTP $c : $(err))"; return; }
    c=$(api GET "/functions/$n")
  fi
  [ "$(jq -r .verify_jwt "$WORK/out.json")" = false ] && ok "$n : version $(jq -r .version "$WORK/out.json"), statut $(jq -r .status "$WORK/out.json"), Verify JWT désactivé" \
    || fail "$n : Verify JWT toujours actif (le planificateur serait refusé)"
}
section "2. Fonctions Edge"
for n in "${NAMES[@]}"; do deploy "$n"; done

if [ -n "${DELETE_FUNCTIONS:-}" ]; then
  for s in ${DELETE_FUNCTIONS//,/ }; do
    [[ "$s" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || { fail "nom de fonction invalide à supprimer : « $s »"; continue; }
    [[ " ${NAMES[*]} " != *" $s "* ]] || { fail "refus : « $s » est une fonction de SANIX AI"; continue; }
    c=$(api DELETE "/functions/$s"); [[ "$c" == 2* || "$c" == 404 ]] && ok "$s supprimée (ou déjà absente)" || fail "$s : suppression refusée (HTTP $c : $(err))"
  done
fi
c=$(api GET /functions)
if [ "$c" = 200 ]; then
  log "  Fonctions du projet :"; jq -r '.[] | "    \(.slug)  v\(.version)  \(.status)  verify_jwt=\(.verify_jwt)"' "$WORK/out.json"
  for s in $(jq -r '.[].slug' "$WORK/out.json"); do
    [[ " ${NAMES[*]} " == *" $s "* ]] || warn "fonction étrangère à SANIX AI : « $s » (à supprimer si elle est inutile)"
  done
fi

# ── 3. Secrets des fonctions ────────────────────────────────────────
section "3. Secrets"
c=$(sqlq "select decrypted_secret from vault.decrypted_secrets where name = 'ai_cron_secret'")
CRON="$(jq -r '.[0].decrypted_secret // empty' "$WORK/out.json" 2>/dev/null || true)"
if [[ "$CRON" =~ ^[0-9a-f]{64}$ ]]; then
  [ -z "${GITHUB_ACTIONS:-}" ] || printf '::add-mask::%s\n' "$CRON"
  c=$(V="$CRON" jq -cn '[{name:"CRON_SECRET",value:env.V}]' | api POST /secrets -H 'Content-Type: application/json' -d @-)
  [[ "$c" == 2* ]] && ok "CRON_SECRET copié du Vault vers les secrets des fonctions (valeur non affichée)" || fail "CRON_SECRET : écriture refusée (HTTP $c : $(err))"
else
  fail "secret « ai_cron_secret » introuvable dans le Vault (HTTP $c) : exécuter d'abord supabase/schedule_cron.sql"
fi
CRON=""
c=$(api GET /secrets)
if [ "$c" = 200 ]; then
  names=" $(jq -r '.[].name' "$WORK/out.json" | tr '\n' ' ')"
  [[ "$names" == *" CRON_SECRET "* ]] && ok "CRON_SECRET présent" || fail "CRON_SECRET absent des secrets"
  if [[ "$names" == *" ANTHROPIC_API_KEY "* ]]; then ok "ANTHROPIC_API_KEY présent"
  else warn "ANTHROPIC_API_KEY ABSENT : les agents restent en pause (incident « cle_ia_absente »). Supabase → Edge Functions → Secrets → Add new secret."; TODO+=("Ajouter le secret ANTHROPIC_API_KEY dans Supabase → Edge Functions → Secrets"); fi
else fail "lecture des secrets impossible (HTTP $c : $(err))"; fi

# ── 4. Les fonctions répondent-elles ? (faux secret : aucun effet) ──
probe() { curl -sS -m 30 -o "$WORK/p.json" -w '%{http_code}' -X POST "$FN/$1" -H 'Content-Type: application/json' -H 'x-cron-secret: sondage-invalide' -d '{"action":"tick"}' 2>/dev/null || echo 000; }
section "4. Réponse des fonctions (un faux secret doit donner 401)"
for n in ai-company ai-sales-director; do
  c=000; for i in 1 2 3 4 5 6 7 8 9 10; do c=$(probe "$n"); [ "$c" = 401 ] && break; sleep 6; done
  case "$c" in
    401) ok "$n : en ligne, secret du planificateur actif (401 attendu)" ;;
    404) fail "$n : introuvable (404) — nom ou déploiement incorrect" ;;
    500) fail "$n : erreur 500 — CRON_SECRET absent de l'environnement de la fonction ?" ;;
    *)   fail "$n : réponse inattendue HTTP $c" ;;
  esac
done
c=000; for i in 1 2 3 4 5; do c=$(curl -sS -m 30 -o /dev/null -w '%{http_code}' "$FN/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=sondage&hub.challenge=1" 2>/dev/null || echo 000); [ "$c" = 403 ] && break; sleep 6; done
[ "$c" = 403 ] && ok "whatsapp-webhook : en ligne (403 attendu sans jeton de vérification)" || warn "whatsapp-webhook : HTTP $c (secrets WhatsApp non configurés ?)"

# ── 5. Planificateur et santé des agents ────────────────────────────
section "5. Planificateur (attente de ${WAIT_CRON:-100} s)"
sleep "${WAIT_CRON:-100}"
c=$(sqlq "select coalesce(status_code::text,'erreur')||' : '||count(*) as n from net._http_response where created > coalesce(nullif('$T0','')::timestamptz, now() - interval '4 minutes') group by status_code order by status_code")
if [ "$c" = 200 ] || [ "$c" = 201 ]; then
  rep=$(jq -r '.[].n' "$WORK/out.json" 2>/dev/null | tr '\n' ' ')
  log "  Réponses des fonctions aux appels du planificateur (depuis le déploiement) : ${rep:-aucune}"
  if jq -e 'map(select(.n | startswith("202") or startswith("200"))) | length > 0' "$WORK/out.json" >/dev/null 2>&1; then ok "le planificateur atteint les fonctions (202 / 200)"
  else fail "aucune réponse 202 / 200 aux appels du planificateur (voir ci-dessus : 401 = CRON_SECRET, 404 = nom de fonction, 500 = secret manquant)"; fi
fi
c=$(sqlq "select (select count(*) from cron.job where jobname like 'ai-%')||' tâches planifiées, '||(select count(*) from ai_agents where etat = 'suspendu')||' agent(s) suspendu(s), missions : '||coalesce((select string_agg(statut||'='||n, ' ' order by statut) from (select statut, count(*) n from ai_agent_tasks group by 1) s),'aucune') as r")
[ "$c" = 200 ] || [ "$c" = 201 ] && log "  $(jq -r '.[0].r' "$WORK/out.json")"
c=$(sqlq "select type||' ('||gravite||') : '||message as i from ai_incidents where created_at > now() - interval '15 minutes' order by id desc limit 5")
if [ "$c" = 200 ] || [ "$c" = 201 ]; then jq -r '.[].i' "$WORK/out.json" | sed 's/^/  incident récent — /' | cut -c1-240; fi

# ── Bilan ───────────────────────────────────────────────────────────
section "Bilan"
if [ ${#TODO[@]} -gt 0 ]; then for t in "${TODO[@]}"; do log "  À FAIRE : $t"; done; fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "### Déploiement SANIX AI"; echo "- échecs : $FAILS"; for t in "${TODO[@]:-}"; do [ -z "$t" ] || echo "- **À faire** : $t"; done; } >> "$GITHUB_STEP_SUMMARY"
fi
[ "$FAILS" -eq 0 ] && { log "  Déploiement terminé sans échec."; exit 0; } || { log "  $FAILS échec(s) : voir ✗ ci-dessus."; exit 1; }
