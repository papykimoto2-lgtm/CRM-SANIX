# SANIX AI Virtual Company — Rapport d'audit (Phase 1)

Date : 10 novembre 2026 · Périmètre : dépôt `CRM-SANIX` (branche `main`, après la PR n° 24) et projet Supabase de production, **en lecture seule**. Aucune donnée ni aucun code n'a été modifié pour produire ce rapport. Les chiffres viennent de requêtes d'agrégats sur la base (aucune donnée personnelle reproduite).

Cadre : cahier des charges v2.0 — trois logiciels autorisés : **ImmoSuite ERP**, **Sanix AluExpert**, **AvicoSuite**.

---

## 1. Synthèse : ce qui est vrai aujourd'hui

1. **Aucun agent n'a jamais accompli une mission.** 25 missions existent : 15 bloquées, 6 en attente de sous-missions, 4 à faire ; **0 terminée, 0 avec résultat**. Coût IA cumulé : **0 $**, aucun appel IA réussi, aucun message, offre, rendez-vous ni relance. Les 45 erreurs d'exécution enregistrées portent le message de l'API Anthropic « solde de crédits insuffisant » (relevé sur un échantillon). Résultat : **15 agents sur 25 sont suspendus automatiquement** (hunters, enrichissement, qualification, marketing, administration…) et 10 sont actifs mais sans rien pouvoir exécuter.
2. **Le moteur est solide sur le papier et dans les tests** (47 tests Deno, scénarios SQL, bout en bout navigateur), mais **tous les tests utilisent un modèle de langage scripté**. Le critère de la Phase 2 (un agent réel, un vrai appel IA, un résultat structuré enregistré) n'a pas encore été validé en production.
3. **La base de 504 prospects n'a subi aucun traitement** : tous à l'étape « enregistré », score 0, aucun décideur renseigné, aucune source vérifiée.
4. **Répartition réelle de la base (504)** : Industrie 211 · Santé 168 · Immobilier 95 · Logistique 30. Elle ne correspond pas aux trois cellules :
   - **ImmoSuite : 95 prospects**, tous avec téléphone, 82 avec e-mail : une base exploitable.
   - **AluExpert : 211 « Industrie »**, dont environ **132 dont le nom évoque l'aluminium, la menuiserie, la vitrerie ou la métallerie** (heuristique sur le nom : à valider par l'enrichissement) ; les ~79 autres sont à vérifier. 10 seulement ont un e-mail (211 un téléphone).
   - **AvicoSuite : quasiment aucun prospect** (2 noms évoquant l'aviculture, 1 client « Aviculture » dans le CRM). Cette cellule dépendra d'abord de la recherche de prospects (Lead Hunter).
   - **Hors périmètre actuel : 168 Santé + 30 Logistique** (198 prospects) ; leur produit recommandé est aujourd'hui MedicorERP et Angel's.
5. **Un réglage de gouvernance contredit le cahier des charges : `communication_externe = autonome`.** Dès que les agents travailleront, ils pourraient envoyer des messages WhatsApp et e-mail **sans validation humaine** (la file de validation existe mais n'est pas activée). Le consentement obligatoire est désactivé. Rien n'est parti à ce jour (0 message). **À corriger avant tout rétablissement des crédits** (§7, décision D1).
6. **Les ventes annoncées sont bien dans le CRM, mais en TTC.** Les deux commandes ImmoSuite valent **3 389 831 et 4 237 288 FCFA HT**, soit exactement **4 000 000 et 5 000 000 FCFA TTC** (TVA 18 %). Le tableau de bord SANIX AI ne les voit pas : son « CA gagné » ne compte que les offres établies par les agents.

---

## 2. Données CRM

| Constat | Valeur |
|---|---|
| Prospects IA (`ai_prospects`) | 504 (CRM : 511 prospects + 8 clients ; les écarts sont des doublons ou fiches non importables) |
| Avec téléphone / e-mail / les deux / aucun | 479 / 109 / 107 / 23 |
| Doublons de téléphone normalisé | 0 |
| Désinscrits (opt-out) | 0 |
| Décideur renseigné | 0 |
| Étape | 504 « enregistré » ; score > 0 : **0** |
| Produit recommandé (pré-rempli par le segment) | AluExpert 211 · MedicorERP 168 · ImmoSuite 95 · Angel's 30 |
| Clients CRM (8) et commandes (9) | ImmoSuite ×2 (en cours), AluExpert ×2 (en cours), AviNest Pro ×1 (livrée), Angel's ×2, AutoGarage Pro ×1, Phyto Strike Force ×1 |

**Point à trancher (D2)** : le CRM porte une vente **« AviNest Pro »** (livrée, 338 983 FCFA HT) alors que le catalogue SANIX AI et le cahier des charges parlent d'**AvicoSuite**. S'agit-il du même produit ? Sinon, AvicoSuite n'a pas de vente établie dans le CRM.

**Produits actifs dans SANIX AI : 10** (aluexpert, immosuite, avicosuite, medicor, angels, distripro, comptapro, inox100, snifi, cilegrenier). Les trois produits du périmètre ont un tarif officiel (licence 750 000 FCFA pour ImmoSuite, 600 000 pour AluExpert et AvicoSuite ; abonnements mensuels 75 000 / 60 000 / 60 000) ; `inox100` et `snifi` n'en ont aucun. Les missions de départ (`seed_crm_missions.sql`) mentionnent MedicorERP et Angel's.

---

## 3. Cartographie des agents (25 existants → rôles du cahier des charges)

| Rôle demandé | Agent existant | État | Remarque |
|---|---|---|---|
| Directeur général IA | `sanix_ai_general_director` | actif | Crée missions et sous-missions, réunions, rapports (code réel) ; jamais exécuté sur modèle réel |
| Directeur commercial IA | `sanix_ai_sales_director` | actif | Peut proposer des actions au plan (outil ajouté en PR n° 24) |
| Market Intelligence | `ia_market` | **suspendu** | Dans le département Intelligence économique |
| Lead Hunter | `ia_hunter_1` (promoteurs), `_2` (cliniques), `_3` (livraison) | **suspendus** | Seul `_1` correspond au périmètre ; `_2` et `_3` hors périmètre ; aucun pour aluminium ni avicole |
| Lead Enrichment | `ia_enrich_1` (« Data Analyst ») | **suspendu** | Remplit l'enrichissement ; ne fait pas d'analyse commerciale |
| Qualification | `ia_qualif_1` | **suspendu** | Score /100 présent (barème différent, §5) |
| Commercial produit (3 profils) | superviseurs `ia_sup_immo` (immobilier + BTP), `ia_sup_sante`, `ia_sup_distribution` | actifs | Découpage par secteur, pas par logiciel : aucun superviseur aluminium ni avicole |
| Communication | `ia_wa_1` (WhatsApp), `ia_mail_1` (e-mail) | actifs | Deux agents par canal ; envoi soumis au réglage de gouvernance |
| Appointment Manager | `ia_rdv_1` | actif | Créneaux, rendez-vous, compte rendu (outil ajouté en PR n° 23) |
| Follow-up Manager | **aucun agent dédié** | — | Relances via l'outil `schedule_followup` et le planificateur du moteur v1 (`ai-sales-director`) |
| Proposal Generator | `ia_nego_1` (« Sales Negotiator ») | actif | Établit l'offre depuis la grille officielle ; pas d'agent distinct |
| Negotiation Manager | `ia_nego_1` | actif | Même agent |
| Customer Success | `ia_success` | **suspendu** | Hors du premier périmètre de vente |
| Sales Analyst | **aucun agent dédié** | — | Indicateurs par vue SQL (§6) |
| Responsable de la prospection | `ia_resp_prospection` | actif | Coordonne les trois superviseurs |
| Hors périmètre commercial | marketing (3), veille concurrentielle, administration (2), directeur relation client | suspendus | À laisser en pause plutôt que supprimer (aucune suppression sans justification) |

Constat : **12 des 14 rôles du cahier des charges sont couverts par des agents existants ; deux manquent (Follow-up Manager, Sales Analyst)**, et le découpage actuel est « par secteur de la santé / distribution » alors que les trois cellules sont par logiciel. Recommandation : **ne pas créer de nouveaux agents** ; réutiliser `ia_qualif_1`, `ia_enrich_1`, `ia_market`, `ia_hunter_1`, `ia_wa_1`, `ia_mail_1`, `ia_rdv_1`, `ia_nego_1`, et exprimer les trois cellules par des **profils produit** (argumentaires et critères) plutôt que par de nouveaux agents. Suspendre les superviseurs, hunters et outils hors périmètre.

---

## 4. Moteur de missions

**Ce qui fonctionne (code et tests)** : verrou de réclamation (verrou consultatif PostgreSQL) ; reprise des missions interrompues après 15 minutes ; blocage après trop de tentatives ; sous-missions, dépendances, réunions ; budget par agent, par jour et par mois contrôlé avant chaque appel ; incidents et suspension automatique après 3 incidents consécutifs ; journal d'audit immuable ; interrupteur global (`ai_governance.actif`) et suspension par agent ; RLS forcée sur les tables métier.

**Écarts avec le cahier des charges (§8)**

| Exigence | État |
|---|---|
| Une mission terminée doit avoir un **résultat exploitable** | **Non garanti** : `terminer_mission` accepte un rapport de 3 caractères et une liste de résultats vide. Rien ne vérifie qu'un livrable existe |
| Statuts : en attente, affectée, en cours, en validation, terminée, échouée, suspendue, annulée | Équivalents : `a_faire`, `en_cours`, `attente_validation`, `terminee`, `echouee`, `annulee` ; plus `attente_sous_taches` et `bloquee`. « Affectée » et « suspendue » ne sont pas distinctes |
| Champs : produit concerné, résultat attendu, agent superviseur | `prospect_id`, `priorite`, `echeance`, `resultats`, `cout_usd`, `executions`, `reprises` existent ; **`produit` et `resultat_attendu` manquent** (le donneur d'ordre joue le rôle de superviseur) |
| Coût IA par mission | `cout_usd` existe ; **0 renseigné** (aucun appel réussi) |

---

## 5. Workflow commercial, scoring, validation et preuves

- **Étapes (22)** : couvrent identification → qualification → contact → rendez-vous → démonstration → offre → négociation → contrat → paiement → déploiement → fidélisation, avec **historique de chaque transition** (`ai_stage_history`). Il manque les étapes **« enrichi »** et **« validé pour contact »** du circuit demandé (segmentation → enrichissement → qualification → recommandation → préparation → **validation** → contact).
- **Barème de score** : 25 produit + 20 besoin + 15 finance + 15 décideur + 15 court terme + 10 disponibilité = 100, avec **seuils 80/60/40 identiques** à ceux du cahier des charges. **Les critères diffèrent** (cahier : 25 correspondance + 25 besoin + 15 taille + 15 accessibilité décideur + 10 maturité numérique + 10 fiabilité des informations). **Aucun critère de fiabilité des informations ni de justification obligatoire du score.**
- **Vente** : les étapes `contrat_signe`, `paiement_confirme` et `marche_gagne` sont **réservées à un utilisateur direction** (le rôle service, c'est-à-dire un agent, est refusé : garde-fou en base, testé). **Mais aucune preuve n'est enregistrée** (référence de paiement, document signé) : le cahier des charges exige une « preuve commerciale ou financière enregistrée ».
- **Validation humaine des envois** : trois modes (`interdite`, `validation`, `autonome`). **Le mode actuel est `autonome`** (§1, point 5). Le mode `validation` crée une approbation pour chaque message ; il fonctionne et est testé.
- **Opposition** : désinscription par « STOP » WhatsApp gérée (opt-out, accusé unique, relances stoppées) ; fenêtre de 24 h WhatsApp ; preuve de consentement par canal disponible mais **désactivée**.
- **Campagnes** : **aucun concept de campagne** (ni table, ni budget, ni suspension par campagne). Les contrôles existants sont globaux, par agent et par période.

---

## 6. Tableau de bord du président

Existant : vue `ai_kpis` (17 indicateurs globaux : prospects, qualifiés, prioritaires, messages, taux de réponse, rendez-vous, démonstrations, offres, négociations, marchés gagnés/perdus, CA gagné HT, taux de transformation, cycle de vente, validations) ; vue `ai_pipeline_par_produit` ; budget du jour et du mois ; table `ai_agent_performance` ; et, depuis la PR n° 24, coûts IA par mois et par agent dans l'écran Pilotage.

Manque pour le cahier des charges (§10) :
- **Aucun indicateur par produit** (taux, CA) ; seulement un décompte par étape.
- **« CA gagné » ne lit que les offres des agents** : les ventes réelles du CRM (dont les deux ImmoSuite) en sont absentes.
- **Aucun coût rapporté aux résultats** : coût par prospect qualifié, par rendez-vous, par opportunité, par vente.
- **Prospects « analysés » et « enrichis »** : pas d'indicateur (pas d'étape ni de date de vérification structurée).
- Vue par agent : une table `ai_agent_performance` existe ; son exploitation à l'écran n'a pas été vérifiée.

---

## 7. Corrections prioritaires et décisions

### Décisions à prendre par toi

| # | Décision | Recommandation |
|---|---|---|
| **D1** | Passer `communication_externe` à **`validation`** et activer `consentement_requis` | **Oui, avant toute remise de crédits.** Réversible, aucune donnée touchée |
| **D2** | « AviNest Pro » (CRM) = « AvicoSuite » ? | À confirmer ; conditionne la référence commerciale d'AvicoSuite |
| **D3** | Désactiver les 7 produits hors périmètre dans `ai_products` (`actif = false`) et classer « hors périmètre commercial actuel » les 198 prospects Santé et Logistique (et les Industrie non confirmés comme aluminium) | **Oui** : réversible, empêche toute recommandation et campagne |
| **D4** | Remplacer le barème de score par celui du cahier des charges | Oui (migration, Phase 2/3) ; les 504 scores sont encore à 0, aucune perte |
| **D5** | Chiffre d'affaires de référence : **HT ou TTC** ? | HT dans les rapports, TTC affiché en regard (les 4 M et 5 M annoncés sont TTC) |

### Plan d'intervention (ordre, sans réécriture générale)

**Avant la Phase 2 (sécurité, non destructif)** : D1 ; D3.
**Phase 2 — fiabiliser le moteur** :
1. Ajouter des crédits Anthropic, réactiver **uniquement** les agents du périmètre (`ia_resp_prospection`, `ia_sup_immo`, `ia_market`, `ia_hunter_1`, `ia_enrich_1`, `ia_qualif_1`, `ia_wa_1`, `ia_mail_1`, `ia_rdv_1`, `ia_nego_1`) ; garder les autres suspendus.
2. **Règle « pas de mission terminée sans preuve »** : `terminer_mission` refuse un rapport vide ou sans résultat chiffré ; colonnes `produit` et `resultat_attendu` sur les missions.
3. **Test réel obligatoire** (Phase 2) : une mission réelle sur un petit nombre de prospects ImmoSuite, avec un vrai appel IA, un résultat structuré enregistré et transmis. Coût plafonné (budget par agent déjà en place).
4. Enregistrement des coûts sur chaque mission et rapport coût par résultat.
**Phase 3 — pilote (30 à 50 prospects réels)** : segmentation (ImmoSuite / AluExpert / AvicoSuite / hors périmètre) calculée depuis les données ; enrichissement avec source et date ; qualification avec **justification obligatoire** ; étapes « enrichi » et « validé pour contact » ; campagne comme objet (statut, budget, suspension) ; revue par un responsable commercial. Répartition pressentie : environ 20 ImmoSuite, 20 AluExpert (les 132 plus nets) et le peu d'AvicoSuite disponible ; **la cellule avicole démarre par la recherche de prospects** (Lead Hunter).
**Phases 4 à 7** comme dans le cahier des charges ; **preuve de vente** (référence de paiement ou document) avant le passage `marche_gagne`.

### Ce que le pilote permettra de mesurer
Aujourd'hui, la seule donnée de conversion fiable est historique : **8 clients sur 519 fiches (1,5 %), 9 commandes**. Il ne s'agit pas d'un objectif. Le pilote donnera, **par logiciel**, le nombre de prospects exploitables, qualifiés, contactés, répondants, en rendez-vous, démonstration, offre, vente, et le coût IA de chaque étape.

---

## 8. Ce qui n'a pas été audité (à dire clairement)

- Le **bureau 3D** : volontairement laissé de côté (priorité basse du cahier des charges) ; aucune régression connue.
- Le contenu exact des **argumentaires** de chaque agent (chartes) : à relire en Phase 3 avec un responsable commercial.
- Les **messages WhatsApp/e-mail réels** et la configuration des canaux (aucun secret `WHATSAPP_*`/`RESEND_*` vérifié, ils ne sont pas lisibles depuis ici).
- L'**exactitude des heuristiques de segmentation** (noms d'entreprise) : estimation à confirmer par l'enrichissement.

## 9. Annexe — sources des constats

Requêtes d'agrégats sur `ai_prospects`, `ai_products`, `ai_pricing`, `ai_agents`, `ai_agent_tasks`, `ai_actions`, `ai_incidents`, `ai_governance`, `crm_records` ; lecture de `supabase/functions/_shared/**`, `supabase/migrations/**`, `supabase/seed_agents.sql`, `supabase/seed_crm_missions.sql`, `company/app.js`.
