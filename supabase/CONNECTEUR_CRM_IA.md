# Connecteur bidirectionnel SANIX CRM ↔ SANIX AI

Une seule base (PostgreSQL / Supabase), une seule identité par client, un journal d'événements partagé.
Le moteur IA (25 agents, missions, bureau 3D, bureau du Président) n'est pas modifié : il est **connecté** au CRM.

| Élément | Fichier |
|---|---|
| Schéma, fonctions, déclencheurs, droits | `supabase/migrations/20261111000000_crm_ai_connector.sql` |
| Verrouillage des anciennes tables `crm_*` (à lancer une fois, après déploiement du CRM) | `supabase/lockdown_crm_legacy.sql` |
| Service navigateur du CRM | `shared/crm-connector.js` (chargé par `index.html`) |
| Interface bureau 3D / Président | `company/office_panel.js`, `company/app.js`, `company/state.js` |
| Tests SQL (PostgreSQL réel) | `supabase/functions/tests/crm_connector_test.ts` |
| Boucle réelle avec le moteur et les outils des agents (modèle scripté) | `supabase/functions/tests/crm_agents_loop_test.ts` |
| Test de bout en bout (CRM réel + PostgreSQL réel) | `tests/crm_connector_test.js` + `supabase/functions/tests/rpc_bridge.ts` |

## 1. Phase A — audit exact du CRM (`index.html`, 16 545 lignes)

### 1.1 Stockage dans le navigateur

`localStorage`, préfixe `sanix_crm_` (`lsSave`/`saveStore`, `LS_STORES`, l. 8611). Clés réelles :

| Clé `localStorage` | Variable | Création / modification / suppression | Identifiant actuel |
|---|---|---|---|
| `sanix_crm_clients` | `CLIENTS` | `saveClient` (7912), `editClient`, `deleteClient`, `convertProspectToClient` | entier : `max + 1`, propre à chaque navigateur |
| `sanix_crm_deals` | `DEALS` | `saveDeal` (7578), `deleteDeal` | entier : `max + 1` |
| `sanix_crm_commandes` | `COMMANDES` | `saveCommande` (9820) | `cmd_<horodatage>` |
| `sanix_crm_presentations` | `PRESENTATIONS` | `savePres` (9628) | `pres_<horodatage>` |
| `sanix_crm_contrats` | `CONTRATS` | `saveContrat` (10101) | `ctr_<horodatage>` |
| `sanix_crm_licences` | `LICENCES` | `saveLicence` (15539) | `lic_<horodatage>` |
| `sanix_crm_documents` | `DOCUMENTS` | `saveDocToLibrary` (14385) | `doc_<horodatage>` |
| `sanix_crm_apporteurs` | `APPORTEURS` | `saveApporteur` (14536) | `app_<horodatage>` |
| `sanix_crm_ecritures` | `ECRITURES` | `saveEcriture` (13500) | `ec_<horodatage>` |
| `sanix_crm_deployments` | `DEPLOYMENTS` | `saveDeploiement` (7300) | `dep_<horodatage>` |
| `sanix_crm_logiciels` | `LOGICIELS` | catalogue (graine `LOGICIELS_SEED`) | `log_*` |
| `sanix_crm_sanix_crm_rdv` (double préfixe : `lsSave(RDV_KEY)` avec `RDV_KEY = 'sanix_crm_rdv'`) | `RDVS` (agenda) | `agSave` (12026), `agDone`, `agDelete` | entier : `max + 1` |
| `sanix_crm_config` | `CONFIG` | `persistConfig` | objet unique |
| `sanix_crm_users_data` | `USERS` | — | **non synchronisé** (empreintes de mots de passe) |

Hors périmètre, restent locaux : `sanix_crm_scheduled`, `_campagnes`, `_docs`, `_doc_registry`, `sanix_mkt_queue`, `_directory`, `_whoami`, `_session`. Volatiles (jamais enregistrés) : `EQUIPE`, `COMMISSIONS`.

### 1.2 Structure exacte des objets

