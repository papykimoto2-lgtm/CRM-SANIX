-- Réorganisation décidée par le président le 27/11/2026 : 26 -> 14 agents.
-- Archivés (rôle repris par) : ia_dir_admin (directeur commercial), ia_dir_intel / ia_dir_marketing / ia_veille / ia_content / ia_social
-- (marketing et veille : ia_market), ia_dir_client (ia_success), ia_sup_immo / ia_sup_sante / ia_sup_distribution (responsable prospection),
-- ia_mail_1 (prise de contact multicanal : ia_wa_1), ia_docs (négociation, offres et documents : ia_nego_1).
-- Rien n'est supprimé : mémoires, prospects suivis, cellules, départements, routage CRM et propriétaires d'étapes sont transférés ;
-- l'historique des missions des agents archivés est conservé.

do $$
declare
  repl jsonb := jsonb_build_object(
    'ia_dir_admin', 'sanix_ai_sales_director', 'ia_dir_intel', 'ia_market', 'ia_dir_marketing', 'ia_market',
    'ia_dir_client', 'ia_success', 'ia_sup_immo', 'ia_resp_prospection', 'ia_sup_sante', 'ia_resp_prospection',
    'ia_sup_distribution', 'ia_resp_prospection', 'ia_mail_1', 'ia_wa_1', 'ia_veille', 'ia_market',
    'ia_content', 'ia_market', 'ia_social', 'ia_market', 'ia_docs', 'ia_nego_1');
  k text; v_old uuid; v_new uuid;
  v_resp uuid := (select id from public.ai_agents where code = 'ia_resp_prospection');
  v_dc uuid := (select id from public.ai_agents where code = 'sanix_ai_sales_director');
