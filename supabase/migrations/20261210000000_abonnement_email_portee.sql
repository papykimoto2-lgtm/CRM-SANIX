-- Portée de la correction d'e-mail (suite de la revue) : seules les fiches désinscrites ou à un stade avancé sont refusées.
-- Correction : la condition « liée à un client du CRM » bloquait 504 fiches sur 516 (toutes les fiches importées du CRM).
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
  -- Les fiches importées du CRM portent toutes un crm_client_id : seul le stade protège les clients signés ou en cours de contrat.
  if p.stage in ('offre_acceptee','contrat_transmis','contrat_signe','paiement_attendu','paiement_confirme','marche_gagne','deploiement','client_fidelise') then
    raise exception 'Fiche à un stade avancé (%) : non modifiable par la routine', p.stage;
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
