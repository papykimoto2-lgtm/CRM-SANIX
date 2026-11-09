# SANIX AI — backend Supabase

Deux ensembles livrés ensemble :

1. **SANIX AI SALES DIRECTOR** — agent commercial (prospection, qualification, conversation WhatsApp, offres, rendez-vous).
2. **SANIX AI VIRTUAL COMPANY** — entreprise virtuelle : directeur général IA, collaborateurs créés par les agents, missions, réunions, rapports, bureau du président.

## Composants

| Élément | Rôle |
|---|---|
| `migrations/20261109000000_ai_sales_director.sql` | Prospects (score /100), fil omnicanal, offres, RDV, relances, validations, audit immuable, RLS |
| `migrations/20261109020000_ai_virtual_company.sql` | Gouvernance, départements, agents hiérarchisés, cahiers des charges versionnés, missions + dépendances, réunions + PV, performance, mémoire, incidents, rapports |
| `functions/ai-company` | Président : instruction, rapports à la demande · Planificateur : `tick`, `report_tick` |
| `functions/ai-sales-director` | Missions de recherche, qualification, relances (CRM) |
| `functions/whatsapp-webhook` | Messages WhatsApp entrants (signature HMAC Meta) |
| `functions/_shared/` | `llm.ts` (appel IA budgété), `company/*` (moteur), `reports/*` (rapports HTML + PDF), `outbox.ts` (envois sous gouvernance) |
| `migrations/20261109030000_ai_virtual_office_3d.sql` | Présence temps réel : activité détaillée, lieu, phase de réunion, flux `ai_agent_events`, `ai_agent_presence()` |
| `migrations/20261109031000_ai_realtime_participants.sql` | Participants de réunion diffusés en temps réel |
| `functions/_shared/company/presence.ts` | Publication de la présence par le moteur (activités, déplacements, prises de parole) |
| `../company/` | Interface : bureau 3D animé, supervision, bureau du président, organisation, missions, réunions, performance, rapports, gouvernance, validations |
| `../company/assets/` | Personnages humains GLB et clips d'animation générés avec Blender (scripts Python reproductibles), voir `company/assets/README.md` |
| `../company/vendor/` | Three.js 0.170 + GLTFLoader en bundle local (aucune dépendance CDN pour la 3D) |
| `../company/tests/` | Tests d'interface (Playwright) : recette du Module 13 et parcours complet |
| `../vercel.json` | En-têtes de sécurité (CSP) de `/company/` |

## Déploiement

```bash
supabase db push
supabase secrets set ANTHROPIC_API_KEY=... CRON_SECRET=$(openssl rand -hex 32) \
  ALLOWED_ORIGINS=https://crm-sanix.vercel.app \
  AI_RUN_BUDGET_MS=110000 \
  RESEND_API_KEY=... EMAIL_FROM="SANIX AI <ia@sanix-africa.ci>" EMAIL_REPLY_TO=... \
  WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=... \
  WHATSAPP_TEMPLATE_FIRST=sanix_premier_contact DEMO_VISIO_URL=...
supabase functions deploy ai-company
supabase functions deploy ai-sales-director
supabase functions deploy whatsapp-webhook --no-verify-jwt   # authentifié par signature HMAC Meta
```

