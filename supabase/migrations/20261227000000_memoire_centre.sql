-- Centre mémoire (phase 2) : statut validé / à vérifier, source, archivage des souvenirs invalidés.
-- Un souvenir invalidé quitte ai_agent_memory (donc n'est plus rappelé ni injecté, en mode API comme abonnement) et part en archive.
alter table public.ai_agent_memory add column if not exists statut text not null default 'a_verifier' check (statut in ('a_verifier', 'valide'));
alter table public.ai_agent_memory add column if not exists source text check (source is null or length(source) <= 300);

create table if not exists public.ai_agent_memory_archive (
  id bigint primary key, agent_id uuid, contenu text not null, tags text[], importance smallint, task_id uuid, created_at timestamptz,
  motif text, archived_at timestamptz not null default now(), archived_by uuid default auth.uid()
);
alter table public.ai_agent_memory_archive enable row level security;
revoke all on public.ai_agent_memory_archive from anon, authenticated;

create or replace function public.ai_memoire_centre() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  return jsonb_build_object(
    'souvenirs', (select count(*) from public.ai_agent_memory),
    'partages', (select count(*) from public.ai_agent_memory where agent_id is null),
    'valides', (select count(*) from public.ai_agent_memory where statut = 'valide'),
    'a_verifier', (select count(*) from public.ai_agent_memory where statut = 'a_verifier' and task_id is null),
    'experiences', (select count(*) from public.ai_agent_memory where task_id is not null),
    'archives', (select count(*) from public.ai_agent_memory_archive),
    'jarvis', (select count(*) from public.ai_jarvis_memory),
    'dossiers', (select count(*) from public.ai_prospect_memory),
    'par_agent', coalesce((select jsonb_agg(jsonb_build_object('agent_id', x.agent_id, 'nom', coalesce(a.nom, 'Partagée'), 'n', x.n) order by x.n desc)
                             from (select agent_id, count(*) n from public.ai_agent_memory group by agent_id) x left join public.ai_agents a on a.id = x.agent_id), '[]'::jsonb));
end $$;

-- Liste des souvenirs (direction). p_agent null = tous ; p_partage true = mémoire partagée seule ; p_statut : valide | a_verifier | experience
create or replace function public.ai_memoire_liste(p_agent uuid default null, p_partage boolean default false, p_statut text default null, p_n int default 60)
returns table (id bigint, agent_id uuid, agent_nom text, contenu text, tags text[], importance smallint, statut text, source text, experience boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  return query
    select m.id, m.agent_id, coalesce(a.nom, 'Partagée'), m.contenu, m.tags, m.importance, m.statut, m.source, m.task_id is not null, m.created_at
      from public.ai_agent_memory m left join public.ai_agents a on a.id = m.agent_id
     where (p_agent is null or m.agent_id = p_agent) and (not coalesce(p_partage, false) or m.agent_id is null)
       and (p_statut is null or (p_statut = 'valide' and m.statut = 'valide') or (p_statut = 'a_verifier' and m.statut = 'a_verifier' and m.task_id is null) or (p_statut = 'experience' and m.task_id is not null))
     order by m.statut = 'valide' desc, m.importance desc, m.created_at desc limit greatest(1, least(coalesce(p_n, 60), 200));
end $$;

-- Valider (importance relevée, protégé des purges automatiques) ou invalider (archivé avec motif)
create or replace function public.ai_memoire_valider(p_id bigint, p_ok boolean, p_motif text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.ai_agent_memory;
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  select * into r from public.ai_agent_memory where id = p_id for update;
  if r.id is null then raise exception 'Souvenir introuvable'; end if;
  if coalesce(p_ok, true) then
    update public.ai_agent_memory set statut = 'valide', importance = greatest(importance, 4::smallint), task_id = null where id = p_id;
  else
    insert into public.ai_agent_memory_archive(id, agent_id, contenu, tags, importance, task_id, created_at, motif)
      values (r.id, r.agent_id, r.contenu, r.tags, r.importance, r.task_id, r.created_at, left(nullif(btrim(coalesce(p_motif, '')), ''), 300)) on conflict (id) do nothing;
    delete from public.ai_agent_memory where id = p_id;
  end if;
  insert into public.ai_actions(agent, action, agent_id, payload, ok, cout_usd)
    values ('memoire', case when coalesce(p_ok, true) then 'souvenir_valide' else 'souvenir_archive' end, r.agent_id, jsonb_build_object('id', p_id), true, 0);
  return jsonb_build_object('ok', true, 'statut', case when coalesce(p_ok, true) then 'valide' else 'archive' end);
end $$;

revoke all on function public.ai_memoire_centre(), public.ai_memoire_liste(uuid, boolean, text, int), public.ai_memoire_valider(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.ai_memoire_centre(), public.ai_memoire_liste(uuid, boolean, text, int), public.ai_memoire_valider(bigint, boolean, text) to authenticated;
