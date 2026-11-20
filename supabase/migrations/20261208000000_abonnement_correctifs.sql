-- Correctifs de la revue du mode « abonnement » (mêmes signatures que les versions précédentes : le prompt de la routine reste valable).
-- 1. Essais limités : une mission qui échoue en boucle est bloquée avec incident, comme dans le moteur.
-- 2. Clôture complète : rapport ou alerte au donneur d'ordre et au responsable, réponse au chat du président pour une instruction, activité et incidents de l'agent.
-- 3. Correction d'e-mail bornée : fiches avancées, désinscrites ou liées à un client refusées ; source https pour tout changement non trivial ; 40 changements par mission.
-- 4. Plafond de 100 prospects compté PAR MISSION (journal), plus par agent depuis la dernière réclamation.
-- 5. Reprise d'une exécution interrompue seulement après 6 h (au lieu de 3 h) : une exécution normale dure bien moins ; risque résiduel documenté.
-- 6. Résultat vérifiable : au moins un élément textuel de 10 caractères (texte, ou objet avec un champ « detail » d'au moins 10 caractères).
-- 7. Logiciel reconnu comme le moteur : sans accents, apostrophes ni espaces.
-- 8. Délégation : 10 dépendances au plus (dédoublonnées), 8 objectifs de 300 caractères au plus.

create or replace function public.ai_slug(p text) returns text language sql immutable set search_path = public as $$
  select regexp_replace(lower(translate(coalesce(p, ''), 'àâäáãéèêëíìîïóòôöõúùûüçñÀÂÄÁÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '[^a-z0-9]+', '', 'g')
$$;

-- 1 + 5 : réclamation
create or replace function public.ai_abonnement_reclamer(p_n int default 1) returns jsonb
language plpgsql set search_path = public as $$
declare g public.ai_governance; r record; got public.ai_agent_tasks; out jsonb := '[]'::jsonb; n int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('ai_claim_tasks'));
  select * into g from public.ai_governance where id = 1;
  if not coalesce(g.actif, true) then return out; end if;
  update public.ai_agent_tasks t set statut = 'a_faire',
         progression = left(coalesce(t.progression,'') || E'\n[Système] Exécution par abonnement interrompue, reprise.', 8000)
   where t.statut = 'en_cours' and t.started_at < now() - interval '6 hours'
     and exists (select 1 from public.ai_agents a where a.id = t.agent_id and a.mode_execution = 'abonnement');
  -- trop de tentatives ⇒ blocage + incident (comme ai_claim_tasks pour le mode API)
  for r in select t.id, t.agent_id, t.titre from public.ai_agent_tasks t join public.ai_agents a on a.id = t.agent_id
            where a.mode_execution = 'abonnement' and t.statut = 'a_faire' and t.executions - t.reprises >= g.max_executions_tache loop
    update public.ai_agent_tasks set statut = 'bloquee' where id = r.id;
    perform public.ai_register_incident(r.agent_id, r.id, 'tentatives_epuisees', 'attention',
      'Mission « ' || r.titre || ' » bloquée après ' || g.max_executions_tache || ' exécutions (mode abonnement)', true);
  end loop;
  for r in select t.id from public.ai_agent_tasks t join public.ai_agents a on a.id = t.agent_id
            where t.statut = 'a_faire' and a.etat = 'actif' and a.mode_execution = 'abonnement' and a.activite <> 'en_reunion'
              and not exists (select 1 from public.ai_task_dependencies d join public.ai_agent_tasks x on x.id = d.depend_de
                               where d.task_id = t.id and x.statut <> 'terminee')
            order by t.priorite, t.created_at loop
    exit when n >= greatest(1, least(p_n, 5));
    got := null;
    update public.ai_agent_tasks t set statut = 'en_cours', started_at = now(), executions = t.executions + 1
     where t.id = r.id and t.statut = 'a_faire'
       and not exists (select 1 from public.ai_agent_tasks y where y.agent_id = t.agent_id and y.statut = 'en_cours')
    returning t.* into got;
    if got.id is null then continue; end if;
    n := n + 1;
    out := out || jsonb_build_array(jsonb_build_object(
      'tache', jsonb_build_object('id', got.id, 'titre', got.titre, 'type', got.type, 'description', got.description, 'objectifs', got.objectifs,
                                 'entrees', got.entrees, 'priorite', got.priorite, 'echeance', got.echeance, 'progression', got.progression, 'executions', got.executions),
      'agent', (select jsonb_build_object('code', a.code, 'nom', a.nom, 'fonction', a.fonction, 'niveau', a.niveau, 'outils', a.outils, 'specialite', a.specialite, 'personnalite', a.personnalite)
                  from public.ai_agents a where a.id = got.agent_id),
      'charte', (select c.contenu from public.ai_agent_charters c where c.agent_id = got.agent_id order by c.version desc limit 1)));
    insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
      values ('abonnement', 'abonnement_reclamee', got.agent_id, got.id, jsonb_build_object('titre', got.titre), true, 0);
  end loop;
  return out;
end $$;

-- 2 + 6 : clôture
create or replace function public.ai_abonnement_cloturer(p_task uuid, p_statut text, p_rapport text, p_resultats jsonb default '[]'::jsonb, p_progression text default null)
returns jsonb language plpgsql set search_path = public as $$
declare t public.ai_agent_tasks; a public.ai_agents; ok boolean; preuve boolean := false; e jsonb;
begin
  if p_statut not in ('terminee', 'bloquee', 'echouee') then raise exception 'Statut refusé : terminee, bloquee ou echouee'; end if;
  select * into t from public.ai_agent_tasks where id = p_task for update;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' then raise exception 'Cet agent n''est pas en mode abonnement'; end if;
  if t.statut <> 'en_cours' then raise exception 'La mission n''est pas en cours (statut : %)', t.statut; end if;
  if coalesce(length(btrim(p_rapport)), 0) < 40 or length(p_rapport) > 20000 then raise exception 'Rapport factuel de 40 à 20000 caractères requis'; end if;
  if p_statut = 'terminee' then
    if jsonb_typeof(coalesce(p_resultats, 'null'::jsonb)) = 'array' then
      for e in select * from jsonb_array_elements(p_resultats) loop
        if (jsonb_typeof(e) = 'string' and length(btrim(e #>> '{}')) >= 10)
           or (jsonb_typeof(e) = 'object' and jsonb_typeof(e->'detail') = 'string' and length(btrim(e->>'detail')) >= 10) then preuve := true; end if;
      end loop;
    end if;
    if not preuve then raise exception 'Une mission terminée porte au moins un résultat vérifiable (texte ou objet avec « detail » d''au moins 10 caractères)'; end if;
  end if;
  ok := p_statut = 'terminee';
  update public.ai_agent_tasks set statut = p_statut, rapport = p_rapport, resultats = coalesce(p_resultats, '[]'::jsonb),
         progression = left(coalesce(nullif(p_progression, ''), progression), 8000), finished_at = now(), updated_at = now()
   where id = t.id;
  update public.ai_agents set incidents_consecutifs = case when ok then 0 else incidents_consecutifs end,
         activite = case when ok then 'mission_terminee' else 'en_difficulte' end, activite_depuis = now()
   where id = a.id and activite <> 'en_reunion';
  if t.donneur_agent_id is not null then
    insert into public.ai_agent_communications(de_agent_id, vers_agent_id, task_id, type, objet, contenu)
      values (a.id, t.donneur_agent_id, t.id, case when ok then 'rapport' else 'alerte' end,
              left((case when ok then 'Rapport : ' else 'Mission bloquée : ' end) || t.titre, 200), left(p_rapport, 8000));
  elsif t.type = 'instruction' then
    insert into public.ai_executive_messages(auteur, contenu, task_id) values ('directeur', left(p_rapport, 20000), t.id);
  end if;
  if not ok and a.manager_id is not null and a.manager_id is distinct from t.donneur_agent_id then
    insert into public.ai_agent_communications(de_agent_id, vers_agent_id, task_id, type, objet, contenu)
      values (a.id, a.manager_id, t.id, 'alerte', left('Mission bloquée : ' || t.titre, 200), left(p_rapport, 4000));
  end if;
  insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_cloturee', t.agent_id, t.id, jsonb_build_object('statut', p_statut, 'titre', t.titre), ok, 0);
  return jsonb_build_object('ok', true, 'statut', p_statut);
end $$;

-- 7 : création de prospects (logiciel reconnu comme le moteur, plafond par mission)
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
  select count(*) into n from public.ai_actions where action = 'abonnement_prospect_cree' and task_id = t.id;   -- plafond PAR MISSION, quelles que soient les reprises
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

-- 3 : correction d'e-mail bornée
create or replace function public.ai_abonnement_corriger_email(p_task uuid, p_prospect uuid, p_email text, p_motif text, p_source_url text default null)
returns jsonb language plpgsql set search_path = public as $$
declare t public.ai_agent_tasks; a public.ai_agents; p public.ai_prospects; v_new text := lower(btrim(coalesce(p_email, ''))); v_old text; n int;
        v_dom_old text; v_dom_new text; v_triv boolean := false;
  typos constant jsonb := '{"gmial.com":"gmail.com","gmai.com":"gmail.com","gmail.con":"gmail.com","gmail.co":"gmail.com","gmaill.com":"gmail.com","gamil.com":"gmail.com","hotmial.com":"hotmail.com","hotmail.con":"hotmail.com","hotmal.com":"hotmail.com","yahooo.com":"yahoo.com","yaho.com":"yahoo.com","yahoo.con":"yahoo.com","outlok.com":"outlook.com","outlook.con":"outlook.com"}';
begin
  select * into t from public.ai_agent_tasks where id = p_task for update;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' or a.etat <> 'actif' then raise exception 'L''agent n''est pas actif en mode abonnement'; end if;
  if t.statut <> 'en_cours' then raise exception 'La mission n''est pas en cours (statut : %)', t.statut; end if;
  if not ('update_prospect' = any(a.outils)) then raise exception 'Cet agent n''a pas l''outil update_prospect'; end if;
  if v_new !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_new) > 200 then raise exception 'Adresse invalide : rien n''est modifié'; end if;
  if length(btrim(coalesce(p_motif, ''))) < 15 then raise exception 'Motif précis requis (avant → après, pourquoi), 15 caractères au moins'; end if;
  select * into p from public.ai_prospects where id = p_prospect for update;
  if p.id is null then raise exception 'Prospect introuvable'; end if;
  if p.opt_out then raise exception 'Prospect désinscrit : fiche non modifiable'; end if;
  if p.crm_client_id is not null or p.stage in ('offre_acceptee','contrat_transmis','contrat_signe','paiement_attendu','paiement_confirme','marche_gagne','deploiement','client_fidelise') then
    raise exception 'Fiche liée à un client ou à un stade avancé (%) : non modifiable par la routine', p.stage;
  end if;
  v_old := p.email;
  if v_old is not distinct from v_new then return jsonb_build_object('info', 'Adresse déjà identique', 'prospect_id', p.id); end if;
  if v_old is not null then
    v_dom_old := lower(split_part(btrim(v_old), '@', 2)); v_dom_new := split_part(v_new, '@', 2);
    v_triv := lower(btrim(v_old)) = v_new or (lower(split_part(btrim(v_old), '@', 1)) = split_part(v_new, '@', 1) and typos->>v_dom_old = v_dom_new);   -- espaces/majuscules ou faute de domaine webmail évidente
  end if;
  if not v_triv and coalesce(p_source_url, '') !~* '^https://' then raise exception 'Changement non trivial : source_url https obligatoire (page publique qui confirme l''adresse)'; end if;
  select count(*) into n from public.ai_actions where action = 'abonnement_email_corrige' and task_id = t.id;
  if n >= 40 then raise exception 'Plafond de 40 corrections atteint pour cette mission : clôture et rapporte'; end if;
  begin
    update public.ai_prospects set email = v_new, updated_at = now() where id = p.id;
  exception when unique_violation then
    return jsonb_build_object('doublon', true, 'info', 'Cette adresse existe déjà sur une autre fiche : rien n''est modifié');
  end;
  insert into public.ai_actions(agent, action, agent_id, task_id, prospect_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_email_corrige', a.id, t.id, p.id, jsonb_build_object('avant', v_old, 'apres', v_new, 'motif', left(p_motif, 300), 'source', left(p_source_url, 300), 'trivial', v_triv), true, 0);
  return jsonb_build_object('ok', true, 'prospect_id', p.id, 'avant', v_old, 'apres', v_new);
end $$;

-- 8 : délégation
create or replace function public.ai_abonnement_assigner(
  p_parent uuid, p_agent_code text, p_titre text, p_description text, p_objectifs jsonb, p_priorite int,
  p_echeance_heures int default null, p_entrees text default null, p_depend_de uuid[] default '{}', p_produit text default null, p_resultat_attendu text default null)
returns jsonb language plpgsql set search_path = public as $$
declare par public.ai_agent_tasks; act public.ai_agents; tgt public.ai_agents; v_produit text; v_id uuid; d uuid; v_obj jsonb; v_deps uuid[];
begin
  select * into par from public.ai_agent_tasks where id = p_parent for update;
  if par.id is null then raise exception 'Mission mère introuvable'; end if;
  if par.statut <> 'en_cours' then raise exception 'La mission mère n''est pas en cours (statut : %)', par.statut; end if;
  select * into act from public.ai_agents where id = par.agent_id;
  if act.mode_execution <> 'abonnement' or act.etat <> 'actif' then raise exception 'L''agent de la mission mère n''est pas actif en mode abonnement'; end if;
  select * into tgt from public.ai_agents where code = p_agent_code;
  if tgt.id is null then raise exception 'Agent « % » introuvable', left(coalesce(p_agent_code, ''), 60); end if;
  if tgt.niveau <= 1 or tgt.id = act.id or not exists (
       with recursive d as (select id from public.ai_agents where manager_id = act.id union select a.id from public.ai_agents a join d on a.manager_id = d.id)
       select 1 from d where d.id = tgt.id) then
    raise exception 'Autorité insuffisante : % n''est pas un subordonné de %', tgt.nom, act.nom;
  end if;
  if tgt.etat <> 'actif' then raise exception '% n''est pas actif (%)', tgt.nom, tgt.etat; end if;
  if length(btrim(coalesce(p_titre, ''))) < 3 or length(btrim(coalesce(p_description, ''))) < 3 then raise exception 'Titre et description requis'; end if;
  v_obj := coalesce((select jsonb_agg(left(btrim(x), 300)) from (select jsonb_array_elements_text(case when jsonb_typeof(coalesce(p_objectifs, 'null'::jsonb)) = 'array' then p_objectifs else '[]'::jsonb end) x limit 8) q where btrim(x) <> ''), '[]'::jsonb);
  v_deps := coalesce(array(select distinct x from unnest(coalesce(p_depend_de, '{}')) x limit 10), '{}');
  foreach d in array v_deps loop
    if not exists (select 1 from public.ai_agent_tasks where id = d and parent_id = p_parent) then
      raise exception 'depend_de : uniquement des missions créées dans la mission mère';
    end if;
  end loop;
  v_produit := par.produit;
  if nullif(btrim(coalesce(p_produit, '')), '') is not null then
    select id into v_produit from public.ai_products where public.ai_slug(id) = public.ai_slug(p_produit) and actif;
    if v_produit is null then raise exception 'Logiciel hors périmètre commercial actuel : seuls les logiciels actifs du catalogue sont autorisés'; end if;
  end if;
  begin
    insert into public.ai_agent_tasks(produit, resultat_attendu, parent_id, agent_id, donneur_agent_id, type, titre, description, objectifs, entrees, priorite, echeance)
    values (v_produit, nullif(left(btrim(coalesce(p_resultat_attendu, '')), 1000), ''), p_parent, tgt.id, act.id, case when act.niveau <= 3 then 'mission' else 'tache' end,
            left(btrim(p_titre), 200), left(btrim(p_description), 8000), v_obj, left(p_entrees, 20000), greatest(1, least(coalesce(p_priorite, 3), 5)),
            case when p_echeance_heures is not null then now() + make_interval(hours => greatest(1, least(p_echeance_heures, 2160))) end)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Une mission identique est déjà ouverte pour cet agent : ne la recrée pas';
  end;
  foreach d in array v_deps loop insert into public.ai_task_dependencies(task_id, depend_de) values (v_id, d); end loop;
  insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_assignation', act.id, par.id, jsonb_build_object('vers', tgt.code, 'sous_mission', v_id, 'titre', left(p_titre, 120)), true, 0);
  return jsonb_build_object('task_id', v_id, 'agent', tgt.code, 'statut', 'a_faire');
end $$;

revoke all on function public.ai_slug(text) from public, anon, authenticated;
grant execute on function public.ai_slug(text) to service_role;
