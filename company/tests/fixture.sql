-- Jeu de données de démonstration (UI) : organisation complète, tous les états, tâches, réunions, validations.
set request.jwt.claim.role = 'service_role';
insert into auth.users(id) values ('11111111-1111-1111-1111-111111111111') on conflict do nothing;
insert into ai_operators(user_id, nom, role, remise_max_pct) values ('11111111-1111-1111-1111-111111111111', 'Cyrille KESSIE', 'direction', 15) on conflict do nothing;
update ai_governance set max_agents_actifs = 40, budget_jour_usd = 25, budget_mois_usd = 500, communication_externe = 'validation';

create or replace function pg_temp.ag(p_code text, p_nom text, p_fonc text, p_dept text, p_niv int, p_chef text, p_act text default 'disponible', p_etat text default 'actif', p_outils text[] default '{}') returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into ai_agents(code, nom, fonction, departement_id, niveau, manager_id, outils, etat, activite, effort, personnalite, specialite, charte_version, temporaire, expire_at)
  values (p_code, p_nom, p_fonc, p_dept, p_niv, (select id from ai_agents where code = p_chef), p_outils, p_etat, p_act, 'medium', 'Rigoureux et orienté résultats', 'Spécialiste ' || p_fonc,
          0, p_code = 'ia_temp_cliniques', case when p_code = 'ia_temp_cliniques' then now() + interval '12 days' end) returning id into v_id;
  insert into ai_agent_charters(agent_id, version, contenu) values (v_id, 1, jsonb_build_object(
    'identite', p_nom || ' — ' || p_fonc, 'fonction', p_fonc, 'departement', p_dept, 'mission_principale', 'Atteindre les objectifs de ' || p_fonc || ' avec rigueur.',
    'missions_secondaires', jsonb_build_array('Reporting quotidien', 'Mise à jour du CRM'), 'competences', jsonb_build_array('Analyse', 'Communication'),
    'outils', to_jsonb(p_outils), 'donnees', jsonb_build_array('Prospects CRM', 'Catalogue produits'), 'objectifs', jsonb_build_array('50 prospects / semaine', 'Taux de réponse ≥ 20 %'),
    'delais', '48 h par mission', 'indicateurs', jsonb_build_array('Taux de réalisation', 'Qualité'), 'procedures', jsonb_build_array('Vérifier les sources', 'Journaliser'),
    'limites', jsonb_build_array('Aucun engagement contractuel', 'Pas de remise hors délégation'), 'responsable', coalesce(p_chef, 'Président'), 'reporting', 'Rapport de fin de mission'));
  return v_id;
end $$;

