-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — WhatsApp en mode manuel (sans clé d'API WhatsApp)
--  Sans WHATSAPP_TOKEN, un message WhatsApp approuvé reste « a_envoyer » : un opérateur l'envoie lui-même depuis son WhatsApp (lien wa.me prérempli dans
--  le bureau), puis l'enregistre ici. Rien ne part sans validation, et rien n'est jamais marqué envoyé sans qu'un humain l'ait confirmé.
--  1. ai_wa_marquer_envoye : l'opérateur confirme l'envoi (statut « envoye », mode « manuel », auteur et date conservés, relance comptée, journal).
--  2. ai_wa_annuler        : l'opérateur renonce à l'envoi (statut « echec », motif conservé).
--  3. ai_wa_reponse        : l'opérateur saisit la réponse reçue (fil de conversation, fenêtre de 24 h, « STOP » → désinscription par le déclencheur existant).
--  Additif et relançable.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.ai_wa_marquer_envoye(p_id bigint, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.ai_messages; p public.ai_prospects;
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  select * into m from public.ai_messages where id = p_id for update;
  if m.id is null or m.sens <> 'sortant' or m.canal <> 'whatsapp' then raise exception 'Message WhatsApp sortant introuvable' using errcode = 'P0002'; end if;
  if m.statut <> 'a_envoyer' then raise exception 'Ce message n''est plus en attente d''envoi (statut : %)', m.statut using errcode = '55000'; end if;
  select * into p from public.ai_prospects where id = m.prospect_id;
  if p.opt_out then raise exception 'Prospect désinscrit : envoi interdit' using errcode = '42501'; end if;
  update public.ai_messages set statut = 'envoye',
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('mode', 'manuel', 'envoye_par', auth.uid(), 'envoye_le', now(), 'note', nullif(left(btrim(coalesce(p_note, '')), 300), ''))
   where id = p_id;
  update public.ai_prospects set last_outbound_at = now(), relances_sans_reponse = relances_sans_reponse + 1 where id = m.prospect_id;
  insert into public.ai_actions(agent, action, prospect_id, payload)
  values ('operateur', 'message_sortant_manuel', m.prospect_id, jsonb_build_object('message', p_id, 'canal', 'whatsapp', 'par', auth.uid()));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ai_wa_annuler(p_id bigint, p_motif text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.ai_messages;
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  select * into m from public.ai_messages where id = p_id for update;
  if m.id is null or m.sens <> 'sortant' or m.canal <> 'whatsapp' then raise exception 'Message WhatsApp sortant introuvable' using errcode = 'P0002'; end if;
  if m.statut <> 'a_envoyer' then raise exception 'Ce message n''est plus en attente d''envoi (statut : %)', m.statut using errcode = '55000'; end if;
  update public.ai_messages set statut = 'echec',
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('detail', 'Envoi manuel abandonné par un opérateur', 'motif', nullif(left(btrim(coalesce(p_motif, '')), 300), ''), 'annule_par', auth.uid())
   where id = p_id;
  insert into public.ai_actions(agent, action, prospect_id, payload)
  values ('operateur', 'message_manuel_annule', m.prospect_id, jsonb_build_object('message', p_id, 'motif', nullif(left(btrim(coalesce(p_motif, '')), 300), '')));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ai_wa_reponse(p_prospect uuid, p_texte text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_texte text := left(btrim(coalesce(p_texte, '')), 4000); v_id bigint; v_opt boolean;
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  if char_length(v_texte) < 1 then raise exception 'Réponse vide' using errcode = '22023'; end if;
  if not exists (select 1 from public.ai_prospects where id = p_prospect) then raise exception 'Prospect introuvable' using errcode = 'P0002'; end if;
  insert into public.ai_messages(prospect_id, canal, sens, auteur, contenu, statut, meta)
  values (p_prospect, 'whatsapp', 'entrant', 'prospect', v_texte, 'recu', jsonb_build_object('mode', 'manuel', 'saisi_par', auth.uid()))
  returning id into v_id;                                                              -- le déclencheur met à jour la fenêtre de 24 h et traite « STOP »
  select opt_out into v_opt from public.ai_prospects where id = p_prospect;
  insert into public.ai_actions(agent, action, prospect_id, payload)
  values ('operateur', 'reponse_manuelle', p_prospect, jsonb_build_object('message', v_id, 'canal', 'whatsapp', 'par', auth.uid(), 'desinscrit', v_opt));
  return jsonb_build_object('ok', true, 'id', v_id, 'desinscrit', v_opt);
end $$;

revoke all on function public.ai_wa_marquer_envoye(bigint, text), public.ai_wa_annuler(bigint, text), public.ai_wa_reponse(uuid, text) from public, anon;
grant execute on function public.ai_wa_marquer_envoye(bigint, text), public.ai_wa_annuler(bigint, text), public.ai_wa_reponse(uuid, text) to authenticated;
