-- Autonomie des agents de prospection (mode abonnement) : les missions récurrentes sont créées par la base,
-- sans intervention du président. Aucun envoi externe : tout contact reste soumis à validation.
--
-- 1. ai_qualification_lots()   : toutes les 3 h, une mission de qualification de 40 fiches non qualifiées (si aucune n'est ouverte).
-- 2. ai_prospection_hebdo()    : chaque lundi, une mission de cycle de prospection pour le Responsable prospection.
-- 3. ai_relancer_missions_bloquees_externes() : remet en file les missions bloquées par une cause externe
--    (plafond API, crédits Firecrawl) et libère les dépendances mortes.

create or replace function public.ai_qualification_lots() returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_agent uuid; v_dg uuid; v_id uuid; v_n int;
begin
  if not coalesce((select actif from public.ai_governance where id = 1), false) then return null; end if;
  select id into v_agent from public.ai_agents where code = 'ia_qualif_1' and etat = 'actif' and archived_at is null;
  if v_agent is null then return null; end if;
  select count(*) into v_n from public.ai_prospects
   where stage = 'enregistre' and coalesce(score, 0) = 0 and coalesce(opt_out, false) = false;
  if v_n = 0 then return null; end if;
  select id into v_dg from public.ai_agents where code = 'sanix_ai_general_director';
  insert into public.ai_agent_tasks(agent_id, donneur_agent_id, type, titre, description, objectifs, priorite, echeance)
  values (v_agent, v_dg, 'mission', 'Qualification par lot de 40 fiches non qualifiées',
    E'Il reste ' || v_n || E' fiche(s) enregistrée(s) sans note dans ai_prospects.\n'
    || E'1. Sélectionne au plus 40 fiches : select id, entreprise, secteur, ville, commune, telephone, email, site_web, decideur, resume_ia, produits_recommandes from public.ai_prospects where stage = ''enregistre'' and coalesce(score,0) = 0 and coalesce(opt_out,false) = false order by created_at desc limit 40; (commence par celles du logiciel Angel''s Livraison s''il en reste).\n'
    || E'2. Pour chacune, note-la avec ton barème (produit, besoin, taille, décideur, maturité, fiabilité) UNIQUEMENT à partir des données de la fiche : aucune donnée inventée, une donnée absente = note basse sur ce critère, jamais devinée.\n'
    || E'3. Enregistre avec ai_abonnement_qualifier (justification factuelle d''au moins 30 caractères citant les données de la fiche). Les grands groupes marqués « peu prioritaire » et les fiches sans téléphone ni e-mail reçoivent une note basse avec ce motif.\n'
    || E'4. Aucun contact, aucun envoi. Rapport : nombre noté, répartition des notes, 5 meilleures fiches à contacter en premier.',
    '["40 fiches notées maximum","Justification factuelle pour chaque note","5 meilleures fiches à contacter en premier"]'::jsonb, 1, now() + interval '1 day')
  returning id into v_id;
  return v_id;
exception when others then
  return null;     -- doublon (mission déjà ouverte), agent chargé ou plafond de gouvernance : nouvelle tentative au prochain passage
end $$;
revoke all on function public.ai_qualification_lots() from public, anon, authenticated;
grant execute on function public.ai_qualification_lots() to service_role;

create or replace function public.ai_prospection_hebdo() returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_agent uuid; v_dg uuid; v_id uuid;
begin
  if not coalesce((select actif from public.ai_governance where id = 1), false) then return null; end if;
  select id into v_agent from public.ai_agents where code = 'ia_resp_prospection' and etat = 'actif' and archived_at is null;
  if v_agent is null then return null; end if;
  select id into v_dg from public.ai_agents where code = 'sanix_ai_general_director';
  insert into public.ai_agent_tasks(agent_id, donneur_agent_id, type, titre, description, objectifs, priorite, echeance)
  values (v_agent, v_dg, 'mission', 'Cycle hebdomadaire de prospection',
    E'1. Compte les prospects par logiciel et par étape : select produits_recommandes, stage, count(*) from public.ai_prospects group by 1,2.\n'
    || E'2. Choisis au plus 2 logiciels actifs qui manquent le plus de prospects qualifiés et assigne à tes chasseurs (ia_hunter_1, ia_hunter_2, ia_hunter_3) des missions de 10 fiches maximum chacune, avec des sources précises à lire (pages d''entreprises, annuaires lisibles) ; règle de fond : une fiche n''est créée qu''après lecture de la page et avec une coordonnée publiée.\n'
    || E'3. Mets-toi en attente des sous-missions, puis évalue-les à ton retour et synthétise : fiches créées, motifs des échecs, sources utiles à mémoriser.\n'
    || E'4. Aucun envoi, aucune prise de contact.',
    '["2 logiciels ciblés avec une raison chiffrée","Missions de chasse assignées","Bilan évalué en fin de cycle"]'::jsonb, 2, now() + interval '4 days')
  returning id into v_id;
  return v_id;
exception when others then
  return null;
end $$;
revoke all on function public.ai_prospection_hebdo() from public, anon, authenticated;
grant execute on function public.ai_prospection_hebdo() to service_role;

-- Remise en file des missions bloquées uniquement par une cause externe (plafond d'API, crédits Firecrawl) :
-- les tentatives déjà faites ne comptent plus (reprises = executions). Les dépendances qui pointent vers une mission
-- remise en file sont conservées ; celles qui pointent vers une mission annulée sont supprimées.
create or replace function public.ai_relancer_missions_bloquees_externes(p_jours int default 5) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n_req int := 0; n_dep int := 0;
begin
  with r as (
    update public.ai_agent_tasks t set statut = 'a_faire', reprises = t.executions,
           progression = left(coalesce(t.progression,'') || E'\n[Système] Remise en file : cause externe levée (exécution par abonnement).', 8000)
     where t.statut = 'bloquee' and t.updated_at > now() - make_interval(days => greatest(p_jours, 1))
       and t.agent_id in (select id from public.ai_agents where mode_execution = 'abonnement' and etat = 'actif' and archived_at is null)
       and (coalesce(t.rapport,'') || coalesce(t.progression,'')) ~* '(crédits insuffisants|facturation requise|usage limits|Plafond Anthropic|Plafond API)'
    returning t.id)
  select count(*) into n_req from r;
  with d as (
    delete from public.ai_task_dependencies d using public.ai_agent_tasks x
     where d.depend_de = x.id and x.statut = 'annulee' returning 1)
  select count(*) into n_dep from d;
  return jsonb_build_object('remises_en_file', n_req, 'dependances_supprimees', n_dep);
end $$;
revoke all on function public.ai_relancer_missions_bloquees_externes(int) from public, anon, authenticated;
grant execute on function public.ai_relancer_missions_bloquees_externes(int) to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('ai_qualification_lots', 'ai_prospection_hebdo');
    perform cron.schedule('ai_qualification_lots', '5 */3 * * *', 'select public.ai_qualification_lots();');
    perform cron.schedule('ai_prospection_hebdo', '45 7 * * 1', 'select public.ai_prospection_hebdo();');
  end if;
end $$;
