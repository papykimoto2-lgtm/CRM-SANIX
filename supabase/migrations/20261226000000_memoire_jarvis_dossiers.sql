-- Mémoire de Jarvis (direction) et mémoire par dossier prospect (opérateurs + agents).
-- Accès uniquement par RPC (RLS activée sans politique). Plafonds, filtre anti-secrets, audit.

create or replace function public.ai_memoire_nettoyer(p_txt text) returns text
language plpgsql immutable set search_path = public as $$
declare v text := btrim(regexp_replace(coalesce(p_txt, ''), '\s+', ' ', 'g'));
begin
  if length(v) < 3 then raise exception 'Souvenir trop court'; end if;
  if length(v) > 500 then raise exception 'Souvenir trop long (500 caractères maximum)'; end if;
  if v ~* '(sk-[a-z0-9_-]{10,}|sbp_[a-z0-9]{10,}|eyJ[a-z0-9_-]{20,}|(mot de passe|password|passwd|mdp|token|secret|api[ _-]?key|cle api)\s*[:=])'
    then raise exception 'Refusé : ne mémorisez jamais de secret ni de mot de passe'; end if;
  return v;
end $$;

-- ───────── Mémoire de Jarvis ─────────
create table if not exists public.ai_jarvis_memory (
  id         bigint generated always as identity primary key,
  contenu    text not null check (length(contenu) between 3 and 500),
  categorie  text not null default 'fait' check (categorie in ('preference', 'decision', 'consigne', 'fait')),
  epingle    boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists ai_jarvis_memory_uq on public.ai_jarvis_memory (lower(contenu));
alter table public.ai_jarvis_memory enable row level security;
revoke all on public.ai_jarvis_memory from anon, authenticated;

create or replace function public.ai_jarvis_memoire() returns setof public.ai_jarvis_memory
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  return query select * from public.ai_jarvis_memory order by epingle desc, created_at desc limit 80;
end $$;

create or replace function public.ai_jarvis_memoriser(p_contenu text, p_categorie text default 'fait') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v text; r public.ai_jarvis_memory;
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  v := public.ai_memoire_nettoyer(p_contenu);
  if coalesce(p_categorie, 'fait') not in ('preference', 'decision', 'consigne', 'fait') then raise exception 'Catégorie invalide'; end if;
  select * into r from public.ai_jarvis_memory where lower(contenu) = lower(v);
  if r.id is not null then return jsonb_build_object('ok', true, 'doublon', true, 'id', r.id); end if;
  insert into public.ai_jarvis_memory(contenu, categorie) values (v, coalesce(p_categorie, 'fait')) returning * into r;
  -- au plus 100 souvenirs : les plus anciens non épinglés partent
  delete from public.ai_jarvis_memory where id in (select id from public.ai_jarvis_memory where not epingle order by created_at desc offset 100);
  insert into public.ai_actions(agent, action, payload, ok, cout_usd) values ('memoire', 'jarvis_memorise', jsonb_build_object('id', r.id, 'categorie', r.categorie), true, 0);
  return jsonb_build_object('ok', true, 'id', r.id);
end $$;

-- Oubli par identifiant, ou par texte (un seul souvenir doit correspondre, sinon rien n'est supprimé)
create or replace function public.ai_jarvis_oublier(p_id bigint default null, p_texte text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; ids bigint[];
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  if p_id is not null then ids := array[p_id];
  elsif length(btrim(coalesce(p_texte, ''))) >= 3 then
    select array_agg(id) into ids from public.ai_jarvis_memory where contenu ilike '%' || replace(replace(replace(btrim(p_texte), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  else raise exception 'Précisez quoi oublier'; end if;
  n := coalesce(array_length(ids, 1), 0);
  if n <> 1 then return jsonb_build_object('ok', false, 'correspondances', n); end if;
  delete from public.ai_jarvis_memory where id = ids[1];
  insert into public.ai_actions(agent, action, payload, ok, cout_usd) values ('memoire', 'jarvis_oublie', jsonb_build_object('id', ids[1]), true, 0);
  return jsonb_build_object('ok', true, 'correspondances', 1);
end $$;

create or replace function public.ai_jarvis_epingler(p_id bigint, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  update public.ai_jarvis_memory set epingle = coalesce(p_on, true) where id = p_id;
end $$;

-- ───────── Mémoire par dossier prospect ─────────
create table if not exists public.ai_prospect_memory (
  id          bigint generated always as identity primary key,
  prospect_id uuid not null references public.ai_prospects(id) on delete cascade,
  contenu     text not null check (length(contenu) between 3 and 500),
  categorie   text not null default 'contexte' check (categorie in ('objection', 'interlocuteur', 'engagement', 'preference', 'contexte')),
  auteur      text not null default 'operateur',
  epingle     boolean not null default false,
  task_id     uuid references public.ai_agent_tasks(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists ai_prospect_memory_idx on public.ai_prospect_memory (prospect_id, epingle desc, created_at desc);
create unique index if not exists ai_prospect_memory_uq on public.ai_prospect_memory (prospect_id, lower(contenu));
alter table public.ai_prospect_memory enable row level security;
revoke all on public.ai_prospect_memory from anon, authenticated;

create or replace function public.ai_prospect_memoire(p_prospect uuid) returns setof public.ai_prospect_memory
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ai_is_operator() then raise exception 'Réservé aux opérateurs' using errcode = '42501'; end if;
  return query select * from public.ai_prospect_memory where prospect_id = p_prospect order by epingle desc, created_at desc limit 40;
end $$;

create or replace function public.ai_prospect_memoriser(p_prospect uuid, p_contenu text, p_categorie text default 'contexte') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v text; r public.ai_prospect_memory;
begin
  if not public.ai_is_operator() then raise exception 'Réservé aux opérateurs' using errcode = '42501'; end if;
  if not exists (select 1 from public.ai_prospects where id = p_prospect) then raise exception 'Prospect introuvable'; end if;
  v := public.ai_memoire_nettoyer(p_contenu);
  if coalesce(p_categorie, 'contexte') not in ('objection', 'interlocuteur', 'engagement', 'preference', 'contexte') then raise exception 'Catégorie invalide'; end if;
  insert into public.ai_prospect_memory(prospect_id, contenu, categorie, auteur)
    values (p_prospect, v, coalesce(p_categorie, 'contexte'), case when public.ai_is_direction() then 'direction' else 'operateur' end)
    on conflict (prospect_id, lower(contenu)) do nothing returning * into r;
  if r.id is null then return jsonb_build_object('ok', true, 'doublon', true); end if;
  delete from public.ai_prospect_memory where id in (select id from public.ai_prospect_memory where prospect_id = p_prospect and not epingle order by created_at desc offset 40);
  insert into public.ai_actions(agent, action, prospect_id, payload, ok, cout_usd) values ('memoire', 'prospect_memorise', p_prospect, jsonb_build_object('id', r.id, 'categorie', r.categorie, 'auteur', r.auteur), true, 0);
  return jsonb_build_object('ok', true, 'id', r.id);
end $$;

create or replace function public.ai_prospect_oublier(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  delete from public.ai_prospect_memory where id = p_id returning prospect_id into pid;
  if pid is not null then insert into public.ai_actions(agent, action, prospect_id, payload, ok, cout_usd) values ('memoire', 'prospect_oublie', pid, jsonb_build_object('id', p_id), true, 0); end if;
end $$;

create or replace function public.ai_prospect_epingler(p_id bigint, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  update public.ai_prospect_memory set epingle = coalesce(p_on, true) where id = p_id;
end $$;

-- ───────── Exécuteur abonnement (service_role) ─────────
create or replace function public.ai_abonnement_memoriser_prospect(p_task uuid, p_prospect uuid, p_contenu text, p_categorie text default 'contexte') returns jsonb
language plpgsql set search_path = public as $$
declare t public.ai_agent_tasks; a public.ai_agents; v text; n int; r public.ai_prospect_memory;
begin
  select * into t from public.ai_agent_tasks where id = p_task for update;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' or a.etat <> 'actif' then raise exception 'L''agent n''est pas actif en mode abonnement'; end if;
  if t.statut <> 'en_cours' then raise exception 'La mission n''est pas en cours (statut : %)', t.statut; end if;
  if not exists (select 1 from public.ai_prospects where id = p_prospect) then raise exception 'Prospect introuvable'; end if;
  v := public.ai_memoire_nettoyer(p_contenu);
  if coalesce(p_categorie, 'contexte') not in ('objection', 'interlocuteur', 'engagement', 'preference', 'contexte') then raise exception 'Catégorie invalide'; end if;
  select count(*) into n from public.ai_actions where action = 'abonnement_memo_prospect' and task_id = t.id;
  if n >= 5 then raise exception 'Limite de 5 souvenirs de dossier par mission'; end if;
  insert into public.ai_prospect_memory(prospect_id, contenu, categorie, auteur, task_id)
    values (p_prospect, v, coalesce(p_categorie, 'contexte'), 'agent:' || a.code, t.id)
    on conflict (prospect_id, lower(contenu)) do nothing returning * into r;
  if r.id is null then return jsonb_build_object('ok', true, 'doublon', true); end if;
  delete from public.ai_prospect_memory where id in (select id from public.ai_prospect_memory where prospect_id = p_prospect and not epingle order by created_at desc offset 40);
  insert into public.ai_actions(agent, action, agent_id, task_id, prospect_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_memo_prospect', a.id, t.id, p_prospect, jsonb_build_object('categorie', r.categorie), true, 0);
  return jsonb_build_object('ok', true, 'id', r.id);
end $$;

create or replace function public.ai_abonnement_rappeler_prospect(p_task uuid, p_prospect uuid) returns jsonb
language plpgsql stable set search_path = public as $$
declare a public.ai_agents; t public.ai_agent_tasks;
begin
  select * into t from public.ai_agent_tasks where id = p_task;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' then raise exception 'Cet agent n''est pas en mode abonnement'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('contenu', m.contenu, 'categorie', m.categorie, 'auteur', m.auteur, 'epingle', m.epingle, 'date', m.created_at) order by m.epingle desc, m.created_at desc)
                     from public.ai_prospect_memory m where m.prospect_id = p_prospect), '[]'::jsonb);
end $$;

revoke all on function public.ai_memoire_nettoyer(text) from public, anon, authenticated;
revoke all on function public.ai_jarvis_memoire(), public.ai_jarvis_memoriser(text, text), public.ai_jarvis_oublier(bigint, text), public.ai_jarvis_epingler(bigint, boolean),
  public.ai_prospect_memoire(uuid), public.ai_prospect_memoriser(uuid, text, text), public.ai_prospect_oublier(bigint), public.ai_prospect_epingler(bigint, boolean),
  public.ai_abonnement_memoriser_prospect(uuid, uuid, text, text), public.ai_abonnement_rappeler_prospect(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ai_jarvis_memoire(), public.ai_jarvis_memoriser(text, text), public.ai_jarvis_oublier(bigint, text), public.ai_jarvis_epingler(bigint, boolean),
  public.ai_prospect_memoire(uuid), public.ai_prospect_memoriser(uuid, text, text), public.ai_prospect_oublier(bigint), public.ai_prospect_epingler(bigint, boolean) to authenticated;
grant execute on function public.ai_abonnement_memoriser_prospect(uuid, uuid, text, text), public.ai_abonnement_rappeler_prospect(uuid, uuid) to service_role;
grant execute on function public.ai_memoire_nettoyer(text) to service_role;
