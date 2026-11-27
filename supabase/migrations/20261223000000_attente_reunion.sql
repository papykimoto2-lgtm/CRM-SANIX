-- Une mission mise en attente ne doit être relancée tout de suite que si elle n'attend PLUS rien :
-- ni sous-mission ouverte, ni réunion planifiée ou en cours (convoquer_reunion puis attendre_sous_taches).
-- La version précédente (20261123190000_guard_parent_task_completion) ne regardait que les sous-missions :
-- un directeur qui convoquait une réunion était relancé aussitôt, sans attendre le procès-verbal.
-- En production, ce garde-fou de course n'était pas encore présent : cette migration l'installe, réunions comprises.
create or replace function public.ai_tasks_after()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.statut is distinct from old.statut and new.statut = 'attente_sous_taches' then
    if not exists (
      select 1 from public.ai_agent_tasks c
       where c.parent_id = new.id
         and c.statut in ('a_faire','en_cours','attente_sous_taches','attente_validation')
    ) and not exists (
      select 1 from public.ai_agent_meetings m
       where m.task_id = new.id and m.statut in ('planifiee','en_cours')
    ) then
      update public.ai_agent_tasks
         set statut = 'a_faire', reprises = reprises + 1
       where id = new.id and statut = 'attente_sous_taches';
    end if;
  end if;

  if new.statut is distinct from old.statut and new.statut in ('terminee','echouee','annulee','bloquee') then
    if new.parent_id is not null then
      update public.ai_agent_tasks p set statut = 'a_faire', reprises = p.reprises + 1
       where p.id = new.parent_id and p.statut = 'attente_sous_taches'
         and not exists (select 1 from public.ai_agent_tasks c where c.parent_id = p.id
                          and c.statut in ('a_faire','en_cours','attente_sous_taches','attente_validation'));
    end if;
    if new.statut in ('echouee','annulee') then
      update public.ai_agent_tasks t set statut = 'bloquee',
             progression = left(coalesce(t.progression,'') || E'\n[Système] Dépendance « ' || new.titre || ' » ' || new.statut, 8000)
       where t.statut = 'a_faire' and t.id in (select d.task_id from public.ai_task_dependencies d where d.depend_de = new.id);
    end if;
  end if;
  return null;
end
$function$;
