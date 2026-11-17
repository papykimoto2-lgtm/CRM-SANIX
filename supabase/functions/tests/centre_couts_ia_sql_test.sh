#!/usr/bin/env bash
# Migration 20261129000000 (centre des coûts IA) sur un PostgreSQL réel. Prérequis : PGHOST / PGPORT / PGUSER. Usage : ./centre_couts_ia_sql_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../migrations/20261129000000_centre_couts_ia.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="cc_test_$$"
bash "$HERE/setup_db.sh" >/dev/null 2>&1
$P -d postgres -c "create database $DB template vc_tpl" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
DIR='00000000-0000-0000-0000-0000000000d1'; COM='00000000-0000-0000-0000-0000000000c2'
q() { $P -d "$DB" -c "$1"; }
as() { $P -d "$DB" -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', '$1', false)" -c "$2" | tail -1; }
checka() { local got; got=$(as "$2" "$3"); if [ "$got" = "$4" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $4 », obtenu « $got »"; exit 1; fi; }
refused() { local out; out=$($P -d "$DB" -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', '$2', false)" -c "$3" 2>&1 >/dev/null || true); if echo "$out" | grep -q "$4"; then echo "  ✓ $1"; else echo "  ✗ $1 : $out"; exit 1; fi; }
q "insert into auth.users(id) values ('$DIR'), ('$COM')" >/dev/null
q "insert into ai_operators(user_id, nom, role) values ('$DIR', 'Direction', 'direction'), ('$COM', 'Commercial', 'commercial')" >/dev/null
$P -d "$DB" -f "$MIG" >/dev/null
echo "▶ Migration relançable"
$P -d "$DB" -f "$MIG" >/dev/null 2>&1 && echo "  ✓ deuxième exécution sans erreur" || { echo "  ✗ deuxième exécution"; exit 1; }
echo "▶ Droits"
refused "un commercial ne lit pas les coûts" "$COM" "select ai_cost_center(30)" "Réservé à la direction"
echo "▶ Jeu de données"
A1=$(q "insert into ai_agents(code, nom, fonction, departement_id, niveau, manager_id) select 'ia_cc_un', 'IA Un', 'Prospection', id, 2, (select id from ai_agents where niveau=1 limit 1) from ai_departments limit 1 returning id")
A2=$(q "insert into ai_agents(code, nom, fonction, departement_id, niveau, manager_id) select 'ia_cc_deux', 'IA Deux', 'Support', id, 2, (select id from ai_agents where niveau=1 limit 1) from ai_departments limit 1 returning id")
q "insert into ai_actions(agent, action, agent_id, cout_usd, tokens_in, tokens_out, payload, at) values
   ('x','llm_turn','$A1', 1.50, 1000, 200, '{\"model\":\"claude-opus-5-5\"}', now()),
   ('x','llm_turn','$A1', 0.50, 500, 100, '{\"model\":\"claude-haiku-5-5\"}', now()),
   ('x','llm_turn','$A2', 2.00, 800, 300, '{\"model\":\"claude-opus-5-5\"}', now() - interval '2 days'),
   ('x','llm_turn','$A2', 9.00, 10, 10, '{\"model\":\"claude-opus-5-5\"}', now() - interval '40 days')" >/dev/null
q "insert into ai_actions(agent, action, agent_id, cout_usd, ok, at) values ('x','llm_turn','$A2', 0, false, now())" >/dev/null
q "insert into ai_incidents(gravite, type, agent_id, message) values ('critique','api_anthropic','$A2','Crédit épuisé'), ('info','test',null,'Note')" >/dev/null
checka "période 30 j : 4 $ (la dépense de 40 jours est exclue)" "$DIR" "select ai_cost_center(30)->>'periode_usd'" "4.0000"
checka "aujourd'hui : 2 $" "$DIR" "select ai_cost_center(30)->>'jour_usd'" "2.0000"
checka "30 jours listés, sans trou" "$DIR" "select jsonb_array_length(ai_cost_center(30)->'jours')" "30"
checka "somme de la courbe = total de la période" "$DIR" "select sum((j->>'cout_usd')::numeric) from jsonb_array_elements(ai_cost_center(30)->'jours') j" "4.0000"
checka "période de 7 jours : 7 enregistrements" "$DIR" "select jsonb_array_length(ai_cost_center(7)->'jours')" "7"
checka "agent le plus coûteux en tête" "$DIR" "select (ai_cost_center(30)->'agents'->0->>'nom')" "IA Deux"
checka "coût et appels de l'agent IA Un" "$DIR" "select a->>'cout_usd' || '/' || (a->>'appels') from jsonb_array_elements(ai_cost_center(30)->'agents') a where a->>'nom' = 'IA Un'" "2.0000/2"
checka "erreurs d'appel comptées par agent" "$DIR" "select (a->>'erreurs') from jsonb_array_elements(ai_cost_center(30)->'agents') a where a->>'nom' = 'IA Deux'" "1"
checka "répartition par modèle : opus 2 appels sur la période + 1 en erreur sans modèle" "$DIR" "select m->>'appels' from jsonb_array_elements(ai_cost_center(30)->'modeles') m where m->>'modele' = 'claude-opus-5-5'" "2"
checka "modèle absent du journal : « inconnu »" "$DIR" "select count(*) from jsonb_array_elements(ai_cost_center(30)->'modeles') m where m->>'modele' = 'inconnu'" "1"
checka "disponibilité : agents actifs comptés" "$DIR" "select (ai_cost_center(30)->'disponibilite'->>'actif')::int >= 2" "t"
checka "incidents de la période par gravité" "$DIR" "select ai_cost_center(30)->'incidents_periode'->>'critique'" "1"
checka "incident listé avec le nom de l'agent" "$DIR" "select i->>'agent' from jsonb_array_elements(ai_cost_center(30)->'incidents') i where i->>'type' = 'api_anthropic'" "IA Deux"
checka "durée bornée à 365 jours" "$DIR" "select ai_cost_center(9999)->>'jours_periode'" "365"
echo "TOUT EST OK"
