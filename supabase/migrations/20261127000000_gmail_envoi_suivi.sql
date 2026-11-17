-- Envoi d'e-mails depuis le CRM par le Gmail de l'entreprise, et suivi des réponses.
-- • crm_mail_account : UN compte Gmail connecté (OAuth). Le jeton de renouvellement y est stocké CHIFFRÉ (AES-GCM, clé en secret Edge) ;
--   aucune politique d'accès : seul le service (fonction Edge crm-gmail) le lit. Jamais visible depuis le navigateur.
-- • crm_mails : journal de chaque e-mail envoyé (qui, à qui, quand), statut envoyé / répondu / échec, délai de relance.
--   Lecture réservée aux opérateurs ; écriture par la fonction Edge uniquement.
-- Relançable.

create table if not exists public.crm_mail_account (
  id           smallint primary key default 1 check (id = 1),
  email        text not null,
  token_enc    text not null,
  scopes       text,
  status       text not null default 'connecte' check (status in ('connecte', 'erreur')),
  last_error   text,
  connected_by uuid,
  connected_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.crm_mail_account enable row level security;
revoke all on table public.crm_mail_account from anon, authenticated;

create table if not exists public.crm_mails (
  id                  uuid primary key default gen_random_uuid(),
  client_rid          text,
  to_email            text not null check (to_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  subject             text not null check (length(subject) between 1 and 300),
  body                text not null check (length(body) between 1 and 20000),
  sent_by             text,
  sent_by_user        uuid,
  gmail_message_id    text,
  gmail_thread_id     text,
  status              text not null default 'envoye' check (status in ('envoye', 'repondu', 'echec')),
  error               text,
  sent_at             timestamptz not null default now(),
  replied_at          timestamptz,
  reply_from          text,
  relance_apres_jours smallint not null default 4 check (relance_apres_jours between 1 and 60),
  last_checked_at     timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists crm_mails_client_idx on public.crm_mails (client_rid, sent_at desc);
create index if not exists crm_mails_suivi_idx on public.crm_mails (status, sent_at) where status = 'envoye';
alter table public.crm_mails enable row level security;
revoke all on table public.crm_mails from anon, authenticated;
grant select on table public.crm_mails to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_mails' and policyname = 'crm_mails_lecture') then
    create policy crm_mails_lecture on public.crm_mails for select to authenticated using (public.ai_is_operator());
  end if;
end $$;

-- État de la connexion Gmail pour l'écran (sans aucun jeton).
create or replace function public.crm_mail_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.ai_is_operator() then jsonb_build_object('erreur', 'accès refusé')
              else coalesce((select jsonb_build_object('connecte', status = 'connecte', 'email', email, 'status', status, 'erreur', last_error, 'depuis', connected_at) from public.crm_mail_account where id = 1),
                            jsonb_build_object('connecte', false)) end
$$;
revoke all on function public.crm_mail_state() from public, anon;
grant execute on function public.crm_mail_state() to authenticated;

-- E-mails à relancer : envoyés, sans réponse, délai de relance dépassé (utilisé par « À faire aujourd'hui »).
create or replace function public.crm_mails_a_relancer() returns setof public.crm_mails
language sql stable security definer set search_path = public as $$
  select * from public.crm_mails
   where public.ai_is_operator() and status = 'envoye' and sent_at < now() - make_interval(days => relance_apres_jours) and sent_at > now() - interval '45 days'
   order by sent_at
$$;
revoke all on function public.crm_mails_a_relancer() from public, anon;
grant execute on function public.crm_mails_a_relancer() to authenticated;
