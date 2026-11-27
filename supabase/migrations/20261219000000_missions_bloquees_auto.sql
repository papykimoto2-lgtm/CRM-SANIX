-- Traitement automatique des missions bloquées : aucune mission ne reste dans l'état « bloquee ».
-- Toutes les 10 minutes, chaque mission bloquée depuis plus de 5 minutes reçoit UNE issue, dans cet ordre :
--   1. obsolete   : une mission plus récente du même agent et du même objet existe -> annulée (remplacée).
--   2. cause externe encore active (pause du plafond API sur un agent en mode api) -> laissée à la bascule vers l'abonnement.
--   3. dependance : dépendances vers des missions annulées / échouées supprimées -> remise en file.
--   4. reaffectee : l'agent n'a pas les outils (qualification, chasse) -> confiée à l'agent équipé, remise en file.
--   5. remise     : nouvelle tentative automatique (3 au plus par mission) pour un agent actif en mode abonnement.
--   6. echouee    : plus rien d'automatique possible -> clôturée « echouee » avec une alerte « decision_requise » pour le président.
-- Chaque décision est tracée dans ai_missions_bloquees_journal.

create table if not exists public.ai_missions_bloquees_journal (
  id         bigserial primary key,
  task_id    uuid not null,
  agent_code text,
  regle      text not null,
  detail     text,
  at         timestamptz not null default now()
);
create index if not exists ai_missions_bloquees_journal_at on public.ai_missions_bloquees_journal(at desc);
alter table public.ai_missions_bloquees_journal enable row level security;
revoke all on public.ai_missions_bloquees_journal from public, anon, authenticated;
grant all on public.ai_missions_bloquees_journal to service_role;
grant usage, select on sequence public.ai_missions_bloquees_journal_id_seq to service_role;

create or replace function public.ai_traiter_missions_bloquees(p_min_minutes int default 5) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.ai_governance; t record; v_pause boolean; txt text; v_n int; v_cible uuid; v_marq constant text := '[Système] Remise automatique';
  v_dep int; v_reste int; r_obs int := 0; r_dep int := 0; r_rea int := 0; r_rem int := 0; r_ech int := 0; r_att int := 0;
  v_outils_manquants constant text := '(non exécutable|ne permettent pas|pas accessible avec mes outils|outil[^.]{0,40}(absent|manquant|indisponible)|n''existe pas dans le catalogue)';