select pg_temp.ag('ia_resp_prospection', 'IA Responsable Prospection', 'Responsable prospection', 'commercial', 3, 'sanix_ai_sales_director', 'en_mission', 'actif', '{assigner_mission,attendre_sous_taches,evaluer_tache,transmettre,creer_agent}');
select pg_temp.ag('ia_sup_btp', 'IA Superviseur BTP', 'Superviseur secteur BTP', 'commercial', 4, 'ia_resp_prospection', 'en_reunion', 'actif', '{assigner_mission,transmettre}');
select pg_temp.ag('ia_sup_sante', 'IA Superviseur Santé', 'Superviseur secteur Santé', 'commercial', 4, 'ia_resp_prospection', 'en_analyse', 'actif', '{assigner_mission,transmettre}');
select pg_temp.ag('ia_hunter_1', 'IA Prospect Hunter 1', 'Chercheur de promoteurs', 'commercial', 5, 'ia_sup_btp', 'en_mission', 'actif', '{recherche_web,create_prospect,transmettre}');
select pg_temp.ag('ia_hunter_2', 'IA Prospect Hunter 2', 'Chercheur de cliniques', 'commercial', 5, 'ia_sup_sante', 'en_mission', 'actif', '{recherche_web,create_prospect,transmettre}');
select pg_temp.ag('ia_hunter_3', 'IA Prospect Hunter 3', 'Chercheur de livreurs', 'commercial', 5, 'ia_sup_btp', 'mission_terminee', 'actif', '{recherche_web,create_prospect}');
select pg_temp.ag('ia_enrich_1', 'IA Data Analyst', 'Enrichissement des prospects', 'commercial', 5, 'ia_sup_btp', 'en_analyse', 'actif', '{recherche_web,update_prospect,transmettre}');
select pg_temp.ag('ia_qualif_1', 'IA Lead Qualifier', 'Qualification commerciale', 'commercial', 5, 'ia_sup_btp', 'en_difficulte', 'actif', '{lister_prospects,update_prospect,set_stage}');
select pg_temp.ag('ia_qualif_2', 'IA Lead Qualifier 2', 'Qualification santé', 'commercial', 5, 'ia_sup_sante', 'disponible', 'actif', '{lister_prospects,update_prospect,set_stage}');
select pg_temp.ag('ia_wa_1', 'IA WhatsApp Sales', 'Prospection WhatsApp', 'commercial', 5, 'ia_sup_btp', 'attente_validation', 'actif', '{send_message,get_product,lister_prospects}');
select pg_temp.ag('ia_mail_1', 'IA Email Sales', 'Prospection e-mail', 'commercial', 5, 'ia_sup_sante', 'disponible', 'attente_validation', '{send_message}');
select pg_temp.ag('ia_rdv_1', 'IA Appointment Manager', 'Prise de rendez-vous', 'commercial', 5, 'ia_sup_btp', 'en_reunion', 'actif', '{list_free_slots,book_appointment}');
select pg_temp.ag('ia_nego_1', 'IA Sales Negotiator', 'Négociation commerciale', 'commercial', 5, 'ia_sup_sante', 'en_mission', 'actif', '{create_offer,get_objection}');
select pg_temp.ag('ia_temp_cliniques', 'IA Cliniques (temporaire)', 'Campagne cliniques 30 jours', 'commercial', 5, 'ia_sup_sante', 'en_mission', 'actif', '{recherche_web,create_prospect}');
select pg_temp.ag('ia_dir_marketing', 'IA Directeur Marketing', 'Directeur marketing', 'marketing', 2, 'sanix_ai_general_director', 'en_reunion', 'actif', '{assigner_mission,creer_agent,attendre_sous_taches,convoquer_reunion}');
select pg_temp.ag('ia_content', 'IA Content Writer', 'Rédaction de contenus', 'marketing', 3, 'ia_dir_marketing', 'en_mission', 'actif', '{recherche_web}');
select pg_temp.ag('ia_social', 'IA Community Manager', 'Réseaux sociaux', 'marketing', 3, 'ia_dir_marketing', 'disponible', 'suspendu', '{}');
select pg_temp.ag('ia_dir_intel', 'IA Directeur Intelligence', 'Directeur intelligence économique', 'intelligence', 2, 'sanix_ai_general_director', 'en_analyse', 'actif', '{assigner_mission,creer_agent,attendre_sous_taches}');
select pg_temp.ag('ia_market', 'IA Market Research', 'Étude du marché', 'intelligence', 3, 'ia_dir_intel', 'en_analyse', 'actif', '{recherche_web}');
select pg_temp.ag('ia_veille', 'IA Veille concurrentielle', 'Veille concurrentielle', 'intelligence', 3, 'ia_dir_intel', 'disponible', 'actif', '{recherche_web}');
select pg_temp.ag('ia_dir_client', 'IA Directeur Relation Client', 'Directeur relation client', 'relation_client', 2, 'sanix_ai_general_director', 'disponible', 'actif', '{assigner_mission,creer_agent}');
select pg_temp.ag('ia_success', 'IA Customer Success', 'Suivi et fidélisation', 'relation_client', 3, 'ia_dir_client', 'mission_terminee', 'actif', '{lister_prospects,get_product}');
select pg_temp.ag('ia_dir_admin', 'IA Directeur Administratif', 'Directeur administratif', 'administratif', 2, 'sanix_ai_general_director', 'disponible', 'actif', '{assigner_mission}');
select pg_temp.ag('ia_docs', 'IA Gestionnaire documents', 'Documents et contrats', 'administratif', 3, 'ia_dir_admin', 'disponible', 'actif', '{}');
select pg_temp.ag('ia_ancien', 'IA Ancien Agent', 'Agent retiré', 'commercial', 5, 'ia_sup_btp', 'disponible', 'archive', '{}');
update ai_agents set activite = 'en_mission' where code = 'sanix_ai_sales_director';

