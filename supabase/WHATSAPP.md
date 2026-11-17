# Envoyer des messages WhatsApp depuis le CRM (API officielle de Meta)

Une fois configuré : dans **Campagnes & Démos → Messagerie → WhatsApp**, le mode **⚡ Envoi direct** envoie les messages sans quitter le CRM. Chaque message est suivi (*envoyé → remis → lu*), les **réponses des prospects** arrivent dans la fiche et dans la cloche 🔔, et vous pouvez leur répondre depuis la fiche pendant 24 h.

## Ce qu'il faut savoir avant de commencer
| | |
|---|---|
| **Un premier message passe par un modèle** | Meta impose un texte **pré-approuvé** pour écrire à quelqu'un qui ne vous a pas écrit depuis 24 h. Le CRM envoie ce modèle en remplissant 3 variables (destinataire, logiciel, signataire). Le texte libre n'est possible que **dans les 24 h qui suivent une réponse** du prospect. |
| **C'est payant, au message délivré** | Meta facture chaque message délivré selon sa catégorie (un premier contact est « marketing ») et le pays du destinataire. La Côte d'Ivoire fait partie de la zone tarifaire « Rest of Africa ». Grille officielle : <https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing> |
| **Il faut l'accord du destinataire** | Meta n'autorise à écrire qu'aux personnes qui ont accepté d'être contactées sur WhatsApp (échange téléphonique, rendez-vous, demande de leur part…). Le CRM vous fait **confirmer cet accord à chaque envoi** et l'enregistre. Écrire à des inconnus fait signaler et bloquer le numéro. <https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in> |
| **« STOP » est respecté** | Une réponse « STOP » (ou « arrêtez », « désinscrire »…) désinscrit le numéro : le CRM refuse ensuite tout envoi, côté serveur. |
| **Un numéro dédié** | Le numéro relié à l'API ne peut plus servir dans l'application WhatsApp du téléphone. Prenez un numéro (SIM) réservé à cet usage. Les réponses se lisent dans le CRM. |
| **Limites** | Plafond de 150 messages par 24 h dans le CRM (le palier de départ de Meta est de 250 destinataires par jour) ; un même modèle n'est jamais renvoyé au même numéro dans les 24 h. |
| **Conservation** | Le CRM conserve le texte des messages envoyés **et des réponses reçues** (lisibles par les seuls opérateurs connectés). Le jeton Meta reste sur le serveur et n'apparaît jamais dans le navigateur. |

## À faire une seule fois (≈ 1 h de saisie ; l'approbation des modèles par Meta prend de quelques minutes à 1 jour)

Les écrans de Meta changent souvent : suivez les noms des rubriques, pas leur emplacement exact. Documentation officielle : <https://developers.facebook.com/documentation/business-messaging/whatsapp/>

