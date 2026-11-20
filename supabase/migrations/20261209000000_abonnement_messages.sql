-- Messages et relances pour les agents commerciaux exécutés en mode « abonnement » (routine Claude Code).
-- La routine n'ENVOIE JAMAIS : ai_abonnement_message place le message dans la file de validation du président (statut « a_valider » +
-- approbation), exactement comme le moteur en mode « validation ». Mêmes garde-fous que deliverMessage : gouvernance active et mode « validation »
-- (sinon refus), prospect non désinscrit, preuve de consentement si exigée, mention « assistant IA » au premier message, texte de 4000 caractères.
-- ai_abonnement_relance planifie une relance (comme schedule_followup : 2 h à 60 jours, la relance précédente est annulée). Réservées au service.

create or replace function public.ai_abonnement_message(p_task uuid, p_prospect uuid, p_canal text, p_objet text, p_corps text)
returns jsonb language plpgsql set search_path = public as $$
declare t public.ai_agent_tasks; a public.ai_agents; g public.ai_governance; p public.ai_prospects; v_corps text := btrim(coalesce(p_corps, '')); v_msg bigint; v_ap uuid; n int; consent jsonb; ok_consent boolean := false;
  disclosure constant text := 'Je suis l''assistant commercial virtuel (IA) de SANIX AFRICA ; un conseiller humain peut prendre le relais à tout moment.';
