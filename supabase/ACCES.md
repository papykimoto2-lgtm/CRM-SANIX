# Accès commun CRM ↔ SANIX AI VIRTUAL COMPANY

Une seule configuration Supabase et le même identifiant pour les deux applications (même site `crm-sanix.vercel.app`).

## Ce qui est partagé automatiquement
- **Configuration Supabase** : saisie une fois, dans le CRM (*Paramétrage → Synchronisation cloud*) **ou** sur l'écran de SANIX AI. Les deux la lisent dans le même emplacement du navigateur. L'URL du projet (`https://izgpvhwhbrgeagjfhfli.supabase.co`) est proposée par défaut : seule la clé publique reste à coller.
- **Identifiant** : l'écran de SANIX AI accepte l'identifiant du CRM (`kessie`) ou un e-mail, et propose l'identifiant du CRM. Il le traduit en e-mail du compte opérateur (annuaire publié par le CRM à chaque connexion, sinon `company/config.js`).
- **Le mot de passe n'est jamais pré-rempli ni partagé.**

## La clé : publique uniquement
Supabase → *Project Settings → API Keys* → **Publishable key** (`sb_publishable_…`), ou la clé **anon** (`eyJ…`, deux points).

Refusées et effacées du navigateur : `sb_secret_…`, `service_role`, **« JWT Secret »** (page *JWT Keys*) et toute valeur qui n'est pas une clé publique. Une clé publique n'ouvre aucune donnée : l'accès est protégé par la connexion d'un opérateur et la sécurité par lignes.

## Créer l'accès opérateur (une fois)
1. Supabase → *Authentication → Users → Add user* : e-mail = celui de la fiche du CRM (`cyrille@sanix-africa.ci` pour `kessie`, modifiable dans `company/config.js`), **mot de passe fort et différent de celui du CRM**, cocher *Auto Confirm User*.
2. *SQL Editor* :
   ```sql
   insert into ai_operators(user_id, nom, role, remise_max_pct)
   select id, 'Cyrille KESSIE', 'direction', 10 from auth.users where email = 'cyrille@sanix-africa.ci';
   ```
3. Se connecter à SANIX AI avec `kessie` + ce mot de passe.

> **Compte du CRM** : aucun compte ni mot de passe n'est livré dans le code. Au premier lancement (ou sur un appareil neuf), le CRM demande de créer le compte administrateur : 10 caractères minimum, enregistré en PBKDF2 avec un sel propre au compte, dans le navigateur de l'appareil. Ce compte verrouille l'accès à l'écran sur cet appareil ; la protection des données sur le serveur repose sur Supabase (sécurité par lignes + connexion opérateur). Contrôlez-la avec `supabase/verifier_securite.sql` (lecture seule, SQL Editor). Utilisez un mot de passe différent pour SANIX AI.
>
> **Données** : le CRM ne contient plus aucune donnée client dans son code. Pour retrouver ses données sur un nouvel appareil : synchronisation Supabase (Paramétrage → Synchronisation cloud) ou *Paramétrage → Restaurer une sauvegarde* avec le fichier produit par *Sauvegarde complète* (à garder privé : il contient les clients, commandes et licences).

## Mise en place du schéma
Avant la première connexion, appliquer les migrations (`supabase db push`, ou *SQL Editor* avec le fichier `supabase/setup_all.sql` collé en une fois), puis déployer les fonctions (`ai-company`, `ai-sales-director`, `whatsapp-webhook`). Voir `supabase/README.md`, section *Mise en service*.
