#!/usr/bin/env bash
# Migration 20261113000000 (Phase 2 : preuve de clôture, mission par logiciel, score du cahier des charges, ventes HT par logiciel) sur un PostgreSQL réel.
# Prérequis : PGHOST / PGPORT / PGUSER (super-utilisateur). Usage : ./phase2_sql_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../migrations/20261113000000_phase2_fiabilisation.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="phase2_test_$$"
bash "$HERE/setup_db.sh" >/dev/null 2>&1
$P -d postgres -c "create database $DB template vc_tpl" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
q() { $P -d "$DB" -c "$1"; }
check() { local got; got=$(q "$2"); if [ "$got" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $3 », obtenu « $got »"; exit 1; fi; }
refused() { local out; out=$($P -d "$DB" -c "$2" 2>&1 >/dev/null || true); if echo "$out" | grep -q "$3"; then echo "  ✓ $1"; else echo "  ✗ $1 : message « $out »"; exit 1; fi; }

echo "▶ Migration relançable"
$P -d "$DB" -f "$MIG" >/dev/null 2>&1 && echo "  ✓ deuxième exécution sans erreur" || { echo "  ✗ deuxième exécution"; exit 1; }

echo "▶ Missions : logiciel concerné"
check "colonnes produit et resultat_attendu" "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_name = 'ai_agent_tasks' and column_name in ('produit','resultat_attendu')" "produit,resultat_attendu"
refused "produit inconnu refusé (clé étrangère)" "insert into ai_agent_tasks(agent_id, type, titre, description, produit) select id, 'mission', 'Mission test', 'Description', 'inexistant' from ai_agents limit 1" "violates foreign key"

echo "▶ Preuve de clôture"
q "insert into ai_agent_tasks(agent_id, type, titre, description, statut) select id, 'mission', 'Mission M1', 'Description', 'en_cours' from ai_agents where code = 'sanix_ai_sales_director'" >/dev/null
refused "terminée sans rapport ni résultat : refusée" "update ai_agent_tasks set statut = 'terminee' where titre = 'Mission M1'" "sans preuve"
refused "rapport sans résultat : refusé" "update ai_agent_tasks set statut = 'terminee', rapport = 'Rapport suffisamment long pour être substantiel, mais sans résultat.' where titre = 'Mission M1'" "sans preuve"
check "rapport + résultat : acceptés" "update ai_agent_tasks set statut = 'terminee', rapport = 'Rapport suffisamment long pour être substantiel et vérifiable.', resultats = '[\"4 prospects qualifiés\"]' where titre = 'Mission M1' returning statut" "terminee"
check "mission produit ImmoSuite enregistrée" "insert into ai_agent_tasks(agent_id, type, titre, description, produit, resultat_attendu) select id, 'mission', 'Mission M2', 'Description', 'immosuite', '10 fiches scorées' from ai_agents limit 1 returning produit" "immosuite"

echo "▶ Score /100 (barème du cahier des charges)"
check "besoin jusqu'à 25 et maturité jusqu'à 10 : total 100" "insert into ai_prospects(entreprise, crit_produit, crit_besoin, crit_finance, crit_decideur, crit_court_terme, crit_disponibilite, score_justification) values ('Entreprise P100', 25, 25, 15, 15, 10, 10, 'Éléments observables : site officiel, programme en cours, décideur joignable') returning score" "100"
refused "besoin > 25 refusé" "insert into ai_prospects(entreprise, crit_besoin, score_justification) values ('Entreprise Test', 26, 'Éléments observables : site officiel, programme en cours')" "crit_besoin"
refused "maturité > 10 refusée" "insert into ai_prospects(entreprise, crit_court_terme, score_justification) values ('Entreprise Test', 11, 'Éléments observables : site officiel, programme en cours')" "crit_court_terme"
refused "score sans justification refusé" "insert into ai_prospects(entreprise, crit_produit) values ('Entreprise Test', 20)" "score_justifie"
check "score nul sans justification : accepté (prospect non qualifié)" "insert into ai_prospects(entreprise) values ('Entreprise non qualifiée') returning score" "0"
check "seuils : 80 → prioritaire" "select priorite from ai_prospects where entreprise = 'Entreprise P100'" "prioritaire"

echo "▶ Produits du CRM et ventes HT par logiciel"
check "AviNest Pro = AvicoSuite" "select ai_product_of('AviNest Pro')" "avicosuite"
check "casse et espaces ignorés" "select ai_product_of('  Sanix AluExpert ERP ')" "aluexpert"
check "produit hors périmètre (Angel's Transport) → null" "select coalesce(ai_product_of('Angel''s Transport'), 'null')" "null"
q "insert into crm_records(entity, rid, data) values
  ('commandes','c1','{\"logiciel\":\"ImmoSuite ERP\",\"statut\":\"en_cours\",\"htNet\":3389831,\"ttc\":4000000}'),
  ('commandes','c2','{\"logiciel\":\"ImmoSuite ERP\",\"statut\":\"en_cours\",\"htNet\":4237288,\"ttc\":5000000}'),
  ('commandes','c3','{\"logiciel\":\"AviNest Pro\",\"statut\":\"livree\",\"htNet\":338983,\"ttc\":400000}'),
  ('commandes','c4','{\"logiciel\":\"Angel''s Transport\",\"statut\":\"en_cours\",\"htNet\":508475,\"ttc\":600000}'),
  ('commandes','c5','{\"logiciel\":\"ImmoSuite ERP\",\"statut\":\"brouillon\",\"htNet\":9000000,\"ttc\":10620000}'),
  ('commandes','c6','{\"logiciel\":\"ImmoSuite ERP\",\"statut\":\"annulee\",\"htNet\":9000000,\"ttc\":10620000}')" >/dev/null
check "ImmoSuite : 2 ventes, 7 627 119 FCFA HT (4 M + 5 M TTC), brouillons et annulées exclus" "select commandes||' · '||ca_ht||' · '||ca_ttc from ai_ventes_par_produit where produit = 'immosuite'" "2 · 7627119 · 9000000"
check "AvicoSuite : la vente AviNest Pro est comptée" "select commandes||' · '||ca_ht from ai_ventes_par_produit where produit = 'avicosuite'" "1 · 338983"
check "produit hors périmètre regroupé" "select commandes||' · '||ca_ht from ai_ventes_par_produit where produit = 'hors_perimetre'" "1 · 508475"
echo; echo "Tous les contrôles SQL de la Phase 2 sont passés."
