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
