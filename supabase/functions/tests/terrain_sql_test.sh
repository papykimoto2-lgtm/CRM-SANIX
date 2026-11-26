#!/usr/bin/env bash
# Module Terrain (migration 20261220000000) sur un PostgreSQL réel. Prérequis : PGUSER super-utilisateur ; setup_db.sh crée la base modèle vc_tpl.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../migrations/20261220000000_terrain_commerciaux.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="tr_test_$$"
bash "$HERE/setup_db.sh" >/dev/null 2>&1
$P -d postgres -c "create database $DB template vc_tpl" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
$P -d "$DB" -f "$MIG" >/dev/null 2>&1 && echo "  ✓ migration relançable (2e exécution)" || { echo "  ✗ 2e exécution"; exit 1; }
DIR=00000000-0000-0000-0000-0000000000d1; C1=00000000-0000-0000-0000-0000000000c1; C2=00000000-0000-0000-0000-0000000000c2
$P -d "$DB" -c "insert into auth.users(id) values ('$DIR'),('$C1'),('$C2'); insert into ai_operators(user_id,nom,role) values ('$DIR','Direction','direction'),('$C1','Awa','commercial'),('$C2','Koffi','commercial')" >/dev/null
as() { # as <uid> <sql> : exécute en rôle authenticated avec ce JWT
  $P -d "$DB" -c "set role authenticated; select set_config('request.jwt.claim.sub','$1',false); select set_config('request.jwt.claim.role','authenticated',false); $2" 2>&1 | tail -n +3 | tail -1; }
asx() { $P -d "$DB" -c "set role authenticated; select set_config('request.jwt.claim.sub','$1',false); $2" 2>&1 >/dev/null | head -1 || true; }
check() { local got; got=$(as "$2" "$3"); if [ "$got" = "$4" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $4 », obtenu « $got »"; exit 1; fi; }
refused() { local out; out=$($P -d "$DB" -c "set role authenticated; select set_config('request.jwt.claim.sub','$2',false); $3" 2>&1 >/dev/null || true); if echo "$out" | grep -q "$4"; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $4 », obtenu « $out »"; exit 1; fi; }

ET='[{"client_rid":"1","nom":"Garage A","adresse":"Marcory","lat":5.3,"lng":-4.0},{"client_rid":"2","nom":"Garage B","lat":5.31,"lng":-4.01},{"client_rid":"3","nom":"Sans GPS"}]'
echo "▶ Planification"
refused "commercial ne planifie pas pour un collègue" $C1 "select terrain_planifier('$C2', current_date, 'T', 'z', '$ET'::jsonb)" "Seule la direction"
refused "tournée vide refusée" $DIR "select terrain_planifier('$C1', current_date, 'Tournée', 'z', '[]'::jsonb)" "1 à 60"
T=$(as $DIR "select terrain_planifier('$C1', current_date, 'Marcory matin', 'Marcory', '$ET'::jsonb)")
check "3 étapes créées" $C1 "select count(*) from terrain_etapes where tournee_id='$T'" "3"
check "le collègue ne voit pas la tournée (RLS)" $C2 "select count(*) from terrain_tournees" "0"
check "la direction voit la tournée" $DIR "select count(*) from terrain_tournees" "1"
refused "écriture directe refusée" $C1 "update terrain_tournees set statut='terminee'" "permission denied"
echo "▶ Consentement et démarrage"
refused "démarrage sans consentement refusé" $C1 "select terrain_demarrer('$T')" "Consentement"
check "consentement enregistré" $C1 "select (terrain_consentir('moto', 6)->>'objectif_visites_jour')" "6"
check "démarrage" $C1 "select terrain_demarrer('$T')->>'ok'" "true"
refused "une seule tournée en cours à la fois" $C1 "select terrain_demarrer(terrain_planifier('$C1', current_date, 'Seconde', null, '$ET'::jsonb))" "déjà en cours"
echo "▶ Positions et présence"
check "position acceptée" $C1 "select terrain_position('$T', 5.3, -4.0, 20, 5)->>'ok'" "true"
check "cadence limitée (8 s)" $C1 "select terrain_position('$T', 5.3001, -4.0, 20, 5)->>'ignore'" "cadence"
refused "coordonnées invalides refusées" $C1 "select terrain_position('$T', 95, 0)" "invalides"
refused "un autre commercial ne peut pas poster" $C2 "select terrain_position('$T', 5.3, -4.0)" "Aucune tournée"
E1=$($P -d "$DB" -c "select id from terrain_etapes where tournee_id='$T' and ordre=1")
E3=$($P -d "$DB" -c "select id from terrain_etapes where tournee_id='$T' and ordre=3")
check "arrivée sur place : présence vérifiée" $C1 "select terrain_arrivee('$E1', 5.30005, -4.0, 15)->>'presence_verifiee'" "true"
check "arrivée loin du prospect : présence non vérifiée" $C1 "select terrain_arrivee('$(echo $($P -d "$DB" -c "select id from terrain_etapes where tournee_id='$T' and ordre=2"))', 5.35, -4.05, 15)->>'presence_verifiee'" "false"
check "prospect sans GPS : position fixée (≤ 60 m)" $C1 "select terrain_arrivee('$E3', 5.32, -4.02, 20)->>'position_prospect_fixee'" "true"
echo "▶ Résultats et clôture"
refused "rendez-vous sans date refusé" $C1 "select terrain_resultat('$E1','visite','rdv_pris','ok')" "date à venir"
check "visite avec rendez-vous" $C1 "select terrain_resultat('$E1','visite','rdv_pris','Intéressé', now()+interval '2 days', 500000)->>'client_rid'" "1"
check "absent" $C1 "select terrain_resultat('$E3','absent')->>'statut'" "absent"
refused "résumé trop court refusé" $C1 "select terrain_terminer('$T','court')" "Résumé"
as $C1 "select terrain_terminer('$T','Journée correcte à Marcory','RAS')" >/dev/null
check "clôture : stats (1 visite, 1 rdv, 1 reporté)" $C1 "select ((terrain_feuille(current_date)->0->'rapport'->'stats')->>'visites') || '/' || ((terrain_feuille(current_date)->0->'rapport'->'stats')->>'rdv') || '/' || ((terrain_feuille(current_date)->0->'rapport'->'stats')->>'reportes')" "1/1/1"
refused "plus de position après clôture" $C1 "select terrain_position('$T', 5.3, -4.0)" "Aucune tournée"
echo "▶ Hiérarchie et indicateurs"
check "rapport à valider visible par la direction" $DIR "select jsonb_array_length(terrain_rapports_a_valider())" "1"
refused "un commercial ne peut pas valider" $C1 "select terrain_valider_rapport('$T','valide')" "direction"
check "validation" $DIR "select terrain_valider_rapport('$T','valide','Bien')->>'ok'" "true"
check "KPI direction : 2 commerciaux" $DIR "select jsonb_array_length(terrain_kpi(current_date-7, current_date))" "2"
check "KPI commercial : lui seul" $C1 "select jsonb_array_length(terrain_kpi(current_date-7, current_date))" "1"
check "KPI : 1 visite, présence 100 %" $C1 "select (terrain_kpi(current_date-7, current_date)->0->>'visites') || '/' || (terrain_kpi(current_date-7, current_date)->0->>'presence_pct')" "1/100"
check "score borné 0..100" $DIR "select bool_and((k->>'score')::int between 0 and 100)::text from jsonb_array_elements(terrain_kpi(current_date-7, current_date)) k" "true"
refused "live réservé à la direction" $C1 "select terrain_live()" "direction"
echo "OK"