| Objet | Champs (relevés dans le code) |
|---|---|
| **Client / prospect** (un prospect est un client dont `statut = 'prospect'`) | `id, nom, phone, email, secteur, logiciel, statut (prospect/client/inactif), commercial, valeur, effectif, caEstime, etablissements, adresse, lat, lng, notes, created_at, updated_at, interactions[] ({date, type, note, etape 0..5, ico})` |
| **Affaire** (pipeline) | `id, client (nom), clientId, logiciel, valeur, commercial, stage (prospect/contact/demo/proposition/negociation/gagne/perdu), notes, color, date, history[]` |
| **Commande** | `id, ref, client (nom), date, logiciel, typeLicence, htBrut, remise, htNet, tva, ttc, acompte, solde, commercial, statut (brouillon/confirmee/en_cours/livree/annulee), presId, notes` |
| **Facture / offre** | `DOCUMENTS` : `id, type (convention/facture/proforma/programme/pv_formation/presence), ref, client, date, contratId, html, createdAt` — une facture est un document de type `facture`, une offre un `proforma` |
| **Paiement** | **n'existe pas comme objet** : `acompte` et `solde` de la commande (`statut` pour la livraison) |
| **Rendez-vous** | agenda `RDVS` : `id, clientId, client, type, date, heure, duree, visio, lieu, notes, statut (prevu/fait/annule), createdAt` ; démonstrations `PRESENTATIONS` : `id, client, date, logiciel, type, commercial, duree, statut (planifiee/realisee/annulee/relance), resultat, suite, notes` |
| **Réclamation** | **n'existe pas** : ajout d'une interaction de type « Réclamation » (bouton dans la fiche client) |

### 1.3 Anomalies constatées (corrigées ou signalées)

| # | Constat | Traitement |
|---|---|---|
| 1 | `syncPull` **remplaçait** les données locales par les lignes distantes (perte de données) | neutralisé : la réception fusionne, une modification locale non envoyée n'est jamais écrasée |
| 2 | Tables `crm_clients`, `crm_deals`, `crm_deployments` : colonnes manquantes (`effectif`, `caEstime`, `clientId`, `notes`…) : 0 ligne en production | nouveau stockage `crm_records` (jsonb : aucune colonne à maintenir) |
| 3 | Toutes les tables `crm_*` en accès « anon » ouvert (lecture/écriture avec la clé publique), dont `crm_users_data` (empreintes) | `supabase/lockdown_crm_legacy.sql` ; les nouvelles tables sont réservées aux opérateurs dès la création |
| 4 | Rattachements par nom (`client`) ou par entier local (`clientId`) : fragiles entre appareils | `_client_rid` (identifiant stable) calculé à l'envoi |
| 5 | Agenda (`RDVS`) et `CONFIG` jamais synchronisés | entités `rdv` et `config` |
| 6 | `saveDeploiement` / `deleteDeploiement` n'enregistraient rien | `saveStore('deployments')` ajouté |
| 7 | `USERS_RAW` contient un mot de passe en clair du super administrateur dans `index.html` | **à corriger séparément** (hors périmètre) : le retirer du code et changer ce mot de passe |
| 8 | Aucune CSP sur le CRM (scripts en ligne) | signalé |

## 2. Correspondance objets CRM → base centrale

Toutes les données métier vont dans **une table** `crm_records(entity, rid, data jsonb, natural_key, version, seq, origin, deleted_at…)` : un objet du CRM est conservé tel quel (aucun champ perdu, aucune colonne à ajouter). Les relations et règles métier sont typées dans les tables SANIX AI existantes.

| Objet CRM | `entity` | `rid` (clé stable) | Relation SANIX AI |
|---|---|---|---|
| Client / prospect | `clients` | `_rid` ajouté à la fiche (`c_<base36>`) ; fiches IA : `ia_<id prospect>` ; clé naturelle `téléphone normalisé | nom normalisé` | `ai_prospects.crm_rid` (unique) ← **un seul dossier par prospect** |
| Affaire | `deals` | `_rid` (`d_…`) ; affaire IA : `ia_<id prospect>` | rattachée par `_client_rid` |
| Commande (+ paiements : `acompte`, `solde`) | `commandes` | `id` du CRM (`cmd_…`) ; commande IA : `ia_<id offre>` | `_client_rid` |
| Facture / offre / document | `documents` | `id` (`doc_…`) ; offre IA : `ia_<id offre>` | `ai_offers` ↔ proforma |
| Rendez-vous (agenda) | `rdv` | `_rid` (`r_…`) ; rendez-vous IA : `ia_<id rendez-vous>` | `ai_appointments` |
| Démonstration, contrat, licence, déploiement, apporteur, écriture, logiciel | `presentations`, `contrats`, `licences`, `deployments`, `apporteurs`, `ecritures`, `logiciels` | `id` du CRM | `_client_rid` quand un client est nommé |
| Paramètres | `config` | `main` | `docSecret` (clé de signature) jamais envoyée |
| Utilisateurs | — | — | non synchronisés |

