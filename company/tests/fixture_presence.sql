-- Présence (Module 13) : activités détaillées, lieux, réunion en direct, événements, échanges.
set request.jwt.claim.role = 'service_role';
update ai_agents set activite_detail = x.d from (values
  ('ia_hunter_1','recherche_prospects'),('ia_hunter_2','recherche_web'),('ia_enrich_1','analyse_donnees'),('ia_wa_1','attente'),('ia_qualif_1','en_difficulte'),
  ('ia_nego_1','negociation'),('ia_temp_cliniques','redaction_email'),('ia_content','redaction_email'),('ia_market','analyse_donnees'),('ia_dir_intel','preparation_rapport'),
  ('ia_success','mission_terminee'),('ia_hunter_3','mission_terminee'),('sanix_ai_sales_director','conversation_whatsapp'),('ia_resp_prospection','management')
) as x(c,d) where ai_agents.code = x.c;
update ai_agents set activite = 'en_mission', activite_detail = 'appel_telephonique' where code = 'ia_veille';
update ai_agents set activite = 'en_mission', activite_detail = 'consultation_documents' where code = 'ia_docs';
-- en réunion (réunion en cours)
update ai_agents set lieu = 'reunion', lieu_jusqua = now() + interval '2 hours', activite_detail = 'reunion' where code in ('sanix_ai_general_director','ia_sup_btp','ia_rdv_1','ia_dir_marketing');
update ai_agents set activite = 'en_reunion' where code = 'sanix_ai_general_director';
-- déplacements
update ai_agents set lieu = 'poste_agent', lieu_cible_agent = (select id from ai_agents where code = 'ia_sup_sante'), lieu_jusqua = now() + interval '2 hours' where code = 'ia_resp_prospection';
update ai_agents set lieu = 'supervision', lieu_jusqua = now() + interval '2 hours' where code = 'sanix_ai_sales_director';
update ai_agents set lieu = 'collaboration', lieu_jusqua = now() + interval '2 hours', activite_detail = 'management', activite = 'en_mission' where code in ('ia_dir_client','ia_dir_admin');
update ai_agents set lieu = 'departement', lieu_cible_dept = 'commercial', lieu_jusqua = now() + interval '2 hours' where code = 'ia_veille';

-- réunion en cours : participants et orateur
update ai_agent_meetings set phase = 'echanges', orateur_id = (select id from ai_agents where code = 'ia_dir_marketing') where id = 'aaaaaaaa-0000-0000-0000-000000000002';
insert into ai_meeting_participants(meeting_id, agent_id, ordre, contribution)
select 'aaaaaaaa-0000-0000-0000-000000000002', id, row_number() over (), null from ai_agents where code in ('ia_sup_btp','ia_rdv_1','ia_dir_marketing');

-- échanges internes et conversations prospects
insert into ai_agent_communications(de_agent_id, vers_agent_id, type, objet, contenu) values
 ((select id from ai_agents where code='ia_sup_btp'), (select id from ai_agents where code='ia_hunter_1'), 'transmission', 'Cible : promoteurs agréés', 'Priorité aux promoteurs agréés d''Abidjan (Cocody, Marcory).'),
 ((select id from ai_agents where code='ia_hunter_1'), (select id from ai_agents where code='ia_sup_btp'), 'rapport', 'Avancement : 32 / 50', '32 promoteurs identifiés, 18 décideurs confirmés.');
insert into ai_messages(prospect_id, canal, sens, auteur, contenu, statut) select id, 'whatsapp', 'sortant', 'agent', 'Bonjour, ImmoSuite ERP simplifie la gestion de vos programmes immobiliers.', 'envoye' from ai_prospects where entreprise = 'Promoteur Alpha';
insert into ai_messages(prospect_id, canal, sens, auteur, contenu, statut) select id, 'whatsapp', 'entrant', 'prospect', 'Bonjour, pouvez-vous m''envoyer une démonstration ?', 'recu' from ai_prospects where entreprise = 'Promoteur Alpha';
insert into ai_actions(agent, action, agent_id, prospect_id) select 'ia_wa_1', 'send_message', (select id from ai_agents where code='ia_wa_1'), id from ai_prospects where entreprise = 'Promoteur Alpha';
update ai_agents set lieu_jusqua = lieu_jusqua;   -- (le garde de présence est déjà passé)

-- événements récents (flux d'activité)
select ai_agent_presence((select id from ai_agents where code='ia_hunter_1'), 'activite', 'recherche_prospects', 'screen');
select ai_agent_presence((select id from ai_agents where code='ia_nego_1'), 'activite', 'negociation', 'talk');
select ai_agent_presence((select id from ai_agents where code='ia_resp_prospection'), 'deplacement', 'management', 'handover', 'poste_agent', (select id from ai_agents where code='ia_sup_sante'), null, null, null, '{}', 20000);
