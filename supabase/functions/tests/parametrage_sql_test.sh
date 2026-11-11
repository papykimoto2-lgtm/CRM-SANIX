#!/usr/bin/env bash
# Migration 20261114000000 (paramétrage : rôles, cellules par logiciel, résolution par rôle, fonctions d'administration) sur un PostgreSQL réel.
# Prérequis : PGHOST / PGPORT / PGUSER (super-utilisateur). Usage : ./parametrage_sql_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../migrations/20261114000000_parametrage.sql"; SEED="$HERE/../../seed_agents.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="param_test_$$"
bash "$HERE/setup_db.sh" >/dev/null 2>&1
$P -d postgres -c "create database $DB template vc_tpl" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
DIR='00000000-0000-0000-0000-0000000000d1'; COM='00000000-0000-0000-0000-0000000000c2'
q() { $P -d "$DB" -c "$1"; }
id() { q "select id from ai_agents where code = '$1'"; }
as() { $P -d "$DB" -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', '$1', false)" -c "$2" | tail -1; }
check() { local got; got=$(q "$2"); if [ "$got" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $3 », obtenu « $got »"; exit 1; fi; }
checka() { local got; got=$(as "$2" "$3"); if [ "$got" = "$4" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu « $4 », obtenu « $got »"; exit 1; fi; }
refused() { local out; out=$($P -d "$DB" -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', '$2', false)" -c "$3" 2>&1 >/dev/null || true); if echo "$out" | grep -q "$4"; then echo "  ✓ $1"; else echo "  ✗ $1 : message « $out »"; exit 1; fi; }

echo "▶ Migration relançable"
$P -d "$DB" -f "$MIG" >/dev/null 2>&1 && echo "  ✓ deuxième exécution sans erreur" || { echo "  ✗ deuxième exécution"; exit 1; }
q "insert into auth.users(id) values ('$DIR'), ('$COM')" >/dev/null
q "insert into ai_operators(user_id, nom, role) values ('$DIR', 'Direction', 'direction'), ('$COM', 'Commercial', 'commercial')" >/dev/null

echo "▶ Configuration par défaut (donnée, pas code)"
check "18 rôles (dont les 14 du cahier des charges)" "select count(*) from ai_roles" "18"
check "directeur général et directeur commercial portent leur rôle" "select string_agg(role_code, ',' order by role_code) from ai_agents where role_code is not null" "directeur_commercial,directeur_general"
check "quatre cellules : ImmoSuite, AluExpert, AvicoSuite, Angel's Livraison" "select string_agg(product_id, ',' order by product_id) from ai_cells" "aluexpert,angels,avicosuite,immosuite"
check "routage des événements du CRM par rôle" "select count(*) from crm_ai_routing where role_code is not null" "8"
$P -d "$DB" -f "$SEED" >/dev/null 2>&1
check "après seed_agents.sql : 19 agents ont un rôle" "select count(*) from ai_agents where role_code is not null" "19"
check "membres des cellules (mutualisation : un agent sert plusieurs cellules)" "select count(*) from ai_cell_members" "25"
check "relancer l'organisation par défaut n'ajoute rien" "select public.ai_defaut_organisation()::text || (select count(*) from ai_cell_members)" "25"

echo "▶ Résolution du rôle pour un logiciel"
check "qualification d'ImmoSuite = ia_qualif_1" "select code from ai_agents where id = ai_agent_for('immosuite', 'qualification')" "ia_qualif_1"
check "communication : l'agent d'ordre 0 d'abord (WhatsApp)" "select code from ai_agents where id = ai_agent_for('aluexpert', 'communication')" "ia_wa_1"
check "poste vacant d'une cellule : repli sur tout agent actif de ce rôle" "select code from ai_agents where id = ai_agent_for('aluexpert', 'lead_hunter')" "ia_hunter_1"
check "rôle sans agent : aucun résultat" "select coalesce(ai_agent_for('immosuite', 'followup_manager')::text, 'null')" "null"
q "update ai_agents set etat = 'suspendu' where code = 'ia_qualif_1'" >/dev/null
check "agent suspendu : jamais désigné" "select coalesce(ai_agent_for('immosuite', 'qualification')::text, 'null')" "null"
q "update ai_agents set etat = 'actif' where code = 'ia_qualif_1'" >/dev/null

echo "▶ Permissions"
refused "un commercial ne peut pas modifier le catalogue" "$COM" "select ai_cfg_save_product('immosuite', '{\"nom\":\"X\"}')" "Réservé à la direction"
refused "un commercial ne peut pas créer d'agent" "$COM" "select ai_cfg_create_agent('{\"role_code\":\"lead_hunter\",\"nom\":\"Pirate\"}')" "Réservé à la direction"
refused "un commercial ne peut pas modifier les cellules" "$COM" "select ai_cfg_set_member('immosuite','lead_hunter','$(id ia_hunter_2)',true,0::smallint)" "Réservé à la direction"
checka "un commercial lit la configuration" "$COM" "select count(*) from ai_cells" "4"
refused "aucune écriture directe dans les cellules" "$DIR" "update ai_cells set nom = 'x'" "permission denied"

echo "▶ Logiciels (catalogue)"
checka "nouveau logiciel : créé INACTIF, sans tarif officiel signalé" "$DIR" "select ai_cfg_save_product('monlogiciel', '{\"nom\":\"Mon Logiciel\",\"marche_cible\":\"PME\",\"secteurs\":[\"commerce\"]}')->>'actif' || ' / ' || (ai_cfg_save_product('monlogiciel', '{\"mots_cles\":[\"caisse\"]}')->>'tarif_officiel')" "false / false"
refused "nouveau logiciel sans marché cible refusé" "$DIR" "select ai_cfg_save_product('sansmarche', '{\"nom\":\"X\"}')" "marché cible"
refused "identifiant invalide refusé" "$DIR" "select ai_cfg_save_product('Mauvais Id', '{}')" "invalide"
checka "activation" "$DIR" "select ai_cfg_save_product('monlogiciel', '{\"actif\":true}')->>'actif'" "true"
check "le logiciel activé est recommandé selon ses mots-clés" "select count(*) from ai_recommend_products('commerce', 'caisse') where product_id = 'monlogiciel'" "1"
checka "désactivation" "$DIR" "select ai_cfg_save_product('monlogiciel', '{\"actif\":false}')->>'actif'" "false"
check "désactivé : plus jamais recommandé" "select count(*) from ai_recommend_products('commerce', 'caisse') where product_id = 'monlogiciel'" "0"
as "$DIR" "select ai_cfg_set_alias('Ma Caisse Pro', 'monlogiciel', true)" >/dev/null
check "équivalence de nom (casse ignorée)" "select ai_product_of(' ma caisse pro ')" "monlogiciel"
as "$DIR" "select ai_cfg_set_alias('ma caisse pro', 'monlogiciel', false)" >/dev/null
check "équivalence retirée" "select coalesce(ai_product_of('ma caisse pro'), 'null')" "null"

echo "▶ Cellules et membres"
refused "une seule cellule active par logiciel" "$DIR" "select ai_cfg_save_cell('{\"id\":\"doublon\",\"nom\":\"Doublon\",\"product_id\":\"immosuite\"}')" "ai_cells_produit_actif"
checka "nouvelle cellule pour un autre logiciel" "$DIR" "select ai_cfg_save_cell('{\"id\":\"caisse\",\"nom\":\"Cellule caisse\",\"product_id\":\"monlogiciel\"}')->>'id'" "caisse"
as "$DIR" "select ai_cfg_set_member('caisse','lead_hunter','$(id ia_hunter_2)',true,0::smallint)" >/dev/null
check "ajout d'un membre : il est désigné pour ce logiciel" "select code from ai_agents where id = ai_agent_for('monlogiciel', 'lead_hunter')" "ia_hunter_2"
as "$DIR" "select ai_cfg_set_member('caisse','lead_hunter','$(id ia_hunter_2)',false,0::smallint)" >/dev/null
check "retrait : retour au repli (autre agent de ce rôle)" "select code from ai_agents where id = ai_agent_for('monlogiciel', 'lead_hunter')" "ia_hunter_1"

echo "▶ Création et modification d'agents"
refused "création refusée par la gouvernance quand le plafond est atteint" "$DIR" "select ai_cfg_create_agent(jsonb_build_object('role_code','lead_hunter','nom','Hors plafond','manager_id','$(id ia_resp_prospection)'))" "agents actifs maximum"
q "update ai_governance set max_agents_actifs = 40 where id = 1" >/dev/null
checka "création depuis un rôle : code généré, cellule renseignée" "$DIR" "select ai_cfg_create_agent(jsonb_build_object('role_code','lead_hunter','nom','Chasseur Aluminium','manager_id','$(id ia_resp_prospection)','cell_id','aluexpert'))->>'code'" "ia_chasseur_aluminium"
check "l'agent a le niveau, les outils et le rôle du modèle" "select niveau||'|'||role_code||'|'||array_to_string(outils, ',') from ai_agents where code = 'ia_chasseur_aluminium'" "5|lead_hunter|recherche_web,create_prospect,transmettre"
check "charte complète en version 1 (15 rubriques)" "select (select count(*) from jsonb_object_keys(contenu)) || '|' || version from ai_agent_charters where agent_id = (select id from ai_agents where code='ia_chasseur_aluminium')" "15|1"
check "il est le chasseur désigné de la cellule AluExpert" "select code from ai_agents where id = ai_agent_for('aluexpert', 'lead_hunter')" "ia_chasseur_aluminium"
refused "responsable obligatoire" "$DIR" "select ai_cfg_create_agent('{\"role_code\":\"lead_hunter\",\"nom\":\"Sans chef\"}')" "Responsable"
refused "hiérarchie respectée (responsable de niveau inférieur refusé)" "$DIR" "select ai_cfg_create_agent(jsonb_build_object('role_code','lead_hunter','nom','Mal rattaché','manager_id','$(id ia_hunter_1)'))" "Hiérarchie invalide"
refused "rôle inconnu refusé" "$DIR" "select ai_cfg_create_agent('{\"role_code\":\"inconnu\",\"nom\":\"X agent\"}')" "Rôle inconnu"
as "$DIR" "select ai_cfg_update_agent('$(id ia_chasseur_aluminium)', '{\"outils\":[\"recherche_web\",\"create_prospect\",\"transmettre\",\"get_prospect\"],\"budget_jour_usd\":1.5,\"fonction\":\"Chasseur de menuiseries aluminium\"}')" >/dev/null
check "modification : outils, budget, fonction" "select array_length(outils,1)||'|'||budget_jour_usd||'|'||fonction from ai_agents where code = 'ia_chasseur_aluminium'" "4|1.50|Chasseur de menuiseries aluminium"
check "outils modifiés : nouvelle version de la charte" "select charte_version||'|'||(select jsonb_array_length(contenu->'outils') from ai_agent_charters where agent_id = a.id and version = 2) from ai_agents a where code = 'ia_chasseur_aluminium'" "2|4"
refused "le directeur général ne peut pas être rattaché" "$DIR" "select ai_cfg_update_agent('$(id sanix_ai_general_director)', jsonb_build_object('manager_id','$(id ia_hunter_1)'))" "directeur général"

echo "▶ Rôles"
checka "nouveau rôle" "$DIR" "select ai_cfg_save_role('{\"code\":\"juriste\",\"libelle\":\"Juriste\",\"niveau\":4,\"outils\":[\"get_prospect\"]}')->>'code'" "juriste"
checka "rôle désactivé : plus de création possible" "$DIR" "select ai_cfg_save_role('{\"code\":\"juriste\",\"actif\":false}')->>'ok'" "true"
refused "création depuis un rôle inactif refusée" "$DIR" "select ai_cfg_create_agent(jsonb_build_object('role_code','juriste','nom','Juriste IA','manager_id','$(id ia_resp_prospection)'))" "Rôle inconnu ou inactif"
check "toutes les modifications sont journalisées" "select count(*) >= 12 from ai_actions where agent = 'operateur'" "t"
echo; echo "Tous les contrôles SQL du paramétrage sont passés."
