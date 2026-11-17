#!/usr/bin/env bash
# Migration 20261126000000 (alertes IA lisibles) sur un PostgreSQL réel. Prérequis : PGHOST / PGPORT / PGUSER. Usage : ./alertes_ia_lisibles_sql_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../migrations/20261126000000_alertes_ia_lisibles.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="al_test_$$"
bash "$HERE/setup_db.sh" >/dev/null 2>&1
$P -d postgres -c "create database $DB template vc_tpl" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
q() { $P -d "$DB" -c "$1"; }
check() { local got; got=$(q "$2"); if [ "$got" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $3 », obtenu « $got »"; exit 1; fi; }
RAW='400 {”type”:”error”,”error”:{”type”:”invalid_request_error”,”message”:”Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.”},”request_id”:”req_011Cguyq”'

echo "▶ Traduction des erreurs brutes"
check "crédit épuisé : phrase claire" "select crm_alert_lisible('$RAW') like 'Crédit Anthropic insuffisant%'" "t"
check "limite de requêtes" "select crm_alert_lisible('429 {\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\"}}') like 'Limite de requêtes%'" "t"
check "clé invalide" "select crm_alert_lisible('401 {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"invalid x-api-key\"}}') like 'Clé API%'" "t"
check "message d'erreur inconnu : on garde le message utile du JSON" "select crm_alert_lisible('500 {\"type\":\"error\",\"error\":{\"message\":\"Panne interne du service\"}}')" "Panne interne du service"
check "texte normal inchangé" "select crm_alert_lisible('Mission « Qualifier X » bloquée')" "Mission « Qualifier X » bloquée"

echo "▶ Alerte : une fois seulement"
q "insert into ai_prospects(entreprise, secteur) values ('Prospect Test', 'Industrie')" >/dev/null
q "insert into crm_ai_events(direction, type, idempotency_key, prospect_id, payload) select 'ia_to_crm', 'ia.alert.raised', 'al-' || g, p.id, jsonb_build_object('niveau', 'attention', 'message', '$RAW') from ai_prospects p, generate_series(1, 3) g" >/dev/null
q "select crm_h_alert(e) from crm_ai_events e where e.idempotency_key like 'al-%' order by e.created_at, e.idempotency_key" >/dev/null
check "trois tentatives identiques : une seule ligne dans la fiche" "select jsonb_array_length(data->'interactions') from crm_records where entity='clients' and data->>'nom'='Prospect Test'" "1"
check "la ligne est lisible" "select (data->'interactions'->0->>'note') like 'Crédit Anthropic insuffisant%' from crm_records where entity='clients' and data->>'nom'='Prospect Test'" "t"
q "insert into crm_ai_events(direction, type, idempotency_key, prospect_id, payload) select 'ia_to_crm', 'ia.alert.raised', 'al-autre', p.id, jsonb_build_object('niveau', 'attention', 'message', 'Autre anomalie') from ai_prospects p" >/dev/null
q "select crm_h_alert(e) from crm_ai_events e where e.idempotency_key = 'al-autre'" >/dev/null
check "une alerte différente est bien ajoutée" "select jsonb_array_length(data->'interactions') from crm_records where entity='clients' and data->>'nom'='Prospect Test'" "2"

echo "▶ Nettoyage des alertes déjà inscrites"
q "select crm_put('clients', 'c_ancien', jsonb_build_object('nom','Ancien Prospect','phone','+2250700000001','statut','prospect','interactions', jsonb_build_array(
   jsonb_build_object('type','Alerte IA (attention)','note','$RAW','date','2026-11-10T21:46:03Z'),
   jsonb_build_object('type','Alerte IA (attention)','note','$RAW','date','2026-11-10T21:47:02Z'),
   jsonb_build_object('type','Alerte IA (attention)','note','$RAW','date','2026-11-10T21:48:03Z'),
   jsonb_build_object('type','Contact établi','note','Étape mise à jour manuellement','date','2026-10-05T12:16:35Z'))), 'crm', 'test', false, null, null, false)" >/dev/null
$P -d "$DB" -f "$MIG" >/dev/null && echo "  ✓ migration rejouée sans erreur"
check "trois alertes identiques réduites à une, les autres lignes conservées" "select jsonb_array_length(data->'interactions') from crm_records where entity='clients' and rid='c_ancien'" "2"
check "l'alerte restante est lisible" "select (data->'interactions'->0->>'note') like 'Crédit Anthropic insuffisant%' from crm_records where entity='clients' and rid='c_ancien'" "t"
check "l'échange « Contact établi » est intact" "select data->'interactions'->1->>'type' from crm_records where entity='clients' and rid='c_ancien'" "Contact établi"
$P -d "$DB" -f "$MIG" >/dev/null && echo "  ✓ deuxième exécution sans effet ni erreur"
echo; echo "Alertes IA lisibles : TOUT EST OK"
