-- Un e-mail rejeté (adresse invalide) ne vaut pas « contacté ».
-- Défaut corrigé : ai_stage_on_send (20261224000000) passait un prospect à premier_contact dès qu'un message sortant était « envoyé »,
-- y compris vers une adresse que Gmail a ensuite rejetée ; son rattrapage a ainsi marqué à tort 7 fiches.
--  1. L'envoi d'un e-mail vers une adresse déjà invalide ne fait plus avancer l'étape.
--  2. Quand une adresse devient invalide (retour « non distribué »), une fiche à « premier contact » sans réponse ni autre contact réussi
--     revient à son étape précédente (historique inclus). Ce déclencheur s'exécute avant ai_prospects_guard : l'historique d'étapes est écrit.
--  3. Rattrapage : mêmes fiches déjà dans cet état.
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
       and stage in ('identifie', 'enregistre', 'qualifie')
       and not (new.canal = 'email' and email_statut = 'invalide');
  end if;
  return null;
end
$function$;

-- Étape à laquelle rendre une fiche : celle d'avant son dernier passage à premier_contact, sinon « enregistré ».
create or replace function public.ai_etape_avant_contact(p_prospect uuid)
returns text
language sql
stable
set search_path to 'public'
as $$
  select coalesce((select h.de from public.ai_stage_history h
                    where h.prospect_id = p_prospect and h.vers = 'premier_contact' and h.de in ('identifie', 'enregistre', 'qualifie')
                    order by h.at desc limit 1), 'enregistre')
$$;

-- Contact réussi par un autre canal ou réponse du prospect : la fiche reste « contactée ».
create or replace function public.ai_contact_reussi(p_prospect uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select exists (select 1 from public.ai_prospects p where p.id = p_prospect and p.last_inbound_at is not null)
      or exists (select 1 from public.ai_messages m where m.prospect_id = p_prospect and m.sens = 'sortant'
                  and m.canal <> 'email' and m.statut in ('envoye', 'delivre', 'lu'))
$$;

create or replace function public.ai_retour_non_distribue()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.email_statut = 'invalide' and old.email_statut is distinct from 'invalide'
     and new.stage = 'premier_contact' and not public.ai_contact_reussi(new.id) then
    new.stage := public.ai_etape_avant_contact(new.id);
  end if;
  return new;
end
$function$;

drop trigger if exists ai_prospects_0_retour_non_distribue on public.ai_prospects;
create trigger ai_prospects_0_retour_non_distribue
  before update of email_statut on public.ai_prospects
  for each row execute function public.ai_retour_non_distribue();

update public.ai_prospects p
   set stage = public.ai_etape_avant_contact(p.id)
 where p.stage = 'premier_contact' and p.email_statut = 'invalide' and not public.ai_contact_reussi(p.id);