-- Missions
create or replace function pg_temp.tk(p_code text, p_titre text, p_statut text, p_parent uuid default null, p_donneur text default null, p_type text default 'mission', p_rapport text default null, p_eval int default null, p_cout numeric default 0.3) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into ai_agent_tasks(agent_id, donneur_agent_id, parent_id, type, titre, description, statut, rapport, evaluation, cout_usd, priorite, executions, started_at, objectifs)
  values ((select id from ai_agents where code = p_code), (select id from ai_agents where code = p_donneur), p_parent, p_type, p_titre, 'Description détaillée de la mission « ' || p_titre || ' ».', p_statut, p_rapport, p_eval, p_cout,
          case when p_type = 'instruction' then 1 else 2 end, 1, now() - interval '3 hours', '["Objectif chiffré 1","Objectif chiffré 2"]'::jsonb) returning id into v;
  return v;
end $$;
do $$ declare r uuid; d uuid; s uuid; h uuid; begin
  r := pg_temp.tk('sanix_ai_general_director', 'Vendre 20 licences ImmoSuite ERP et 15 licences Angel''s ce mois-ci', 'attente_sous_taches', null, null, 'instruction');
  d := pg_temp.tk('sanix_ai_sales_director', 'Plan commercial ImmoSuite + Angel''s', 'attente_sous_taches', r, 'sanix_ai_general_director');
  s := pg_temp.tk('ia_resp_prospection', 'Organiser la prospection BTP et santé', 'attente_sous_taches', d, 'sanix_ai_sales_director');
  h := pg_temp.tk('ia_hunter_3', 'Trouver 100 entreprises de livraison à Abidjan', 'terminee', s, 'ia_resp_prospection', 'tache', '100 entreprises enregistrées, 62 décideurs identifiés.', 88, 1.42);
  perform pg_temp.tk('ia_hunter_1', 'Trouver 50 promoteurs immobiliers', 'en_cours', s, 'ia_sup_btp', 'tache');
  perform pg_temp.tk('ia_qualif_1', 'Qualifier les promoteurs trouvés', 'bloquee', s, 'ia_sup_btp', 'tache', 'Source indisponible : accès à l''annuaire refusé.');
  perform pg_temp.tk('ia_hunter_2', 'Cartographier les cliniques privées', 'a_faire', s, 'ia_sup_sante', 'tache');
  perform pg_temp.tk('ia_wa_1', 'Contacter 30 promoteurs qualifiés', 'attente_validation', s, 'ia_sup_btp', 'tache');
  perform pg_temp.tk('ia_dir_marketing', 'Campagne de contenus ImmoSuite', 'en_cours', r, 'sanix_ai_general_director');
  perform pg_temp.tk('ia_market', 'Étude du marché de la livraison au Sénégal', 'terminee', null, 'ia_dir_intel', 'mission', 'Marché estimé à 1 200 entreprises ; 3 concurrents locaux identifiés.', 74, 0.9);
  perform pg_temp.tk('ia_success', 'Plan de fidélisation clients Angel''s', 'echouee', null, 'ia_dir_client', 'mission', null, 35, 0.4);
end $$;

-- Validations
insert into ai_approvals(type, agent_id, motif, payload) values
 ('ressources', (select id from ai_agents where code = 'sanix_ai_sales_director'), 'SANIX AI SALES DIRECTOR demande budget_jour_usd : 25 → 40', '{"parametre":"budget_jour_usd","valeur":"40","actuel":25,"justification":"Campagne de prospection ImmoSuite + Angel''s : 5 agents de recherche supplémentaires."}'),
 ('creation_agent', (select id from ai_agents where code = 'ia_mail_1'), 'Création de IA Email Sales (Prospection e-mail) par IA Superviseur Santé', '{"outils":["send_message"],"mission":"Prospection e-mail des cliniques privées"}'),
 ('remise', (select id from ai_agents where code = 'ia_nego_1'), 'Remise 12% > délégation agent 5% sur OFF-2611-AB12CD', '{"reference":"OFF-2611-AB12CD","total_ht":660000}'),
 ('engagement', (select id from ai_agents where code = 'ia_dir_admin'), 'Signature d''une convention de partenariat', '{"details":"Convention de revente avec un cabinet comptable d''Abidjan"}');
insert into ai_prospects(entreprise, secteur, ville, whatsapp, crit_produit, crit_besoin, crit_finance, crit_decideur, crit_court_terme, crit_disponibilite, stage, produits_recommandes, potentiel_fcfa)
values ('Promoteur Alpha', 'Immobilier', 'Abidjan', '+2250707070707', 25, 18, 10, 12, 10, 8, 'qualifie', '{immosuite}', 4500000), ('Express Colis', 'Livraison', 'Abidjan', '+2250505050505', 20, 15, 8, 10, 8, 6, 'interesse', '{angels}', 1800000);
insert into ai_approvals(type, agent_id, prospect_id, motif, payload)
select 'message', (select id from ai_agents where code = 'ia_wa_1'), id, 'Message whatsapp à ' || entreprise, jsonb_build_object('message_id', 1, 'canal', 'whatsapp', 'apercu', 'Bonjour, je suis l''assistant commercial de SANIX AFRICA. Nous avons développé ImmoSuite ERP pour les promoteurs… <script>alert(1)</script>') from ai_prospects;