### 1. Compte et application Meta
1. Un compte **Meta Business** (<https://business.facebook.com>) au nom de SANIX.
2. <https://developers.facebook.com> → **Mes applications → Créer une application** → type **Entreprise (Business)** → ajoutez le produit **WhatsApp**.
3. Dans **WhatsApp → Configuration de l'API**, **ajoutez votre numéro dédié** (code de vérification par SMS ou appel). Notez l'**identifiant du numéro de téléphone** (*Phone number ID*).

### 2. Jeton permanent
**Paramètres de l'entreprise → Utilisateurs → Utilisateurs système** → créez un utilisateur système (rôle Admin) → **attribuez-lui l'application et le compte WhatsApp** → **Générer un jeton** (durée : permanent) avec les autorisations `whatsapp_business_messaging` et `whatsapp_business_management`. Copiez-le.

### 3. Les donner au serveur (jamais dans le CRM, ni dans GitHub, ni dans une conversation)
Supabase → **Edge Functions → Secrets → Add new secret** :

| Nom | Valeur |
|---|---|
| `WHATSAPP_TOKEN` | le jeton permanent de l'étape 2 |
| `WHATSAPP_PHONE_NUMBER_ID` | l'identifiant du numéro (étape 1) |
| `WHATSAPP_VERIFY_TOKEN` | une phrase secrète de votre choix (≥ 20 caractères aléatoires) |
| `WHATSAPP_APP_SECRET` | application Meta → **Paramètres → Général → Clé secrète de l'application** |

Ce sont les mêmes secrets que ceux des agents IA : si vous les avez déjà posés, rien à refaire.

### 4. Brancher la réception (réponses, « remis », « lu »)
Application Meta → **WhatsApp → Configuration → Webhook** :
- **URL de rappel** : `https://izgpvhwhbrgeagjfhfli.supabase.co/functions/v1/whatsapp-webhook`
- **Jeton de vérification** : la valeur de `WHATSAPP_VERIFY_TOKEN`
- **Vérifier et enregistrer**, puis **abonnez-vous au champ `messages`**.

### 5. Faire approuver les trois modèles
**WhatsApp Manager → Modèles de messages → Créer un modèle** : catégorie **Marketing**, langue **Français**, nom **exactement** celui indiqué, texte **exactement** celui indiqué. Meta demande un **exemple** pour chaque variable : utilisez ceux du tableau.

| Nom du modèle | {{1}} (exemple) | {{2}} (exemple) | {{3}} (exemple) |
|---|---|---|---|
| `sanix_crm_premier_contact` | Clinique Alpha | MediCore Suite | Cyrille Kesie |
| `sanix_crm_relance` | Clinique Alpha | MediCore Suite | Cyrille Kesie |
| `sanix_crm_demo` | Clinique Alpha | MediCore Suite | Cyrille Kesie |

**`sanix_crm_premier_contact`**
```
Bonjour {{1}}, je suis {{3}} de SANIX Africa à Abidjan. Nous éditons {{2}}, un logiciel de gestion pensé pour les entreprises ivoiriennes (conforme SYSCOHADA, utilisable hors connexion). Puis-je vous proposer une démonstration gratuite de 20 minutes ? Répondez OUI et je vous appelle, ou STOP pour ne plus recevoir nos messages.
```
**`sanix_crm_relance`**
```
Bonjour {{1}}, je reviens vers vous au sujet de {{2}}. Avez-vous pu y réfléchir ? Je reste disponible pour répondre à vos questions ou organiser une démonstration. {{3}}, SANIX Africa. Répondez STOP pour ne plus recevoir nos messages.
```
**`sanix_crm_demo`**
```
Bonjour {{1}}, nous vous invitons à une démonstration gratuite de {{2}}, adaptée à votre activité : 30 minutes, en visio ou dans vos locaux. Répondez à ce message pour choisir un créneau. {{3}}, SANIX Africa. Répondez STOP pour ne plus recevoir nos messages.
```
Si Meta refuse ou reclasse un modèle, vous pouvez le modifier dans le CRM (**Paramétrage → WhatsApp → Modèles**) : le texte, le nom et la langue doivent rester **identiques à ceux approuvés chez Meta**.

### 6. Activer dans le CRM
**Paramétrage → 💬 WhatsApp — API officielle** : le CRM indique si le serveur est prêt et si la réception est branchée. Quand Meta a approuvé un modèle, cochez **Approuvé par Meta** : il apparaît dans la Messagerie. **Laissez vides** les champs « API WhatsApp » (jeton, identifiant) de la section des séquences : ils enverraient depuis le navigateur ; la clé doit rester sur le serveur.

### 7. Premier essai
Messagerie → WhatsApp → ⚡ Envoi direct → un seul destinataire : **votre propre numéro**. Vérifiez la réception, répondez-vous depuis votre téléphone, puis contrôlez la fiche (réponse) et la cloche 🔔. Ne lancez un envoi groupé qu'ensuite.

## Si quelque chose ne marche pas
| Message dans le CRM | Cause |
|---|---|
| « Serveur non configuré — secret(s) manquant(s) » | un secret de l'étape 3 est absent |
| « (#132001) Template name does not exist » | le nom ou la langue du modèle ne correspond pas à celui approuvé chez Meta |
| « (#132000) Number of parameters does not match » | le texte du modèle dans le CRM ne correspond pas au texte approuvé |
| « Invalid OAuth access token » | jeton expiré ou mal copié : en générer un nouveau (étape 2) |
| « Le destinataire n'est pas sur WhatsApp » (dans la fiche) | numéro sans WhatsApp : appelez-le |
| Pas de « remis / lu » ni de réponses | webhook non branché (étape 4) ou `WHATSAPP_APP_SECRET` erroné |
