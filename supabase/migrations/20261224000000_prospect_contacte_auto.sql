-- Un prospect contacté par message sortant (e-mail, WhatsApp, autre canal) passe automatiquement à « premier contact ».
-- Avant : seul le chemin Gmail/WhatsApp du CRM changeait l'étape ; les messages partis par la file d'envoi de l'entreprise IA
-- laissaient la fiche à « enregistré ». Une seule règle en base couvre désormais tous les chemins d'envoi.
-- Le changement d'étape déclenche déjà la synchronisation vers la fiche du CRM (crm_ia_prospect_emit) et l'historique (ai_guard_stage).
create or replace function public.ai_stage_on_send()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.sens = 'sortant' and new.statut in ('envoye', 'delivre', 'lu') and new.prospect_id is not null then
    update public.ai_prospects
       set stage = 'premier_contact',
           last_outbound_at = greatest(coalesce(last_outbound_at, '-infinity'::timestamptz), coalesce(new.envoye_at, now()))
     where id = new.prospect_id
       and stage in ('identifie', 'enregistre', 'qualifie');
  end if;
  return null;
end
$function$;

drop trigger if exists ai_messages_stage_on_send on public.ai_messages;
create trigger ai_messages_stage_on_send
  after insert or update of statut on public.ai_messages
  for each row execute function public.ai_stage_on_send();

-- Rattrapage : fiches déjà contactées mais restées à une étape antérieure.
update public.ai_prospects p
   set stage = 'premier_contact'
 where p.stage in ('identifie', 'enregistre', 'qualifie')
   and exists (select 1 from public.ai_messages m
                where m.prospect_id = p.id and m.sens = 'sortant' and m.statut in ('envoye', 'delivre', 'lu'));
