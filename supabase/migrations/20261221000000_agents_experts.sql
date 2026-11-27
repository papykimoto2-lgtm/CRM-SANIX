-- Agents experts et proactifs (mode abonnement).
-- 1. Trois nouveaux outils exécutables par l'exécuteur planifié : rapport_president, transmettre, demander_decision.
-- 2. Toute décision demandée (incident « decision_requise ») arrive aussitôt dans le bureau exécutif du président (et sur son WhatsApp si la fenêtre est ouverte).
-- 3. Point du jour : données consolidées (ai_point_du_jour_donnees) et publication dans le bureau (ai_publier_point_du_jour).
-- 4. Outils complets par métier pour chaque agent ; rôles alignés pour les futurs agents.
-- 5. Compétences d'expert réécrites ou ajoutées, et rattachées aux agents.
-- Aucun envoi externe nouveau : les messages aux prospects restent soumis à la validation du président.

-- 1. Outils ---------------------------------------------------------------------------------------------------------
create or replace function public.ai_abonnement_rapport_president(p_task uuid, p_contenu text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.ai_agents; t public.ai_agent_tasks; v_id bigint;
begin
  a := public.ai_abo_agent(p_task, 'rapport_president');
  perform public.ai_abo_plafond(p_task, 'abonnement_rapport_president', 3);
  if length(btrim(coalesce(p_contenu, ''))) < 40 then raise exception 'Rapport de 40 caractères au moins requis'; end if;
  select * into t from public.ai_agent_tasks where id = p_task;
  insert into public.ai_executive_messages(auteur, contenu, canal, task_id, wa_statut)
  values ('directeur', left('[' || a.nom || ' — ' || t.titre || E']\n' || btrim(p_contenu), 6000), 'bureau', p_task, 'en_attente')
  returning id into v_id;
  insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
  values ('abonnement', 'abonnement_rapport_president', a.id, p_task, jsonb_build_object('message', v_id), true, 0);
  return jsonb_build_object('ok', true, 'message_id', v_id);
end $$;

create or replace function public.ai_abonnement_transmettre(p_task uuid, p_vers text, p_objet text, p_contenu text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.ai_agents; v_vers uuid; v_id uuid;
begin
  a := public.ai_abo_agent(p_task, 'transmettre');
  perform public.ai_abo_plafond(p_task, 'abonnement_transmettre', 10);
  select id into v_vers from public.ai_agents where code = p_vers and etat = 'actif' and archived_at is null;
  if v_vers is null then raise exception 'Agent destinataire introuvable ou inactif : %', p_vers; end if;
  if length(btrim(coalesce(p_contenu, ''))) < 20 then raise exception 'Contenu de 20 caractères au moins requis'; end if;
  insert into public.ai_agent_communications(de_agent_id, vers_agent_id, task_id, type, objet, contenu)
  values (a.id, v_vers, p_task, 'transmission', left(coalesce(nullif(btrim(p_objet), ''), 'Transmission'), 200), left(btrim(p_contenu), 8000))
  returning id into v_id;
  insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
  values ('abonnement', 'abonnement_transmettre', a.id, p_task, jsonb_build_object('vers', p_vers), true, 0);
  return jsonb_build_object('ok', true, 'communication_id', v_id);
end $$;

create or replace function public.ai_abonnement_demander_decision(p_task uuid, p_question text, p_options text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.ai_agents; t public.ai_agent_tasks;
begin
  a := public.ai_abo_agent(p_task, 'demander_decision');
  perform public.ai_abo_plafond(p_task, 'abonnement_demander_decision', 2);
  if length(btrim(coalesce(p_question, ''))) < 20 then raise exception 'Question de 20 caractères au moins requise'; end if;
  select * into t from public.ai_agent_tasks where id = p_task;
  insert into public.ai_incidents(gravite, type, agent_id, task_id, message)
  values ('attention', 'decision_requise', a.id, p_task,
          left(a.nom || ' — ' || t.titre || E'\nQuestion : ' || btrim(p_question) || coalesce(E'\nOptions : ' || nullif(btrim(p_options), ''), ''), 4000));
  insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
  values ('abonnement', 'abonnement_demander_decision', a.id, p_task, '{}'::jsonb, true, 0);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.ai_abonnement_rapport_president(uuid, text) from public, anon, authenticated;
revoke all on function public.ai_abonnement_transmettre(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.ai_abonnement_demander_decision(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ai_abonnement_rapport_president(uuid, text) to service_role;
grant execute on function public.ai_abonnement_transmettre(uuid, text, text, text) to service_role;
grant execute on function public.ai_abonnement_demander_decision(uuid, text, text) to service_role;

-- 2. Décision demandée -> bureau exécutif du président ------------------------------------------------------------------
create or replace function public.ai_incident_decision_vers_president() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.type = 'decision_requise' then
    insert into public.ai_executive_messages(auteur, contenu, canal, task_id, wa_statut)
    values ('directeur', left(E'DÉCISION REQUISE\n' || new.message, 6000), 'bureau', new.task_id, 'en_attente');
  end if;
  return null;
end $$;
drop trigger if exists ai_incident_decision_vers_president on public.ai_incidents;
create trigger ai_incident_decision_vers_president after insert on public.ai_incidents
  for each row execute function public.ai_incident_decision_vers_president();

-- 3. Point du jour ---------------------------------------------------------------------------------------------------
create or replace function public.ai_point_du_jour_donnees(p_heures int default 24) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with p as (select now() - make_interval(hours => greatest(p_heures, 1)) as depuis)
  select jsonb_build_object(
    'periode_heures', p_heures,
    'missions', jsonb_build_object(
      'terminees', (select count(*) from ai_agent_tasks, p where statut = 'terminee' and finished_at > p.depuis),
      'echouees', (select count(*) from ai_agent_tasks, p where statut = 'echouee' and updated_at > p.depuis),
      'a_faire', (select count(*) from ai_agent_tasks where statut = 'a_faire'),
      'en_cours', (select count(*) from ai_agent_tasks where statut = 'en_cours'),
      'bloquees', (select count(*) from ai_agent_tasks where statut = 'bloquee')),
    'resultats', coalesce((select jsonb_agg(x) from (
        select a.nom as agent, t.titre, left(regexp_replace(coalesce(t.rapport, ''), E'\\s+', ' ', 'g'), 400) as rapport
          from ai_agent_tasks t join ai_agents a on a.id = t.agent_id, p
         where t.statut = 'terminee' and t.finished_at > p.depuis order by t.finished_at desc limit 12) x), '[]'::jsonb),
    'prospects', jsonb_build_object(
      'crees_par_les_agents', (select count(*) from ai_prospects, p where created_at > p.depuis and coalesce(source, '') <> 'crm'),
      'qualifies', (select count(*) from ai_actions, p where action in ('abonnement_qualification', 'update_prospect') and at > p.depuis),
      'reste_a_qualifier', (select count(*) from ai_prospects where stage = 'enregistre' and coalesce(score, 0) = 0 and not coalesce(opt_out, false)),
      'meilleurs_a_contacter', coalesce((select jsonb_agg(y) from (
          select entreprise, score, segment, telephone is not null as a_telephone
            from ai_prospects where score >= 50 and stage in ('enregistre', 'qualifie') and not coalesce(opt_out, false)
              and last_outbound_at is null order by score desc limit 5) y), '[]'::jsonb)),
    'a_valider_par_le_president', jsonb_build_object(
      'messages', (select count(*) from ai_messages where statut = 'a_valider'),
      'approbations', (select count(*) from ai_approvals where statut = 'en_attente')),
    'rendez_vous_a_venir', (select count(*) from ai_appointments where debut > now() and statut not in ('annule', 'realise')),
    'decisions_requises', coalesce((select jsonb_agg(z) from (
        select left(message, 300) as question, created_at from ai_incidents, p
         where type = 'decision_requise' and created_at > now() - interval '3 days' order by created_at desc limit 8) z), '[]'::jsonb),
    'plafond_api', (select case when provider_pause_until > now() then provider_pause_until end from ai_governance where id = 1)
  );
$$;

create or replace function public.ai_publier_point_du_jour(p_texte text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  if length(btrim(coalesce(p_texte, ''))) < 40 then raise exception 'Point du jour trop court'; end if;
  insert into public.ai_executive_messages(auteur, contenu, canal, wa_statut)
  values ('directeur', left(E'POINT DU JOUR\n' || btrim(p_texte), 6000), 'bureau', 'en_attente') returning id into v_id;
  return v_id;
end $$;
revoke all on function public.ai_point_du_jour_donnees(int) from public, anon, authenticated;
revoke all on function public.ai_publier_point_du_jour(text) from public, anon, authenticated;
grant execute on function public.ai_point_du_jour_donnees(int) to service_role;
grant execute on function public.ai_publier_point_du_jour(text) to service_role;

-- 4. Outils complets par métier ----------------------------------------------------------------------------------------
do $$
declare
  base text[] := array['lister_prospects','get_prospect','get_product','recommend_products','recherche_web','firecrawl_scrape',
                       'consulter_indicateurs','transmettre','rapport_president','demander_decision','escalate_to_human'];
  pilote text[] := array['assigner_mission','attendre_sous_taches','evaluer_tache','consulter_performance','propose_commercial_action',
                         'convoquer_reunion','demander_ressources'];
  direction text[] := array['creer_agent','modifier_agent','changer_etat_agent'];
  contact text[] := array['send_message','schedule_followup','get_objection','set_stage'];
  m jsonb := jsonb_build_object(
    'sanix_ai_general_director', to_jsonb(base || pilote || direction || array['repondre_president','update_prospect','set_stage']),
    'sanix_ai_sales_director',   to_jsonb(base || pilote || direction || array['update_prospect','set_stage','create_offer','get_objection','schedule_followup']),
    'sanix_ai_fundraising_director', to_jsonb(base || array['consulter_levee_de_fonds','lister_financeurs','enregistrer_financeur','propose_commercial_action']),
    'ia_dir_admin',      to_jsonb(base || pilote || direction),
    'ia_dir_intel',      to_jsonb(base || pilote || direction),
    'ia_dir_marketing',  to_jsonb(base || pilote || direction),
    'ia_dir_client',     to_jsonb(base || pilote || direction || contact),
    'ia_resp_prospection', to_jsonb(base || pilote || array['update_prospect','set_stage','schedule_followup']),
    'ia_sup_distribution', to_jsonb(base || pilote || array['update_prospect','set_stage']),
    'ia_sup_immo',         to_jsonb(base || pilote || array['update_prospect','set_stage']),
    'ia_sup_sante',        to_jsonb(base || pilote || array['update_prospect','set_stage']),
    'ia_hunter_1', to_jsonb(base || array['create_prospect']),
    'ia_hunter_2', to_jsonb(base || array['create_prospect']),
    'ia_hunter_3', to_jsonb(base || array['create_prospect']),
    'ia_enrich_1', to_jsonb(base || array['update_prospect','set_stage','verifier_adresse','create_prospect']),
    'ia_qualif_1', to_jsonb(base || array['update_prospect','set_stage','verifier_adresse']),
    'ia_wa_1',     to_jsonb(base || contact || array['list_free_slots','book_appointment']),
    'ia_mail_1',   to_jsonb(base || contact || array['list_free_slots','book_appointment','verifier_adresse']),
    'ia_rdv_1',    to_jsonb(base || contact || array['list_free_slots','book_appointment','record_appointment_report']),
    'ia_nego_1',   to_jsonb(base || contact || array['create_offer','record_appointment_report','list_free_slots','book_appointment']),
    'ia_success',  to_jsonb(base || contact || array['propose_commercial_action','record_appointment_report']),
    'ia_market',   to_jsonb(base || array['propose_commercial_action']),
    'ia_veille',   to_jsonb(base || array['propose_commercial_action']),
    'ia_content',  to_jsonb(base || array['propose_commercial_action']),
    'ia_social',   to_jsonb(base || array['propose_commercial_action']),
    'ia_docs',     to_jsonb(base || array['create_offer']));
  k text;
begin
  for k in select jsonb_object_keys(m) loop
    update public.ai_agents
       set outils = (select array_agg(distinct x order by x) from jsonb_array_elements_text(m -> k) x), updated_at = now()
     where code = k and archived_at is null;
  end loop;
  -- rôles (modèles des futurs agents) : mêmes outils de base + outils du métier existants
  update public.ai_roles r set outils = (select array_agg(distinct x order by x) from unnest(r.outils || base) x), updated_at = now();
end $$;

-- 5. Compétences d'expert ------------------------------------------------------------------------------------------------
insert into public.ai_skills(code, nom, description, contenu, actif) values
('prospection_web', 'Chasse de prospects B2B en Côte d''Ivoire', 'Trouver des entreprises réelles avec une coordonnée publiée et une source lue',
$s$OBJECTIF : créer des fiches d'entreprises réelles, utiles et vérifiées, jamais des fiches « au cas où ».
1. CIBLE (ICP) — pars du logiciel de la mission : AutoGarage Pro (garages, carrosseries, flottes), ImmoSuite (promoteurs, agences, SCI), AluExpert (menuiseries alu/vitrerie), MediCore (cliniques, centres de santé, laboratoires), Angel's Livraison (sociétés de livraison, coursiers, e-commerce), Phyto Strike Force (distributeurs d'intrants, coopératives), AviNest Pro (fermes avicoles, provenderies), DistriPro/ComptaPro (grossistes, négoce). Taille visée : PME de 5 à 200 salariés.
2. RECHERCHE — requêtes précises en français : « <métier> <commune> Abidjan téléphone », « <métier> Bouaké contact », variante par commune (Cocody, Marcory, Yopougon, Koumassi, Treichville, Plateau, Abobo, Port-Bouët, Bingerville) et par ville (Bouaké, Yamoussoukro, San-Pédro, Daloa, Korhogo). Utilise firecrawl_search (ou WebSearch) puis LIS la page avec firecrawl_scrape.
3. SOURCES LISIBLES, par ordre de fiabilité : site officiel de l'entreprise (page Contact) ; fiche individuelle GoAfrica (une page par entreprise, numéro lisible) ; page Facebook professionnelle avec numéro publié dans « À propos » ; Pratik / annuaires sectoriels ; articles de presse économique. Peu productifs : pages de liste d'annuaires (« Demander un contact »), LinkedIn (non lisible).
4. CRITÈRES D'ACCEPTATION (tous obligatoires) : nom d'entreprise exact ; activité correspondant à la cible ; au moins une coordonnée PROFESSIONNELLE publiée sur la page lue (téléphone, e-mail générique ou site) ; source https. Sinon : ne crée pas, note le candidat dans le rapport.
5. DÉDOUBLONNAGE avant chaque création : lister_prospects (nom proche, même téléphone). Réponse « doublon » de la fonction = passer à la suivante.
6. FICHE : commune et ville réelles (sinon null), besoins observables (« gestion de flotte », « suivi des chantiers »), jamais inventés.
7. RENDEMENT : vise au moins 1 fiche validée pour 3 pages lues. Si une source ne rend rien après 3 lectures, change de source et mémorise la leçon (source productive ou stérile).
8. RAPPORT : fiches créées, sources productives, candidats écartés avec motif. Si une source nouvelle rend bien, mémorise-la (memoriser, partagée si niveau ≤ 3).$s$, true),
('qualification_score', 'Qualification et score /100', 'Noter un prospect de façon reproductible et justifiée',
$s$GRILLE SANIX /100 (ai_abonnement_qualifier) — chaque note s'appuie sur un fait de la fiche ou d'une page lue :
• produit (0-25) : 20-25 le métier correspond exactement à un logiciel actif ; 10-19 correspondance partielle ; 0-9 hors cible.
• besoin (0-25) : 20-25 besoin exprimé ou visible (plusieurs sites, flotte, programmes immobiliers en cours) ; 10-19 besoin probable par l'activité ; 0-9 inconnu.
• taille (0-15) : 12-15 structure établie (plusieurs agences, site, équipe) ; 6-11 PME active ; 0-5 très petite ou inconnue.
• décideur (0-15) : 12-15 nom et fonction publiés ; 6-11 contact direct de l'entreprise ; 0-5 aucun contact nominatif.
• maturité (0-10) : 7-10 entreprise déjà équipée (site, réseaux actifs, logiciel cité) ; 3-6 présence numérique faible ; 0-2 aucune.
• fiabilité (0-10) : 8-10 source officielle récente et coordonnée vérifiée ; 4-7 annuaire ou réseau social ; 0-3 non vérifié.
SEUILS : ≥ 70 chaud (à contacter en premier) ; 50-69 tiède (séquence standard) ; < 50 froid (veille). Un grand groupe noté « peu prioritaire » plafonne à 45. Une fiche sans téléphone ni e-mail plafonne à 40.
JUSTIFICATION : 2 à 4 faits (« site officiel avec 3 agences ; téléphone publié ; décideur inconnu »). Jamais « semble », jamais de chiffre inventé.
APRÈS NOTATION : choisis le logiciel recommandé (produits) et, pour les ≥ 70, signale-les en fin de rapport : ce sont les priorités de contact.$s$, true),
('enrichissement_fiche', 'Enrichissement de fiche', 'Compléter une fiche existante avec des données publiques vérifiées',
$s$1. Lis la fiche (get_prospect) : liste ce qui manque (site, e-mail générique, décideur, commune, activité précise).
2. Cherche le site officiel (« <nom> Côte d'Ivoire ») et LIS la page Contact / À propos (firecrawl_scrape).
3. Ajoute seulement ce qui est publié : e-mail professionnel générique (contact@, info@) ou nominatif publié par l'entreprise ; décideur et fonction publiés ; jamais d'adresse devinée (prenom.nom@…), jamais de numéro personnel non publié.
4. Ne remplace jamais une valeur renseignée par le président ; complète les cases vides. Toute correction cite la source https.
5. Vérifie l'e-mail (verifier_adresse si disponible) avant de le considérer comme fiable.
6. Rapport : fiches enrichies, champs ajoutés, sources ; fiches sans rien de publié = notées « aucune donnée publique ».$s$, true),
('redaction_message', 'Rédaction de messages commerciaux', 'Premier contact et relances par WhatsApp et e-mail',
$s$RÈGLES COMMUNES : vouvoiement ; nom exact de l'entreprise ; une phrase qui montre que tu connais son activité ; un bénéfice concret du logiciel recommandé ; UNE seule question finale simple (« Seriez-vous disponible 15 minutes jeudi ou vendredi ? ») ; aucun prix, aucune promesse non validée ; signature Cyrille KESSIE, SANIX. La mention « assistant IA » est ajoutée automatiquement au premier message.
WHATSAPP : 400 à 600 caractères, pas de pièce jointe au premier message, pas de lien raccourci, phrase d'opposition : « Répondez STOP pour ne plus être contacté. » Envoi en semaine entre 8 h et 18 h (heure d'Abidjan).
E-MAIL : objet de 60 caractères au plus, concret (« Suivi des chantiers pour <Entreprise> ») ; 120 à 180 mots ; un seul appel à l'action.
PERSONNALISATION : utilise les données de la fiche (commune, activité, nombre d'agences, besoin observé). Sans donnée, reste sobre plutôt qu'inventer.
QUALITÉ : relis contre ces règles avant ai_abonnement_message ; un message refusé par la fonction = lis le motif et corrige.$s$, true),
('relance_sequence', 'Séquence de relance', 'Cadence multicanal sans harcèlement',
$s$CADENCE STANDARD (prospect tiède ou chaud, sans réponse) : J0 premier message WhatsApp ; J+3 relance courte (rappel + question simple) ; J+7 e-mail ou appel préparé ; J+14 dernier message (« Je ne vous relancerai plus, voici mon contact si le sujet revient »), puis mise en veille 90 jours.
LIMITES : 3 relances au plus sans réponse ; arrêt immédiat sur STOP, refus ou demande de ne plus écrire (opt_out) ; jamais deux messages le même jour.
PROGRAMMATION : ai_abonnement_relance avec un scénario précis (quoi dire, quel canal) ; la relance suivante passe par la file de validation.
SIGNAUX : une réponse, même « plus tard », arrête la séquence automatique et passe la fiche au traitement manuel (prise de rendez-vous ou objection).$s$, true),
('traitement_objections', 'Traitement des objections', 'Réponses aux objections courantes des PME ivoiriennes',
$s$MÉTHODE : écouter, reformuler, répondre par un fait, reposer une question. Jamais de prix ni de remise sans la grille officielle et la validation.
« C'est trop cher » → « Je comprends. Combien de temps vos équipes passent-elles chaque semaine sur <tâche> ? » puis démonstration de 15 minutes centrée sur le gain.
« Excel nous suffit » → reconnaître l'outil ; montrer ce qu'Excel ne fait pas (accès simultané, historique, alertes, portail client) ; proposer d'importer leur fichier.
« Internet coupe souvent » → nos applications fonctionnent hors ligne et synchronisent au retour du réseau.
« Nos données sont sensibles » → accès par utilisateur, sauvegardes, données de l'entreprise qui restent sa propriété ; détails techniques par le président.
« Nous avons déjà un logiciel » → demander ce qui manque ou agace ; proposer une comparaison sans dénigrer.
« Pas le temps » → proposer 15 minutes au créneau de son choix, ou une courte vidéo.
« Envoyez la documentation » → l'envoyer (après validation) ET proposer un créneau pour en parler.
Toute objection inédite : la noter dans le rapport et la transmettre (transmettre) au négociateur.$s$, true),
('conformite_prospection', 'Conformité de la prospection', 'Loi ivoirienne 2013-450, règles WhatsApp et règles SANIX',
$s$LOI N° 2013-450 DU 19 JUIN 2013 (Côte d'Ivoire, autorité : ARTCI) : les données d'une personne physique ne sont collectées que pour une finalité déterminée et légitime ; la personne a le droit de s'opposer, gratuitement, à l'utilisation de ses données à des fins de prospection (art. 30). En pratique : données professionnelles publiques uniquement ; toute demande de retrait ou STOP = opt_out immédiat et définitif ; jamais de données sensibles ; jamais de revente ni de transmission à des tiers.
WHATSAPP (règles Meta) : un message libre n'est possible que dans les 24 heures suivant le dernier message du contact ; hors de cette fenêtre, seul un modèle approuvé peut être envoyé. Les signalements et blocages font restreindre le numéro de SANIX : mieux vaut 10 messages ciblés que 100 messages génériques.
RÈGLES SANIX : aucun envoi sans validation du président ; mention « assistant IA » au premier message ; aucun prix ou engagement non validé ; aucune donnée inventée.$s$, true),
('rapport_resultats', 'Rendre compte au président', 'Être proactif : apporter des résultats et des décisions prêtes à prendre',
$s$PRINCIPE : c'est l'agent qui va vers le président avec des résultats, pas l'inverse.
QUAND utiliser rapport_president (3 au plus par mission) : un résultat notable (fiches créées, prospects ≥ 70, rendez-vous obtenu, réponse d'un prospect, offre acceptée), un risque (source épuisée, chute d'activité), une opportunité (nouveau segment, partenaire).
FORMAT (court, lisible sur téléphone) : 1) Résultat chiffré ; 2) Ce que cela change ; 3) Prochaine action que je lance ; 4) Décision attendue du président (si besoin).
DÉCISION : utiliser demander_decision quand une action dépend du président (budget, prix, envoi groupé, partenariat) ; poser une question fermée avec 2 ou 3 options et une recommandation.
JAMAIS : rapporter une absence de travail comme un résultat, noyer le président de détails, demander une décision que l'agent peut prendre lui-même dans ses règles.$s$, true),
('pilotage_direction', 'Pilotage et délégation', 'Diriger une équipe d'agents vers des résultats mesurables',
$s$RITUELS : chaque matin, lire les indicateurs (fiches créées, qualifiées, messages à valider, rendez-vous) et la file des missions ; chaque semaine, revue des résultats par agent et ajustement des cibles.
DÉLÉGATION : une mission = un agent qui POSSÈDE les outils nécessaires (vérifie la liste d'outils avant d'assigner) ; objectif chiffré et petit (10 fiches, 40 qualifications) ; sources ou périmètre précis ; résultat vérifiable attendu. Ne jamais confier une qualification à un chasseur, ni une chasse à un qualificateur.
SUIVI : évaluer chaque sous-mission (note et commentaire factuel) ; une mission sans résultat deux fois de suite = changer d'approche (autre source, autre segment), pas la relancer à l'identique.
PRIORITÉS : 1) prospects chauds non contactés ; 2) qualification des fiches en attente ; 3) chasse sur les logiciels qui manquent de prospects ; 4) le reste.
PROACTIVITÉ : rendre compte au président des résultats (rapport_president) et lui soumettre les décisions (demander_decision) avec une recommandation.$s$, true)
on conflict (code) do update set nom = excluded.nom, description = excluded.description, contenu = excluded.contenu, actif = true, updated_at = now();

