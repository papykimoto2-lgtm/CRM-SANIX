-- Bureau 3D : les participants d'une réunion sont diffusés en temps réel (les agents rejoignent la table dès la convocation).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ai_meeting_participants;
  end if;
exception when duplicate_object then null; end $$;
