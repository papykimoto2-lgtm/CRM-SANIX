#!/usr/bin/env bash
# Migration 20261125010000 (correctifs de la revue d'interconnexion) sur un PostgreSQL réel.
# Prérequis : PGHOST / PGPORT / PGUSER (super-utilisateur). Usage : ./revue_interconnexion_sql_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../migrations/20261125010000_correctifs_revue_interconnexion.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="rv_test_$$"
bash "$HERE/setup_db.sh" >/dev/null 2>&1
$P -d postgres -c "create database $DB template vc_tpl" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
q() { $P -d "$DB" -c "$1"; }
check() { local got; got=$(q "$2"); if [ "$got" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $3 », obtenu « $got »"; exit 1; fi; }
refused() { local out; out=$($P -d "$DB" -c "$2" 2>&1 >/dev/null || true); if echo "$out" | grep -q "$3"; then echo "  ✓ $1"; else echo "  ✗ $1 : message attendu « $3 », obtenu « $out »"; exit 1; fi; }
put() { q "select crm_put('commandes', 'c1', '$1'::jsonb, 'crm', 'test', false, null, null, false)" >/dev/null; }

echo "▶ Migration relançable"
$P -d "$DB" -f "$MIG" >/dev/null 2>&1 && echo "  ✓ deuxième exécution sans erreur" || { echo "  ✗ deuxième exécution"; exit 1; }

echo "▶ Fusion des paiements par identifiant"
check "union : p1 et p3 conservés avec p2" "select jsonb_array_length(crm_merge_paiements('[{\"id\":\"p1\",\"montant\":1},{\"id\":\"p2\",\"montant\":2}]', '[{\"id\":\"p1\",\"montant\":1},{\"id\":\"p3\",\"montant\":3}]'))" "3"
check "deux paiements identiques (même date, montant, mode) mais d'id différents : jamais fusionnés" "select jsonb_array_length(crm_merge_paiements('[{\"id\":\"pa\",\"date\":\"2026-11-11\",\"montant\":1000000}]', '[{\"id\":\"pb\",\"date\":\"2026-11-11\",\"montant\":1000000}]'))" "2"
check "version la plus récente (maj) l'emporte" "select (crm_merge_paiements('[{\"id\":\"p1\",\"montant\":1,\"maj\":\"2026-11-01\"}]', '[{\"id\":\"p1\",\"montant\":9,\"maj\":\"2026-11-02\"}]')->0->>'montant')" "9"
check "à maj plus ancienne, la copie périmée ne gagne pas" "select (crm_merge_paiements('[{\"id\":\"p1\",\"montant\":9,\"maj\":\"2026-11-02\"}]', '[{\"id\":\"p1\",\"montant\":1,\"maj\":\"2026-11-01\"}]')->0->>'montant')" "9"
check "paiement supprimé : le tombstone l'emporte sur une copie périmée" "select (crm_merge_paiements('[{\"id\":\"p1\",\"montant\":1,\"supprime\":true}]', '[{\"id\":\"p1\",\"montant\":1}]')->0->>'supprime')" "true"

echo "▶ Deux appareils qui ajoutent chacun un paiement"
put '{"ref":"CMD-T-1","ttc":5000000,"paiements":[{"id":"p1","date":"2026-09-04","montant":1000000}],"acompte":1000000,"solde":4000000}'
put '{"ref":"CMD-T-1","ttc":5000000,"paiements":[{"id":"p1","date":"2026-09-04","montant":1000000},{"id":"p2","date":"2026-11-11","montant":1000000}],"acompte":2000000,"solde":3000000}'
put '{"ref":"CMD-T-1","ttc":5000000,"paiements":[{"id":"p1","date":"2026-09-04","montant":1000000},{"id":"p3","date":"2026-11-12","montant":500000}],"acompte":1500000,"solde":3500000}'
check "les trois paiements sont conservés (avant : p2 disparaissait)" "select jsonb_array_length(data->'paiements') from crm_records where entity='commandes' and rid='c1'" "3"
check "acompte recalculé par le serveur : 1 000 000 + 1 000 000 + 500 000" "select (data->>'acompte') from crm_records where entity='commandes' and rid='c1'" "2500000"
check "solde recalculé : 5 000 000 − 2 500 000" "select (data->>'solde') from crm_records where entity='commandes' and rid='c1'" "2500000"

echo "▶ Suppression d'un paiement (tombstone) face à une copie périmée"
put '{"ref":"CMD-T-1","ttc":5000000,"paiements":[{"id":"p2","date":"2026-11-11","montant":1000000,"supprime":true,"maj":"2026-11-13T10:00:00Z"}]}'
put '{"ref":"CMD-T-1","ttc":5000000,"paiements":[{"id":"p1","date":"2026-09-04","montant":1000000},{"id":"p2","date":"2026-11-11","montant":1000000},{"id":"p3","date":"2026-11-12","montant":500000}]}'
check "le paiement supprimé ne ressuscite pas" "select count(*) from crm_records, jsonb_array_elements(data->'paiements') e where entity='commandes' and rid='c1' and e->>'id'='p2' and coalesce(e->>'supprime','false')='true'" "1"
check "acompte sans le paiement supprimé : 1 500 000" "select (data->>'acompte') from crm_records where entity='commandes' and rid='c1'" "1500000"

echo "▶ Historique append-only des enregistrements"
n0=$(q "select count(*) from crm_records_history where entity='commandes' and rid='c1'")
q "delete from crm_records where entity='commandes' and rid='c1'" >/dev/null
check "la suppression est conservée dans l'historique avec l'ancienne valeur" "select count(*) > $n0 and bool_or(op='DELETE' and (data->>'ref')='CMD-T-1') from crm_records_history where entity='commandes' and rid='c1'" "t"
check "table d'historique inaccessible à anon" "select has_table_privilege('anon','crm_records_history','select')" "f"

echo "▶ Garde-fou d'étape : tout ce que le CRM classe « gagné » est réservé à la direction"
q "insert into ai_prospects(entreprise) values ('Prospect Test')" >/dev/null
for s in paiement_attendu deploiement client_fidelise contrat_signe paiement_confirme marche_gagne; do
  refused "étape $s refusée à l'agent" "update ai_prospects set stage='$s' where entreprise='Prospect Test'" "réservée à la direction"
done
q "update ai_prospects set stage='negociation' where entreprise='Prospect Test'" >/dev/null && echo "  ✓ étape « négociation » toujours permise à l'agent"

echo "▶ Événement et agent suspendu : l'événement attend au lieu de mourir"
q "insert into ai_agents(code, nom, fonction, departement_id, niveau, manager_id, etat) select 'ia_dir_admin', 'Admin test', 'admin', d.id, 2, (select id from ai_agents where niveau=1 limit 1), 'suspendu' from ai_departments d limit 1" >/dev/null
q "insert into crm_ai_events(direction, type, idempotency_key, entity, rid, payload) values ('crm_to_ia', 'crm.paiement.enregistre', 'susp-1', 'commandes', 'cX', '{\"client\":\"Client Test\",\"ref\":\"CMD-X\",\"montant\":1000}'::jsonb)" >/dev/null
q "select crm_process_events(10)" >/dev/null
check "paiement enregistré, agent suspendu : l'événement reste en attente (avant : mort après 8 essais)" "select status || '|' || attempts from crm_ai_events where idempotency_key='susp-1'" "pending|0"
check "message explicite pour le fondateur" "select (last_error like 'En attente d''un agent disponible%') from crm_ai_events where idempotency_key='susp-1'" "t"
q "update crm_ai_events set created_at = now() - interval '4 days', attempts = 7, next_attempt_at = now() where idempotency_key='susp-1'" >/dev/null
q "select crm_process_events(10)" >/dev/null
check "au-delà de 3 jours, l'événement est abandonné (dead) et rejouable" "select status from crm_ai_events where idempotency_key='susp-1'" "dead"

echo "▶ Missions bloquées visibles en tête, avec leur raison"
q "insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000d1')" >/dev/null
q "insert into ai_operators(user_id, nom, role) values ('00000000-0000-0000-0000-0000000000d1', 'Direction', 'direction')" >/dev/null
q "insert into ai_agent_tasks(agent_id, titre, description, statut, rapport) select id, 'Mission terminée', 'd', 'terminee', 'Tout va bien' from ai_agents where niveau=1" >/dev/null
q "insert into ai_agent_tasks(agent_id, titre, description, statut, rapport) select id, 'Mission bloquée', 'd', 'bloquee', repeat('x', 900) || ' RAISON : plafond de coût dépassé' from ai_agents where niveau=1" >/dev/null
ov() { $P -d "$DB" -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false)" -c "$1" | tail -1; }
check_ov() { local got; got=$(ov "$2"); if [ "$got" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $3 », obtenu « $got »"; exit 1; fi; }
check_ov "la mission bloquée passe en premier" "select (crm_missions_overview(10)->0->>'statut')" "bloquee"
check_ov "sa raison (fin du rapport) est fournie" "select (crm_missions_overview(10)->0->>'raison') like '%plafond de coût dépassé'" "t"
check_ov "les missions terminées n'ont pas de « raison »" "select (crm_missions_overview(10)->1->>'raison') is null" "t"

echo "▶ Chiffres des rapports IA = chiffres du CRM"
q "insert into crm_records(entity, rid, data, origin) values
  ('commandes','r1','{\"ref\":\"CMD-R-1\",\"statut\":\"en_cours\",\"date\":\"2026-11-10\",\"htNet\":1000000,\"ttc\":1180000,\"paiements\":[{\"id\":\"a\",\"date\":\"2026-11-12\",\"montant\":590000},{\"id\":\"b\",\"date\":\"2026-11-13\",\"montant\":100000,\"supprime\":true}]}', 'crm'),
  ('commandes','r2','{\"ref\":\"CMD-R-2\",\"statut\":\"brouillon\",\"date\":\"2026-11-11\",\"htNet\":9000000,\"ttc\":10620000}', 'crm'),
  ('commandes','r3','{\"ref\":\"REN-R-3\",\"statut\":\"confirmee\",\"date\":\"2026-11-11\",\"htNet\":400000,\"ttc\":472000,\"renouvellement\":true}', 'crm'),
  ('commandes','r4','{\"ref\":\"CMD-R-4\",\"statut\":\"livree\",\"date\":\"2026-10-01\",\"ttc\":118000}', 'crm')" >/dev/null
check "CA signé de la période = HT des commandes confirmées (brouillon, renouvellement et hors période exclus) : 1 000 000" "select (ai_report_data('2026-11-01', '2026-12-01')->'financier'->>'ca_signe_ht')" "1000000"
check "commande ancienne sans HT : repli TTC/1,18 = 100 000, comptée en octobre" "select (ai_report_data('2026-10-01', '2026-11-01')->'financier'->>'ca_signe_ht')" "100000"
check "encaissé de la période, en HT : 590 000 × (1 000 000 / 1 180 000) = 500 000 ; paiement supprimé ignoré" "select (ai_report_data('2026-11-01', '2026-12-01')->'financier'->>'ca_encaisse_ht')" "500000"
check "opportunités : seuls les prospects au stade devis ou après comptent" "select (ai_report_data('2026-11-01', '2026-12-01')->'financier'->>'valeur_opportunites')" "0"
check "offre acceptée : la commande créée par l'IA est un brouillon" "select (pg_get_functiondef('crm_h_offer'::regproc) like '%''statut'', ''brouillon''%')" "t"

echo "▶ Droits retirés"
check "TRUNCATE retiré à authenticated sur crm_records" "select has_table_privilege('authenticated','crm_records','truncate')" "f"
check "TRUNCATE retiré à authenticated sur ai_prospects" "select has_table_privilege('authenticated','ai_prospects','truncate')" "f"

echo ""; echo "Correctifs d'interconnexion : TOUT EST OK"
