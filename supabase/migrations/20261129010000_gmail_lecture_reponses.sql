-- Gmail : lecture du texte des réponses des prospects.
-- • crm_mail_replies : le texte de chaque réponse reçue à un e-mail envoyé par le CRM (citations de l'historique retirées).
--   Seuls les fils ouverts par le CRM sont lus, jamais le reste de la boîte. Lecture réservée aux opérateurs ; écriture par la fonction Edge crm-gmail.
-- • crm_mail_state() indique aussi si l'accès Gmail accordé permet cette lecture (sinon : reconnecter Gmail une fois).
-- Relançable.

create table if not exists public.crm_mail_replies (
  id               uuid primary key default gen_random_uuid(),
  mail_id          uuid not null references public.crm_mails(id) on delete cascade,
  gmail_message_id text not null unique,
  from_email       text,
  received_at      timestamptz not null,
  body             text not null check (length(body) <= 20000),
  created_at       timestamptz not null default now()
);
create index if not exists crm_mail_replies_mail_idx on public.crm_mail_replies (mail_id, received_at);
alter table public.crm_mail_replies enable row level security;
revoke all on table public.crm_mail_replies from anon, authenticated;
grant select on table public.crm_mail_replies to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_mail_replies' and policyname = 'crm_mail_replies_lecture') then
    create policy crm_mail_replies_lecture on public.crm_mail_replies for select to authenticated using (public.ai_is_operator());
  end if;
end $$;

create or replace function public.crm_mail_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.ai_is_operator() then jsonb_build_object('erreur', 'accès refusé')
              else coalesce((select jsonb_build_object('connecte', status = 'connecte', 'email', email, 'status', status, 'erreur', last_error, 'depuis', connected_at,
                                                       'lecture_reponses', coalesce(scopes, '') like '%gmail.readonly%') from public.crm_mail_account where id = 1),
                            jsonb_build_object('connecte', false)) end
$$;
revoke all on function public.crm_mail_state() from public, anon;
grant execute on function public.crm_mail_state() to authenticated;