`AI_RUN_BUDGET_MS` : durée maximale d'une exécution d'agent. Plan gratuit (150 s de limite d'horloge) : 110 000. Plan Pro (400 s) : jusqu'à 330 000.

### Planificateur (pg_cron + pg_net)

Déploiement des fonctions sans CLI : workflow GitHub *Déployer SANIX AI (Supabase)* (`DEPLOIEMENT.md` §5, script `tools/deploy_functions.sh`). Planificateur sans CLI : `schedule_cron.sql` (voir `DEPLOIEMENT.md` §3) planifie les trois tâches en une exécution, le secret étant généré et gardé dans le Vault (rien à saisir). Variante manuelle, fonctions déployées avec *Verify JWT* actif :

```sql
select cron.schedule('ai-company-tick', '* * * * *', $$
  select net.http_post('https://<ref>.supabase.co/functions/v1/ai-company',
    '{"action":"tick"}'::jsonb, '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>','x-cron-secret','<CRON_SECRET>'))$$);
select cron.schedule('ai-company-reports', '*/5 * * * *', $$
  select net.http_post('https://<ref>.supabase.co/functions/v1/ai-company',
    '{"action":"report_tick"}'::jsonb, '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>','x-cron-secret','<CRON_SECRET>'))$$);
select cron.schedule('ai-sales-followups', '*/15 * * * *', $$
  select net.http_post('https://<ref>.supabase.co/functions/v1/ai-sales-director',
    '{"action":"tick"}'::jsonb, '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>','x-cron-secret','<CRON_SECRET>'))$$);
```

Les agents travaillent **sur le serveur**, interface fermée : `tick` (chaque minute) prend en charge les missions échues, les réunions, l'envoi des messages approuvés et l'expiration des agents temporaires.

### Webhook WhatsApp

`https://<ref>.supabase.co/functions/v1/whatsapp-webhook` (champ `messages`).

## Mise en service

0. Appliquer le schéma : `supabase db push`, ou coller `supabase/setup_all.sql` dans *SQL Editor* (généré par `build_setup_sql.sh`). Accès commun CRM ↔ SANIX AI et clé publique : voir `ACCES.md`. Création de tous les agents (`seed_agents.sql`, 23 collaborateurs) et missions d'après le CRM (`seed_crm_missions.sql`), fonctions Edge sans CLI (fichiers prêts à coller dans le tableau de bord), secrets et planificateur : voir `DEPLOIEMENT.md`.
1. Créer les comptes (Supabase Auth), puis :
   `insert into ai_operators(user_id, nom, role, remise_max_pct) values ('<uuid>', 'Nom', 'direction', 10);`
   Rôles : `direction` (tout), `admin` (+ gestion des opérateurs), `commercial` (lecture, ses prospects).
2. `ai_report_recipients` : adresse du président (principal) et destinataires secondaires. Heure, fuseau et fréquence : onglet *Rapports* (défaut : quotidien à 18 h, Africa/Abidjan).
3. `ai_availability` : créneaux des commerciaux. `ai_products.fonctionnalites` et `ai_pricing` : **l'agent ne cite que ces fonctionnalités et n'annonce que ces prix**.
4. Faire approuver par Meta le modèle `sanix_premier_contact` (1 variable : nom du contact).
5. Ouvrir `https://<site>/company/` (même origine que le CRM : la configuration Supabase du CRM est reprise ; une clé *secrète* est refusée).

## Gouvernance (onglet *Gouvernance*)

| Réglage | Défaut | Effet |
|---|---|---|
| Entreprise active | oui | Interrupteur général (pause) |
| Création d'agents sans validation | oui | Sinon chaque agent attend l'accord du président |
| Validation des outils externes | oui | Un agent doté de `send_message` attend l'accord |
| Communication externe | `validation` | `interdite` · chaque message validé par le président · `autonome` |
| Agents actifs / créations par jour | 25 / 10 | Plafonds (triggers SQL + moteur) |
| Missions actives / par agent / sous-missions / profondeur | 60 / 5 / 10 / 6 | Anti-prolifération et anti-boucle |
| Budget IA jour / mois / agent | 20 $ / 400 $ / 5 $ | Contrôlé avant **chaque** appel IA |
| Suspension automatique | 3 incidents | Agent suspendu, responsable alerté, e-mail d'incident critique |

Un agent peut demander plus de ressources (`demander_ressources`) : la demande apparaît dans *Validations*.

## Garde-fous

- `contrat_signe`, `paiement_confirme`, `marche_gagne` : bloqués en base pour l'agent (direction uniquement).
- Autorité hiérarchique : un agent ne donne d'ordre qu'à ses subordonnés ; la collaboration latérale reste dans sa direction ; privilèges d'outils non transmissibles au-delà de ceux possédés.
- Anti-boucle : chaîne de traitement sans retour à un agent déjà intervenu, missions identiques refusées, profondeur et charge plafonnées, dépendances acycliques (trigger).
- « STOP » → désinscription automatique, relances annulées, envois bloqués.
- Contenus prospects / web / rapports de sous-agents traités comme **données**, jamais comme instructions ; chaque agent n'agit que sur les prospects de son périmètre.
- `ai_actions` append-only : chaque appel IA et chaque outil sont journalisés (tokens et coût inclus).
- Rapports HTML : tout contenu est échappé ; affichage en iframe sans script.

## Bureau 3D temps réel (Module 13)

Le moteur IA **écrit l'état réel** ; le bureau 3D le **représente** (il ne simule rien). Les animations traduisent le statut déclaré, pas chaque opération technique.

| Couche | Rôle |
|---|---|
| `ai_agents` (+ `activite_detail`, `lieu`, `lieu_cible_agent/dept`, `lieu_jusqua`) | État persistant : survit à la fermeture de l'interface |
| `ai_agent_events` (14 jours) | Flux : `activite`, `deplacement`, `briefing`, `reunion`, `parole` — historique + synchronisation |
| `ai_agent_meetings.phase / orateur_id` | Réunion en direct : convocation → installation → échanges → synthèse → clôture |
| `ai_agent_presence()` | Écriture atomique (état + événement), réservée à `service_role` |
| Realtime (`postgres_changes`) | `ai_agents` (UPDATE), `ai_agent_events` (INSERT), réunions, participants, missions |

Événement publié (exemple) : `{ agent_id, status, activity, animation, department, location, target_agent_id, task_id, created_at }`.

**Activités → animations** (vocabulaire unique `company/activity.js` ↔ `presence.ts`, vérifié par le test P0) : recherche de prospects/web = écran · analyse de données = écrans multiples · rédaction d'e-mail = frappe · WhatsApp = terminal · appel = casque · négociation = échange animé · préparation de rapport / documents / rendez-vous = documents · organisation des équipes = présentation · réunion = assis à la table · mission terminée = confirmation · difficulté = signal d'alerte · attente / suspendu = pause.

**Déplacements** (déduits des missions réelles) : salle de réunion · visite d'un subordonné · supervision · espace de collaboration · département voisin · espace détente (disponible depuis 3 min sans mission). Les trajets suivent les allées (aucune traversée de bureau, testé). Le retour au poste est automatique à l'échéance `lieu_jusqua`, même sans nouvel événement.

**Rendu** : bureau de jour (ciel clair, murs blancs et vitrages, bureaux, chaises, bibliothèques, plantes, salle de réunion à table ronde, salle de supervision, espace détente), façades qui s'abaissent quand la caméra est derrière elles. Avatars humains en GLB (4 silhouettes × peau, cheveux, tenue et couleur de département déduits de l'identifiant, ~6 000 triangles, 1 appel de dessin) animés par 27 clips (marche, assis/debout : écran, frappe, appel, documents, parole, écoute, réussite, alerte, pause…). Qualité **élevée** : éclairage PBR, environnement, ombres portées ; **réduite / éco** : éclairage par sommet, sans ombres portées.

