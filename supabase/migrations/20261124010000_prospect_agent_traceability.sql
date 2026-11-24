-- Fiabilise l'attribution des prospects créés par les agents en mode abonnement.
-- mission_id référence ai_missions (et non ai_agent_tasks) : on ne le renseigne pas ici.
-- La mission d'origine reste tracée dans ai_actions.task_id.
create or replace function public.ai_abonnement_creer_prospect(
  p_task uuid, p_entreprise text, p_secteur text, p_ville text, p_source_url text, p_produit text,
  p_commune text default null, p_telephone text default null, p_email text default null, p_site_web text default null,
  p_decideur text default null, p_decideur_fonction text default null, p_besoins jsonb default '[]'::jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare t public.ai_agent_tasks; a public.ai_agents; v_prod text; v_email text; v_id uuid; n int; v_besoins text[]; s text := public.ai_slug(p_produit);
begin
  select * into t from public.ai_agent_tasks where id = p_task for update;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' or a.etat <> 'actif' then raise exception 'L''agent n''est pas actif en mode abonnement'; end if;
  if t.statut <> 'en_cours' then raise exception 'La mission n''est pas en cours (statut : %)', t.statut; end if;
  if not ('create_prospect' = any(a.outils)) then raise exception 'Cet agent n''a pas l''outil create_prospect'; end if;
  if length(btrim(coalesce(p_entreprise, ''))) < 2 then raise exception 'Nom d''entreprise requis'; end if;
  if coalesce(p_source_url, '') !~* '^https://' then raise exception 'source_url https obligatoire (page où l''entreprise a été trouvée)'; end if;
  select count(*) into n from public.ai_actions where action = 'abonnement_prospect_cree' and task_id = t.id;
  if n >= 100 then return jsonb_build_object('info', 'Plafond de 100 prospects atteint pour cette mission : arrête et rapporte.'); end if;
  v_email := case when p_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then p_email else null end;
  select p.id into v_prod from public.ai_products p
   where p.actif and s <> '' and (public.ai_slug(p.id) = s or public.ai_slug(p.nom) = s
          or exists (select 1 from public.ai_product_aliases al where al.product_id = p.id and public.ai_slug(al.alias) = s))
   limit 1;
  if v_prod is null then
    raise exception 'Produit inconnu « % ». Logiciels actifs : %', left(coalesce(p_produit, ''), 60), (select string_agg(id || ' (' || nom || ')', ' ; ') from public.ai_products where actif);
  end if;
  v_besoins := coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(coalesce(p_besoins, 'null'::jsonb)) = 'array' then p_besoins else '[]'::jsonb end) limit 10), '{}');
  begin
    insert into public.ai_prospects(entreprise, secteur, ville, commune, telephone, email, site_web, decideur, decideur_fonction, besoins, produits_recommandes, source, source_url, stage, agent_id)
    values (left(btrim(p_entreprise), 200), p_secteur, p_ville, p_commune, p_telephone, v_email, p_site_web, p_decideur, p_decideur_fonction, v_besoins, array[v_prod], 'agent:' || a.code, p_source_url, 'enregistre', a.id)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('doublon', true, 'info', 'Déjà en base');
  end;
  insert into public.ai_actions(agent, action, agent_id, task_id, prospect_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_prospect_cree', a.id, t.id, v_id, jsonb_build_object('entreprise', left(p_entreprise, 120)), true, 0);
  return jsonb_build_object('ok', true, 'prospect_id', v_id, 'total', n + 1);
end $$;
