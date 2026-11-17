# Envoyer les e-mails depuis le CRM avec votre Gmail (et suivre les réponses)

Une fois configuré : dans les **Exemples de courrier**, le bouton **📤 Envoyer depuis Gmail** envoie l'e-mail sans quitter le CRM. Chaque e-mail est suivi : *envoyé → répondu*, ou *sans réponse depuis N jours : relance conseillée* (page **À faire aujourd'hui** et fiche du prospect).

## Ce que le CRM peut et ne peut pas faire
| | |
|---|---|
| ✅ Envoie un e-mail **quand vous cliquez** sur « Envoyer maintenant » (après relecture) | ❌ Aucun envoi automatique, aucun envoi en masse |
| ✅ Lit les **réponses** (expéditeur, date, **texte**) des seules conversations qu'il a lui-même ouvertes, pour savoir si le prospect a répondu et vous montrer sa réponse | ❌ Ne lit **ni ne modifie** le reste de votre boîte : le CRM n'ouvre que les conversations dont il a gardé l'identifiant à l'envoi. ⚠️ Google ne propose pas de droit « uniquement ces conversations » : l'autorisation `gmail.readonly` donne techniquement accès à la lecture de la boîte, c'est le CRM qui s'impose cette limite |
| ✅ Plafond de 100 e-mails par 24 h ; refuse le même e-mail envoyé deux fois à la suite | |
| ✅ Retire l'accès à tout moment : bouton **Déconnecter**, ou <https://myaccount.google.com/permissions> | |

Le jeton Google est **chiffré** (AES-256) dans la base et ne sort jamais du serveur.

## À faire une seule fois (≈ 10 minutes, depuis un ordinateur de préférence)

### 1. Créer l'application Google
1. <https://console.cloud.google.com> → connectez-vous avec le Gmail à connecter → **Créer un projet** (nom : `SANIX CRM`).
2. **API et services → Bibliothèque** → cherchez **Gmail API** → **Activer**.
3. **Écran de consentement OAuth** (ou « Google Auth Platform ») → type d'utilisateur **Externe** → nom de l'application `SANIX CRM`, e-mail d'assistance = votre Gmail.
4. **Champs d'application (Scopes)** → ajoutez exactement ces deux-là :
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.readonly`
   *(Si vous aviez connecté Gmail avec l'ancien droit `gmail.metadata`, remplacez-le par `gmail.readonly` dans cette liste, puis cliquez sur **Reconnecter Gmail** dans les réglages du CRM : l'envoi continue de fonctionner entre-temps, seule la lecture du texte des réponses attend la reconnexion.)*
5. **Utilisateurs de test** → ajoutez votre adresse Gmail.
6. ⚠️ **Publier l'application** (état « En production »). *Sans cela, Google fait expirer l'accès au bout de 7 jours.* Vous serez seul utilisateur : aucune vérification Google n'est nécessaire, mais l'écran de connexion affichera « Google n'a pas validé cette application » → **Paramètres avancés → Accéder à SANIX CRM (non sécurisé)**. C'est normal pour une application personnelle.

### 2. Créer les identifiants
**Identifiants → Créer des identifiants → ID client OAuth** → type **Application Web** → **URI de redirection autorisés** :

```
https://izgpvhwhbrgeagjfhfli.supabase.co/functions/v1/crm-gmail
```

Copiez l'**ID client** et le **code secret du client**.

### 3. Les donner au serveur (jamais dans le CRM ni dans GitHub)
Supabase → **Edge Functions → Secrets → Add new secret** :

| Nom | Valeur |
|---|---|
| `GOOGLE_CLIENT_ID` | l'ID client |
| `GOOGLE_CLIENT_SECRET` | le code secret du client |

*(Facultatif : `APP_URL` si le CRM n'est pas à `https://crm-sanix.vercel.app`. `GMAIL_TOKEN_KEY` n'est pas nécessaire : la clé de chiffrement est dérivée d'un secret du serveur. Si ce secret serveur change un jour, reconnectez simplement Gmail.)*

### 4. Connecter
Dans le CRM : **Réglages → Envoi d'e-mails par Gmail → 🔗 Connecter Gmail** → choisissez votre compte → acceptez **les deux** autorisations → vous revenez dans le CRM avec « ✅ Gmail connecté ».

## Déploiement technique (déjà fait par Claude)
- Migration `20261127000000_gmail_envoi_suivi.sql` (tables `crm_mail_account`, `crm_mails`).
- Fonction Edge `crm-gmail` — **Verify JWT désactivé** (Google renvoie le navigateur sans JWT ; l'authenticité est garantie par un paramètre `state` signé, 10 min de validité). Fichier : `supabase/deploy/crm-gmail/index.ts`.
- Planificateur `crm-gmail-sync` (toutes les 15 minutes) : `supabase/schedule_cron.sql`.

## Dépannage
| Message | Cause | Solution |
|---|---|---|
| « secret GOOGLE_CLIENT_ID absent » | étape 3 non faite | ajouter les deux secrets |
| « redirect_uri_mismatch » sur la page Google | l'URI de l'étape 2 ne correspond pas | la recopier à l'identique, sans espace |
| « Il faut accepter les deux autorisations » | une case décochée sur Google | recommencer en laissant tout coché |
| « Google n'a pas remis de jeton durable » | l'accès avait déjà été accordé | retirer l'accès sur <https://myaccount.google.com/permissions> puis recommencer |
| « Accès Gmail retiré ou expiré » | accès retiré, ou application restée en « Test » (7 jours) | publier l'application (étape 1.6), puis reconnecter |
| « Non distribué » sur un e-mail | adresse inexistante ou boîte pleine (retour de Gmail) | corriger l'adresse dans la fiche |


## E-mails envoyés par les agents IA
Quand Resend n'est pas configuré, les e-mails des agents partent par **le même Gmail connecté** :
- Ils respectent la gouvernance : en mode « validation » (réglage actuel), chaque message attend l'accord du président dans **Validations** ; le consentement du prospect reste exigé.
- Plafond : **30 e-mails d'agents par 24 h** (en plus des 100 du compte). Au-delà, le message reste en file et part le lendemain.
- Chaque envoi est inscrit dans le journal des e-mails du CRM (expéditeur « Agent IA ») : il apparaît dans **Relances**, dans la fiche client, et la réponse est lue comme les autres.
- Une réponse arrête les relances de l'agent (compteur remis à zéro) ; une réponse qui **commence par « STOP »** (ou « désinscription », « ne plus recevoir », « arrêtez ») désinscrit le prospect : plus aucun message automatique.
- Une adresse déjà revenue « non distribuée » n'est jamais renvoyée ; Gmail non connecté : le message reste en file avec la consigne de connecter Gmail.
