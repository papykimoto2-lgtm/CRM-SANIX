#!/usr/bin/env bash
# Migration 20261127000000 (Gmail : compte connecté, journal des e-mails, droits d'accès) sur un PostgreSQL réel.
# Prérequis : PGHOST / PGPORT / PGUSER (super-utilisateur). Usage : ./gmail_sql_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../migrations/20261127000000_gmail_envoi_suivi.sql"; MIG2="$HERE/../../migrations/20261129010000_gmail_lecture_reponses.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="gm_test_$$"
bash "$HERE/setup_db.sh" >/dev/null 2>&1
$P -d postgres -c "create database $DB template vc_tpl" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
OP='00000000-0000-0000-0000-0000000000d1'; NOP='00000000-0000-0000-0000-0000000000e9'
q() { $P -d "$DB" -c "$1"; }
as() { $P -d "$DB" -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', '$1', false)" -c "$2" | tail -1; }
check() { local got; got=$(q "$2"); if [ "$got" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $3 », obtenu « $got »"; exit 1; fi; }
checka() { local got; got=$(as "$2" "$3"); if [ "$got" = "$4" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $4 », obtenu « $got »"; exit 1; fi; }
refused() { local out; out=$($P -d "$DB" -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', '$2', false)" -c "$3" 2>&1 >/dev/null || true); if echo "$out" | grep -q "$4"; then echo "  ✓ $1"; else echo "  ✗ $1 : refus attendu (« $4 »), obtenu « $out »"; exit 1; fi; }
q "insert into auth.users(id) values ('$OP'), ('$NOP')" >/dev/null
q "insert into ai_operators(user_id, nom, role) values ('$OP', 'Opérateur', 'commercial')" >/dev/null
$P -d "$DB" -f "$MIG" >/dev/null
$P -d "$DB" -f "$MIG2" >/dev/null

echo "▶ Migrations relançables"
$P -d "$DB" -f "$MIG" >/dev/null 2>&1 && $P -d "$DB" -f "$MIG2" >/dev/null 2>&1 && echo "  ✓ deuxième exécution sans erreur" || { echo "  ✗ deuxième exécution"; exit 1; }

echo "▶ Le jeton Gmail reste inaccessible depuis le navigateur"
q "insert into crm_mail_account(email, token_enc) values ('sanix@gmail.com', 'v1.secret.secret')" >/dev/null
refused "un opérateur ne lit pas la table du compte" "$OP" "select token_enc from crm_mail_account" "permission denied"
refused "un opérateur ne peut pas y écrire" "$OP" "update crm_mail_account set email='x@y.ci'" "permission denied"
refused "ni un utilisateur quelconque" "$NOP" "select * from crm_mail_account" "permission denied"
out=$($P -d "$DB" -c "insert into crm_mail_account(id, email, token_enc) values (2, 'autre@gmail.com', 'v1.a.b')" 2>&1 >/dev/null || true); echo "$out" | grep -q "check constraint" && echo "  ✓ un seul Gmail peut être connecté (un second compte est refusé)" || { echo "  ✗ second compte accepté"; exit 1; }

echo "▶ État de la connexion"
checka "opérateur : voit l'adresse et « connecté », sans jeton" "$OP" "select (crm_mail_state()->>'connecte') || '|' || (crm_mail_state()->>'email') || '|' || (crm_mail_state() ? 'token_enc')::text" "true|sanix@gmail.com|false"
checka "non opérateur : accès refusé" "$NOP" "select crm_mail_state()->>'erreur'" "accès refusé"
q "update crm_mail_account set status='erreur', last_error='Accès retiré'" >/dev/null
checka "compte en erreur : « connecté » = faux et message" "$OP" "select (crm_mail_state()->>'connecte') || '|' || (crm_mail_state()->>'erreur')" "false|Accès retiré"

echo "▶ Journal des e-mails"
q "insert into crm_mails(client_rid, to_email, subject, body, status, sent_at, relance_apres_jours) values
   ('c1', 'a@x.ci', 'Ancien sans réponse', 'corps', 'envoye', now() - interval '6 days', 4),
   ('c2', 'b@x.ci', 'Récent', 'corps', 'envoye', now() - interval '1 day', 4),
   ('c3', 'c@x.ci', 'Répondu', 'corps', 'repondu', now() - interval '9 days', 4),
   ('c4', 'd@x.ci', 'Trop ancien', 'corps', 'envoye', now() - interval '60 days', 4),
   ('c5', 'e@x.ci', 'Relance dans 10 jours', 'corps', 'envoye', now() - interval '6 days', 10)" >/dev/null
checka "un opérateur lit le journal" "$OP" "select count(*) from crm_mails" "5"
checka "un non-opérateur ne voit rien" "$NOP" "select count(*) from crm_mails" "0"
refused "personne n'écrit directement dans le journal" "$OP" "insert into crm_mails(to_email, subject, body) values ('z@x.ci','a','b')" "permission denied"
refused "ni ne le modifie" "$OP" "update crm_mails set status='repondu'" "permission denied"
out=$($P -d "$DB" -c "insert into crm_mails(to_email, subject, body) values ('pas-une-adresse','a','b')" 2>&1 >/dev/null || true); echo "$out" | grep -q "check constraint" && echo "  ✓ adresse du destinataire invalide : refusée par la base" || { echo "  ✗ adresse invalide acceptée"; exit 1; }
out=$($P -d "$DB" -c "insert into crm_mails(to_email, subject, body, status) values ('a@x.ci','a','b','inconnu')" 2>&1 >/dev/null || true); echo "$out" | grep -q "check constraint" && echo "  ✓ statut hors liste : refusé" || { echo "  ✗ statut libre accepté"; exit 1; }

echo "▶ À relancer"
checka "envoyé, sans réponse, délai dépassé : 1 seul e-mail (pas le récent, pas le répondu, pas le trop ancien, pas celui à 10 jours)" "$OP" "select string_agg(subject, ',') from crm_mails_a_relancer()" "Ancien sans réponse"
checka "non opérateur : liste vide" "$NOP" "select count(*) from crm_mails_a_relancer()" "0"
echo "▶ Texte des réponses"
MID=$(q "select id from crm_mails where subject = 'Relance dans 10 jours'")
q "insert into crm_mail_replies(mail_id, gmail_message_id, from_email, received_at, body) values ('$MID', 'gm-r1', 'marc@promo.ci', now(), 'Oui, mardi me convient.')" >/dev/null
checka "un opérateur lit les réponses" "$OP" "select body from crm_mail_replies" "Oui, mardi me convient."
checka "un non-opérateur ne voit rien" "$NOP" "select count(*) from crm_mail_replies" "0"
refused "personne n'écrit directement une réponse" "$OP" "insert into crm_mail_replies(mail_id, gmail_message_id, received_at, body) values ('$MID','x',now(),'y')" "permission denied"
out=$($P -d "$DB" -c "insert into crm_mail_replies(mail_id, gmail_message_id, received_at, body) values ('$MID', 'gm-r1', now(), 'doublon')" 2>&1 >/dev/null || true); echo "$out" | grep -q "unique" && echo "  ✓ un même message Gmail n'est enregistré qu'une fois" || { echo "  ✗ doublon accepté : $out"; exit 1; }
out=$($P -d "$DB" -c "insert into crm_mail_replies(mail_id, gmail_message_id, received_at, body) values ('$MID', 'gm-r2', now(), repeat('x', 20001))" 2>&1 >/dev/null || true); echo "$out" | grep -q "check constraint" && echo "  ✓ texte limité à 20 000 caractères" || { echo "  ✗ texte trop long accepté"; exit 1; }
q "delete from crm_mails where id = '$MID'" >/dev/null
check "les réponses disparaissent avec leur e-mail" "select count(*) from crm_mail_replies" "0"
echo "▶ État de la connexion : droit de lecture"
q "update crm_mail_account set scopes = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata'" >/dev/null
checka "ancienne connexion (en-têtes seulement) : lecture des réponses non disponible" "$OP" "select crm_mail_state()->>'lecture_reponses'" "false"
q "update crm_mail_account set scopes = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly'" >/dev/null
checka "après reconnexion (envoi + lecture) : lecture des réponses disponible" "$OP" "select crm_mail_state()->>'lecture_reponses'" "true"
checka "la connexion reste décrite comme avant (adresse, statut du compte)" "$OP" "select (crm_mail_state()->>'email') || '/' || (crm_mail_state()->>'status')" "sanix@gmail.com/erreur"

echo; echo "Gmail (base de données) : TOUT EST OK"
