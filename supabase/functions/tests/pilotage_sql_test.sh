#!/usr/bin/env bash
# Migration 20261112000000 (pilotage : budget, plan d'actions, coûts IA, propositions des agents) sur un PostgreSQL réel.
# Prérequis : PGHOST / PGPORT / PGUSER (super-utilisateur). Prépare la base modèle avec setup_db.sh. Usage : ./pilotage_sql_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../migrations/20261112000000_pilotage_budget.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="pilotage_test_$$"
bash "$HERE/setup_db.sh" >/dev/null 2>&1
$P -d postgres -c "create database $DB template vc_tpl" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
OP='00000000-0000-0000-0000-0000000000a1'; NOP='00000000-0000-0000-0000-0000000000b2'
q() { $P -d "$DB" -c "$1"; }
check() { local got; got=$(q "$2"); if [ "$got" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $3 », obtenu « $got »"; exit 1; fi; }
as() { $P -d "$DB" -c "set role $1" -c "select set_config('request.jwt.claim.sub', '$2', false)" -c "$3" | tail -1; }
refused() { local out; out=$($P -d "$DB" -c "set role $1" -c "select set_config('request.jwt.claim.sub', '$2', false)" -c "$3" 2>&1 >/dev/null || true); if echo "$out" | grep -q "$4"; then echo "  ✓ $5"; else echo "  ✗ $5 : message « $out »"; exit 1; fi; }

echo "▶ Migration relançable"
$P -d "$DB" -f "$MIG" >/dev/null 2>&1 && echo "  ✓ deuxième exécution sans erreur" || { echo "  ✗ deuxième exécution"; exit 1; }
q "insert into auth.users(id) values ('$OP'), ('$NOP')" >/dev/null
q "insert into ai_operators(user_id, nom, role) values ('$OP', 'Opérateur', 'direction')" >/dev/null

echo "▶ Entités de synchronisation"
q "insert into crm_records(entity, rid, data) values ('pil_depenses','dep_1','{\"mois\":\"2026-11\"}'), ('pil_actions','act_1','{}'), ('pil_config','main','{\"obj_2026-11\":5000000}')" >/dev/null
check "pil_depenses, pil_actions et pil_config acceptées" "select string_agg(entity, ',' order by entity) from crm_records where entity like 'pil_%'" "pil_actions,pil_config,pil_depenses"
refused postgres "$OP" "insert into crm_records(entity, rid, data) values ('inconnue','x','{}')" "check" "entité inconnue refusée"
check "les anciennes entités restent acceptées" "insert into crm_records(entity, rid, data) values ('clients','c_t','{}') returning entity" "clients"

echo "▶ Coûts IA"
q "insert into ai_actions(agent, action, agent_id, cout_usd, at) select 'x', 'llm_turn', id, 1.5, now() from ai_agents limit 1" >/dev/null
q "insert into ai_actions(agent, action, agent_id, cout_usd, at) select 'x', 'llm_turn', id, 2.5, now() - interval '40 days' from ai_agents limit 1" >/dev/null
q "insert into ai_actions(agent, action, cout_usd, at) values ('x', 'autre_action', 9, now())" >/dev/null
[ "$(as authenticated "$OP" "select (public.pilotage_ai_costs(1)->>'mois_usd')::numeric")" = "1.5000" ] && echo "  ✓ coût du mois : 1,5 (l'ancien mois et les actions non IA exclus)" || { echo "  ✗ coût du mois"; exit 1; }
as authenticated "$OP" "select jsonb_array_length(public.pilotage_ai_costs(3)->'mois')" | grep -q '^2$' && echo "  ✓ opérateur : 2 mois sur 3 (le coût d'il y a 40 jours apparaît)" || { echo "  ✗ opérateur : coûts mensuels"; exit 1; }
[ "$(as authenticated "$OP" "select jsonb_array_length(public.pilotage_ai_costs(1)->'agents_mois')")" = "1" ] && echo "  ✓ coût par agent pour le mois" || { echo "  ✗ coût par agent"; exit 1; }
refused authenticated "$NOP" "select public.pilotage_ai_costs(1)" "opérateurs" "coûts refusés à un non-opérateur"
refused anon "$NOP" "select public.pilotage_ai_costs(1)" "permission denied" "coûts refusés à anon"

echo "▶ Propositions des agents"
check "outil ouvert au directeur commercial IA" "select string_agg(code, ',') from ai_agents where 'propose_commercial_action' = any(outils)" "sanix_ai_sales_director"
check "proposition enregistrée" "select (public.ai_propose_commercial_action((select id from ai_agents limit 1), 'Relancer les cliniques de Cocody', 'Réponse <b>forte</b>', 'Awa', current_date + 7, 3000000, 'Santé')->>'statut')" "proposee"
check "HTML neutralisé" "select justification from pilotage_proposals" "Réponse ‹b›forte‹/b›"
refused postgres "$OP" "select public.ai_propose_commercial_action(null, 'Relancer les cliniques de Cocody')" "identique" "doublon en attente refusé"
refused postgres "$OP" "select public.ai_propose_commercial_action(null, 'abc')" "trop court" "titre trop court refusé"
q "do \$\$ begin for i in 1..19 loop perform public.ai_propose_commercial_action(null, 'Action numéro ' || i || ' du plan'); end loop; end \$\$" >/dev/null
refused postgres "$OP" "select public.ai_propose_commercial_action(null, 'Une de trop pour le plafond')" "Trop de propositions" "plafond de 20 propositions en attente"
refused authenticated "$OP" "select public.ai_propose_commercial_action(null, 'Tentative depuis un navigateur')" "permission denied" "un navigateur ne peut pas proposer"
[ "$(as authenticated "$NOP" "select count(*) from pilotage_proposals")" = "0" ] && echo "  ✓ non-opérateur : aucune proposition visible (RLS)" || { echo "  ✗ RLS des propositions"; exit 1; }
refused authenticated "$NOP" "select public.pilotage_proposals_list()" "opérateurs" "liste refusée à un non-opérateur"
as authenticated "$OP" "select jsonb_array_length(public.pilotage_proposals_list())" | grep -q '^20$' && echo "  ✓ opérateur : 20 propositions listées" || { echo "  ✗ liste opérateur"; exit 1; }
ID=$(q "select id from pilotage_proposals where titre like 'Relancer%'")
as authenticated "$OP" "select public.pilotage_proposal_decide('$ID', true)->>'statut'" | grep -q '^acceptee$' && echo "  ✓ décision : acceptée" || { echo "  ✗ décision"; exit 1; }
refused authenticated "$OP" "select public.pilotage_proposal_decide('$ID', false)" "déjà traitée" "seconde décision refusée"
refused authenticated "$NOP" "select public.pilotage_proposal_decide('$ID', true)" "opérateurs" "décision refusée à un non-opérateur"
check "la proposition acceptée n'est plus en attente" "select count(*) from pilotage_proposals where statut = 'proposee'" "19"
echo; echo "Tous les contrôles SQL du pilotage sont passés."
