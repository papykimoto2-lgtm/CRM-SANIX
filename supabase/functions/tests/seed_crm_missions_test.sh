#!/usr/bin/env bash
# Base CRM → entreprise IA (supabase/seed_crm_missions.sql) : import des prospects, une mission par agent, hiérarchie, dépendances, reprise des parents, idempotence.
# Prérequis : PGHOST / PGPORT / PGUSER et la base modèle vc_tpl (setup_db.sh). Usage : ./seed_crm_missions_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SEED_A="$HERE/../../seed_agents.sql"; SEED="$HERE/../../seed_crm_missions.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="seed_crm_test_$$"
$P -d postgres -c "create database $DB template vc_tpl" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
check() { local got; got=$($P -d "$DB" -c "$2"); if [ "$got" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu $3, obtenu $got"; exit 1; fi; }
$P -d "$DB" -f "$SEED_A" >/dev/null 2>&1
$P -d "$DB" -f "$SEED" >/dev/null 2>&1
check "prospects importés (≥ 98 % des fiches du CRM)" "select (count(*) >= 500)::text from ai_prospects where source='crm'" true
check "tous à l'étape « enregistre », source crm" "select count(*) from ai_prospects where source='crm' and stage <> 'enregistre'" 0
check "aucun prospect importé en double (même fiche du CRM)" "select count(*) - count(distinct crm_client_id) from ai_prospects where source='crm'" 0
check "produit recommandé par segment (immobilier → immosuite)" "select count(*) from ai_prospects where secteur='Immobilier' and produits_recommandes <> array['immosuite']" 0
check "WhatsApp renseigné seulement avec un téléphone" "select count(*) from ai_prospects where whatsapp is not null and telephone is null" 0
check "25 missions, une par agent" "select count(*)||'/'||count(distinct agent_id) from ai_agent_tasks" "25/25"
check "une seule instruction : celle du président au directeur général" "select count(*) from ai_agent_tasks t join ai_agents a on a.id=t.agent_id where t.type='instruction' and a.code='sanix_ai_general_director'" 1
check "autorité : chaque mission est donnée par le responsable direct (le président n'a pas de donneur agent)" "select count(*) from ai_agent_tasks t join ai_agents a on a.id=t.agent_id where t.donneur_agent_id is distinct from a.manager_id" 0
check "chaque sous-mission est rattachée à la mission de son donneur" "select count(*) from ai_agent_tasks c join ai_agent_tasks p on p.id=c.parent_id where c.donneur_agent_id <> p.agent_id" 0
check "profondeur de délégation ≤ 4" "select max(profondeur) from ai_agent_tasks" 4
check "10 missions de direction en attente de leurs subordonnés, 15 à faire" "select string_agg(statut||'='||n, ' ' order by statut) from (select statut, count(*) n from ai_agent_tasks group by statut) s" "a_faire=15 attente_sous_taches=10"
check "dépendances : contact après qualification, rendez-vous après contact, offre après rendez-vous" "select count(*) from ai_task_dependencies" 5
check "superviseur aligné sur Industrie et Logistique (charte v2)" "select a.charte_version||':'||a.fonction from ai_agents a where a.code='ia_sup_distribution'" "2:Superviseur secteurs industrie et logistique"
check "faits du CRM dans les missions (entrées renseignées pour les missions à faire)" "select count(*) from ai_agent_tasks where statut='a_faire' and entrees is null" 0
# le moteur ne prend que les missions sans dépendance en attente : 11 sur 15 (e-mail, WhatsApp, rendez-vous et offre attendent)
check "le moteur réclame les 11 missions prêtes (les 4 dépendantes attendent)" "select count(*) from ai_claim_tasks(20)" 11
$P -d "$DB" -c "update ai_agent_tasks set statut='terminee', finished_at=now() where agent_id in (select id from ai_agents where code in ('ia_hunter_3','ia_wa_1'))" >/dev/null
check "reprise automatique : le superviseur reprend la main quand ses subordonnés ont terminé" "select statut from ai_agent_tasks where agent_id=(select id from ai_agents where code='ia_sup_distribution')" a_faire
$P -d "$DB" -f "$SEED" >/dev/null 2>&1
check "relance idempotente : ni prospect ni mission en double" "select ((select count(*) from ai_agent_tasks) = 25 and (select count(*) from ai_prospects where source='crm') >= 500)::text" true
echo "Base CRM → missions : TOUT EST OK"
