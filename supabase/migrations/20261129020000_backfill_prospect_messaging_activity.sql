-- Backfill de la qualification à partir des échanges déjà journalisés.
-- Ne modifie une fiche que si le lien CRM / e-mail / téléphone identifie exactement un prospect.
-- Aucun contenu de message n'est copié et aucune étape commerciale avancée n'est rétrogradée.

with mail_candidates as (
  select m.id as message_id, p.id as prospect_id, m.sent_at, m.replied_at
  from public.crm_mails m
  join public.ai_prospects p
    on (m.client_rid is not null and p.crm_rid = m.client_rid)
    or (m.to_email is not null and lower(trim(p.email)) = lower(trim(m.to_email)))
  where m.status <> 'echec'
),
mail_unique as (
  select message_id, (array_agg(prospect_id))[1] as prospect_id,
         max(sent_at) as last_outbound_at, max(replied_at) as last_inbound_at
  from mail_candidates
  group by message_id
  having count(distinct prospect_id) = 1
),
mail_activity as (
  select prospect_id, max(last_outbound_at) as last_outbound_at,
         max(last_inbound_at) as last_inbound_at
  from mail_unique
  group by prospect_id
),
wa_out_candidates as (
  select w.id as message_id, p.id as prospect_id, w.sent_at
  from public.crm_wa_messages w
  join public.ai_prospects p
    on (w.client_rid is not null and p.crm_rid = w.client_rid)
    or (w.to_phone is not null and p.phone_norm = w.to_phone)
  where w.status <> 'echec'
),
wa_out_unique as (
  select message_id, (array_agg(prospect_id))[1] as prospect_id, max(sent_at) as last_outbound_at
  from wa_out_candidates
  group by message_id
  having count(distinct prospect_id) = 1
),
wa_out_activity as (
  select prospect_id, max(last_outbound_at) as last_outbound_at,
         null::timestamptz as last_inbound_at
  from wa_out_unique
  group by prospect_id
),
wa_in_candidates as (
  select i.id as message_id, p.id as prospect_id, i.received_at
  from public.crm_wa_inbound i
  join public.ai_prospects p
    on (i.client_rid is not null and p.crm_rid = i.client_rid)
    or (i.from_phone is not null and p.phone_norm = i.from_phone)
),
wa_in_unique as (
  select message_id, (array_agg(prospect_id))[1] as prospect_id, max(received_at) as last_inbound_at
  from wa_in_candidates
  group by message_id
  having count(distinct prospect_id) = 1
),
wa_in_activity as (
  select prospect_id, null::timestamptz as last_outbound_at,
         max(last_inbound_at) as last_inbound_at
  from wa_in_unique
  group by prospect_id
),
activity as (
  select prospect_id, max(last_outbound_at) as last_outbound_at,
         max(last_inbound_at) as last_inbound_at
  from (
    select * from mail_activity
    union all select * from wa_out_activity
    union all select * from wa_in_activity
  ) x
  group by prospect_id
),
optout_candidates as (
  select o.phone, p.id as prospect_id, o.since
  from public.crm_wa_optout o
  join public.ai_prospects p on p.phone_norm = o.phone
),
optout_unique as (
  select phone, (array_agg(prospect_id))[1] as prospect_id, max(since) as opt_out_at
  from optout_candidates
  group by phone
  having count(distinct prospect_id) = 1
)
update public.ai_prospects p
set last_outbound_at = case
      when a.last_outbound_at is not null
        then greatest(coalesce(p.last_outbound_at, a.last_outbound_at), a.last_outbound_at)
      else p.last_outbound_at
    end,
    last_inbound_at = case
      when a.last_inbound_at is not null
        then greatest(coalesce(p.last_inbound_at, a.last_inbound_at), a.last_inbound_at)
      else p.last_inbound_at
    end,
    relances_sans_reponse = case
      when a.last_inbound_at is not null then 0
      else p.relances_sans_reponse
    end,
    stage = case
      when a.last_inbound_at is not null
        and p.stage in ('identifie', 'enregistre', 'qualifie', 'premier_contact')
        then 'conversation'
      when a.last_outbound_at is not null
        and p.stage in ('identifie', 'enregistre', 'qualifie')
        then 'premier_contact'
      else p.stage
    end,
    opt_out = case when o.prospect_id is not null then true else p.opt_out end,
    opt_out_at = case
      when o.prospect_id is not null then greatest(coalesce(p.opt_out_at, o.opt_out_at), o.opt_out_at)
      else p.opt_out_at
    end
from (select * from activity) a
full join optout_unique o on o.prospect_id = a.prospect_id
where p.id = coalesce(a.prospect_id, o.prospect_id);