begin
  select * into g from public.ai_governance where id = 1;
  v_pause := g.provider_pause_until is not null and g.provider_pause_until > now();
  for t in
    select k.*, a.code as agent_code, a.mode_execution as mode, a.etat as agent_etat
      from public.ai_agent_tasks k join public.ai_agents a on a.id = k.agent_id
     where k.statut = 'bloquee' and k.updated_at < now() - make_interval(mins => greatest(p_min_minutes, 1))
     order by k.updated_at
  loop
    txt := coalesce(t.rapport, '') || ' ' || coalesce(t.progression, '');
    v_n := (length(txt) - length(replace(txt, v_marq, ''))) / length(v_marq);
    begin
      -- 1. obsolète
      if exists (select 1 from public.ai_agent_tasks o
                  where o.id <> t.id and o.agent_id = t.agent_id and o.created_at > t.created_at and left(o.titre_norm, 40) = left(t.titre_norm, 40)
                    and o.statut in ('terminee', 'a_faire', 'en_cours', 'attente_sous_taches', 'attente_validation')) then
        update public.ai_agent_tasks set statut = 'annulee',
               progression = left(coalesce(progression, '') || E'\n[Système] Annulée : remplacée par une mission plus récente de même objet.', 8000) where id = t.id;
        insert into public.ai_missions_bloquees_journal(task_id, agent_code, regle, detail) values (t.id, t.agent_code, 'obsolete', 'Remplacée par une mission plus récente');
        r_obs := r_obs + 1; continue;
      end if;
      -- 2. cause externe encore active : la bascule vers l'abonnement s'en charge
      if v_pause and t.mode = 'api' and txt ~* '(usage limits|Plafond Anthropic|Plafond API)' then
        r_att := r_att + 1; continue;
      end if;
      -- 3. dépendances mortes
      select count(*) into v_dep from public.ai_task_dependencies d join public.ai_agent_tasks x on x.id = d.depend_de
       where d.task_id = t.id and x.statut in ('annulee', 'echouee');
      if v_dep > 0 or txt ~* 'Dépendance' then
        delete from public.ai_task_dependencies d using public.ai_agent_tasks x where d.task_id = t.id and x.id = d.depend_de and x.statut in ('annulee', 'echouee');
        select count(*) into v_reste from public.ai_task_dependencies d join public.ai_agent_tasks x on x.id = d.depend_de where d.task_id = t.id and x.statut <> 'terminee';
        if v_reste = 0 and v_n < 3 and t.agent_etat = 'actif' then
          update public.ai_agent_tasks set statut = 'a_faire', reprises = executions, started_at = null,
                 progression = left(coalesce(progression, '') || E'\n' || v_marq || ' (dépendance morte supprimée).', 8000) where id = t.id;
          insert into public.ai_missions_bloquees_journal(task_id, agent_code, regle, detail) values (t.id, t.agent_code, 'dependance', v_dep || ' dépendance(s) morte(s) supprimée(s)');
          r_dep := r_dep + 1; continue;
        end if;
      end if;
      -- 4. réaffectation vers l'agent équipé
      v_cible := null;
      if txt ~* v_outils_manquants and v_n < 3 then
        if t.titre ~* 'qualifi' then
          select id into v_cible from public.ai_agents where code = 'ia_qualif_1' and etat = 'actif' and archived_at is null and id <> t.agent_id;
        elsif t.titre ~* '(prospection|recherche|garages|fiches (vérifiées|complémentaires)|chasse)' then
          select ag.id into v_cible from public.ai_agents ag
           where ag.code in ('ia_hunter_1', 'ia_hunter_2', 'ia_hunter_3') and ag.etat = 'actif' and ag.archived_at is null and ag.id <> t.agent_id
           order by (select count(*) from public.ai_agent_tasks o where o.agent_id = ag.id and o.statut in ('a_faire', 'en_cours')), ag.code limit 1;
        end if;
        if v_cible is not null then
          begin
            update public.ai_agent_tasks set agent_id = v_cible, statut = 'a_faire', reprises = executions, started_at = null,
                   progression = left(coalesce(progression, '') || E'\n' || v_marq || ' (confiée à un agent équipé des outils nécessaires).', 8000) where id = t.id;
            insert into public.ai_missions_bloquees_journal(task_id, agent_code, regle, detail)
            values (t.id, t.agent_code, 'reaffectee', 'Confiée à ' || (select code from public.ai_agents where id = v_cible));
            r_rea := r_rea + 1; continue;
          exception when others then null;   -- agent chargé ou plafond de gouvernance : on passe à la règle suivante
          end;
        end if;
      end if;
      -- 5. nouvelle tentative automatique (abonnement)
      if v_n < 3 and t.agent_etat = 'actif' and t.mode = 'abonnement' then
        update public.ai_agent_tasks set statut = 'a_faire', reprises = executions, started_at = null,
               progression = left(coalesce(progression, '') || E'\n' || v_marq || ' (tentative ' || (v_n + 1) || '/3).', 8000) where id = t.id;
        insert into public.ai_missions_bloquees_journal(task_id, agent_code, regle, detail) values (t.id, t.agent_code, 'remise', 'Tentative ' || (v_n + 1) || '/3');
        r_rem := r_rem + 1; continue;
      end if;
      -- 6. plus rien d'automatique : clôture propre + décision demandée au président
      update public.ai_agent_tasks set statut = 'echouee', finished_at = coalesce(finished_at, now()),
             progression = left(coalesce(progression, '') || E'\n[Système] Clôturée « échouée » : aucune reprise automatique possible. Décision du président demandée.', 8000) where id = t.id;
      insert into public.ai_incidents(gravite, type, agent_id, task_id, message)
      values ('attention', 'decision_requise', t.agent_id, t.id,
              left('Mission « ' || t.titre || E' » : plus de reprise automatique possible. Dernier constat : ' || left(regexp_replace(txt, E'\\s+', ' ', 'g'), 600), 4000));
      insert into public.ai_missions_bloquees_journal(task_id, agent_code, regle, detail) values (t.id, t.agent_code, 'echouee', 'Décision du président demandée');
      r_ech := r_ech + 1;
    exception when others then
      insert into public.ai_missions_bloquees_journal(task_id, agent_code, regle, detail) values (t.id, t.agent_code, 'erreur', left(sqlerrm, 300));
    end;
  end loop;
  return jsonb_build_object('obsoletes_annulees', r_obs, 'dependances_levees', r_dep, 'reaffectees', r_rea, 'remises_en_file', r_rem, 'echouees_avec_decision', r_ech, 'en_attente_bascule', r_att);
