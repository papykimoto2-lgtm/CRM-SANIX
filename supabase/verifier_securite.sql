-- SANIX CRM / SANIX AI — contrôle de sécurité des données. LECTURE SEULE : rien n'est modifié, aucune donnée n'est affichée (comptages et noms de tables seulement).
-- Supabase → SQL Editor → coller tout le fichier → Run. Une ligne par contrôle : OK, À CORRIGER (avec l'action) ou INFO.
--
-- Question posée : « quelqu'un qui a la clé publique du CRM (visible dans le navigateur) peut-il lire ou écrire mes données ? »
-- La réponse attendue est NON pour toutes les tables du schéma public. Seule une session d'opérateur connecté (Authentication) passe par les fonctions du connecteur.
-- À relancer après chaque changement de migration, et après avoir exécuté supabase/lockdown_crm_legacy.sql si une ligne le demande.

create or replace function pg_temp.verif_securite()
returns table(ord int, controle text, statut text, detail text, action text)
language plpgsql as $f$
declare
  n int; liste text; t record;
begin
  -- 1. Tables sans sécurité par lignes (RLS) : lisibles par la clé publique tant qu'un droit est accordé au rôle anon.
  select count(*), string_agg(c.relname, ', ' order by c.relname) into n, liste
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  ord := 10; controle := 'Toutes les tables ont la sécurité par lignes (RLS)';
  if n = 0 then statut := 'OK'; detail := 'aucune table sans RLS'; action := null;
  else statut := 'À CORRIGER'; detail := n || ' table(s) sans RLS : ' || coalesce(liste, '');
       action := 'alter table public.<table> enable row level security; puis créer une politique réservée aux opérateurs. Pour les anciennes tables crm_* : exécuter supabase/lockdown_crm_legacy.sql.'; end if;
  return next;

  -- 2. Droits directs du rôle anon (clé publique) sur les tables du schéma public.
  select count(*), string_agg(distinct g.table_name, ', ' order by g.table_name) into n, liste
    from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.grantee = 'anon' and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  ord := 20; controle := 'Le rôle anon (clé publique) n''a aucun droit sur les tables';
  if n = 0 then statut := 'OK'; detail := 'aucun droit direct'; action := null;
  else statut := 'À CORRIGER'; detail := 'droits accordés à anon sur : ' || coalesce(liste, '');
       action := 'revoke all on public.<table> from anon;  (anciennes tables crm_* : supabase/lockdown_crm_legacy.sql)'; end if;
  return next;

  -- 3. Politiques RLS ouvertes à tous (using true / with check true) accordées à anon ou public.
  select count(*), string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename) into n, liste
    from pg_policies p
   where p.schemaname = 'public' and (p.roles && array['anon', 'public']::name[])
     and (coalesce(p.qual, 'true') in ('true', '(true)') or coalesce(p.with_check, '') in ('true', '(true)'));
  ord := 30; controle := 'Aucune politique RLS ouverte à tous (anon_all, using true)';
  if n = 0 then statut := 'OK'; detail := 'aucune politique ouverte'; action := null;
  else statut := 'À CORRIGER'; detail := n || ' politique(s) : ' || coalesce(liste, '');
       action := 'drop policy <nom> on public.<table>;  (anciennes tables crm_* : supabase/lockdown_crm_legacy.sql les supprime)'; end if;
  return next;

  -- 4. Fonctions SECURITY DEFINER exécutables par anon : elles contournent la RLS.
  select count(*), string_agg(distinct p.proname, ', ' order by p.proname) into n, liste
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute');   -- les fonctions de déclencheur ne sont pas appelables à distance
  ord := 40; controle := 'Aucune fonction SECURITY DEFINER appelable avec la clé publique';
  if n = 0 then statut := 'OK'; detail := 'aucune fonction exposée'; action := null;
  else statut := 'À CORRIGER'; detail := n || ' fonction(s) : ' || coalesce(liste, '');
       action := 'revoke execute on function public.<fonction>(...) from anon, public;  puis grant execute ... to authenticated.'; end if;
  return next;

  -- 5. Anciennes tables de synchronisation du CRM (crm_deals, crm_clients, crm_users_data…) : si elles existent, elles doivent être verrouillées.
  select count(*), string_agg(c.relname, ', ' order by c.relname) into n, liste
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r'
     and c.relname in ('crm_deals','crm_clients','crm_deployments','crm_users_data','crm_logiciels','crm_presentations','crm_commandes','crm_contrats','crm_licences','crm_apporteurs','crm_documents','crm_ecritures','crm_config');
  ord := 50; controle := 'Anciennes tables crm_* (copie des données et des empreintes de mots de passe)';
  if n = 0 then statut := 'OK'; detail := 'aucune ancienne table'; action := null;
  else
    select count(*) into n from pg_policies p
     where p.schemaname = 'public' and p.tablename in ('crm_deals','crm_clients','crm_deployments','crm_users_data','crm_logiciels','crm_presentations','crm_commandes','crm_contrats','crm_licences','crm_apporteurs','crm_documents','crm_ecritures','crm_config')
       and p.policyname <> 'dir_read';
    if n = 0 then statut := 'INFO'; detail := 'présentes (' || coalesce(liste, '') || '), lecture réservée à la direction'; action := 'Après vérification de la synchronisation, vous pouvez les supprimer : elles ne servent plus (archive).';
    else statut := 'À CORRIGER'; detail := 'présentes (' || coalesce(liste, '') || ') avec des politiques autres que « dir_read »'; action := 'Exécuter supabase/lockdown_crm_legacy.sql.'; end if;
  end if;
  return next;

  -- 6. Données du CRM : la table centrale n'est lisible que par les opérateurs.
  ord := 60; controle := 'Table centrale crm_records protégée (RLS + aucune politique pour anon)';
  if to_regclass('public.crm_records') is null then statut := 'INFO'; detail := 'connecteur CRM non installé (migration 20261111000000)'; action := 'Appliquer la migration du connecteur pour synchroniser le CRM avec Supabase.';
  else
    select count(*) into n from pg_class c where c.oid = 'public.crm_records'::regclass and c.relrowsecurity;
    select count(*) into t from pg_policies p where p.schemaname = 'public' and p.tablename = 'crm_records' and (p.roles && array['anon','public']::name[]);
    if n = 1 and t.count = 0 then statut := 'OK'; detail := 'RLS active, aucune politique pour anon'; action := null;
    else statut := 'À CORRIGER'; detail := 'RLS ' || case when n = 1 then 'active' else 'ABSENTE' end || ', ' || t.count || ' politique(s) pour anon/public'; action := 'Réappliquer supabase/migrations/20261111000000_crm_ai_connector.sql.'; end if;
  end if;
  return next;

  -- 7. Stockage : aucun bucket public ne devrait contenir de documents clients (factures, contrats).
  ord := 70; controle := 'Aucun bucket de stockage public';
  if to_regclass('storage.buckets') is null then statut := 'INFO'; detail := 'stockage non utilisé'; action := null;
  else
    execute 'select count(*), string_agg(id, '', '') from storage.buckets where public' into n, liste;
    if n = 0 then statut := 'OK'; detail := 'aucun bucket public'; action := null;
    else statut := 'INFO'; detail := n || ' bucket(s) public(s) : ' || coalesce(liste, ''); action := 'Normal pour des images publiques (avatars). Vérifiez qu''aucun contrat, facture ou export client n''y est déposé.'; end if;
  end if;
  return next;

  -- 8. Opérateurs : qui peut se connecter aux données.
  ord := 80; controle := 'Comptes opérateurs actifs (connexion aux données)';
  if to_regclass('public.ai_operators') is null then statut := 'INFO'; detail := 'schéma SANIX AI non installé'; action := 'Coller supabase/setup_all.sql (voir DEPLOIEMENT.md).';
  else
    execute 'select count(*) from public.ai_operators where actif' into n;
    statut := case when n between 1 and 5 then 'OK' when n = 0 then 'INFO' else 'À CORRIGER' end;
    detail := n || ' opérateur(s) actif(s)'; action := case when n = 0 then 'Créer le compte opérateur (ACCES.md).' when n > 5 then 'Vérifier chaque compte : désactiver ceux qui ne servent plus.' else null end;
  end if;
  return next;

  -- 9. Rappel : la sécurité ne dépend pas que de la base.
  ord := 90; controle := 'À faire hors SQL'; statut := 'INFO';
  detail := 'Authentication → Providers : désactiver « Allow new users to sign up » (personne d''autre ne doit pouvoir créer un compte). Project Settings → API : la clé « service_role » ne doit exister que dans les secrets des fonctions Edge, jamais dans le navigateur.';
  action := 'Vérifier ces deux réglages dans le tableau de bord Supabase.';
  return next;
end
$f$;

select ord as "#", controle as "Contrôle", statut as "Résultat", detail as "Détail", action as "Action à faire"
  from pg_temp.verif_securite() order by ord;
