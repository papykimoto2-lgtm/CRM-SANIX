-- Planification des envois externes (WhatsApp, e-mail) : fenêtre horaire + plafond quotidien, appliqués par le SQL qui réserve les envois.
-- Aucun changement de fonction Edge : flushOutbox réserve ses messages par ai_claim_outbox, qui ne rend plus rien hors fenêtre et limite
-- WhatsApp au plafond du jour. Un message validé hors fenêtre (ou plafond atteint) reste « a_envoyer » et part au prochain créneau.
-- Fuseau : Africa/Abidjan (UTC+0, sans heure d'été). Jours : 1 = lundi … 7 = dimanche.
alter table public.ai_governance
  add column if not exists envoi_planifie boolean not null default true,
  add column if not exists envoi_jours smallint[] not null default '{1,2,3,4,5,6}',
  add column if not exists envoi_debut time not null default '08:00',
  add column if not exists envoi_fin time not null default '18:00',
  add column if not exists envoi_plafond_wa_jour integer not null default 20;
do $$ begin
  alter table public.ai_governance add constraint ai_gov_envoi_chk check (envoi_debut < envoi_fin and envoi_plafond_wa_jour between 0 and 1000 and envoi_jours <@ array[1,2,3,4,5,6,7]::smallint[]);
exception when duplicate_object then null; end $$;

-- Heure d'envoi réelle (le created_at d'un message validé plus tard n'est pas l'heure du départ)
alter table public.ai_messages add column if not exists envoye_at timestamptz;
update public.ai_messages set envoye_at = created_at where envoye_at is null and sens = 'sortant' and statut in ('envoye', 'delivre', 'lu');
create index if not exists ai_messages_envoye_idx on public.ai_messages (canal, envoye_at) where envoye_at is not null;
create or replace function public.ai_messages_envoye_at() returns trigger language plpgsql set search_path = public as $$
begin
  if new.sens = 'sortant' and new.statut in ('envoye', 'delivre', 'lu') and new.envoye_at is null then new.envoye_at := now(); end if;
  return new;
end $$;
drop trigger if exists ai_messages_envoye_at_trg on public.ai_messages;
create trigger ai_messages_envoye_at_trg before insert or update of statut on public.ai_messages for each row execute function public.ai_messages_envoye_at();

-- La fenêtre est-elle ouverte à cet instant ?
create or replace function public.ai_envoi_ouvert(p_ts timestamptz default now()) returns boolean language plpgsql stable set search_path = public as $$
declare g public.ai_governance; l timestamp := p_ts at time zone 'Africa/Abidjan';
begin
  select * into g from public.ai_governance where id = 1;
  if g.id is null or not g.envoi_planifie then return true; end if;
  return extract(isodow from l)::smallint = any(g.envoi_jours) and l::time >= g.envoi_debut and l::time < g.envoi_fin;
end $$;

-- Prochaine ouverture de fenêtre à partir de p_ts (maintenant si elle est ouverte)
create or replace function public.ai_envoi_prochain(p_ts timestamptz default now()) returns timestamptz language plpgsql stable set search_path = public as $$
declare g public.ai_governance; l timestamp := p_ts at time zone 'Africa/Abidjan'; d date; i int;
begin
  select * into g from public.ai_governance where id = 1;
  if g.id is null or not g.envoi_planifie or coalesce(array_length(g.envoi_jours, 1), 0) = 0 then return p_ts; end if;
  for i in 0..8 loop
    d := l::date + i;
    if extract(isodow from d)::smallint = any(g.envoi_jours) then
      if i = 0 then
        if l::time < g.envoi_debut then return (d + g.envoi_debut) at time zone 'Africa/Abidjan'; end if;
        if l::time < g.envoi_fin then return p_ts; end if;
      else return (d + g.envoi_debut) at time zone 'Africa/Abidjan'; end if;
    end if;
  end loop;
  return null;
end $$;

-- Messages WhatsApp encore autorisés aujourd'hui (jour d'Abidjan)
create or replace function public.ai_envoi_restant_wa(p_ts timestamptz default now()) returns integer language plpgsql stable set search_path = public as $$
declare g public.ai_governance; n int;
begin
  select * into g from public.ai_governance where id = 1;
  if g.id is null or not g.envoi_planifie then return 1000000; end if;
  select count(*) into n from public.ai_messages m
   where m.sens = 'sortant' and m.canal = 'whatsapp' and m.envoye_at is not null
     and (m.envoye_at at time zone 'Africa/Abidjan')::date = (p_ts at time zone 'Africa/Abidjan')::date;
  return greatest(0, g.envoi_plafond_wa_jour - n);
end $$;