Tables SANIX AI réutilisées (aucune dupliquée) : `ai_prospects` (+ `crm_rid`, `agent_id`), `ai_agents`, `ai_agent_tasks` (+ `prospect_id`, `crm_event_id`), `ai_appointments`, `ai_offers`, `ai_approvals`, `ai_incidents`. Nouvelles : `crm_records`, `crm_sync_ops` (idempotence), `crm_ai_events` (journal), `crm_ai_routing` (quel agent traite quel événement, modifiable), `crm_ai_stage_owner` (agent responsable selon l'étape de l'entonnoir).

## 3. Événements (durables, horodatés, traçables, idempotents)

`crm_ai_events` : `idempotency_key` unique, `trace_id`/`caused_by`, `status` (pending → done / failed / dead / skipped), `attempts`, `next_attempt_at`, `last_error`. Traitement par `crm_process_events()` (pg_cron, chaque minute) : verrouillage `skip locked`, sous-transaction par événement, reprise à 30 s, 60 s, 2 min… (1 h au plus), « dead » après 8 tentatives (visible dans le CRM, rejouable). Une file de gouvernance pleine (`max_taches_agent`, `max_missions_actives`) **retarde** l'événement sans le compter comme un échec.

| Sens | Événement | Déclencheur | Effet |
|---|---|---|---|
| CRM → IA | `crm.prospect.created` | fiche `prospect` créée dans un navigateur | `ai_prospects` créé/rattaché, agent responsable, mission « Qualifier… » à `ia_qualif_1` |
| | `crm.client.created` | fiche `client` créée | mission d'accueil à `ia_success` |
| | `crm.client.converted` | `statut` passe à `client` dans le CRM | mission de fidélisation |
| | `crm.commande.created` | commande créée | mission documents à `ia_docs` |
| | `crm.rdv.created` | rendez-vous créé | fiche de préparation à `ia_rdv_1` |
| | `crm.facture.emise` | document `facture` créé | suivi d'encaissement à `ia_dir_admin` |
| | `crm.paiement.enregistre` | `acompte` augmente | contrôle du versement à `ia_dir_admin` |
| | `crm.reclamation.recue` | interaction « Réclamation » ajoutée | mission prioritaire (1) à `ia_success` |
| IA → CRM | `ia.prospect.qualified` | étape `qualifie` | statut IA, score, historique « étape 1 », dossier créé si absent |
| | `ia.prospect.stage_changed` | autre changement d'étape | historique (étape 0..5), affaire du pipeline ; **conversion** (`marche_gagne`…) : `statut = client`, une seule fiche |
| | `ia.rdv.booked` / `ia.rdv.report` | `ai_appointments` | rendez-vous dans l'agenda ; compte rendu |
| | `ia.offer.created` / `.updated` / `.accepted` | `ai_offers` | proforma dans les documents (HTML échappé), affaire `proposition` ; acceptée : commande `confirmee`, affaire `negociation` |
| | `ia.mission.assigned` / `.completed` | `ai_agent_tasks` avec `prospect_id` | historique du dossier, compte rendu |
| | `ia.alert.raised` | `ai_incidents` (attention/critique), mission échouée ou bloquée | alerte dans le dossier et dans le bureau du Président |

La consigne de chaque mission créée par le connecteur (ou par `crm_assign_mission`) contient `prospect_id = <uuid>` : le moteur l'ajoute au périmètre de l'agent, qui peut alors agir sur le dossier sans le rechercher.

