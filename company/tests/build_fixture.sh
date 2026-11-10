#!/usr/bin/env bash
# Reconstruit la base d'interface « vc_ui » depuis le modèle migré (supabase/functions/tests/setup_db.sh), charge les jeux de
# données de démonstration (organisation, présence, réunion en cours) et exporte fixture.json (état réel de PostgreSQL).
set -euo pipefail
cd "$(dirname "$0")"
P="psql -v ON_ERROR_STOP=1 -q -U ${PGUSER:-postgres}"
$P -d postgres -c 'drop database if exists vc_ui' -c 'create database vc_ui template vc_tpl' >/dev/null
$P -d vc_ui -f fixture.sql -f fixture_presence.sql >/dev/null
{ echo "set request.jwt.claim.role = 'service_role';"; echo "select json_build_object(
  'ai_agents', (select json_agg(t) from ai_agents t), 'ai_departments', (select json_agg(t) from ai_departments t), 'ai_agent_tasks', (select json_agg(t) from ai_agent_tasks t),
  'ai_approvals', (select coalesce(json_agg(t), '[]') from ai_approvals t where statut = 'en_attente'), 'ai_executive_messages', (select json_agg(t) from ai_executive_messages t),
  'ai_agent_meetings', (select json_agg(t) from ai_agent_meetings t), 'ai_meeting_participants', (select json_agg(t) from ai_meeting_participants t), 'ai_meeting_minutes', (select json_agg(t) from ai_meeting_minutes t),
  'ai_report_settings', (select json_agg(t) from ai_report_settings t), 'ai_report_recipients', (select json_agg(t) from ai_report_recipients t), 'ai_daily_reports', (select json_agg(t) from ai_daily_reports t),
  'ai_agent_charters', (select json_agg(t) from ai_agent_charters t), 'ai_operators', (select json_agg(t) from ai_operators t), 'ai_prospects', (select json_agg(t) from ai_prospects t),
  'ai_kpis', (select coalesce(json_agg(t), '[]') from ai_kpis t), 'ai_governance', (select json_agg(t) from ai_governance t),
  'ai_products', (select json_agg(t) from ai_products t), 'ai_offers', (select coalesce(json_agg(t), '[]') from ai_offers t),
  'ai_agent_events', (select coalesce(json_agg(t), '[]') from ai_agent_events t), 'ai_agent_communications', (select coalesce(json_agg(t), '[]') from ai_agent_communications t),
  'ai_messages', (select coalesce(json_agg(t), '[]') from ai_messages t), 'ai_actions', (select coalesce(json_agg(t), '[]') from (select * from ai_actions where action = 'send_message') t),
  'rpc', json_build_object('ai_budget_status', ai_budget_status(), 'ai_agent_stats', (select json_agg(t) from ai_agent_stats(now() - interval '7 days', now()) t))
);"; } | $P -d vc_ui -Atq > fixture.json
python3 - <<'PY'
import json; d = json.load(open('fixture.json')); print({k: (len(v) if isinstance(v, list) else 'obj') for k, v in d.items()})
PY
