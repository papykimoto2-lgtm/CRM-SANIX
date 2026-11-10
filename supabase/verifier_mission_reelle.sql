-- SANIX AI — contrôle du test de mission réelle (Phase 2). LECTURE SEULE.
-- À exécuter après avoir donné une instruction au directeur général IA avec un vrai modèle (voir docs/PHASE2_TEST_REEL.md).
-- Supabase → SQL Editor → coller → Run. Une ligne par contrôle : OK, À FAIRE ou INFO.
with m as (select * from public.ai_agent_tasks where created_at > now() - interval '24 hours'),
c as (
  select 10 ord, 'Appels IA réussis (coût enregistré)' controle,
         (select count(*) from public.ai_actions where action = 'llm_turn' and at > now() - interval '24 hours')::text v,
         (select count(*) from public.ai_actions where action = 'llm_turn' and at > now() - interval '24 hours') >= 1 ok
  union all select 20, 'Coût IA des dernières 24 h (USD)', (select coalesce(sum(cout_usd), 0)::text from public.ai_actions where action = 'llm_turn' and at > now() - interval '24 hours'), null
  union all select 30, 'Missions terminées (24 h)', (select count(*) from m where statut = 'terminee')::text, (select count(*) from m where statut = 'terminee') >= 1
  union all select 40, 'Missions terminées SANS rapport substantiel ni résultat (doit être 0)',
         (select count(*) from m where statut = 'terminee' and type <> 'instruction' and (jsonb_array_length(resultats) = 0 or char_length(coalesce(rapport, '')) < 40))::text,
         (select count(*) from m where statut = 'terminee' and type <> 'instruction' and (jsonb_array_length(resultats) = 0 or char_length(coalesce(rapport, '')) < 40)) = 0
  union all select 50, 'Missions terminées dont le coût IA est renseigné', (select count(*) from m where statut = 'terminee' and cout_usd > 0)::text, (select count(*) from m where statut = 'terminee' and cout_usd > 0) >= 1
  union all select 60, 'Missions par statut (24 h)', coalesce((select string_agg(statut || ' ' || n, ' · ' order by statut) from (select statut, count(*) n from m group by 1) t), 'aucune'), null
  union all select 70, 'Prospects scorés avec justification (24 h)', (select count(*) from public.ai_prospects where score > 0 and char_length(coalesce(score_justification, '')) >= 30 and updated_at > now() - interval '24 hours')::text,
         (select count(*) from public.ai_prospects where score > 0 and char_length(coalesce(score_justification, '')) >= 30 and updated_at > now() - interval '24 hours') >= 1
  union all select 80, 'Prospects scorés SANS justification (doit être 0)', (select count(*) from public.ai_prospects where score > 0 and char_length(coalesce(score_justification, '')) < 30)::text,
         (select count(*) from public.ai_prospects where score > 0 and char_length(coalesce(score_justification, '')) < 30) = 0
  union all select 90, 'Messages réellement ENVOYÉS (doit être 0 pendant le test)', (select count(*) from public.ai_messages where sens = 'sortant' and statut = 'envoye')::text,
         (select count(*) from public.ai_messages where sens = 'sortant' and statut = 'envoye') = 0
  union all select 100, 'Messages en attente de validation du président', (select count(*) from public.ai_approvals where type = 'message' and statut = 'en_attente')::text, null
  union all select 110, 'Gouvernance : communication externe / consentement', (select communication_externe || ' / ' || consentement_requis::text from public.ai_governance where id = 1),
         (select communication_externe <> 'autonome' from public.ai_governance where id = 1)
  union all select 120, 'Incidents des dernières 24 h (par type)', coalesce((select string_agg(type || ' ' || n, ' · ' order by n desc) from (select type, count(*) n from public.ai_incidents where created_at > now() - interval '24 hours' group by 1) t), 'aucun'), null
  union all select 130, 'Agents suspendus', (select count(*) from public.ai_agents where etat = 'suspendu')::text, null
)
select controle as "contrôle", v as "résultat", case when ok is null then 'INFO' when ok then 'OK' else 'À FAIRE' end as "état" from c order by ord;
