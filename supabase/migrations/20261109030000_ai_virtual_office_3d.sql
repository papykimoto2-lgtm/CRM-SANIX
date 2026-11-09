-- ═══════════════════════════════════════════════════════════════════
--  SANIX AI VIRTUAL COMPANY — Module 13 : présence et animation 3D temps réel
--  Principe : le moteur IA écrit l'état réel (activité détaillée, lieu) et publie des événements ;
--  le bureau 3D se synchronise via Realtime et reconstruit l'état à la réouverture.
--  Les animations représentent le statut déclaré par le moteur, pas chaque opération technique.
-- ═══════════════════════════════════════════════════════════════════

-- ─── État de présence persistant (survit à la fermeture de l'interface) ───
alter table public.ai_agents
  add column if not exists activite_detail  text check (activite_detail is null or activite_detail ~ '^[a-z_]{3,40}$'),
  add column if not exists lieu             text not null default 'poste'
    check (lieu in ('poste','poste_agent','reunion','supervision','collaboration','detente','departement')),
  add column if not exists lieu_cible_agent uuid references public.ai_agents(id) on delete set null,
  add column if not exists lieu_cible_dept  text references public.ai_departments(id) on delete set null,
  add column if not exists lieu_depuis      timestamptz,
  add column if not exists lieu_jusqua      timestamptz;
alter table public.ai_agents drop constraint if exists ai_agents_lieu_cible_check;
alter table public.ai_agents add constraint ai_agents_lieu_cible_check check (
  (lieu <> 'poste_agent' or lieu_cible_agent is not null) and (lieu <> 'departement' or lieu_cible_dept is not null));

create or replace function public.ai_agents_presence_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.lieu is distinct from old.lieu or new.lieu_cible_agent is distinct from old.lieu_cible_agent
     or new.lieu_cible_dept is distinct from old.lieu_cible_dept then
    new.lieu_depuis := now();
  end if;
  if new.lieu = 'poste' then
    new.lieu_cible_agent := null; new.lieu_cible_dept := null; new.lieu_jusqua := null;
  end if;
  if new.etat = 'archive' then new.lieu := 'poste'; new.activite_detail := null; end if;
  return new;
end $$;
drop trigger if exists ai_agents_presence_guard on public.ai_agents;
create trigger ai_agents_presence_guard before update on public.ai_agents
  for each row execute function public.ai_agents_presence_guard();

-- ─── Réunions en direct : phase et orateur ───
alter table public.ai_agent_meetings
  add column if not exists phase text check (phase is null or phase in ('convocation','installation','echanges','synthese','cloture')),
  add column if not exists orateur_id uuid references public.ai_agents(id) on delete set null;

-- ─── Flux d'événements (historique des activités + synchronisation temps réel) ───
create table if not exists public.ai_agent_events (
  id              bigint generated always as identity primary key,
  agent_id        uuid not null references public.ai_agents(id) on delete cascade,
  kind            text not null check (kind in ('activite','deplacement','briefing','reunion','parole')),
  activity        text check (activity is null or activity ~ '^[a-z_]{3,40}$'),
  animation       text check (animation is null or animation ~ '^[a-z_]{3,40}$'),
  status          text,                         -- état grossier de l'agent au moment de l'événement
  department      text,
  location        text check (location is null or location in ('poste','poste_agent','reunion','supervision','collaboration','detente','departement')),
  target_agent_id uuid references public.ai_agents(id) on delete set null,
  target_dept     text,
  task_id         uuid references public.ai_agent_tasks(id) on delete set null,
  meeting_id      uuid references public.ai_agent_meetings(id) on delete set null,
  participants    uuid[] not null default '{}',
  payload         jsonb not null default '{}'::jsonb,
  duration_ms     int check (duration_ms is null or duration_ms between 0 and 1800000),
  created_at      timestamptz not null default now()
);
create index if not exists ai_events_at on public.ai_agent_events(created_at desc);
create index if not exists ai_events_agent on public.ai_agent_events(agent_id, created_at desc);

alter table public.ai_agent_events enable row level security;
alter table public.ai_agent_events force row level security;
revoke all on public.ai_agent_events from anon;
drop policy if exists op_read on public.ai_agent_events;
create policy op_read on public.ai_agent_events for select to authenticated using (public.ai_is_operator());

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ai_agent_events;
  end if;
exception when duplicate_object then null; end $$;

-- ─── Publication d'un événement de présence (une seule écriture atomique) ───
--  p_kind = activite     : met à jour l'activité détaillée
--  p_kind = deplacement  : le lieu de l'agent change pour p_duree_ms (retour automatique au poste)
--  p_kind = briefing     : idem, collaboration de plusieurs agents (p_participants)
--  p_kind = reunion      : l'agent rejoint la salle de réunion
--  p_kind = parole       : prise de parole en réunion (bulle de texte, aucun changement d'état)
create or replace function public.ai_agent_presence(
  p_agent uuid, p_kind text, p_activity text default null, p_animation text default null,
  p_lieu text default null, p_cible_agent uuid default null, p_cible_dept text default null,
  p_task uuid default null, p_meeting uuid default null, p_participants uuid[] default '{}',
  p_duree_ms int default null, p_payload jsonb default '{}'::jsonb)
returns bigint language plpgsql set search_path = public as $$
declare a public.ai_agents; v_id bigint;
begin
  select * into a from public.ai_agents where id = p_agent;
  if not found or a.etat = 'archive' then return null; end if;
  if p_kind = 'activite' then
    update public.ai_agents set activite_detail = p_activity where id = p_agent and activite_detail is distinct from p_activity;
  elsif p_kind in ('deplacement','briefing','reunion') then
    update public.ai_agents set lieu = coalesce(p_lieu, 'poste'), lieu_cible_agent = p_cible_agent, lieu_cible_dept = p_cible_dept,
           lieu_jusqua = case when coalesce(p_lieu, 'poste') = 'poste' then null else now() + make_interval(secs => greatest(1, coalesce(p_duree_ms, 10000)) / 1000.0) end
     where id = p_agent;
  end if;
  insert into public.ai_agent_events(agent_id, kind, activity, animation, status, department, location, target_agent_id, target_dept,
                                      task_id, meeting_id, participants, payload, duration_ms)
  values (p_agent, p_kind, p_activity, p_animation, a.activite, a.departement_id, p_lieu, p_cible_agent, p_cible_dept,
          p_task, p_meeting, coalesce(p_participants, '{}'), coalesce(p_payload, '{}'::jsonb), p_duree_ms)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.ai_agent_presence(uuid, text, text, text, text, uuid, text, uuid, uuid, uuid[], int, jsonb) from public, anon, authenticated;
grant execute on function public.ai_agent_presence(uuid, text, text, text, text, uuid, text, uuid, uuid, uuid[], int, jsonb) to service_role;

-- ─── Entretien : retours au poste, activités périmées, purge de l'historique ───
create or replace function public.ai_expire_agents() returns int language plpgsql set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.ai_agents where temporaire and expire_at < now() and etat <> 'archive' loop
    perform public.ai_agent_change_etat(r.id, 'archive', 'Fin de mission temporaire', 'systeme');
    n := n + 1;
  end loop;
  update public.ai_agents set activite = 'disponible', activite_detail = null
   where activite = 'mission_terminee' and activite_depuis < now() - interval '30 minutes';
  -- déplacement terminé : retour au poste
  update public.ai_agents set lieu = 'poste' where lieu <> 'poste' and lieu_jusqua is not null and lieu_jusqua < now();
  -- exécution interrompue (processus arrêté) : l'agent n'est plus « en mission » sans mission en cours
  update public.ai_agents a set activite = 'disponible', activite_detail = null
   where a.activite in ('en_mission','en_analyse') and a.activite_depuis < now() - interval '20 minutes'
     and not exists (select 1 from public.ai_agent_tasks t where t.agent_id = a.id and t.statut = 'en_cours');
  delete from public.ai_agent_events where id in (select id from public.ai_agent_events where created_at < now() - interval '14 days' limit 5000);
  return n;
end $$;
