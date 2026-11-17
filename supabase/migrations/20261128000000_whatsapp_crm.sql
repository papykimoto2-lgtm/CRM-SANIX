-- WhatsApp Business (API officielle Meta) depuis le CRM : messages envoyés, réponses reçues, désinscriptions.
-- • crm_wa_messages : journal de chaque message envoyé par le CRM (qui, à qui, quand, modèle utilisé) et son état : envoyé → remis → lu, ou échec.
-- • crm_wa_inbound  : réponses reçues des prospects auxquels le CRM a écrit (le numéro WhatsApp de l'API n'a pas d'application : sans cela, personne ne les lirait).
-- • crm_wa_optout   : numéros qui ont demandé à ne plus être contactés (« STOP ») : le CRM n'écrit plus jamais à ces numéros.
-- Lecture réservée aux opérateurs ; écriture par les fonctions Edge uniquement (crm-whatsapp, whatsapp-webhook). Relançable.

create table if not exists public.crm_wa_messages (
  id               uuid primary key default gen_random_uuid(),
  client_rid       text,
  to_phone         text not null check (to_phone ~ '^[0-9]{8,15}$'),
  kind             text not null default 'template' check (kind in ('template', 'text')),
  template         text,
  body             text not null check (length(body) between 1 and 4096),
  sent_by          text,
  sent_by_user     uuid,
  consent_by       text,
  wa_message_id    text unique,
  status           text not null default 'envoye' check (status in ('envoye', 'remis', 'lu', 'echec')),
  error            text,
  sent_at          timestamptz not null default now(),
  delivered_at     timestamptz,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists crm_wa_messages_client_idx on public.crm_wa_messages (client_rid, sent_at desc);
create index if not exists crm_wa_messages_phone_idx  on public.crm_wa_messages (to_phone, sent_at desc);

create table if not exists public.crm_wa_inbound (
  id               uuid primary key default gen_random_uuid(),
  wa_message_id    text unique,
  from_phone       text not null check (from_phone ~ '^[0-9]{8,15}$'),
  client_rid       text,
  body             text not null check (length(body) <= 4000),
  kind             text not null default 'text',
  received_at      timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists crm_wa_inbound_client_idx on public.crm_wa_inbound (client_rid, received_at desc);
create index if not exists crm_wa_inbound_phone_idx  on public.crm_wa_inbound (from_phone, received_at desc);

create table if not exists public.crm_wa_optout (
  phone            text primary key check (phone ~ '^[0-9]{8,15}$'),
  since            timestamptz not null default now(),
  source           text
);

do $$ declare t text; begin
  foreach t in array array['crm_wa_messages', 'crm_wa_inbound', 'crm_wa_optout'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_lecture') then
      execute format('create policy %I on public.%I for select to authenticated using (public.ai_is_operator())', t || '_lecture', t);
    end if;
  end loop;
end $$;
