#!/usr/bin/env bash
# Peuplement de l'organisation (supabase/seed_agents.sql) : effectif, hiérarchie, chartes, outils par niveau, idempotence.
# Prérequis : PGHOST / PGPORT / PGUSER et la base modèle vc_tpl (setup_db.sh). Usage : ./seed_agents_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SEED="$HERE/../../seed_agents.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="seed_test_$$"
$P -d postgres -c "create database $DB template vc_tpl" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
check() { local got; got=$($P -d "$DB" -c "$2"); if [ "$got" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu $3, obtenu $got"; exit 1; fi; }
$P -d "$DB" -f "$SEED" >/dev/null 2>&1
check "25 agents actifs (plafond de gouvernance atteint)" "select count(*) from ai_agents where etat='actif'" 25
check "un seul directeur général" "select count(*) from ai_agents where niveau=1" 1
check "hiérarchie valide (responsable de niveau inférieur)" "select count(*) from ai_agents a join ai_agents m on m.id=a.manager_id where m.niveau >= a.niveau" 0
check "chaque agent a une charte en version 1" "select count(*) from ai_agents a where a.charte_version = 1" 25
check "chartes complètes (mission, délais, reporting, objectifs, limites, indicateurs)" "select count(*) from ai_agent_charters where not (contenu ? 'mission_principale' and contenu ? 'delais' and contenu ? 'reporting' and jsonb_array_length(contenu->'objectifs')>0 and jsonb_array_length(contenu->'limites')>0 and jsonb_array_length(contenu->'indicateurs')>0)" 0
check "chaque département a un responsable" "select count(*) from ai_departments where responsable_id is null" 0
check "pas d'outil de management au niveau 4 ou 5" "select count(*) from ai_agents where niveau >= 4 and outils && array['creer_agent','modifier_agent','changer_etat_agent','consulter_indicateurs','convoquer_reunion','demander_ressources','repondre_president']" 0
check "outil de communication externe : seulement WhatsApp et e-mail" "select string_agg(code, ',' order by code) from ai_agents where 'send_message' = any(outils)" "ia_mail_1,ia_wa_1"
check "organisation tracée au journal d'audit" "select count(*) from ai_actions where agent='seed_agents.sql' and action='organisation_initiale'" 1
$P -d "$DB" -f "$SEED" >/dev/null 2>&1
check "relance idempotente : aucun agent ni charte en double" "select count(*)||'/'||(select count(*) from ai_agent_charters) from ai_agents" "25/25"
echo "Peuplement de l'organisation : TOUT EST OK"
