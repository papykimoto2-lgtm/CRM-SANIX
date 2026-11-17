#!/usr/bin/env bash
# Migration 20261128000000 (WhatsApp CRM : messages envoyés, réponses, désinscriptions, droits d'accès) sur un PostgreSQL réel.
# Prérequis : PGHOST / PGPORT / PGUSER (super-utilisateur). Usage : ./wacrm_sql_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../migrations/20261128000000_whatsapp_crm.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="wa_test_$$"
bash "$HERE/setup_db.sh" >/dev/null 2>&1
$P -d postgres -c "create database $DB template vc_tpl" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
OP='00000000-0000-0000-0000-0000000000d1'; NOP='00000000-0000-0000-0000-0000000000e9'
q() { $P -d "$DB" -c "$1"; }
as() { $P -d "$DB" -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', '$1', false)" -c "$2" | tail -1; }
checka() { local got; got=$(as "$2" "$3"); if [ "$got" = "$4" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $4 », obtenu « $got »"; exit 1; fi; }
refused() { local out; out=$($P -d "$DB" -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', '$2', false)" -c "$3" 2>&1 >/dev/null || true); if echo "$out" | grep -q "$4"; then echo "  ✓ $1"; else echo "  ✗ $1 : « $out »"; exit 1; fi; }
rejected() { local out; out=$($P -d "$DB" -c "$2" 2>&1 >/dev/null || true); if echo "$out" | grep -q "check constraint"; then echo "  ✓ $1"; else echo "  ✗ $1 : « $out »"; exit 1; fi; }
q "insert into auth.users(id) values ('$OP'), ('$NOP')" >/dev/null
q "insert into ai_operators(user_id, nom, role) values ('$OP', 'Opérateur', 'commercial')" >/dev/null
$P -d "$DB" -f "$MIG" >/dev/null

echo "▶ Migration relançable"
$P -d "$DB" -f "$MIG" >/dev/null 2>&1 && echo "  ✓ deuxième exécution sans erreur" || { echo "  ✗ deuxième exécution"; exit 1; }

echo "▶ Messages envoyés"
q "insert into crm_wa_messages(client_rid, to_phone, template, body, wa_message_id) values ('c1', '2250700000107', 'sanix_premier_contact', 'Bonjour Alpha', 'wamid.A'), ('c2', '2250700000108', 'sanix_premier_contact', 'Bonjour Bêta', 'wamid.B')" >/dev/null
checka "un opérateur lit le journal" "$OP" "select count(*) from crm_wa_messages" "2"
checka "un non-opérateur ne voit rien" "$NOP" "select count(*) from crm_wa_messages" "0"
refused "personne n'écrit directement dans le journal" "$OP" "insert into crm_wa_messages(to_phone, body) values ('2250700000109','x')" "permission denied"
refused "ni ne le modifie" "$OP" "update crm_wa_messages set status='lu'" "permission denied"
rejected "numéro invalide refusé" "insert into crm_wa_messages(to_phone, body) values ('abc','x')"
rejected "statut hors liste refusé" "insert into crm_wa_messages(to_phone, body, status) values ('2250700000109','x','inconnu')"
rejected "message vide refusé" "insert into crm_wa_messages(to_phone, body) values ('2250700000109','')"
out=$($P -d "$DB" -c "insert into crm_wa_messages(to_phone, body, wa_message_id) values ('2250700000109','x','wamid.A')" 2>&1 >/dev/null || true); echo "$out" | grep -q "unique" && echo "  ✓ un même identifiant Meta ne peut être enregistré deux fois" || { echo "  ✗ unicité : $out"; exit 1; }

echo "▶ Réponses reçues"
q "insert into crm_wa_inbound(wa_message_id, from_phone, client_rid, body) values ('wamid.IN1', '2250700000107', 'c1', 'Je suis intéressé')" >/dev/null
checka "un opérateur lit les réponses" "$OP" "select body from crm_wa_inbound" "Je suis intéressé"
checka "un non-opérateur ne voit rien" "$NOP" "select count(*) from crm_wa_inbound" "0"
refused "personne n'écrit une réponse depuis le navigateur" "$OP" "insert into crm_wa_inbound(from_phone, body) values ('2250700000107','faux')" "permission denied"
out=$($P -d "$DB" -c "insert into crm_wa_inbound(wa_message_id, from_phone, body) values ('wamid.IN1','2250700000107','doublon')" 2>&1 >/dev/null || true); echo "$out" | grep -q "unique" && echo "  ✓ une réponse reçue deux fois (Meta réessaie) n'est enregistrée qu'une fois" || { echo "  ✗ doublon : $out"; exit 1; }

echo "▶ Désinscriptions"
q "insert into crm_wa_optout(phone, source) values ('2250700000107', 'STOP par WhatsApp')" >/dev/null
checka "un opérateur voit la liste des désinscrits" "$OP" "select count(*) from crm_wa_optout" "1"
refused "mais ne peut pas retirer un désinscrit" "$OP" "delete from crm_wa_optout" "permission denied"
checka "un non-opérateur ne la voit pas" "$NOP" "select count(*) from crm_wa_optout" "0"
echo; echo "WhatsApp CRM (base de données) : TOUT EST OK"
