#!/usr/bin/env bash
# Migration 20261115000000 (Phase 3 : segmentation par logiciel, sélection du pilote, entonnoir par logiciel) sur un PostgreSQL réel.
# Prérequis : PGHOST / PGPORT / PGUSER (super-utilisateur). Usage : ./phase3_sql_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../migrations/20261115000000_phase3_pilote.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="p3_test_$$"
bash "$HERE/setup_db.sh" >/dev/null 2>&1
$P -d postgres -c "create database $DB template vc_tpl" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
DIR='00000000-0000-0000-0000-0000000000d1'; COM='00000000-0000-0000-0000-0000000000c2'
q() { $P -d "$DB" -c "$1"; }
as() { $P -d "$DB" -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', '$1', false)" -c "$2" | tail -1; }
check() { local got; got=$(q "$2"); if [ "$got" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $3 », obtenu « $got »"; exit 1; fi; }
checka() { local got; got=$(as "$2" "$3"); if [ "$got" = "$4" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $4 », obtenu « $got »"; exit 1; fi; }
refused() { local out; out=$($P -d "$DB" -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', '$2', false)" -c "$3" 2>&1 >/dev/null || true); if echo "$out" | grep -q "$4"; then echo "  ✓ $1"; else echo "  ✗ $1 : message « $out »"; exit 1; fi; }
pid() { q "select id from ai_prospects where entreprise = '$1'"; }
seg() { q "select segment from ai_prospects where entreprise = '$1'"; }
sg() { local got; got=$(seg "$2"); if [ "$got" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $3 », obtenu « $got »"; exit 1; fi; }

echo "▶ Migration relançable"
$P -d "$DB" -f "$MIG" >/dev/null 2>&1 && echo "  ✓ deuxième exécution sans erreur" || { echo "  ✗ deuxième exécution"; exit 1; }
check "6 règles de départ (configuration, modifiable)" "select count(*) from ai_segment_rules" "6"
q "insert into auth.users(id) values ('$DIR'), ('$COM')" >/dev/null
q "insert into ai_operators(user_id, nom, role) values ('$DIR', 'Direction', 'direction'), ('$COM', 'Commercial', 'commercial')" >/dev/null

# Jeu de données : formes réelles de la base (secteur, nom), contacts variés
q "insert into ai_prospects(entreprise, secteur, telephone, email, stage, produits_recommandes) values
  ('Promoteur Alpha', 'Immobilier', '+2250700000001', 'alpha@exemple.ci', 'enregistre', '{immosuite}'),
  ('Promoteur Beta', 'Immobilier', '+2250700000002', null, 'enregistre', '{immosuite}'),
  ('Promoteur Gamma', 'Immobilier', null, 'gamma@exemple.ci', 'enregistre', '{immosuite}'),
  ('Promoteur Delta', 'Immobilier', '+2250700000004', 'delta@exemple.ci', 'enregistre', '{immosuite}'),
  ('Alutech Services', 'Industrie', '+2250700000010', 'alutech@exemple.ci', 'enregistre', '{aluexpert}'),
  ('Vitrerie du Plateau', 'Industrie', '+2250700000011', null, 'enregistre', '{aluexpert}'),
  ('Menuiserie Moderne', 'Industrie', '+2250700000012', null, 'enregistre', '{aluexpert}'),
  ('Ets Kouassi Industrie', 'Industrie', '+2250700000013', null, 'enregistre', '{aluexpert}'),
  ('Salut Entreprise', 'Industrie', '+2250700000014', null, 'enregistre', '{aluexpert}'),
  ('Ferme Avicole du Nord', 'Industrie', '+2250700000020', null, 'enregistre', '{aluexpert}'),
  ('Poulets de Bouaké', 'Services', '+2250700000021', null, 'enregistre', '{}'),
  ('Clinique Sainte Marie', 'Santé', '+2250700000030', 'clinique@exemple.ci', 'enregistre', '{medicor}'),
  ('Express Colis', 'Logistique', '+2250700000040', null, 'enregistre', '{angels}'),
  ('Divers Commerce', 'Commerce', '+2250700000050', null, 'enregistre', '{}'),
  ('Promoteur Déjà Travaillé', 'Immobilier', '+2250700000099', 'ok@exemple.ci', 'qualifie', '{medicor}')" >/dev/null

echo "▶ Aperçu : aucune écriture"
checka "aperçu pour un opérateur non direction" "$COM" "select (ai_segmenter_prospects(false)->'segments_calcules'->>'immosuite')::int" "5"
check "rien n'est enregistré par l'aperçu" "select count(*) from ai_prospects where segment is not null" "0"
checka "répartition calculée : ImmoSuite 5 (dont le déjà travaillé)" "$COM" "select ai_segmenter_prospects(false)->'segments_calcules' = '{\"aluexpert\": 3, \"a_verifier\": 2, \"immosuite\": 5, \"avicosuite\": 2, \"hors_perimetre\": 3}'::jsonb" "t"
refused "appliquer est réservé à la direction" "$COM" "select ai_segmenter_prospects(true)" "Réservé à la direction"

echo "▶ Application"
checka "la direction applique : 14 fiches modifiées (le prospect déjà travaillé est exclu)" "$DIR" "select (ai_segmenter_prospects(true)->>'fiches_modifiees')::int" "14"
sg "immobilier → ImmoSuite" "Promoteur Alpha" "immosuite"
sg "nom alu (début de mot) → AluExpert" "Alutech Services" "aluexpert"
sg "vitrerie → AluExpert" "Vitrerie du Plateau" "aluexpert"
sg "menuiserie → AluExpert" "Menuiserie Moderne" "aluexpert"
sg "« Salut » ne devient pas aluminium (début de mot)" "Salut Entreprise" "a_verifier"
sg "industrie sans indice → à vérifier (jamais forcé)" "Ets Kouassi Industrie" "a_verifier"
sg "ferme avicole → AvicoSuite même classée Industrie" "Ferme Avicole du Nord" "avicosuite"
sg "poulets (secteur Services) → AvicoSuite" "Poulets de Bouaké" "avicosuite"
sg "santé → hors périmètre" "Clinique Sainte Marie" "hors_perimetre"
sg "logistique → hors périmètre" "Express Colis" "hors_perimetre"
sg "secteur inconnu → hors périmètre (défaut)" "Divers Commerce" "hors_perimetre"
check "fiche déjà travaillée : jamais touchée" "select coalesce(segment, 'null') || '|' || array_to_string(produits_recommandes, ',') from ai_prospects where entreprise = 'Promoteur Déjà Travaillé'" "null|medicor"
check "logiciel recommandé = segment (plus d'ancien produit)" "select array_to_string(produits_recommandes, ',') from ai_prospects where entreprise = 'Alutech Services'" "aluexpert"
check "hors périmètre : aucune recommandation" "select coalesce(array_to_string(produits_recommandes, ','), '') || '|' || cardinality(produits_recommandes) from ai_prospects where entreprise = 'Clinique Sainte Marie'" "|0"
check "à vérifier : aucune recommandation" "select cardinality(produits_recommandes) from ai_prospects where entreprise = 'Ets Kouassi Industrie'" "0"

echo "▶ Choix manuel et règles"
as "$DIR" "select ai_cfg_set_segment('$(pid 'Ets Kouassi Industrie')', 'aluexpert')" >/dev/null
sg "choix manuel enregistré" "Ets Kouassi Industrie" "aluexpert"
q "update ai_prospects set stage = 'enregistre' where entreprise = 'Ets Kouassi Industrie'" >/dev/null
as "$DIR" "select ai_segmenter_prospects(true)" >/dev/null
sg "une nouvelle application ne défait jamais un choix manuel" "Ets Kouassi Industrie" "aluexpert"
refused "segment inconnu refusé" "$DIR" "select ai_cfg_set_segment('$(q "select id from ai_prospects limit 1")', 'inexistant')" "absent du catalogue"
refused "règle à expression invalide refusée avant écriture" "$DIR" "select ai_cfg_save_segment_rule('{\"champ\":\"entreprise\",\"motif\":\"(\",\"segment\":\"aluexpert\"}')" "invalid regular expression"
check "aucune règle ajoutée par l'erreur" "select count(*) from ai_segment_rules" "6"
as "$DIR" "select ai_cfg_save_segment_rule('{\"champ\":\"entreprise\",\"motif\":\"kouassi\",\"segment\":\"immosuite\",\"priorite\":5}')" >/dev/null
check "nouvelle règle (priorité 5) appliquée avant les autres" "select ai_segment_of(p) from ai_prospects p where entreprise = 'Ets Kouassi Industrie'" "immosuite"
as "$DIR" "select ai_cfg_save_segment_rule(jsonb_build_object('id', $(q "select id from ai_segment_rules where motif = 'kouassi'"), 'actif', false))" >/dev/null
check "règle désactivée : plus appliquée" "select ai_segment_of(p) from ai_prospects p where entreprise = 'Ets Kouassi Industrie'" "a_verifier"
refused "règles : direction seulement" "$COM" "select ai_cfg_save_segment_rule('{\"champ\":\"secteur\",\"motif\":\"test\",\"segment\":\"immosuite\"}')" "Réservé à la direction"

echo "▶ Pilote"
checka "sélection : 3 ImmoSuite, 10 AluExpert (segment plus petit : on prend ce qui existe), 5 AvicoSuite" "$DIR" "select ai_choisir_pilote('{\"immosuite\":3,\"aluexpert\":10,\"avicosuite\":5}') = '{\"aluexpert\": {\"manque\": 6, \"quota\": 10, \"ajoutes\": 4, \"dans_le_pilote\": 4, \"disponibles_dans_le_segment\": 4}, \"immosuite\": {\"manque\": 0, \"quota\": 3, \"ajoutes\": 3, \"dans_le_pilote\": 3, \"disponibles_dans_le_segment\": 4}, \"avicosuite\": {\"manque\": 3, \"quota\": 5, \"ajoutes\": 2, \"dans_le_pilote\": 2, \"disponibles_dans_le_segment\": 2}}'::jsonb" "t"
check "les plus joignables d'abord : e-mail + téléphone, puis e-mail seul" "select string_agg(p.entreprise, ',' order by p.entreprise) from ai_pilote pl join ai_prospects p on p.id = pl.prospect_id where pl.product_id = 'immosuite'" "Promoteur Alpha,Promoteur Delta,Promoteur Gamma"
check "« Promoteur Beta » (téléphone seul) laissé de côté quand le quota est atteint" "select count(*) from ai_pilote pl join ai_prospects p on p.id = pl.prospect_id where p.entreprise = 'Promoteur Beta'" "0"
check "le déjà travaillé n'entre jamais dans le pilote" "select count(*) from ai_pilote pl join ai_prospects p on p.id = pl.prospect_id where p.entreprise = 'Promoteur Déjà Travaillé'" "0"
checka "relancer la sélection n'ajoute rien (idempotent)" "$DIR" "select ((ai_choisir_pilote('{\"immosuite\":3}'))->'immosuite'->>'ajoutes')::int" "0"
checka "logiciel inactif ou inconnu signalé, jamais forcé" "$DIR" "select (ai_choisir_pilote('{\"inexistant\":5}'))->'inexistant'->>'erreur'" "logiciel absent ou inactif"
refused "sélection : direction seulement" "$COM" "select ai_choisir_pilote('{\"immosuite\":1}')" "Réservé à la direction"
as "$DIR" "select ai_cfg_pilote_set('$(pid 'Promoteur Beta')', true)" >/dev/null
check "ajout manuel d'un prospect segmenté" "select count(*) from ai_pilote pl join ai_prospects p on p.id = pl.prospect_id where p.entreprise = 'Promoteur Beta'" "1"
refused "ajout d'un prospect hors périmètre refusé" "$DIR" "select ai_cfg_pilote_set('$(pid 'Clinique Sainte Marie')', true)" "hors périmètre"
as "$DIR" "select ai_cfg_pilote_set('$(pid 'Promoteur Beta')', false)" >/dev/null
check "retrait manuel" "select count(*) from ai_pilote pl join ai_prospects p on p.id = pl.prospect_id where p.entreprise = 'Promoteur Beta'" "0"

echo "▶ Entonnoir par logiciel"
check "répartition de toute la base par segment" "select string_agg(segment || '=' || prospects, ',' order by segment) from ai_pilote_entonnoir" "a_verifier=1,aluexpert=4,avicosuite=2,hors_perimetre=3,immosuite=4,non_segmente=1"
check "pilote ImmoSuite : 3" "select dans_le_pilote from ai_pilote_entonnoir where segment = 'immosuite'" "3"
q "update ai_prospects set crit_produit = 25, crit_besoin = 25, crit_finance = 15, crit_decideur = 15, crit_court_terme = 10, crit_disponibilite = 10, score_justification = 'Éléments observables : site officiel et programme en cours' where entreprise = 'Promoteur Alpha'" >/dev/null
q "insert into ai_messages(prospect_id, canal, sens, auteur, contenu, statut) select id, 'email', 'sortant', 'agent', 'Bonjour', 'envoye' from ai_prospects where entreprise = 'Promoteur Alpha'" >/dev/null
q "insert into ai_messages(prospect_id, canal, sens, auteur, contenu, statut) select id, 'email', 'sortant', 'agent', 'Brouillon', 'a_valider' from ai_prospects where entreprise = 'Promoteur Beta'" >/dev/null
q "insert into ai_messages(prospect_id, canal, sens, auteur, contenu, statut) select id, 'email', 'entrant', 'prospect', 'Intéressé', 'recu' from ai_prospects where entreprise = 'Promoteur Alpha'" >/dev/null
check "qualifiés, prioritaires, contactés (un message à valider n'est pas un contact), réponses" "select qualifies||'|'||prioritaires||'|'||contactes||'|'||reponses from ai_pilote_entonnoir where segment = 'immosuite'" "1|1|1|1"
q "insert into crm_records(entity, rid, data) values ('commandes','c1','{\"logiciel\":\"ImmoSuite ERP\",\"statut\":\"en_cours\",\"htNet\":3389831,\"ttc\":4000000}')" >/dev/null
check "ventes du CRM (HT) rapprochées par logiciel" "select ca_ht_crm::bigint from ai_pilote_entonnoir where segment = 'immosuite'" "3389831"
q "grant select on all tables in schema public to authenticated" >/dev/null     # équivalent des droits par défaut de Supabase ; la protection par ligne (RLS) reste appliquée
checka "l'entonnoir est lisible par un opérateur" "$COM" "select prospects from ai_pilote_entonnoir where segment = 'immosuite'" "4"
check "le journal conserve les opérations de configuration" "select count(*) >= 5 from ai_actions where agent = 'operateur' and action in ('cfg_segmentation','cfg_pilote','cfg_segment_manuel','cfg_regle_segment')" "t"
echo; echo "Tous les contrôles SQL de la Phase 3 sont passés."