**Interface** : supervision *Agent · Activité · Statut* (🟢 🟡 🔴 ⚪, recherche, filtre, pagination) → fiche (identité, cahier des charges, missions, résultats, échanges internes, conversations prospects) → *Assigner une mission*, *Demander un rapport*, *Suspendre*. Un clic sur le directeur IA ouvre le dialogue. Notification cliquable quand une mission demandée par le président se termine. Caméras : d'ensemble, étage de direction (vue d'ouverture tant que l'entreprise compte ≤ 8 collaborateurs : on démarre par le prototype), département, bureau du directeur, réunion, supervision, activités en cours, suivi d'un collaborateur, vue libre (rotation, déplacement, zoom, clavier, tactile).

**Performance** : création progressive des avatars, avatars simplifiés au-delà du seuil (30 mobile · 90 poste · 18 éco), qualité automatique (mobile / appareil modeste → réduite), sélecteur Auto · Élevée · Réduite · Éco, mise en veille hors écran / onglet masqué, `prefers-reduced-motion` respecté (placement direct, sans marche), synchronisation incrémentale sans rechargement, rattrapage complet à la reconnexion et au retour sur l'onglet.

**Limites connues** : les clips d'animation sont écrits en code (Mixamo exige un compte Adobe et ne peut pas être automatisé) : `company/assets/README.md` explique comment les remplacer par des animations Mixamo ou d'autres modèles ; sans ressources GLB (hors ligne, fichier absent) le bureau bascule sur des avatars procéduraux ; pas de React Three Fiber (Three.js direct, plus léger) ; « appel téléphonique » = planification d'appel (aucun appel vocal réel) ; la restitution est celle de l'état en base, jamais une relecture des opérations.

## Tests

```bash
# PostgreSQL local (aucun Supabase requis)
supabase/functions/tests/setup_db.sh        # base modèle migrée « vc_tpl » (PGHOST/PGPORT/PGUSER)
cd supabase/functions
deno test --no-check --import-map=tests/import_map.json --allow-net --allow-env --allow-read --allow-write tests/
deno check ai-company/index.ts ai-sales-director/index.ts whatsapp-webhook/index.ts
```

Les tests exécutent le moteur sur un vrai PostgreSQL (triggers, contraintes, fonctions SQL) avec un faux Claude scripté : chaîne d'instruction → organisation → missions → synthèse, gouvernance, autorité, anti-boucle, communication externe, budget, pannes, suspension automatique, réunions, rapports (fuseaux, PDF, envois, alertes).
**Interface (Playwright + Chromium, WebGL logiciel)** : `company/tests/` — jeu de données exporté du vrai schéma PostgreSQL, faux client Supabase (requêtes journalisées, Realtime pilotable), CSP réelle de `vercel.json`.

```bash
npm i --no-save playwright
supabase/functions/tests/setup_db.sh && company/tests/build_fixture.sh   # base modèle puis jeu de données (PG* requis)
node company/tests/ui_test.js        # parcours complet : onglets, validations, rapports, mobile, repli 2D
node company/tests/m13_test.js       # recette Module 13 (9 critères : avatars, animations, temps réel, déplacements, réunions, interactions, missions, réouverture, mobile/performance)
company/tests/schema_check.py        # chaque colonne utilisée par l'interface existe dans le schéma réel
```

**Non couverts :** appels réels à Claude, WhatsApp et Resend ; API REST Supabase (PostgREST) et Realtime réels (simulés côté test) ; rendu sur GPU réel (testé en rendu logiciel SwiftShader, ~5-10 images/s : les fréquences mesurées n'ont pas de valeur absolue et les tests pilotent le temps avec `office.advance`).