-- Réunion + PV
insert into ai_agent_meetings(id, titre, ordre_du_jour, convoque_par, statut, cout_usd, debut_at, fin_at) values
 ('aaaaaaaa-0000-0000-0000-000000000001', 'Stratégie de commercialisation ImmoSuite ERP', 'Élaborer le plan de commercialisation d''ImmoSuite ERP auprès des promoteurs agréés.', (select id from ai_agents where code = 'sanix_ai_general_director'), 'terminee', 0.31, now() - interval '5 hours', now() - interval '4 hours'),
 ('aaaaaaaa-0000-0000-0000-000000000002', 'Revue hebdomadaire des performances', 'Examiner les agents en difficulté.', (select id from ai_agents where code = 'sanix_ai_general_director'), 'en_cours', 0, now() - interval '5 minutes', null);
insert into ai_meeting_participants(meeting_id, agent_id, ordre, contribution) select 'aaaaaaaa-0000-0000-0000-000000000001', id, row_number() over (), 'Analyse : les promoteurs agréés sont la cible prioritaire.' || E'\n' || 'Recommandations : Prioriser Abidjan.' from ai_agents where code in ('ia_market', 'ia_dir_marketing', 'sanix_ai_sales_director');
insert into ai_meeting_minutes(meeting_id, synthese, decisions, plan_action) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Les contributions convergent : cibler les promoteurs agréés d''Abidjan avec une offre ImmoSuite ERP.', '["Lancer une étude des promoteurs agréés","Préparer l''argumentaire closing"]',
 '[{"titre":"Étude des promoteurs agréés","responsable_code":"ia_market","priorite":2,"echeance_jours":5,"task_id":"x"},{"titre":"Mission fantôme","responsable_code":"inconnu","priorite":3,"echeance_jours":3,"task_id":null,"erreur":"responsable indisponible"}]');

-- Conversation avec le président
insert into ai_executive_messages(user_id, auteur, contenu, created_at) values
 ('11111111-1111-1111-1111-111111111111', 'president', 'Notre priorité ce mois-ci est de vendre 20 licences ImmoSuite ERP et 15 licences Angel''s. Organise les équipes nécessaires et présente-moi ton plan.', now() - interval '3 hours'),
 (null, 'directeur', E'Plan d''action :\n1. Direction commerciale : prospection BTP, santé et livraison (3 superviseurs, 11 agents)\n2. Marketing : campagne de contenus ImmoSuite\n3. Intelligence économique : étude du marché sénégalais pour Angel''s\n\nBudget IA estimé : 18 $/jour. Je vous demande validation pour 5 agents supplémentaires.', now() - interval '2 hours 55 minutes');

-- Rapports + destinataires
insert into ai_report_recipients(email, nom, principal) values ('president@sanix-africa.ci', 'Président', true), ('adjoint@sanix-africa.ci', 'Adjoint', false);
insert into ai_daily_reports(type, periode_debut, periode_fin, donnees, html, statut, destinataires, pdf_path, cout_usd, envoye_at) values
 ('quotidien', now() - interval '1 day 18 hours', now() - interval '1 day', '{}', '<html><body><h1>RAPPORT JOURNALIER</h1><p><script>alert(1)</script>Contenu</p></body></html>', 'envoye', '{president@sanix-africa.ci}', '2026/11/quotidien-x.pdf', 0.04, now() - interval '1 day'),
 ('hebdomadaire', now() - interval '8 days', now() - interval '1 day', '{}', '<html><body>Hebdo</body></html>', 'echec', '{}', null, 0.06, null);
update ai_daily_reports set erreur = 'president@sanix-africa.ci: Resend 403: domain not verified' where statut = 'echec';

select ai_compute_performance(current_date);
insert into ai_actions(agent, action, agent_id, cout_usd) select 'x', 'llm_turn', id, 0.9 from ai_agents where code in ('ia_hunter_1', 'ia_wa_1', 'sanix_ai_sales_director');
update ai_agent_tasks set finished_at = now() - interval '1 hour' where statut = 'terminee';
