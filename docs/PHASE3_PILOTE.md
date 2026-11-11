# Phase 3 : pilote commercial (préparation sans crédits, exécution avec)

Objectif du cahier des charges : sur **30 à 50 prospects réels** du CRM, tester segmentation, enrichissement, qualification, score, recommandation de logiciel, argumentaire, message personnalisé et validation humaine, puis **mesurer par logiciel** combien de prospects peuvent devenir clients. Ne pas forcer une répartition égale.

## 1. Ce qui est prêt (migration `20261115000000_phase3_pilote.sql`, onglet *Paramétrage → Pilote*)
- **Segmentation** par règles modifiables (`ai_segment_rules`) : chaque prospect est rangé dans un logiciel, « à vérifier » (Industrie sans indice d'activité) ou « hors périmètre ». Aperçu sans écriture, puis application par la direction. Ne touche jamais une fiche déjà travaillée ni un choix manuel. Le logiciel recommandé suit le segment.
- **Sélection du pilote** (`ai_pilote`) : les prospects les plus joignables d'abord (e-mail + téléphone, puis e-mail, puis téléphone), sans désinscrits, dans la limite de ce qui existe. Reproductible, modifiable à la main.
- **Entonnoir par logiciel** (`ai_pilote_entonnoir`) : prospects → pilote → qualifiés → prioritaires → contactés → réponses → rendez-vous → démonstrations → offres → CA du CRM (HT) et coût IA. Données réelles uniquement.

## 2. Ce que les données montrent (aperçu en lecture seule sur les 504 prospects)
| Segment | Prospects | Téléphone + e-mail | Remarque |
|---|---|---|---|
| ImmoSuite | 95 | 82 | base exploitable immédiatement |
| AluExpert | 108 | 6 | quasi uniquement joignables par téléphone : **WhatsApp** est le canal |
| AvicoSuite | 1 | 1 | base vide : le **Lead Hunter** doit d'abord trouver des exploitations |
| À vérifier (Industrie) | 103 | 4 | à confirmer par l'enrichissement avant tout contact |
| Hors périmètre | 197 | 14 | Santé et Logistique : aucune action commerciale |

Pilote proposé : **20 ImmoSuite + 20 AluExpert + ce qui existe en AvicoSuite** (environ 41). Les ventes déjà conclues (ImmoSuite 7 627 119 FCFA HT, AluExpert 847 457, AvicoSuite 338 983) servent de référence, jamais d'objectif.

## 3. Ordre d'exécution
1. Appliquer la migration, puis ouvrir *Paramétrage → Pilote*.
2. **Aperçu** de la répartition, relire les règles avec un responsable commercial (ajuster), puis **Appliquer**.
3. **Sélectionner** le pilote (20 / 20 / 10), relire la liste, retirer ou ajouter à la main.
4. **Décisions préalables** (voir §4), crédits Anthropic, budget de test (déjà plafonné).
5. Instruction au directeur général IA (modèle ci-dessous), **sans envoi** : tout reste « à valider ».
6. Le responsable commercial relit : segment, score justifié, argumentaire, message. Valider, corriger ou refuser chaque message dans *Validations*.
7. Relever l'entonnoir et le coût (`verifier_mission_reelle.sql`, écran Pilote). Rapport du pilote.

### Instruction type (à donner au directeur général IA)
> « Pilote commercial : pour chacun des prospects de la liste « pilote » (ImmoSuite ERP et Sanix AluExpert), vérifie les informations publiques, enregistre les sources et la date, note le prospect sur 100 avec justification, recommande le logiciel, prépare un argumentaire personnalisé et un premier message. Aucun envoi : tout message doit rester en attente de validation. Pour AvicoSuite, recherche d'abord des exploitations avicoles (poulets de chair, pondeuses) et enregistre-les avec leur source. Présente-moi le bilan par logiciel. »

## 4. Décisions qui vous appartiennent
- **D6 · Consentement et premier contact.** `consentement_requis = true` bloque tout premier message tant qu'un prospect n'a pas de preuve de consentement datée par canal (ou, pour WhatsApp, un message entrant récent). Aucun des 504 prospects n'en a. Pour le pilote, soit vous fixez la base juridique du premier contact professionnel et vous enregistrez la preuve, soit le pilote s'arrête à la préparation des messages. **Je ne contourne pas ce garde-fou.**
- **D7 · Canal WhatsApp d'AluExpert.** 108 prospects n'ont que le téléphone. Le premier contact WhatsApp exige un modèle de message approuvé (secret `WHATSAPP_TEMPLATE_FIRST`) : je ne peux pas vérifier ici que les secrets `WHATSAPP_*` sont posés.
- **D8 · Industrie « à vérifier » (103).** Les enrichir (coût IA) pour en faire des AluExpert, ou les laisser de côté : à décider après le pilote.

## 5. Critères de réussite du pilote
Segmentation pertinente (relue), informations vérifiables et sourcées, score toujours justifié, logiciel recommandé adapté, messages personnalisés et validés, aucun envoi non autorisé, coût IA mesuré par logiciel. **Aucun taux de conversion n'est fixé à l'avance** : l'entonnoir du pilote les établit.

## Quatrième logiciel : Angel's Livraison (décision de la direction)
Plus d'opportunité sur la livraison : le périmètre commercial passe à **quatre logiciels** — ImmoSuite ERP, Sanix AluExpert, AvicoSuite (= Angel's Agro) et **Angel's Livraison** (livraison à moto, coursiers, messagerie). Angel's Transport reste hors périmètre.
- Migration `20261117000000_angels_livraison_quatrieme_logiciel.sql` : produit `angels` renommé et activé (14 fonctionnalités du catalogue du CRM, grille tarifaire existante : 600 000 FCFA/an, 60 000 FCFA/mois), noms du CRM rattachés, règle de segmentation « logistique, livraison, coursier, messagerie, expédition » (priorité 85, avant « hors périmètre »), cellule dédiée aux mêmes agents partagés qu'AvicoSuite.
- Données : 30 prospects Logistique segmentés `angels` ; pilote de 20 (4 avec e-mail et téléphone, 16 par téléphone seul) ; la vente « Angel's Livraison » du CRM (508 475 FCFA HT) est comptée dans ce logiciel.
