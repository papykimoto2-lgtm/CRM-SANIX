-- Création de prospects par les agents « chasseurs » exécutés en mode « abonnement » (routine Claude Code).
-- Mêmes règles que le moteur (crm_tools.ts : create_prospect) : l'agent doit avoir l'outil create_prospect, mission en cours,
-- e-mail valide ou vide, logiciel du catalogue actif, plafond de 100 fiches par mission, doublons refusés (index uniques e-mail / téléphone),
-- étape « enregistre », source « agent:<code> ». Seule écriture CRM de la routine. Réservée au service.
create or replace function public.ai_abonnement_creer_prospect(
  p_task uuid, p_entreprise text, p_secteur text, p_ville text, p_source_url text, p_produit text,
  p_commune text default null, p_telephone text default null, p_email text default null, p_site_web text default null,
  p_decideur text default null, p_decideur_fonction text default null, p_besoins jsonb default '[]'::jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare t public.ai_agent_tasks; a public.ai_agents; v_prod text; v_email text; v_id uuid; n int; v_besoins text[];
begin
  select * into t from public.ai_agent_tasks where id = p_task for update;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' or a.etat <> 'actif' then raise exception 'L''agent n''est pas actif en mode abonnement'; end if;
  if t.statut <> 'en_cours' then raise exception 'La mission n''est pas en cours (statut : %)', t.statut; end if;
  if not ('create_prospect' = any(a.outils)) then raise exception 'Cet agent n''a pas l''outil create_prospect'; end if;
  if length(btrim(coalesce(p_entreprise, ''))) < 2 then raise exception 'Nom d''entreprise requis'; end if;
  if coalesce(p_source_url, '') !~* '^https://' then raise exception 'source_url https obligatoire (page où l''entreprise a été trouvée)'; end if;
  select count(*) into n from public.ai_prospects where source = 'agent:' || a.code and created_at >= coalesce(t.started_at, t.created_at);
  if n >= 100 then return jsonb_build_object('info', 'Plafond de 100 prospects atteint pour cette mission : arrête et rapporte.'); end if;
  v_email := case when p_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then p_email else null end;
  select p.id into v_prod from public.ai_products p
   where p.actif and (lower(p.id) = lower(btrim(coalesce(p_produit, ''))) or lower(p.nom) = lower(btrim(coalesce(p_produit, '')))
          or exists (select 1 from public.ai_product_aliases al where al.product_id = p.id and lower(al.alias) = lower(btrim(coalesce(p_produit, '')))))
   limit 1;
  if v_prod is null then
    raise exception 'Produit inconnu « % ». Logiciels actifs : %', left(coalesce(p_produit, ''), 60), (select string_agg(id || ' (' || nom || ')', ' ; ') from public.ai_products where actif);
  end if;
  v_besoins := coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(coalesce(p_besoins, 'null'::jsonb)) = 'array' then p_besoins else '[]'::jsonb end) limit 10), '{}');
  begin
    insert into public.ai_prospects(entreprise, secteur, ville, commune, telephone, email, site_web, decideur, decideur_fonction, besoins, produits_recommandes, source, source_url, stage, mission_id)
    values (left(btrim(p_entreprise), 200), p_secteur, p_ville, p_commune, p_telephone, v_email, p_site_web, p_decideur, p_decideur_fonction, v_besoins, array[v_prod], 'agent:' || a.code, p_source_url, 'enregistre', null)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('doublon', true, 'info', 'Déjà en base');
  end;
  insert into public.ai_actions(agent, action, agent_id, task_id, prospect_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_prospect_cree', a.id, t.id, v_id, jsonb_build_object('entreprise', left(p_entreprise, 120)), true, 0);
  return jsonb_build_object('ok', true, 'prospect_id', v_id, 'total', n + 1);
end $$;

revoke all on function public.ai_abonnement_creer_prospect(uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ai_abonnement_creer_prospect(uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb) to service_role;
