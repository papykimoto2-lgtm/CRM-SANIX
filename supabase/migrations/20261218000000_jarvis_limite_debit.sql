-- Limite de débit Jarvis : comptage des appels récents par opérateur.
create index if not exists ai_actions_jarvis_appel on public.ai_actions (((payload->>'par')), at desc) where action = 'jarvis_appel';
