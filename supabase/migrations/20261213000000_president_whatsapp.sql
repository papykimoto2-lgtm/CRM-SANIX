-- WhatsApp du président ⇄ directeur général IA.
-- Le numéro du président (un seul, singleton) est enregistré ici. Un message WhatsApp reçu de CE numéro (authentifié par la signature Meta du webhook)
-- devient une instruction au directeur général IA, comme dans le bureau exécutif ; ses réponses (repondre_president) sont renvoyées sur WhatsApp.
-- Fenêtre WhatsApp de 24 h : une réponse n'est envoyée que si le président a écrit depuis moins de 23 h ; sinon elle reste dans le bureau (« hors_fenetre »)
-- et part dès le prochain message du président.
create table if not exists public.ai_president_whatsapp (
  id int primary key default 1 check (id = 1),
  numero text not null check (numero ~ '^[0-9]{8,15}$'),
  actif boolean not null default true,
  user_id uuid references auth.users(id) on delete set null,
  last_inbound_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.ai_president_whatsapp enable row level security;
drop policy if exists dir_read on public.ai_president_whatsapp;
create policy dir_read on public.ai_president_whatsapp for select using (public.ai_is_direction());
revoke all on public.ai_president_whatsapp from anon, authenticated;
grant select on public.ai_president_whatsapp to authenticated;

alter table public.ai_executive_messages add column if not exists canal text not null default 'bureau' check (canal in ('bureau', 'whatsapp'));
alter table public.ai_executive_messages add column if not exists wamid text;
alter table public.ai_executive_messages add column if not exists wa_statut text check (wa_statut in ('en_attente', 'envoi', 'envoye', 'echec', 'hors_fenetre'));
alter table public.ai_executive_messages add column if not exists wa_detail text;
create unique index if not exists ai_exec_wamid_uq on public.ai_executive_messages(wamid) where wamid is not null;
create index if not exists ai_exec_wa_pending on public.ai_executive_messages(id) where wa_statut in ('en_attente', 'hors_fenetre');

-- Un message du directeur est mis en file WhatsApp quand le président a écrit par WhatsApp il y a moins de 23 h ; sinon (WhatsApp actif mais fenêtre fermée) « hors_fenetre ».
create or replace function public.ai_exec_wa_queue() returns trigger language plpgsql set search_path = public as $$
declare w public.ai_president_whatsapp;
begin
  if new.auteur <> 'directeur' or new.wa_statut is not null then return new; end if;
  select * into w from public.ai_president_whatsapp where id = 1 and actif;
  if w.id is null or w.last_inbound_at is null then return new; end if;
  new.wa_statut := case when w.last_inbound_at > now() - interval '23 hours' then 'en_attente' else 'hors_fenetre' end;
  return new;
end $$;
drop trigger if exists ai_exec_wa_queue_trg on public.ai_executive_messages;
create trigger ai_exec_wa_queue_trg before insert on public.ai_executive_messages for each row execute function public.ai_exec_wa_queue();

-- Réglage par la direction (numéro international sans + ni espaces, ex. 2250700000000).
create or replace function public.ai_president_whatsapp_set(p_numero text, p_actif boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n text := regexp_replace(coalesce(p_numero, ''), '\D', '', 'g');
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  if n !~ '^[0-9]{8,15}$' then raise exception 'Numéro invalide : format international, 8 à 15 chiffres (ex. 2250700000000)'; end if;
  insert into public.ai_president_whatsapp(id, numero, actif, user_id) values (1, n, coalesce(p_actif, true), auth.uid())
  on conflict (id) do update set numero = excluded.numero, actif = excluded.actif, user_id = auth.uid(), updated_at = now(),
    last_inbound_at = case when public.ai_president_whatsapp.numero = excluded.numero then public.ai_president_whatsapp.last_inbound_at else null end;
  return jsonb_build_object('ok', true, 'numero_fin', right(n, 4), 'actif', coalesce(p_actif, true));
end $$;
revoke all on function public.ai_president_whatsapp_set(text, boolean) from public, anon;
grant execute on function public.ai_president_whatsapp_set(text, boolean) to authenticated;
