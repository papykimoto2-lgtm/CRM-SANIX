-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — Crédit de l'API Anthropic : solde estimé, recharges et données pour la comptabilité
--  L'API d'Anthropic ne donne pas le solde du crédit prépayé à une clé ordinaire : il est donc tenu ici, à partir de ce que la direction déclare
--  (une recharge, ou le solde lu dans la Console) et de la consommation réellement enregistrée par les agents (ai_actions.cout_usd).
--  1. ai_credit_api      : journal des recharges et des soldes constatés (direction seule, via les fonctions ci-dessous).
--  2. ai_credit_ajouter  : la direction déclare une recharge ou un solde constaté dans la Console.
--  3. ai_credit_status   : solde estimé = dernier solde constaté + recharges suivantes − consommation depuis ; rythme et jours restants.
--  4. ai_credit_compta   : recharges et consommation par mois, pour les écritures comptables du CRM (lecture seule, opérateurs).
--  Additif et relançable.
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.ai_credit_api (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  type        text not null check (type in ('recharge', 'solde_constate')),
  montant_usd numeric(12, 4) not null check (montant_usd >= 0),
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists ai_credit_api_at_idx on public.ai_credit_api (at);
alter table public.ai_credit_api enable row level security;
revoke all on public.ai_credit_api from public, anon, authenticated;

create or replace function public.ai_credit_ajouter(p_type text, p_montant numeric, p_date date default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_at timestamptz; v_id bigint;
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  if p_type not in ('recharge', 'solde_constate') then raise exception 'Type invalide (recharge ou solde_constate)' using errcode = '22023'; end if;
  if p_montant is null or p_montant < 0 or p_montant > 100000 then raise exception 'Montant invalide' using errcode = '22023'; end if;
  if p_type = 'recharge' and p_montant = 0 then raise exception 'Une recharge doit être supérieure à 0' using errcode = '22023'; end if;
  if p_date is not null and p_date > (now() at time zone 'Africa/Abidjan')::date then raise exception 'La date ne peut pas être dans le futur' using errcode = '22023'; end if;
  -- un solde constaté vaut « maintenant » ; une recharge garde sa date (midi, heure d'Abidjan) si elle est fournie
  v_at := case when p_type = 'recharge' and p_date is not null then (p_date::timestamp + interval '12 hours') at time zone 'Africa/Abidjan' else now() end;
  insert into public.ai_credit_api(at, type, montant_usd, note) values (v_at, p_type, round(p_montant, 4), nullif(left(btrim(coalesce(p_note, '')), 300), ''))
  returning id into v_id;
  insert into public.ai_actions(agent, action, payload)
  values ('direction', 'credit_api_' || p_type, jsonb_build_object('id', v_id, 'montant_usd', round(p_montant, 4), 'par', auth.uid()));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.ai_credit_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_base public.ai_credit_api; v_recharges numeric; v_depense numeric; v_solde numeric; v_7j numeric; v_rythme numeric; v_saisi boolean;
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  select exists (select 1 from public.ai_credit_api) into v_saisi;
  if not v_saisi then return jsonb_build_object('saisi', false); end if;
  select * into v_base from public.ai_credit_api where type = 'solde_constate' order by at desc, id desc limit 1;
  select coalesce(sum(montant_usd), 0) into v_recharges from public.ai_credit_api
   where type = 'recharge' and (v_base.id is null or at > v_base.at);
  select coalesce(sum(cout_usd), 0) into v_depense from public.ai_actions
   where action = 'llm_turn' and (v_base.id is null or at > v_base.at);
  v_solde := coalesce(v_base.montant_usd, 0) + v_recharges - v_depense;
  select coalesce(sum(cout_usd), 0) into v_7j from public.ai_actions where action = 'llm_turn' and at > now() - interval '7 days';
  v_rythme := v_7j / 7;
  return jsonb_build_object(
    'saisi', true,
    'solde_usd', round(v_solde, 2),
    'base_usd', v_base.montant_usd, 'base_at', v_base.at,
    'recharges_depuis_usd', round(v_recharges, 2),
    'depense_depuis_usd', round(v_depense, 4),
    'rythme_jour_usd', round(v_rythme, 2),
    'jours_restants', case when v_rythme > 0 and v_solde > 0 then floor(v_solde / v_rythme) end,
    'derniere_recharge', (select jsonb_build_object('at', at, 'montant_usd', montant_usd) from public.ai_credit_api where type = 'recharge' order by at desc, id desc limit 1),
    'recharges_total_usd', (select coalesce(round(sum(montant_usd), 2), 0) from public.ai_credit_api where type = 'recharge'),
    'depense_totale_usd', (select coalesce(round(sum(cout_usd), 2), 0) from public.ai_actions where action = 'llm_turn'));
end $$;

create or replace function public.ai_credit_compta(p_months integer default 12) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_from timestamptz := date_trunc('month', now() at time zone 'Africa/Abidjan') at time zone 'Africa/Abidjan' - make_interval(months => least(greatest(coalesce(p_months, 12), 1), 36) - 1);
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  return jsonb_build_object(
    'recharges', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'date', to_char(at at time zone 'Africa/Abidjan', 'YYYY-MM-DD'), 'montant_usd', montant_usd, 'note', note) order by at)
                             from public.ai_credit_api where type = 'recharge' and at >= v_from), '[]'::jsonb),
    'conso_mois', coalesce((select jsonb_agg(jsonb_build_object('mois', m, 'cout_usd', c) order by m)
                              from (select to_char(at at time zone 'Africa/Abidjan', 'YYYY-MM') m, round(sum(cout_usd), 4) c
                                      from public.ai_actions where action = 'llm_turn' and at >= v_from group by 1) t), '[]'::jsonb));
end $$;

revoke all on function public.ai_credit_ajouter(text, numeric, date, text), public.ai_credit_status(), public.ai_credit_compta(integer) from public, anon;
grant execute on function public.ai_credit_ajouter(text, numeric, date, text), public.ai_credit_status(), public.ai_credit_compta(integer) to authenticated;
