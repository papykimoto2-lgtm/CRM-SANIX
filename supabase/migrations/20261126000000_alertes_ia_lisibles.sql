-- Alertes IA lisibles dans l'historique des fiches.
-- Avant : un agent qui échouait (crédit Anthropic épuisé…) écrivait dans la fiche le JSON brut de l'API, une fois par tentative (3 fois en 2 minutes sur une même fiche).
-- Après : une phrase claire, et la même alerte n'est pas répétée dans les 24 heures sur la même fiche. Les alertes déjà présentes sont nettoyées. Relançable.

create or replace function public.crm_alert_lisible(p text) returns text
language sql immutable as $$
  select case
    when p ~* 'credit balance is too low' then 'Crédit Anthropic insuffisant : rechargez le compte (Plans & Billing). L''agent IA n''a pas pu travailler.'
    when p ~* 'error' and p ~* '(rate.?limit|\m429\M)' then 'Limite de requêtes Anthropic atteinte : nouvelle tentative plus tard.'
    when p ~* 'error' and p ~* '(overloaded|\m529\M)' then 'Service Anthropic surchargé : nouvelle tentative plus tard.'
    when p ~* 'error' and p ~* '(authentication_error|invalid x-api-key|\m401\M)' then 'Clé API Anthropic invalide ou expirée : à remplacer.'
    when p ~ '^\s*\d{3}\s*\{' and p ~ '[“”"]message[“”"]\s*:\s*[“”"][^“”"]{3,}' then substring(p from '[“”"]message[“”"]\s*:\s*[“”"]([^“”"]{3,240})')
    else p
  end
$$;

create or replace function public.crm_h_alert(ev public.crm_ai_events) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p public.ai_prospects; v_rid text; v_msg text := public.crm_alert_lisible(coalesce(ev.payload->>'message', 'Anomalie signalée par un agent'));
        v_type text := 'Alerte IA (' || coalesce(ev.payload->>'niveau', 'attention') || ')'; v_deja boolean := false;
begin
  if ev.prospect_id is null then return jsonb_build_object('alert', true, 'client_rid', null); end if;
  select * into p from public.ai_prospects where id = ev.prospect_id;
  if p.id is null then return jsonb_build_object('alert', true, 'client_rid', null); end if;
  v_rid := public.crm_ensure_client(p);
  -- même alerte déjà inscrite dans les dernières 24 heures sur cette fiche : on ne la répète pas
  select exists (select 1 from public.crm_records r, jsonb_array_elements(case when jsonb_typeof(r.data->'interactions') = 'array' then r.data->'interactions' else '[]'::jsonb end) i
                 where r.entity = 'clients' and r.rid = v_rid and i->>'type' = v_type and i->>'note' = v_msg
                   and coalesce(nullif(i->>'date', '')::timestamptz, now() - interval '2 days') > ev.created_at - interval '24 hours') into v_deja;
  if v_deja then return jsonb_build_object('alert', true, 'client_rid', v_rid, 'doublon', true); end if;
  perform public.crm_put('clients', v_rid,
    jsonb_build_object('interactions', jsonb_build_array(public.crm_interaction(v_type, v_msg, null, ev.created_at, ev.id)),
                       'ia', jsonb_build_object('alerte', jsonb_build_object('niveau', coalesce(ev.payload->>'niveau', 'attention'), 'message', left(v_msg, 400), 'at', ev.created_at))),
    'ia', 'ia:' || ev.type, false, null, null, false);
  return jsonb_build_object('alert', true, 'client_rid', v_rid);
end $$;

-- Nettoyage des alertes déjà inscrites : texte lisible, et une seule ligne par alerte identique.
do $$
declare r record; v_new jsonb;
begin
  for r in select rid, data from public.crm_records where entity = 'clients' and deleted_at is null and jsonb_typeof(data->'interactions') = 'array'
           and exists (select 1 from jsonb_array_elements(data->'interactions') i where i->>'type' like 'Alerte IA%' and i->>'note' is distinct from public.crm_alert_lisible(i->>'note'))
  loop
    select coalesce(jsonb_agg(e.i order by e.n), '[]'::jsonb) into v_new from (
      select i || case when i->>'type' like 'Alerte IA%' then jsonb_build_object('note', public.crm_alert_lisible(i->>'note')) else '{}'::jsonb end as i, n,
             row_number() over (partition by case when i->>'type' like 'Alerte IA%' then (i->>'type') || '|' || public.crm_alert_lisible(i->>'note') else n::text end order by n) rn
      from jsonb_array_elements(r.data->'interactions') with ordinality as t(i, n)) e where e.rn = 1;
    update public.crm_records set data = jsonb_set(data, '{interactions}', v_new), updated_by = 'nettoyage alertes IA' where entity = 'clients' and rid = r.rid;
  end loop;
end $$;

-- Le résumé « dernière alerte » de la fiche reprenait aussi le message brut.
update public.crm_records set data = jsonb_set(data, '{ia,alerte,message}', to_jsonb(public.crm_alert_lisible(data->'ia'->'alerte'->>'message'))), updated_by = 'nettoyage alertes IA'
 where entity = 'clients' and deleted_at is null and data->'ia'->'alerte'->>'message' is not null
   and data->'ia'->'alerte'->>'message' is distinct from public.crm_alert_lisible(data->'ia'->'alerte'->>'message');
