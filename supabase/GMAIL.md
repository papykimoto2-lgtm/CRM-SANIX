# Envoyer les e-mails depuis le CRM avec votre Gmail (et suivre les réponses)

Une fois configuré : dans les **Exemples de courrier**, le bouton **📤 Envoyer depuis Gmail** envoie l'e-mail sans quitter le CRM. Chaque e-mail est suivi : *envoyé → répondu*, ou *sans réponse depuis N jours : relance conseillée* (page **À faire aujourd'hui** et fiche du prospect).

## Ce que le CRM peut et ne peut pas faire
| | |
|---|---|
| ✅ Envoie un e-mail **quand vous cliquez** sur « Envoyer maintenant » (après relecture) | ❌ Aucun envoi automatique, aucun envoi en masse |
| ✅ Lit les **en-têtes** (expéditeur, date) des fils qu'il a lui-même ouverts, pour savoir si le prospect a répondu | ❌ Ne lit **jamais le contenu** de vos e-mails ni le reste de votre boîte (Google ne lui en donne pas le droit) |
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
   - `https://www.googleapis.com/auth/gmail.metadata`
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