begin
  -- 1. hiérarchie aplatie
  update public.ai_agents set manager_id = v_resp, updated_at = now()
   where code in ('ia_hunter_1', 'ia_hunter_2', 'ia_hunter_3', 'ia_enrich_1', 'ia_qualif_1');
  update public.ai_agents set manager_id = v_dc, updated_at = now()
   where code in ('ia_resp_prospection', 'ia_wa_1', 'ia_rdv_1', 'ia_nego_1', 'ia_success', 'ia_market');

  -- 2. routage des événements CRM et propriétaires d'étapes
  update public.crm_ai_routing set agent_code = 'ia_nego_1', role_code = 'negotiation_manager' where agent_code = 'ia_docs';
  update public.crm_ai_routing set agent_code = 'sanix_ai_sales_director', role_code = 'directeur_commercial' where agent_code = 'ia_dir_admin';
  update public.crm_ai_stage_owner set agent_code = 'ia_wa_1' where agent_code = 'ia_mail_1';
  update public.crm_ai_stage_owner set agent_code = 'ia_nego_1', role_code = 'negotiation_manager' where agent_code = 'ia_docs';
  update public.crm_ai_stage_owner set agent_code = 'sanix_ai_sales_director', role_code = 'directeur_commercial' where agent_code = 'ia_dir_admin';

  -- 3. missions de qualification ouvertes des agents archivés : couvertes par la qualification automatique par lots
  update public.ai_agent_tasks t set statut = 'annulee',
         progression = left(coalesce(t.progression, '') || E'\n[Système] Annulée : réorganisation, couverte par la qualification automatique par lots.', 8000)
   where t.statut in ('a_faire', 'attente_validation', 'bloquee') and t.titre ilike '%qualif%'
     and t.agent_id in (select id from public.ai_agents where code in (select jsonb_object_keys(repl)));

  -- 4. transferts puis archivage
  for k in select jsonb_object_keys(repl) loop
    select id into v_old from public.ai_agents where code = k and archived_at is null;
    select id into v_new from public.ai_agents where code = repl ->> k;
    continue when v_old is null or v_new is null;
    update public.ai_agent_memory set agent_id = v_new where agent_id = v_old;
    update public.ai_prospects set agent_id = v_new where agent_id = v_old;
    begin
      update public.ai_agent_tasks set agent_id = v_new where agent_id = v_old and statut in ('a_faire', 'attente_validation');
    exception when others then null;   -- gouvernance (agent chargé) : la mission sera annulée par l'archivage
    end;
    delete from public.ai_cell_members m where m.agent_id = v_old;
    update public.ai_cells set responsable_agent_id = v_new where responsable_agent_id = v_old;
    update public.ai_departments set responsable_id = v_new where responsable_id = v_old;
    delete from public.ai_bascule_modes where agent_id = v_old;
    perform public.ai_agent_change_etat(v_old, 'archive', 'Réorganisation 26 -> 14 agents : rôle repris par ' || (repl ->> k), 'president');
    update public.ai_agents set archived_at = now() where id = v_old;
  end loop;

  -- 5. périmètres élargis
  update public.ai_agents set fonction = 'Prise de contact multicanal (WhatsApp et e-mail)',
         specialite = 'Premier contact, relances et réponses sur WhatsApp et par e-mail, préparés pour la validation du président',
         outils = (select array_agg(distinct x order by x) from unnest(outils || array['verifier_adresse']) x), updated_at = now()
   where code = 'ia_wa_1';
  update public.ai_agents set fonction = 'Marketing, veille et études de marché',
         specialite = 'Études de marché sourcées, veille concurrentielle, contenus et réseaux sociaux au service de la prospection', updated_at = now()
   where code = 'ia_market';
  update public.ai_agents set fonction = 'Négociation, offres et documents commerciaux',
         specialite = 'Découverte, objections, offres sur la grille officielle, contrats et documents de commande', updated_at = now()
   where code = 'ia_nego_1';
  update public.ai_agents set fonction = 'Succès client et relation client',
         specialite = 'Suivi des clients, satisfaction, renouvellements et ventes additionnelles', updated_at = now()
   where code = 'ia_success';
  update public.ai_agents set specialite = 'Pilotage commercial : prospection, conversion, relation client, marketing, partenariats et suivi des encaissements', updated_at = now()
   where code = 'sanix_ai_sales_director';
  update public.ai_agents set fonction = 'Chasseur immobilier, BTP, menuiserie aluminium et garages',
         specialite = 'ImmoSuite, AluExpert et AutoGarage Pro : promoteurs, agences, menuiseries, garages ; fiches vérifiées sur page lue', updated_at = now()
   where code = 'ia_hunter_1';
  update public.ai_agents set fonction = 'Chasseur santé, négoce, distribution et agricole',
         specialite = 'MediCore, DistriPro, ComptaPro, Phyto Strike Force et AviNest Pro : cliniques, grossistes, intrants, élevages ; fiches vérifiées sur page lue', updated_at = now()
   where code = 'ia_hunter_2';
  update public.ai_agents set fonction = 'Chasseur livraison, transport et e-commerce',
         specialite = 'Angel''s Livraison et logistique : sociétés de livraison, coursiers, transporteurs, e-commerce ; fiches vérifiées sur page lue', updated_at = now()
   where code = 'ia_hunter_3';

  -- compétences reprises des agents archivés
  insert into public.ai_agent_skills(agent_id, skill_code, ordre)
  select a.id, s.code, 20 from public.ai_agents a
    join (values ('ia_market', 'contenu_marketing'), ('ia_market', 'prospection_web'), ('ia_nego_1', 'admin_documents'),
                 ('sanix_ai_sales_director', 'admin_documents'), ('sanix_ai_sales_director', 'succes_client'),
                 ('sanix_ai_sales_director', 'contenu_marketing'), ('ia_success', 'traitement_objections')) v(agent, skill) on v.agent = a.code
    join public.ai_skills s on s.code = v.skill
  on conflict (agent_id, skill_code) do nothing;

  -- 6. chartes à jour (nouvelle version) pour les 14 agents actifs : fonction, outils réels, compte rendu au président
  insert into public.ai_agent_charters(agent_id, version, contenu, motif)
  select a.id, coalesce(c.version, 0) + 1,
         coalesce(c.contenu, '{}'::jsonb) || jsonb_build_object(
           'fonction', a.fonction,
           'outils', to_jsonb(a.outils),
           'reporting', 'Rapport de fin de mission ; tout résultat notable au président (rapport_president) ; décisions soumises par demander_decision avec une recommandation ; relais aux autres agents par transmettre.'),
         'Réorganisation 26 -> 14 agents (président, 27/11/2026) : périmètre, outils et compte rendu mis à jour'
    from public.ai_agents a
    left join lateral (select * from public.ai_agent_charters x where x.agent_id = a.id order by x.version desc limit 1) c on true
   where a.archived_at is null and a.etat = 'actif';
end $$;