-- Réservation des envois : rien hors fenêtre ; WhatsApp limité au reste du plafond du jour ; e-mail dans la fenêtre seulement
create or replace function public.ai_claim_outbox(p_limit integer default 20) returns table(id bigint, prospect_id uuid, canal text, contenu text, meta jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare lim int := greatest(1, least(coalesce(p_limit, 20), 100)); reste int;
begin
  if not public.ai_envoi_ouvert() then return; end if;
  reste := public.ai_envoi_restant_wa();
  return query
  with picked as (
    select m.id from public.ai_messages m
    where m.sens = 'sortant' and m.statut = 'a_envoyer'
      and (m.meta->>'claimed_at' is null or (m.meta->>'claimed_at')::timestamptz < now() - interval '10 minutes')
      and m.canal <> 'whatsapp'
    order by m.created_at for update skip locked limit lim
  )
  update public.ai_messages m set meta = coalesce(m.meta, '{}'::jsonb) || jsonb_build_object('claimed_at', now())
    from picked where m.id = picked.id returning m.id, m.prospect_id, m.canal, m.contenu, m.meta;
  if reste > 0 then
    return query
    with picked as (
      select m.id from public.ai_messages m
      where m.sens = 'sortant' and m.statut = 'a_envoyer'
        and (m.meta->>'claimed_at' is null or (m.meta->>'claimed_at')::timestamptz < now() - interval '10 minutes')
        and m.canal = 'whatsapp'
      order by m.created_at for update skip locked limit least(lim, reste)
    )
    update public.ai_messages m set meta = coalesce(m.meta, '{}'::jsonb) || jsonb_build_object('claimed_at', now())
      from picked where m.id = picked.id returning m.id, m.prospect_id, m.canal, m.contenu, m.meta;
  end if;
end $$;

-- Relances : en mode « autonome » (envoi direct sans validation) elles ne partent que dans la fenêtre ; en mode « validation », leur préparation n'est pas bloquée
-- (le message préparé attend de toute façon la validation puis le créneau).
create or replace function public.ai_claim_due_followups(p_limit integer default 10) returns table(id uuid, prospect_id uuid, scenario text, canal text, attempts integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.ai_governance;
begin
  select * into g from public.ai_governance where id = 1;
  if g.communication_externe = 'autonome' and not public.ai_envoi_ouvert() then return; end if;
  return query
  with picked as (
    select f.id from public.ai_followups f
    where f.statut = 'planifiee' and f.due_at <= now() and (f.locked_at is null or f.locked_at < now() - interval '30 minutes')
    order by f.due_at asc for update skip locked limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.ai_followups f set locked_at = now(), attempts = f.attempts + 1 from picked where f.id = picked.id
  returning f.id, f.prospect_id, f.scenario, f.canal, f.attempts;
end $$;

-- État de la planification (pour l'écran Gouvernance et pour Jarvis) : lecture réservée aux opérateurs
create or replace function public.ai_envoi_etat() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare g public.ai_governance; jour date := (now() at time zone 'Africa/Abidjan')::date;
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  select * into g from public.ai_governance where id = 1;
  return jsonb_build_object(
    'planifie', coalesce(g.envoi_planifie, false), 'jours', g.envoi_jours, 'debut', to_char(g.envoi_debut, 'HH24:MI'), 'fin', to_char(g.envoi_fin, 'HH24:MI'), 'plafond_wa_jour', g.envoi_plafond_wa_jour,
    'fenetre_ouverte', public.ai_envoi_ouvert(), 'prochain_creneau', public.ai_envoi_prochain(),
    'wa_envoyes_aujourdhui', (select count(*) from public.ai_messages m where m.sens = 'sortant' and m.canal = 'whatsapp' and m.envoye_at is not null and (m.envoye_at at time zone 'Africa/Abidjan')::date = jour),
    'wa_restants_aujourdhui', public.ai_envoi_restant_wa(),
    'a_valider', (select count(*) from public.ai_messages where sens = 'sortant' and statut = 'a_valider'),
    'en_file', (select count(*) from public.ai_messages where sens = 'sortant' and statut = 'a_envoyer'),
    'relances_planifiees', (select count(*) from public.ai_followups where statut = 'planifiee'));
end $$;

revoke all on function public.ai_envoi_ouvert(timestamptz), public.ai_envoi_prochain(timestamptz), public.ai_envoi_restant_wa(timestamptz) from public, anon;
grant execute on function public.ai_envoi_ouvert(timestamptz), public.ai_envoi_prochain(timestamptz), public.ai_envoi_restant_wa(timestamptz) to authenticated, service_role;
revoke all on function public.ai_envoi_etat() from public, anon; grant execute on function public.ai_envoi_etat() to authenticated, service_role;
revoke all on function public.ai_claim_outbox(integer), public.ai_claim_due_followups(integer) from public, anon, authenticated;
grant execute on function public.ai_claim_outbox(integer), public.ai_claim_due_followups(integer) to service_role;
