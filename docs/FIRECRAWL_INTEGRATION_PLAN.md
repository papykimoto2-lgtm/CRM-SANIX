# Architecture d'intégration Firecrawl — SANIX CRM

**Statut :** proposition technique, non implémentée  
**Périmètre :** prospection Lead Hunter dans Supabase Edge Functions  
**Décision recommandée :** intégration complémentaire et progressive ; ne pas remplacer immédiatement les outils web Anthropic.

## 1. Décision

Conserver les outils Anthropic déjà prévus dans la PR #178 et ajouter Firecrawl comme moteur d'extraction de pages web, côté serveur.

- **Anthropic `web_search`** reste le moteur de découverte des entreprises et de formulation des requêtes.
- **Firecrawl `/scrape`** devient le lecteur de page privilégié lorsque `FIRECRAWL_API_KEY` est configurée.
- **Anthropic** reste responsable de l'interprétation, de la qualification, de la décision de créer une fiche et du résumé de mission.
- **Anthropic `web_fetch`** reste le mécanisme de repli si Firecrawl est indisponible, renvoie une page vide ou si la clé Firecrawl n'est pas configurée.
- **Supabase/Postgres** reste la source de vérité pour les doublons, les fiches prospects, les statuts de mission et les journaux d'audit.

Ne pas activer Firecrawl Search dans le premier pilote : il ferait doublon avec Anthropic Web Search. Le comparer lors d'un benchmark ultérieur, sur les mêmes secteurs, villes et critères de qualité.

## 2. Flux cible

1. L'opérateur crée une mission (secteur, ville, produit, objectif).
2. Lead Hunter utilise Anthropic Web Search pour découvrir des entreprises candidates.
3. L'agent vérifie que l'URL candidate est une page d'entreprise publique et admissible.
4. L'agent appelle le scraper Firecrawl côté Edge Function. La clé API n'est jamais exposée au navigateur ni au modèle.
5. Le contenu Markdown est limité en taille et renvoyé à Anthropic comme résultat d'outil non fiable.
6. Anthropic vérifie les faits requis : existence, activité, ville et au moins une coordonnée professionnelle publiée.
7. L'agent appelle `create_prospect` uniquement si la preuve est suffisante ; la base reste l'autorité finale contre les doublons.
8. Le CRM conserve l'URL réellement lue, la date de collecte, le moteur utilisé et les informations de provenance disponibles.
9. Le rapport distingue les candidats découverts, pages lues, entreprises vérifiées, fiches créées, doublons et échecs.

## 3. Appel Firecrawl conseillé pour le pilote

Utiliser l'API REST v2 directement avec `fetch` depuis une Edge Function ; aucun SDK supplémentaire n'est nécessaire pour le premier incrément.

- Endpoint : `POST https://api.firecrawl.dev/v2/scrape`
- Authentification : `Authorization: Bearer <FIRECRAWL_API_KEY>`
- Corps minimal : URL candidate, `formats: ["markdown"]`, `onlyMainContent: true`
- Ne pas demander HTML brut, captures d'écran, extraction JSON par LLM ou crawl complet pendant le pilote.
- Plafond initial proposé : 8 pages par mission, cohérent avec le plafond de lecture prévu dans la PR #178.
- Limiter la taille du Markdown transmis au modèle (objectif : 6 000 tokens maximum par page, à calibrer après test).

Le scraper doit traiter explicitement les réponses non-200, les timeouts, les erreurs 402 (crédits/facturation), 429 (limite de débit) et 5xx. Une erreur Firecrawl ne doit pas faire échouer silencieusement une mission : tenter le repli Anthropic Web Fetch, puis déclarer une erreur exploitable si les deux moteurs échouent.

## 4. Sécurité et qualité des données

- Stocker `FIRECRAWL_API_KEY` dans les secrets Supabase Edge Functions ; jamais dans le front-end, le dépôt Git, les prompts ou les journaux.
- N'accepter que des URL HTTP/HTTPS publiques ; rejeter localhost, IP privées, adresses link-local, schémas non web, identifiants intégrés à l'URL et ports inhabituels.
- Restreindre autant que possible les domaines aux sites officiels, annuaires professionnels connus et sources publiques pertinentes.
- Ne jamais considérer le contenu d'une page comme une instruction : l'encapsuler comme donnée non fiable et ignorer toute instruction qu'il contiendrait.
- Ne pas inventer les e-mails, téléphones, dirigeants, adresses ou besoins. Une donnée absente reste absente.
- Ne collecter que les coordonnées publiées dans un contexte professionnel ; respecter les mentions d'opposition et les règles applicables.
- Conserver la page source et la date de vérification. Une page d'accueil ne prouve pas automatiquement toutes les informations de la fiche.
- Garder le contrôle de doublons en base (e-mail normalisé, téléphone normalisé, domaine/site web et rapprochement prudent du nom + ville). Ne pas remplacer la contrainte unique PostgreSQL par un contrôle applicatif seul.

## 5. Comptabilité des coûts

Les coûts Firecrawl ne sont pas inclus dans le calcul de coût Anthropic actuel de `llm.ts`. Il faut les journaliser séparément et les faire apparaître dans le coût total d'une mission.

