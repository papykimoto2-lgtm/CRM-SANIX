#!/usr/bin/env bash
# Migration 20261123000000 (crédit de l'API Anthropic : solde estimé, recharges, données comptables) sur un PostgreSQL réel.
# Prérequis : PGHOST / PGPORT / PGUSER (super-utilisateur). Usage : ./credit_api_sql_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../migrations/20261123000000_credit_api.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="cr_test_$$"
bash "$HERE/setup_db.sh" >/dev/null 2>&1
$P -d postgres -c "create database $DB template vc_tpl" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
DIR='00000000-0000-0000-0000-0000000000d1'; COM='00000000-0000-0000-0000-0000000000c2'
q() { $P -d "$DB" -c "$1"; }
as() { $P -d "$DB" -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', '$1', false)" -c "$2" | tail -1; }
check() { local got; got=$(q "$2"); if [ "$got" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $3 », obtenu « $got »"; exit 1; fi; }
checka() { local got; got=$(as "$2" "$3"); if [ "$got" = "$4" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $4 », obtenu « $got »"; exit 1; fi; }
refused() { local out; out=$($P -d "$DB" -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', '$2', false)" -c "$3" 2>&1 >/dev/null || true); if echo "$out" | grep -q "$4"; then echo "  ✓ $1"; else echo "  ✗ $1 : refus attendu (« $4 »), obtenu « $out »"; exit 1; fi; }
q "insert into auth.users(id) values ('$DIR'), ('$COM')" >/dev/null
q "insert into ai_operators(user_id, nom, role) values ('$DIR', 'Direction', 'direction'), ('$COM', 'Commercial', 'commercial')" >/dev/null
$P -d "$DB" -f "$MIG" >/dev/null

echo "▶ Migration relançable"
$P -d "$DB" -f "$MIG" >/dev/null 2>&1 && echo "  ✓ deuxième exécution sans erreur" || { echo "  ✗ deuxième exécution"; exit 1; }

echo "▶ Aucune saisie : le solde n'est pas inventé"
checka "solde non renseigné" "$DIR" "select (ai_credit_status()->>'saisi')" "false"

echo "▶ Droits"
refused "un commercial ne peut pas déclarer une recharge" "$COM" "select ai_credit_ajouter('recharge', 10)" "Réservé à la direction"
checka "un commercial peut lire le solde" "$COM" "select (ai_credit_status()->>'saisi')" "false"
refused "table inaccessible directement" "$DIR" "select * from ai_credit_api" "permission denied"
refused "montant négatif refusé" "$DIR" "select ai_credit_ajouter('solde_constate', -1)" "Montant invalide"
refused "recharge à 0 refusée" "$DIR" "select ai_credit_ajouter('recharge', 0)" "supérieure à 0"
refused "date future refusée" "$DIR" "select ai_credit_ajouter('recharge', 10, current_date + 3)" "futur"

echo "▶ Solde estimé = solde constaté + recharges − consommation depuis"
as "$DIR" "select ai_credit_ajouter('solde_constate', 6.70, null, 'Console')" >/dev/null
q "insert into ai_actions(agent, action, cout_usd, at) values ('a', 'llm_turn', 1.20, now()), ('a', 'llm_turn', 0.30, now())" >/dev/null
checka "6,70 − 1,50 = 5,20" "$DIR" "select (ai_credit_status()->>'solde_usd')" "5.20"
as "$DIR" "select ai_credit_ajouter('recharge', 10, null, 'Recharge')" >/dev/null
checka "après recharge de 10 $ : 15,20" "$DIR" "select (ai_credit_status()->>'solde_usd')" "15.20"
q "insert into ai_actions(agent, action, cout_usd, at) values ('a', 'llm_turn', 99, now() - interval '3 days')" >/dev/null
checka "une dépense antérieure au solde constaté n'est pas recomptée" "$DIR" "select (ai_credit_status()->>'solde_usd')" "15.20"
as "$DIR" "select ai_credit_ajouter('solde_constate', 12.00)" >/dev/null
checka "un nouveau solde constaté repart de zéro" "$DIR" "select (ai_credit_status()->>'solde_usd')" "12.00"
check "recharges et saisies journalisées" "select count(*) from ai_actions where action in ('credit_api_recharge','credit_api_solde_constate')" "3"

echo "▶ Données comptables"
checka "la recharge figure pour la comptabilité" "$COM" "select jsonb_array_length(ai_credit_compta()->'recharges')" "1"
checka "la consommation du mois est remontée" "$COM" "select (ai_credit_compta()->'conso_mois'->0->>'cout_usd')::numeric > 0" "t"
echo "TOUT EST OK"