-- rattachement : compétences communes à tous, puis compétences par métier
do $$
declare v record;
  par_metier jsonb := jsonb_build_object(
    'sanix_ai_general_director', '["pilotage_direction","qualification_score"]',
    'sanix_ai_sales_director', '["pilotage_direction","qualification_score","relance_sequence","traitement_objections","suivi_partenariats","offre_commerciale"]',
    'sanix_ai_fundraising_director', '["recherche_financeurs","etude_marche"]',
    'ia_dir_admin', '["pilotage_direction","admin_documents"]',
    'ia_dir_intel', '["pilotage_direction","etude_marche","veille_concurrentielle"]',
    'ia_dir_marketing', '["pilotage_direction","contenu_marketing"]',
    'ia_dir_client', '["pilotage_direction","succes_client","relance_sequence"]',
    'ia_resp_prospection', '["pilotage_direction","prospection_web","qualification_score","enrichissement_fiche","relance_sequence"]',
    'ia_sup_distribution', '["pilotage_direction","prospection_web","qualification_score"]',
    'ia_sup_immo', '["pilotage_direction","prospection_web","qualification_score"]',
    'ia_sup_sante', '["pilotage_direction","prospection_web","qualification_score"]',
    'ia_hunter_1', '["prospection_web","qualite_donnees","enrichissement_fiche"]',
    'ia_hunter_2', '["prospection_web","qualite_donnees","enrichissement_fiche"]',
    'ia_hunter_3', '["prospection_web","qualite_donnees","enrichissement_fiche"]',
    'ia_enrich_1', '["enrichissement_fiche","qualite_donnees","qualification_score","prospection_web"]',
    'ia_qualif_1', '["qualification_score","decouverte_besoins","qualite_donnees","enrichissement_fiche"]',
    'ia_wa_1', '["redaction_message","relance_sequence","traitement_objections","prise_rdv"]',
    'ia_mail_1', '["redaction_message","relance_sequence","traitement_objections","prise_rdv"]',
    'ia_rdv_1', '["prise_rdv","compte_rendu_rdv","relance_sequence","decouverte_besoins"]',
    'ia_nego_1', '["offre_commerciale","traitement_objections","decouverte_besoins","compte_rendu_rdv"]',
    'ia_success', '["succes_client","redaction_message","relance_sequence"]',
    'ia_market', '["etude_marche","veille_concurrentielle"]',
    'ia_veille', '["veille_concurrentielle","etude_marche"]',
    'ia_content', '["contenu_marketing"]',
    'ia_social', '["contenu_marketing","prospection_web"]',
    'ia_docs', '["admin_documents","offre_commerciale"]');
  k text; s text; o int;
begin
  for k in select jsonb_object_keys(par_metier) loop
    o := 1;
    for s in select jsonb_array_elements_text((par_metier ->> k)::jsonb) loop
      insert into public.ai_agent_skills(agent_id, skill_code, ordre)
      select a.id, s, o from public.ai_agents a where a.code = k and a.archived_at is null and exists (select 1 from public.ai_skills where code = s)
      on conflict (agent_id, skill_code) do update set ordre = excluded.ordre;
      o := o + 1;
    end loop;
    for s in select unnest(array['rapport_resultats', 'conformite_prospection']) loop
      insert into public.ai_agent_skills(agent_id, skill_code, ordre)
      select a.id, s, 90 from public.ai_agents a where a.code = k and a.archived_at is null
      on conflict (agent_id, skill_code) do nothing;
    end loop;
  end loop;
end $$;