begin
  select * into t from public.ai_agent_tasks where id = p_task for update;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' or a.etat <> 'actif' then raise exception 'L''agent n''est pas actif en mode abonnement'; end if;
  if t.statut <> 'en_cours' then raise exception 'La mission n''est pas en cours (statut : %)', t.statut; end if;
  if not ('send_message' = any(a.outils)) then raise exception 'Cet agent n''a pas l''outil send_message'; end if;
  select * into g from public.ai_governance where id = 1;
  if g.actif is false or coalesce(g.communication_externe, 'validation') <> 'validation' then
    raise exception 'La routine ne prépare des messages que lorsque la gouvernance impose la validation du président (mode actuel : %)', coalesce(g.communication_externe, 'validation');
  end if;
  if p_canal not in ('email', 'whatsapp') then raise exception 'Canal : email ou whatsapp'; end if;
  if length(v_corps) < 20 then raise exception 'Message trop court'; end if;
  select * into p from public.ai_prospects where id = p_prospect for update;
  if p.id is null then raise exception 'Prospect introuvable'; end if;
  if p.opt_out then raise exception 'Prospect désinscrit : envoi interdit'; end if;
  if p_canal = 'email' and (p.email is null or p.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'Aucune adresse e-mail valide sur cette fiche'; end if;
  if p_canal = 'whatsapp' and coalesce(p.whatsapp, p.telephone) is null then raise exception 'Aucun numéro sur cette fiche'; end if;
  if coalesce(g.consentement_requis, false) then
    if p_canal = 'whatsapp' and p.last_inbound_at is not null and now() - p.last_inbound_at < interval '24 hours' then ok_consent := true; end if;
    consent := p.consentement -> p_canal;
    if not ok_consent and jsonb_typeof(consent) = 'object' and length(btrim(coalesce(consent->>'preuve', ''))) > 0 and (consent->>'at') is not null and (consent->>'at')::timestamptz <= now() then ok_consent := true; end if;
    if not ok_consent then raise exception 'Envoi % bloqué : la gouvernance exige une preuve de consentement', p_canal; end if;
  end if;
  if exists (select 1 from public.ai_messages m where m.prospect_id = p.id and m.canal = p_canal and m.sens = 'sortant' and m.statut = 'a_valider') then
    raise exception 'Un message % est déjà en attente de validation pour ce prospect : ne le renvoie pas', p_canal;
  end if;
  select count(*) into n from public.ai_actions where action = 'abonnement_message_prepare' and task_id = t.id;
  if n >= 30 then raise exception 'Plafond de 30 messages préparés atteint pour cette mission : clôture et rapporte'; end if;
  v_corps := left(v_corps, 4000);
  if not exists (select 1 from public.ai_messages m where m.prospect_id = p.id and m.sens = 'sortant' and m.statut in ('envoye', 'delivre', 'lu', 'a_envoyer')) then
    v_corps := left(v_corps, 4000 - length(disclosure) - 2) || E'\n\n' || disclosure;
  end if;
  insert into public.ai_messages(prospect_id, canal, sens, auteur, contenu, statut, meta)
    values (p.id, p_canal, 'sortant', 'agent', v_corps, 'a_valider', jsonb_build_object('objet', nullif(left(btrim(coalesce(p_objet, '')), 300), ''), 'agent_id', a.id, 'via', 'abonnement'))
    returning id into v_msg;
  insert into public.ai_approvals(type, prospect_id, agent_id, motif, payload)
    values ('message', p.id, a.id, 'Message ' || p_canal || ' à ' || p.entreprise, jsonb_build_object('message_id', v_msg, 'canal', p_canal, 'objet', nullif(left(btrim(coalesce(p_objet, '')), 300), ''), 'apercu', left(v_corps, 600)))
    returning id into v_ap;
  insert into public.ai_actions(agent, action, agent_id, task_id, prospect_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_message_prepare', a.id, t.id, p.id, jsonb_build_object('canal', p_canal, 'message_id', v_msg, 'approval_id', v_ap), true, 0);
  return jsonb_build_object('statut', 'a_valider', 'detail', 'En attente de validation du président', 'message_id', v_msg, 'approval_id', v_ap,
                            'consigne', 'Message soumis à validation : ne le renvoie pas, passe au prospect suivant ou termine.');
end $$;

create or replace function public.ai_abonnement_relance(p_task uuid, p_prospect uuid, p_dans_heures int, p_scenario text, p_canal text)
returns jsonb language plpgsql set search_path = public as $$
declare t public.ai_agent_tasks; a public.ai_agents; p public.ai_prospects; h int := greatest(2, least(coalesce(p_dans_heures, 24), 24 * 60)); v_due timestamptz; n int;
begin
  select * into t from public.ai_agent_tasks where id = p_task for update;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' or a.etat <> 'actif' then raise exception 'L''agent n''est pas actif en mode abonnement'; end if;
  if t.statut <> 'en_cours' then raise exception 'La mission n''est pas en cours (statut : %)', t.statut; end if;
  if not ('schedule_followup' = any(a.outils)) then raise exception 'Cet agent n''a pas l''outil schedule_followup'; end if;
  if p_canal not in ('whatsapp', 'email', 'telephone') then raise exception 'Canal : whatsapp, email ou telephone'; end if;
  if length(btrim(coalesce(p_scenario, ''))) < 5 then raise exception 'Scénario de relance requis'; end if;
  select * into p from public.ai_prospects where id = p_prospect for update;
  if p.id is null then raise exception 'Prospect introuvable'; end if;
  if p.opt_out then raise exception 'Prospect désinscrit : aucune relance'; end if;
  select count(*) into n from public.ai_actions where action = 'abonnement_relance_planifiee' and task_id = t.id;
  if n >= 50 then raise exception 'Plafond de 50 relances planifiées atteint pour cette mission : clôture et rapporte'; end if;
  v_due := now() + make_interval(hours => h);
  update public.ai_followups set statut = 'annulee' where prospect_id = p.id and statut = 'planifiee';
  insert into public.ai_followups(prospect_id, due_at, scenario, canal) values (p.id, v_due, left(btrim(p_scenario), 300), p_canal);
  update public.ai_prospects set next_action_at = v_due where id = p.id;
  insert into public.ai_actions(agent, action, agent_id, task_id, prospect_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_relance_planifiee', a.id, t.id, p.id, jsonb_build_object('due_at', v_due, 'canal', p_canal), true, 0);
  return jsonb_build_object('due_at', v_due);
end $$;

revoke all on function public.ai_abonnement_message(uuid, uuid, text, text, text), public.ai_abonnement_relance(uuid, uuid, int, text, text) from public, anon, authenticated;
grant execute on function public.ai_abonnement_message(uuid, uuid, text, text, text), public.ai_abonnement_relance(uuid, uuid, int, text, text) to service_role;