L'import initial n'émet **aucun** événement (pas de mission pour l'historique). Les écritures de l'IA dans le CRM (`origin = 'ia'`) n'en émettent pas non plus (pas d'écho). Une panne du connecteur ne fait jamais échouer le travail d'un agent ni la saisie du CRM (déclencheurs protégés).

## 4. Synchronisation du navigateur (`shared/crm-connector.js`)

- **Mode de transition** : le CRM garde `localStorage` et continue de fonctionner hors ligne ; le connecteur observe `lsSave`/`saveStore` et envoie les modifications. Sans session opérateur (onglet « Directeur commercial IA » → connecter l'agent), tout reste en file et rien n'est perdu.
- **Sauvegarde préalable** : copie locale automatique (`sanix_crm_backup_<date>`, 2 conservées) et export JSON depuis le panneau « Synchronisation ».
- **Import initial idempotent** : fiches identifiées (`_rid`), envoi par lots de 100 avec `op_id` (rejeu après réponse perdue : résultat mémorisé, aucun doublon) ; deux appareils qui ont saisi le même client (même nom + même téléphone) convergent vers une fiche ; deux entreprises derrière le même standard ne sont jamais fusionnées.
- **File d'envoi persistante** : seules les clés modifiées (contenu + `op_id`), reprise avec délai croissant (2 s → 60 s), rejeu à la reconnexion.
- **Réception** : curseur `seq` + recouvrement de 100 ; fusion champ par champ côté serveur ; champs que l'IA modifie (`statut`, `ia`…) protégés contre une copie locale périmée ; `interactions` et `history` fusionnés sans doublon.
- **Suppressions** : tombstones ; une suppression massive inattendue (> 30 %) n'est jamais envoyée sans confirmation ; une fiche modifiée par l'IA depuis n'est pas supprimée (conflit signalé).
- Interface : pilulier d'état (en-tête), panneau « Synchronisation » (état, missions des agents, événements en échec avec « Rejouer »), fiche client (agent responsable, missions, rendez-vous et comptes rendus, offres, journal), boutons « Confier à l'IA » et « Signaler une réclamation ».

## 5. Sécurité

- Les nouvelles tables sont en RLS dès leur création : lecture réservée aux opérateurs (`ai_is_operator()`), **aucune écriture directe** (fonctions `SECURITY DEFINER` uniquement). `anon` : aucun accès.
- Aucune clé secrète dans le navigateur : appels RPC avec la session opérateur (Supabase Auth).
- Contenus issus du web écrits par l'IA dans le CRM : `<`, `>`, `"` et `` ` `` neutralisés côté serveur (`crm_clean`) et HTML des propositions échappé ; le CRM les insère dans des gabarits HTML.
- La clé de signature des documents (`CONFIG.docSecret`) et les utilisateurs ne quittent jamais le navigateur.
- Arbitrage des missions (annuler, reprioriser) et tableau de bord : direction seulement. Les étapes engageantes (`contrat_signe`, `paiement_confirme`, `marche_gagne`) restent réservées à la validation humaine (garde-fou existant).

## 6. Mise en service (ordre)

1. Fusionner la PR (Vercel déploie le CRM avec `shared/crm-connector.js`). **Fusionner avant la migration est sans risque** : le connecteur détecte l'absence des fonctions SQL (404 `PGRST202`) et se met en veille (pilulier « Local · connecteur serveur absent », aucune rafale de requêtes, une sauvegarde locale par jour au plus) ; l'ancien envoi (tables `crm_*`) reste disponible, l'ancienne réception « remplace tout » est désactivée dans tous les cas ; le CRM enregistre en local comme avant. Dès que la migration est appliquée, la reprise est automatique (nouvelle détection au plus 5 min après, ou tout de suite par « Synchroniser maintenant ») : fiches créées pendant la veille incluses dans l'import initial (importées comme historique, sans mission).
2. Appliquer `20261111000000_crm_ai_connector.sql` (SQL Editor), **après** `schedule_cron.sql` : le traitement continu des événements est planifié par pg_cron, activé par ce script (sinon, relancer les deux `cron.schedule` de la fin de la migration). Sur une installation antérieure au 10 novembre, appliquer d'abord les deux migrations du 10 novembre (`DEPLOIEMENT.md` §7) ; `setup_all.sql` ne sert qu'aux nouvelles installations. Planification : le script crée `crm-ai-events` (chaque minute) et `crm-ai-purge` si `pg_cron` est actif.
3. Ouvrir le CRM, connecter l'agent IA (opérateur) : sauvegarde locale, import initial, puis synchronisation continue. Vérifier le pilulier : « Synchronisé ».
4. Une fois **tous** les navigateurs mis à jour : exécuter `supabase/lockdown_crm_legacy.sql` (supprime l'accès public aux anciennes tables).
5. Optionnel : `select crm_backfill_ia();` rattrape les offres, rendez-vous et prospects IA déjà existants.
6. **Outil de compte rendu** (`record_appointment_report`, nouveau) : redéployer les fonctions Edge (`supabase/tools/deploy_functions.sh`), **puis** l'ouvrir aux deux agents concernés (les installations neuves l'ont déjà via `seed_agents.sql`) :
   `update ai_agents set outils = array_append(outils, 'record_appointment_report') where code in ('ia_rdv_1', 'ia_nego_1') and not ('record_appointment_report' = any(outils));`
   Sans cet outil, un agent peut réserver un rendez-vous (visible dans l'agenda du CRM) mais pas en rédiger le compte rendu.

7. **Pilotage (budget, plan d'actions, coûts IA)** : appliquer `20261112000000_pilotage_budget.sql` (après la migration du connecteur), redéployer les trois fonctions, puis ouvrir l'écran *Pilotage → Budget & actions*. Le budget et le plan d'actions se synchronisent par le même chemin que les fiches du CRM (entités `pil_depenses`, `pil_actions`, `pil_config`, fusion champ par champ). Les agents proposent des actions avec l'outil `propose_commercial_action` ; rien n'entre dans le plan sans acceptation d'un opérateur. Serveur sans la migration : ces trois entités sont mises en veille 10 minutes puis réessayées, sans erreur de synchronisation. Tests : `supabase/functions/tests/pilotage_sql_test.sh`, `pilotage_tools_test.ts`, `tests/pilotage_e2e_test.js`.

Retour arrière : désactiver la planification (`select cron.unschedule('crm-ai-events')`) ; les données du CRM restent dans les navigateurs ; aucune table existante n'a été modifiée (colonnes ajoutées, nullables).

## 7. Tests

| Test | Contrôle | Résultat |
|---|---|---|
| `crm_connector_test.ts` (18, PostgreSQL réel) | droits et RLS, import idempotent, scénarios 1 à 9, événements CRM, tombstones, curseur, tableau de bord, isolation du moteur, XSS | 18 réussis |
| `crm_agents_loop_test.ts` (PostgreSQL réel, **vrai moteur et vrais outils des agents**, seul le modèle de langage est scripté) | prospect du CRM → qualification (`update_prospect`, `set_stage`) → rendez-vous (`list_free_slots`, `book_appointment`) → compte rendu (`record_appointment_report`) → offre (`create_offer`, grille officielle) → tout apparaît dans le CRM ; garde-fous de l'outil (avant le rendez-vous, doublon, trop court, hors périmètre) | 1 réussi |
| Suite Deno complète (moteur, ventes, présence, rapports + connecteur) | non-régression | 44 réussis |
| `tests/crm_connector_test.js` (CRM réel dans Chromium → HTTP → PostgreSQL réel) | mode dormant (migration absente), import et sauvegarde, scénarios 1 à 9 avec coupure réseau, panne 503, réponse perdue | 43 contrôles |

## 8. Limites connues

- La réception est interrogée toutes les 20 s (et après chaque envoi, au retour sur l'onglet, à la reconnexion). Realtime n'est pas utilisé pour `crm_records` (lignes volumineuses : documents HTML) ; à étudier si une réception instantanée devient nécessaire.
- Une modification locale d'un champ protégé (`statut` d'un client, par exemple) faite depuis une copie périmée n'est pas appliquée : le serveur garde la valeur de l'IA et la renvoie.
- Les marketing (`campagnes`, `scheduled`) et `USERS` restent locaux.
- L'application des migrations et le verrouillage des anciennes tables sont des actions de production : elles ne sont pas faites par la PR.