Tarifs/consommation documentés consultés :
- Scrape : 1 crédit par page.
- Search : 2 crédits par tranche de 10 résultats.
- Offre gratuite affichée : 1 000 crédits/mois.
- Offre Hobby affichée : 5 000 crédits/mois à 16 USD/mois avec facturation annuelle (à revérifier au moment de souscrire).

Hypothèses de simulation : une page Firecrawl scrappée par prospect, et si Firecrawl Search était utilisé, 10 résultats de recherche par tranche de 10 prospects. Les calculs sont des crédits estimés, pas une garantie de coût total.

| Prospects | Scrape seul (1 page chacun) | Avec Search Firecrawl (2 crédits/10 résultats) |
|---:|---:|---:|
| 100 | 100 crédits | 120 crédits |
| 500 | 500 crédits | 600 crédits |
| 1 000 | 1 000 crédits | 1 200 crédits |

**Conséquence :** pour le pilote, conserver Anthropic Web Search et ne facturer que les pages Firecrawl effectivement scrapées. Le quota gratuit peut théoriquement couvrir 1 000 pages simples par mois, mais sans marge pour les reprises, les pages supplémentaires ou les options payantes. Prévoir un plafond dur et un arrêt propre à épuisement du quota.

## 6. Architecture technique proposée

Créer un module partagé, par exemple `supabase/functions/_shared/firecrawl.ts`, contenant :
- la lecture de `FIRECRAWL_API_KEY` ;
- la validation stricte de l'URL ;
- l'appel REST avec timeout ;
- la gestion des statuts et erreurs ;
- l'extraction du Markdown et de l'URL canonique ;
- la limitation de taille ;
- une estimation de crédits et un journal d'audit sans secret ni contenu sensible.

Dans `agent.ts`, exposer un outil client contrôlé au Lead Hunter seulement, par exemple `firecrawl_scrape`. Intercepter cet outil dans la boucle d'exécution et appeler le module partagé, au lieu de le transmettre à `runCrmTool`. Maintenir `web_fetch` comme repli. Ne pas accorder automatiquement ce nouvel outil aux collaborateurs de l'entreprise virtuelle : passer d'abord par le catalogue, les permissions, le budget et les tests.

Pour les explorations multi-pages, ne pas bloquer une Edge Function sur un crawl long. Prévoir ultérieurement un job asynchrone (start crawl → stockage de l'identifiant → polling/webhook → traitement des résultats) avec plafond de pages, échéance et reprise idempotente.

## 7. Plan de livraison

### Phase 0 — prérequis
- Obtenir une clé Firecrawl et l'ajouter comme secret Supabase.
- Vérifier les crédits disponibles et la politique de rétention du compte.
- Confirmer le comportement API sur 5 à 10 sites professionnels ivoiriens.

### Phase 1 — pilote contrôlé
- Firecrawl Scrape uniquement dans Lead Hunter.
- Anthropic Web Search conservé pour la découverte.
- Anthropic Web Fetch conservé comme repli.
- Plafond : 8 pages par mission ; objectif pilote : 10 entreprises.
- Aucun envoi automatique de message.
- Vérification humaine des fiches avant toute campagne.

### Phase 2 — benchmark
Comparer sur les mêmes requêtes : taux de pages accessibles, coordonnées publiées, exactitude, doublons, coût par prospect vérifié et durée. Tester Firecrawl Search uniquement si la découverte Anthropic laisse des lacunes mesurables.

### Phase 3 — extension
Après validation, proposer l'outil aux agents de recherche autorisés, avec permission explicite, quotas par agent, budget consolidé et supervision.

## 8. Critères d'acceptation

- Aucune clé API dans le navigateur, les réponses au modèle ou les logs.
- Chaque prospect créé a une URL source effectivement lue.
- Une page vide, inaccessible ou non pertinente ne crée aucune fiche.
- Les doublons restent bloqués par les contraintes de la base.
- Les erreurs Firecrawl sont visibles et le repli Anthropic fonctionne.
- Le nombre de pages et crédits estimés est auditable par mission.
- Une mission sans nouveau prospect ne peut pas être déclarée réussie uniquement parce que le modèle a produit un texte.
- Tests Deno, tests de validation URL, tests de gestion d'erreurs, tests anti-doublons et génération des bundles exécutés avant déploiement.

## 9. Sources officielles

- Firecrawl API v2 : https://docs.firecrawl.dev/
- Firecrawl Scrape : https://docs.firecrawl.dev/api-reference/endpoint/scrape
- Firecrawl Search : https://docs.firecrawl.dev/api-reference/endpoint/search
- Firecrawl billing : https://docs.firecrawl.dev/rate-limits
- Firecrawl pricing : https://www.firecrawl.dev/pricing
- Supabase Edge Function limits : https://supabase.com/docs/guides/functions/limits
- Supabase Edge Function secrets : https://supabase.com/docs/guides/functions/secrets

---
**Note de livraison :** ce document ne déploie rien et ne modifie pas la PR #178. L'implémentation doit faire l'objet d'une PR distincte et être testée avant toute fusion ou mise en production.
