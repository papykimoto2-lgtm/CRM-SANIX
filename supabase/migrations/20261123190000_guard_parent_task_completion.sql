-- Empêche la clôture réussie d'une mission mère si une sous-mission n'est pas terminée.
-- Une sous-mission explicitement annulée est considérée comme une décision de périmètre.
create or replace function public.ai_task_proof()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.statut = 'terminee' and old.statut is distinct from 'terminee' then
    if exists (
      select 1
        from public.ai_agent_tasks c
       where c.parent_id = new.id
         and c.statut not in ('terminee', 'annulee')
    ) then
      raise exception 'Mission mère non clôturable : une ou plusieurs sous-missions ne sont pas terminées'
        using errcode = '23514';
    end if;

    if new.type <> 'instruction' then
      if jsonb_typeof(new.resultats) is distinct from 'array' or jsonb_array_length(new.resultats) = 0
         or char_length(btrim(coalesce(new.rapport, ''))) < 40 then
        raise exception 'Mission terminée sans preuve : un rapport (40 caractères au moins) et au moins un résultat enregistré sont obligatoires'
          using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end
$function$;

-- Évite qu'une mission mère reste en attente si ses enfants se terminent juste
-- avant son passage en attente (course entre deux transactions).
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
