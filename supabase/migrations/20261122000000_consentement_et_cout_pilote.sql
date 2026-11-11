-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — Preuves de consentement enregistrables par la direction + coût IA rattaché au bon logiciel
--  1. Avec `consentement_requis`, l'outil d'envoi refuse même de PRÉPARER un message pour un prospect sans preuve datée : aucun brouillon, donc aucune vente possible.
--     La direction enregistre la preuve (source, date, forme), prospect par prospect ou pour tout le pilote d'un logiciel ; datée, signée et journalisée. Le garde-fou reste entier.
--  2. Le coût IA de l'entonnoir comptait seulement les missions marquées d'un logiciel ; il compte maintenant chaque appel au modèle rattaché à un prospect (son segment)
--     ou à une mission (son logiciel) : le coût par logiciel est celui qui sert à juger la rentabilité du pilote.
--  Additif et relançable.
-- ═════════════════════════════════════════════════════════════════════════════
do $$ begin
  if to_regprocedure('public.ai_cfg_check()') is null or to_regclass('public.ai_pilote') is null then
    raise exception 'Appliquer d''abord les migrations 20261114 et 20261115' using errcode = '55000';
  end if;
end $$;

create or replace function public.ai_consentement_enregistrer(p_prospect uuid, p_canal text, p_preuve text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_preuve text := btrim(coalesce(p_preuve, ''));
begin
  perform public.ai_cfg_check();
  if p_canal not in ('whatsapp', 'email') then raise exception 'Canal invalide (whatsapp ou email)' using errcode = '22023'; end if;
  if char_length(v_preuve) < 10 then raise exception 'Preuve de consentement trop courte (10 caractères au moins : source, date, forme)' using errcode = '22023'; end if;
  update public.ai_prospects set consentement = coalesce(consentement, '{}'::jsonb) ||
         jsonb_build_object(p_canal, jsonb_build_object('at', now(), 'preuve', left(v_preuve, 500), 'par', auth.uid()))
   where id = p_prospect and not opt_out;
  if not found then raise exception 'Prospect introuvable ou désinscrit' using errcode = 'P0002'; end if;
  perform public.ai_cfg_audit('cfg_consentement', jsonb_build_object('prospect', p_prospect, 'canal', p_canal));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ai_consentement_pilote(p_product text, p_canal text, p_preuve text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_preuve text := btrim(coalesce(p_preuve, '')); n int;
begin
  perform public.ai_cfg_check();
  if p_canal not in ('whatsapp', 'email') then raise exception 'Canal invalide (whatsapp ou email)' using errcode = '22023'; end if;
  if char_length(v_preuve) < 20 then raise exception 'Preuve trop courte pour un lot (20 caractères au moins : base juridique, source, date)' using errcode = '22023'; end if;
  update public.ai_prospects p set consentement = coalesce(p.consentement, '{}'::jsonb) ||
         jsonb_build_object(p_canal, jsonb_build_object('at', now(), 'preuve', left(v_preuve, 500), 'par', auth.uid(), 'lot', p_product))
   where not p.opt_out and p.id in (select prospect_id from public.ai_pilote where product_id = p_product)
     and coalesce(p.consentement->p_canal->>'preuve', '') = '';
  get diagnostics n = row_count;
  perform public.ai_cfg_audit('cfg_consentement_lot', jsonb_build_object('produit', p_product, 'canal', p_canal, 'prospects', n));
  return jsonb_build_object('ok', true, 'prospects', n);
end $$;
revoke all on function public.ai_consentement_enregistrer(uuid, text, text), public.ai_consentement_pilote(text, text, text) from public, anon;
grant execute on function public.ai_consentement_enregistrer(uuid, text, text), public.ai_consentement_pilote(text, text, text) to authenticated;

-- Entonnoir : coût IA par logiciel (même colonnes, même ordre ; seule la colonne cout_ia_usd change de définition)
create or replace view public.ai_pilote_entonnoir with (security_invoker = true) as
select s.segment,
       count(*) as prospects,
       count(*) filter (where pl.prospect_id is not null) as dans_le_pilote,
       count(*) filter (where p.score > 0) as qualifies,
       count(*) filter (where p.score >= 80) as prioritaires,
       count(*) filter (where exists (select 1 from public.ai_messages m where m.prospect_id = p.id and m.sens = 'sortant' and m.statut in ('envoye', 'delivre', 'lu'))) as contactes,
       count(*) filter (where exists (select 1 from public.ai_messages m where m.prospect_id = p.id and m.sens = 'entrant')) as reponses,
       count(*) filter (where exists (select 1 from public.ai_appointments a where a.prospect_id = p.id and a.statut in ('confirme', 'realise'))) as rendez_vous,
       count(*) filter (where exists (select 1 from public.ai_appointments a where a.prospect_id = p.id and a.statut = 'realise')) as demonstrations,
       count(*) filter (where exists (select 1 from public.ai_offers o where o.prospect_id = p.id and o.statut in ('envoyee', 'acceptee', 'refusee'))) as offres,
       count(*) filter (where exists (select 1 from public.ai_offers o where o.prospect_id = p.id and o.statut = 'acceptee')) as offres_acceptees,
       coalesce((select sum(a.cout_usd) from public.ai_actions a
                   left join public.ai_prospects ap on ap.id = a.prospect_id
                   left join public.ai_agent_tasks t on t.id = a.task_id
                  where a.action = 'llm_turn' and coalesce(ap.segment, t.produit) = s.segment), 0) as cout_ia_usd,
       coalesce((select v.ca_ht from public.ai_ventes_par_produit v where v.produit = s.segment), 0) as ca_ht_crm
  from public.ai_prospects p
  cross join lateral (select coalesce(p.segment, 'non_segmente') as segment) s
  left join public.ai_pilote pl on pl.prospect_id = p.id
 group by s.segment;
revoke all on public.ai_pilote_entonnoir from anon;
grant select on public.ai_pilote_entonnoir to authenticated;
