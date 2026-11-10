-- SANIX CRM — verrouillage des anciennes tables de synchronisation (crm_deals, crm_clients, crm_commandes…).
-- À EXÉCUTER UNE FOIS, dans Supabase → SQL Editor, APRÈS le déploiement du CRM qui contient shared/crm-connector.js (voir supabase/CONNECTEUR_CRM_IA.md §6).
--
-- Pourquoi : ces tables ont été créées à la main avec une politique « anon_all » (lecture ET écriture avec la clé publique du CRM, donc par n'importe quel
-- visiteur qui la lit dans le navigateur), y compris crm_users_data (empreintes de mots de passe). Le nouveau connecteur n'écrit plus dedans : les données
-- vivent dans crm_records (réservée aux opérateurs). Les anciennes tables sont conservées en lecture seule pour la direction (archive), jamais supprimées.
-- Relançable sans effet de bord. Retour arrière : recréer une politique d'accès, ou lancer `alter table public.<table> disable row level security;` (déconseillé).
do $$
declare t text; pol record;
begin
  foreach t in array array['crm_deals','crm_clients','crm_deployments','crm_users_data','crm_logiciels','crm_presentations','crm_commandes',
                           'crm_contrats','crm_licences','crm_apporteurs','crm_documents','crm_ecritures','crm_config'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('create policy dir_read on public.%I for select to authenticated using (public.ai_is_direction())', t);
    raise notice 'verrouillée : %', t;
  end loop;
end $$;
