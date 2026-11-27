-- Phase 6 : vérité. Niveau de preuve (1 officiel … 6 forum), motif d'archivage typé, indice de fiabilité indicatif, recherche honnête (« pas de preuves suffisantes »).
-- Aucun coût IA. Le score n'est pas une probabilité de vérité : une connaissance non validée par la direction reste plafonnée à 49/100.
alter table public.ai_agent_memory add column if not exists niveau_preuve smallint check (niveau_preuve between 1 and 6);
alter table public.ai_agent_memory_archive add column if not exists motif_type text not null default 'autre' check (motif_type in ('obsolete', 'contredit', 'faux', 'autre'));

-- Souvenirs calculés en SQL à partir des données internes du CRM : preuve de niveau 1
create or replace function public.ai_memoire_niveau_auto() returns trigger language plpgsql as $$
begin
  if new.niveau_preuve is null and (new.source like 'stage:%' or new.source like 'bilan:%' or new.source like 'erreur:%') then new.niveau_preuve := 1; end if;
  return new;
end $$;
drop trigger if exists ai_memoire_niveau_auto_t on public.ai_agent_memory;
create trigger ai_memoire_niveau_auto_t before insert on public.ai_agent_memory for each row execute function public.ai_memoire_niveau_auto();
update public.ai_agent_memory set niveau_preuve = 1 where niveau_preuve is null and (source like 'stage:%' or source like 'bilan:%' or source like 'erreur:%');

-- Indice de fiabilité 0-100 (indicatif) : preuve + validation + fraîcheur ; plafonné à 49 tant que la direction n'a pas validé
create or replace function public.ai_memoire_fiabilite(p_statut text, p_niveau smallint, p_date timestamptz) returns int
language sql immutable as $$
  select case when p_statut = 'valide' then least(100, b + 25 + f) else least(49, b + f) end
  from (select case p_niveau when 1 then 60 when 2 then 50 when 3 then 45 when 4 then 35 when 5 then 25 when 6 then 15 else 10 end b,
               case when p_date >= now() - interval '30 days' then 15 when p_date >= now() - interval '90 days' then 8 else 0 end f) x
$$;

-- Validation (avec niveau de preuve) ou invalidation typée (archive conservée)
drop function if exists public.ai_memoire_valider(bigint, boolean, text);
create function public.ai_memoire_valider(p_id bigint, p_ok boolean, p_motif text default null, p_niveau smallint default null, p_motif_type text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.ai_agent_memory;
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  if p_niveau is not null and p_niveau not between 1 and 6 then raise exception 'Niveau de preuve invalide (1 à 6)'; end if;
  if p_motif_type is not null and p_motif_type not in ('obsolete', 'contredit', 'faux', 'autre') then raise exception 'Motif invalide'; end if;
  select * into r from public.ai_agent_memory where id = p_id for update;
  if r.id is null then raise exception 'Souvenir introuvable'; end if;
  if coalesce(p_ok, true) then
    update public.ai_agent_memory set statut = 'valide', valide_at = now(), niveau_preuve = coalesce(p_niveau, niveau_preuve), importance = greatest(importance, 4::smallint), task_id = null where id = p_id;
  else
    insert into public.ai_agent_memory_archive(id, agent_id, contenu, tags, importance, task_id, created_at, motif, motif_type)
      values (r.id, r.agent_id, r.contenu, r.tags, r.importance, r.task_id, r.created_at, left(nullif(btrim(coalesce(p_motif, '')), ''), 300), coalesce(p_motif_type, 'autre')) on conflict (id) do nothing;
    delete from public.ai_agent_memory where id = p_id;
  end if;
  insert into public.ai_actions(agent, action, agent_id, payload, ok, cout_usd)
    values ('memoire', case when coalesce(p_ok, true) then 'souvenir_valide' else 'souvenir_archive' end, r.agent_id, jsonb_build_object('id', p_id, 'niveau', p_niveau, 'motif', p_motif_type), true, 0);
  return jsonb_build_object('ok', true, 'statut', case when coalesce(p_ok, true) then 'valide' else 'archive' end);
end $$;

drop function if exists public.ai_memoire_liste(uuid, boolean, text, int);
create function public.ai_memoire_liste(p_agent uuid default null, p_partage boolean default false, p_statut text default null, p_n int default 60)
returns table (id bigint, agent_id uuid, agent_nom text, contenu text, tags text[], importance smallint, statut text, source text, experience boolean, a_revalider boolean, niveau_preuve smallint, fiabilite int, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  return query
    select m.id, m.agent_id, coalesce(a.nom, 'Partagée'), m.contenu, m.tags, m.importance, m.statut, m.source, m.task_id is not null,
           (m.statut = 'valide' and coalesce(m.valide_at, m.created_at) < now() - interval '90 days'), m.niveau_preuve,
           public.ai_memoire_fiabilite(m.statut, m.niveau_preuve, coalesce(m.valide_at, m.created_at)), m.created_at
      from public.ai_agent_memory m left join public.ai_agents a on a.id = m.agent_id
     where (p_agent is null or m.agent_id = p_agent) and (not coalesce(p_partage, false) or m.agent_id is null)
       and (p_statut is null or (p_statut = 'valide' and m.statut = 'valide') or (p_statut = 'a_verifier' and m.statut = 'a_verifier' and m.task_id is null)
            or (p_statut = 'experience' and m.task_id is not null) or (p_statut = 'a_revalider' and m.statut = 'valide' and coalesce(m.valide_at, m.created_at) < now() - interval '90 days'))
     order by (m.statut = 'valide' and coalesce(m.valide_at, m.created_at) < now() - interval '90 days') desc, m.statut = 'valide' desc, m.importance desc, m.created_at desc limit greatest(1, least(coalesce(p_n, 60), 200));
end $$;

-- « Que sais-tu sur X ? » : validés d'abord, non vérifiés signalés comme tels ; zéro résultat = « pas de preuves suffisantes »
create or replace function public.ai_memoire_chercher(p_q text, p_n int default 6) returns table (origine text, contenu text, statut text, niveau_preuve smallint, fiabilite int, source text)
language plpgsql stable security definer set search_path = public as $$
declare q tsquery;
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_q, ''))) < 3 then raise exception 'Précisez le sujet'; end if;
  q := websearch_to_tsquery('french'::regconfig, left(p_q, 200));
  return query
    select * from (
      select 'agent'::text, m.contenu, m.statut, m.niveau_preuve, public.ai_memoire_fiabilite(m.statut, m.niveau_preuve, coalesce(m.valide_at, m.created_at)), m.source
        from public.ai_agent_memory m where m.fts @@ q
      union all
      select 'president'::text, j.contenu, 'valide'::text, null::smallint, 100, null::text
        from public.ai_jarvis_memory j where to_tsvector('french'::regconfig, j.contenu) @@ q
    ) z order by (z.statut = 'valide') desc, z.fiabilite desc limit greatest(1, least(coalesce(p_n, 6), 12));
end $$;

revoke all on function public.ai_memoire_fiabilite(text, smallint, timestamptz), public.ai_memoire_niveau_auto() from public, anon, authenticated;
revoke all on function public.ai_memoire_valider(bigint, boolean, text, smallint, text), public.ai_memoire_liste(uuid, boolean, text, int), public.ai_memoire_chercher(text, int) from public, anon, authenticated;
grant execute on function public.ai_memoire_valider(bigint, boolean, text, smallint, text), public.ai_memoire_liste(uuid, boolean, text, int), public.ai_memoire_chercher(text, int) to authenticated;
grant execute on function public.ai_memoire_fiabilite(text, smallint, timestamptz) to service_role;