end $$;
revoke all on function public.ai_traiter_missions_bloquees(int) from public, anon, authenticated;
grant execute on function public.ai_traiter_missions_bloquees(int) to service_role;

-- La bascule vers l'abonnement appelle désormais le traitement général (il couvre la remise en file des missions bloquées par le plafond).
create or replace function public.ai_bascule_plafond_api() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.ai_governance; a record; n_b int := 0; n_r int := 0; v_rel jsonb := '{}'::jsonb;
begin
  select * into g from public.ai_governance where id = 1;
  if g.provider_pause_until is not null and g.provider_pause_until > now() then
    for a in
      select ag.id, ag.code, ag.mode_execution from public.ai_agents ag
       where ag.etat = 'actif' and ag.archived_at is null and ag.mode_execution = 'api'
         and exists (select 1 from public.ai_agent_tasks t
                      where t.agent_id = ag.id and t.statut in ('bloquee', 'a_faire') and t.updated_at > now() - interval '7 days'
                        and (coalesce(t.progression, '') || coalesce(t.rapport, '')) ~* '(usage limits|Plafond Anthropic|Plafond API)')
    loop
      insert into public.ai_bascule_modes(agent_id, mode_avant, raison)
      values (a.id, a.mode_execution, left('Plafond API : ' || coalesce(g.provider_pause_reason, ''), 300))
      on conflict (agent_id) do update set mode_avant = excluded.mode_avant, bascule_at = now(), raison = excluded.raison, restaure_at = null;
      update public.ai_agents set mode_execution = 'abonnement', updated_at = now() where id = a.id;
      insert into public.ai_actions(agent, action, agent_id, payload, ok)
      values ('systeme', 'bascule_abonnement', a.id, jsonb_build_object('agent', a.code, 'jusqu_au', g.provider_pause_until), true);
      n_b := n_b + 1;
    end loop;
  else
    for a in
      select b.agent_id, b.mode_avant, ag.code from public.ai_bascule_modes b join public.ai_agents ag on ag.id = b.agent_id
       where b.restaure_at is null
         and not exists (select 1 from public.ai_agent_tasks t where t.agent_id = b.agent_id and t.statut = 'en_cours')
    loop
      update public.ai_agents set mode_execution = a.mode_avant, updated_at = now() where id = a.agent_id and mode_execution = 'abonnement';
      update public.ai_bascule_modes set restaure_at = now() where agent_id = a.agent_id;
      insert into public.ai_actions(agent, action, agent_id, payload, ok)
      values ('systeme', 'retour_mode_api', a.agent_id, jsonb_build_object('agent', a.code, 'mode', a.mode_avant), true);
      n_r := n_r + 1;
    end loop;
  end if;
  v_rel := public.ai_traiter_missions_bloquees(0);
  return jsonb_build_object('bascules', n_b, 'restaures', n_r, 'missions', v_rel, 'pause_jusqu_au', g.provider_pause_until);
end $$;
revoke all on function public.ai_bascule_plafond_api() from public, anon, authenticated;
grant execute on function public.ai_bascule_plafond_api() to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ai_missions_bloquees_auto';
    perform cron.schedule('ai_missions_bloquees_auto', '7-59/10 * * * *', 'select public.ai_traiter_missions_bloquees();');
  end if;
end $$;
