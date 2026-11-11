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

## 4. Décisions D6, D7, D8 (tranchées)
- **D6 · Consentement et premier contact : aucun envoi sans preuve.** `consentement_requis` reste à `true` ; aucun des prospects n'a de preuve de consentement. **Précision après vérification du code :** avec ce réglage, l'outil d'envoi refuse même de *préparer* un message pour un prospect sans preuve (`deliverMessage`, avant la file de validation). Aucun brouillon n'existe donc tant qu'une preuve datée n'est pas enregistrée pour le prospect et le canal (ou qu'il n'a pas écrit dans les dernières 24 h sur WhatsApp). La première phase mesure la qualité de la segmentation, des scores et des coûts, pas encore des messages.
  *Reste à la direction :* fixer la base juridique du premier contact professionnel (intérêt légitime B2B selon la réglementation de chaque pays) et décider comment les preuves sont enregistrées : soit prospect par prospect (champ `ai_prospects.consentement`, qui n'a pas encore d'écran), soit en assouplissant le réglage pour les brouillons, sachant que l'envoi reste soumis à validation humaine. Le garde-fou n'est jamais contourné par l'assistant.
- **D7 · WhatsApp : mode manuel, sans clé d'API.** L'envoi automatique exige l'API WhatsApp Cloud (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) et, pour un premier contact, un gabarit approuvé par Meta (`WHATSAPP_TEMPLATE_FIRST`) ; rien de cela n'a été vérifié ni supposé. Pour le pilote, **le mode manuel** (migration `20261120`) évite la clé : sans token, un message approuvé reste « à envoyer » ; l'opérateur ouvre WhatsApp avec le message prérempli (lien `wa.me`), l'envoie depuis son propre numéro, puis le confirme dans le bureau (onglet Validations → « WhatsApp à envoyer »). Il peut aussi abandonner un envoi et saisir la réponse reçue (fenêtre de 24 h, « STOP » = désinscription). Limites : pas de suivi de livraison ni de relance automatique ; les réponses arrivent sur le téléphone de l'opérateur.
  *Reste à la direction :* rien pour le pilote. L'API ne sera utile qu'à plus grande échelle.
- **D8 · Les 103 « Industrie à vérifier » : laissés de côté jusqu'à la fin du pilote.** Ni pilote, ni message, ni mission, ni enrichissement maintenant : les 61 prospects du pilote suffisent à mesurer, et l'enrichissement de 103 fiches consommerait le budget IA (3 $/jour, 30 $/mois) sans rien prouver de plus. Ré-évaluation avec les chiffres réels : coût par fiche enrichie et taux d'AluExpert confirmés sur un échantillon.

## 5. Critères de réussite du pilote
Segmentation pertinente (relue), informations vérifiables et sourcées, score toujours justifié, logiciel recommandé adapté, messages personnalisés et validés, aucun envoi non autorisé, coût IA mesuré par logiciel. **Aucun taux de conversion n'est fixé à l'avance** : l'entonnoir du pilote les établit.

## Quatrième logiciel : Angel's Livraison (décision de la direction)
Plus d'opportunité sur la livraison : le périmètre commercial passe à **quatre logiciels** — ImmoSuite ERP, Sanix AluExpert, AvicoSuite (= Angel's Agro) et **Angel's Livraison** (livraison à moto, coursiers, messagerie). Angel's Transport reste hors périmètre.
- Migration `20261117000000_angels_livraison_quatrieme_logiciel.sql` : produit `angels` renommé et activé (14 fonctionnalités du catalogue du CRM, grille tarifaire existante : 600 000 FCFA/an, 60 000 FCFA/mois), noms du CRM rattachés, règle de segmentation « logistique, livraison, coursier, messagerie, expédition » (priorité 85, avant « hors périmètre »), cellule dédiée aux mêmes agents partagés qu'AvicoSuite.
- Données : 30 prospects Logistique segmentés `angels` ; pilote de 20 (4 avec e-mail et téléphone, 16 par téléphone seul) ; la vente « Angel's Livraison » du CRM (508 475 FCFA HT) est comptée dans ce logiciel.

## Mode manuel WhatsApp (sans clé d'API)
| Étape | Qui | Où |
|---|---|---|
| Rédaction du message | agent IA | file de validation (statut `a_valider`) |
| Approbation | direction | Validations (statut `a_envoyer`) |
| Envoi | **opérateur, à la main** | Validations → « WhatsApp à envoyer » → « Ouvrir dans WhatsApp », puis « J'ai envoyé » (`ai_wa_marquer_envoye`) |
| Abandon | opérateur | « Ne pas envoyer » (`ai_wa_annuler`) |
| Réponse du prospect | opérateur | « Saisir la réponse reçue » (`ai_wa_reponse`) |
Garde-fous : un prospect désinscrit ne peut pas être marqué contacté ; un message n'est jamais marqué envoyé sans la confirmation d'un opérateur (auteur et date conservés, opération journalisée) ; le traitement automatique ne touche pas aux messages WhatsApp en attente tant que la clé n'est pas posée.

## Crédit de l'API Anthropic et comptabilité de l'IA (migration 20261123)

**Pourquoi un solde « estimé ».** Anthropic ne communique pas à une clé d'API le solde du crédit prépayé de la Console. L'appli le tient donc elle-même : *dernier solde constaté + recharges suivantes − consommation enregistrée par les agents* (`ai_actions.cout_usd`). C'est une estimation : recalez-la avec la Console de temps en temps (Gouvernance → « Crédit de l'API Anthropic » → « Solde lu dans la Console »). Rien n'est inventé : tant qu'aucun montant n'est saisi, l'écran affiche « Non renseigné ».

**Où le voir.** Bureau SANIX AI → ⚖️ Gouvernance : solde estimé, rythme des 7 derniers jours, jours restants, dernière recharge, alerte sous 2 $ ou sous 3 jours ; pastille « Crédit … $ » dans l'en-tête dès qu'un solde est saisi. La saisie (solde constaté ou recharge) est réservée à la direction et journalisée (`ai_actions`).

**Comptabilité (CRM → Comptabilité).** Les dépenses de l'API sont comptabilisées automatiquement, au taux USD/FCFA saisi dans « Budget & plan d'actions » (sans taux : aucune écriture et un message le rappelle) :
- consommation du mois : journal AC, débit **634000** (redevances pour logiciels et licences), crédit **401000** (fournisseur Anthropic), datée du dernier jour du mois (aujourd'hui pour le mois en cours) ;
- recharge : journal BQ, débit **401000**, crédit **521000** (banque). Le solde débiteur du 401000 représente le crédit non encore consommé.
Les écritures sont régénérées à chaque affichage depuis le serveur : aucune donnée en double entre appareils. **À confirmer avec le comptable** : choix des comptes et traitement de la TVA sur un service acheté à l'étranger.

Tests : `supabase/functions/tests/credit_api_sql_test.sh` (PostgreSQL réel), `company/tests/credit_test.js` (écran), `tests/compta_ia_test.js` (écritures).
