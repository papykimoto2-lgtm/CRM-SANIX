-- Levée de fonds : état partagé entre le CRM et les agents IA, annuaire des financeurs, mission hebdomadaire.
-- Le CRM enregistre ici les réglages du module (critères cochés, seuils, simulation, éléments du deck) et un instantané des chiffres du modèle Financement
-- (les agents tournent côté serveur et ne voient pas le navigateur). Les mesures commerciales sont, elles, recalculées par l'agent depuis crm_commandes.
-- Direction uniquement. Relançable.

create table if not exists public.levee_etat (
  id          smallint primary key default 1 check (id = 1),
  config      jsonb not null default '{}'::jsonb,
  instantane  jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
alter table public.levee_etat enable row level security;
drop policy if exists levee_etat_direction on public.levee_etat;
create policy levee_etat_direction on public.levee_etat for all to authenticated
  using (public.ai_is_direction()) with check (public.ai_is_direction());
revoke all on public.levee_etat from anon;

-- Écriture par le CRM (réservée à la direction) : un seul enregistrement, remplacé à chaque appel.
create or replace function public.levee_enregistrer(p_config jsonb, p_instantane jsonb) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz := now();
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  if pg_column_size(coalesce(p_config, '{}'::jsonb)) > 200000 or pg_column_size(coalesce(p_instantane, '{}'::jsonb)) > 200000 then
    raise exception 'État trop volumineux' using errcode = '54000';
  end if;
  insert into public.levee_etat(id, config, instantane, updated_at, updated_by)
  values (1, coalesce(p_config, '{}'::jsonb), coalesce(p_instantane, '{}'::jsonb), v_now, auth.uid())
  on conflict (id) do update set config = excluded.config, instantane = excluded.instantane, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return v_now;
end $$;
revoke all on function public.levee_enregistrer(jsonb, jsonb) from public, anon;
grant execute on function public.levee_enregistrer(jsonb, jsonb) to authenticated;

-- Annuaire des financeurs : chaque ligne porte sa source (aucun financeur sans lien vérifiable).
create table if not exists public.levee_financeurs (
  id           uuid primary key default gen_random_uuid(),
  nom          text not null check (length(nom) between 2 and 160),
  nom_norm     text generated always as (lower(regexp_replace(btrim(nom), '\s+', ' ', 'g'))) stored,
  type         text not null check (type in ('business_angel', 'fonds', 'banque', 'subvention', 'accelerateur', 'autre')),
  pays         text check (length(pays) <= 80),
  ticket_min   numeric(16,0) check (ticket_min >= 0),
  ticket_max   numeric(16,0) check (ticket_max >= 0),
  devise       text not null default 'FCFA' check (length(devise) between 1 and 8),
  conditions   text check (length(conditions) <= 3000),
  url_source   text not null check (url_source ~* '^https://'),
  statut       text not null default 'a_etudier' check (statut in ('a_etudier', 'correspond', 'contacte', 'en_discussion', 'decline', 'ecarte', 'investi')),
  notes        text check (length(notes) <= 3000),
  ajoute_par   uuid references public.ai_agents(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists levee_financeurs_nom on public.levee_financeurs(nom_norm);
create index if not exists levee_financeurs_statut on public.levee_financeurs(statut, created_at desc);
alter table public.levee_financeurs enable row level security;
drop policy if exists levee_financeurs_direction on public.levee_financeurs;
create policy levee_financeurs_direction on public.levee_financeurs for all to authenticated
  using (public.ai_is_direction()) with check (public.ai_is_direction());
revoke all on public.levee_financeurs from anon;

-- Mission hebdomadaire de l'agent « levée de fonds » (lancée par le planificateur ; sans effet si l'agent n'existe pas, est suspendu ou si l'entreprise est en pause).
create or replace function public.ai_levee_mission_hebdo() returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_agent uuid; v_dg uuid; v_id uuid;
begin
  if not coalesce((select actif from public.ai_governance where id = 1), false) then return null; end if;
  select id into v_agent from public.ai_agents where code = 'sanix_ai_fundraising_director' and etat = 'actif';
  if v_agent is null then return null; end if;
  select id into v_dg from public.ai_agents where code = 'sanix_ai_general_director';
  insert into public.ai_agent_tasks(agent_id, donneur_agent_id, type, titre, description, objectifs, priorite, echeance)
  values (v_agent, v_dg, 'mission', 'Suivi hebdomadaire de la levée de fonds',
    E'1. Consulte l''état de préparation avec consulter_levee_de_fonds.\n2. Compare avec ta dernière analyse (rappeler) : qu''est-ce qui a changé ? Quels critères ont progressé, lesquels bloquent encore ?\n3. Si l''annuaire des financeurs compte moins de 15 lignes, cherche sur le web (Côte d''Ivoire, zone UEMOA, Afrique francophone) au plus 5 nouveaux financeurs ou programmes correspondant à notre profil, et enregistre chacun avec enregistrer_financeur (source obligatoire).\n4. Rédige le rapport : situation en 5 lignes, ce qui a changé, les 3 actions prioritaires, les financeurs ajoutés ou à étudier. Ne communique jamais un chiffre qui ne vient pas des outils ; signale les données non mesurables.\n5. Mémorise l''essentiel pour la semaine prochaine, puis termine.',
    '["Rapport hebdomadaire à jour","3 actions prioritaires","Financeurs ajoutés avec leur source"]'::jsonb, 3, now() + interval '2 days')
  returning id into v_id;
  return v_id;
exception when others then
  return null;     -- doublon (mission déjà ouverte), agent chargé ou plafond de gouvernance : on réessaiera la semaine suivante
end $$;
revoke all on function public.ai_levee_mission_hebdo() from public, anon, authenticated;
grant execute on function public.ai_levee_mission_hebdo() to service_role;
