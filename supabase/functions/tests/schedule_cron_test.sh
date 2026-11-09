#!/usr/bin/env bash
# Planificateur (supabase/schedule_cron.sql) : secret généré une seule fois (Vault), 3 tâches, aucun secret dans les requêtes planifiées, appels corrects,
# fonction ai_cron_secret() lisible par le service seul (rien à recopier dans les secrets Edge).
# pg_cron, pg_net et le Vault sont simulés (schémas cron / net / vault) ; le script est exécuté tel quel, hors ses 3 lignes « create extension ».
# Prérequis : PGHOST / PGPORT / PGUSER (super-utilisateur, rôle « postgres » présent). Usage : ./schedule_cron_test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SQL="$HERE/../../schedule_cron.sql"
P="psql -v ON_ERROR_STOP=1 -q -At -U ${PGUSER:-postgres}"; DB="cron_test_$$"; TMP="$(mktemp)"
$P -d postgres -c "create database $DB" >/dev/null
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null; rm -f "$TMP" "$TMP.out"' EXIT
check() { local got; got=$($P -d "$DB" -c "$2"); if [ "$got" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 : attendu $3, obtenu $got"; exit 1; fi; }

$P -d "$DB" >/dev/null <<'SQL'
do $r$ declare x text; begin
  foreach x in array array['anon','authenticated','service_role'] loop
    if not exists (select 1 from pg_roles where rolname = x) then execute format('create role %I nologin', x); end if;
  end loop;
end $r$;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema cron;
create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text, active boolean not null default true);
create function cron.schedule(n text, s text, c text) returns bigint language sql as
  $f$ insert into cron.job(jobname, schedule, command) values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid::bigint $f$;
create schema net;
create table net.calls(id serial primary key, url text, body jsonb, headers jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{"Content-Type": "application/json"}', timeout_milliseconds int default 5000) returns bigint language sql as
  $f$ insert into net.calls(url, body, headers) values (url, body, headers) returning id::bigint $f$;
create schema vault;
create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, description text, secret text);
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as
  $f$ insert into vault.secrets(name, description, secret) values (new_name, new_description, new_secret) returning id $f$;
create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
SQL

[ "$(grep -c '^create extension if not exists \(pg_cron\|pg_net\|supabase_vault\)' "$SQL")" = 3 ] && echo "  ✓ le script active pg_cron, pg_net et le Vault" || { echo "  ✗ extensions"; exit 1; }
grep -v '^create extension' "$SQL" > "$TMP"
run() { $P -d "$DB" -f "$TMP" >"$TMP.out" 2>&1 || { echo "  ✗ le script SQL a échoué :"; sed "s/^/      /" "$TMP.out"; exit 1; }; }
secret() { $P -d "$DB" -c "select decrypted_secret from vault.decrypted_secrets where name='ai_cron_secret'"; }

run
SECRET=$(secret)
[[ "$SECRET" =~ ^[0-9a-f]{64}$ ]] && echo "  ✓ secret généré : 64 caractères hexadécimaux" || { echo "  ✗ secret : $SECRET"; exit 1; }
[ "$(tail -1 "$TMP.out")" = "ai-sales-followups|*/15 * * * *|t" ] && echo "  ✓ la dernière requête liste les tâches planifiées (et n'affiche aucun secret)" || { echo "  ✗ dernière ligne : $(tail -1 "$TMP.out")"; exit 1; }
! grep -q "$SECRET" "$TMP.out" && echo "  ✓ le secret n'apparaît nulle part dans la sortie du script" || { echo "  ✗ secret visible dans la sortie"; exit 1; }
check "ai_cron_secret() rend le secret du Vault" "select public.ai_cron_secret() = '$SECRET'" t
check "lecture refusée à anon et authenticated, permise à service_role" "select (not has_function_privilege('anon','public.ai_cron_secret()','execute'))::text || (not has_function_privilege('authenticated','public.ai_cron_secret()','execute'))::text || has_function_privilege('service_role','public.ai_cron_secret()','execute')::text" "truetruetrue"
check "aucun droit pour PUBLIC" "select count(*) from pg_proc p, aclexplode(p.proacl) a where p.proname='ai_cron_secret' and a.grantee = 0" 0
check "le Vault garde ce secret, en un seul exemplaire" "select count(*) from vault.secrets where name='ai_cron_secret' and secret='$SECRET'" 1
check "3 tâches planifiées (tick/minute, rapports/5 min, relances/15 min)" "select string_agg(jobname||'@'||schedule, ' ' order by jobname) from cron.job" "ai-company-reports@*/5 * * * * ai-company-tick@* * * * * ai-sales-followups@*/15 * * * *"
check "aucun secret dans les requêtes planifiées" "select count(*) from cron.job where position('$SECRET' in command) > 0" 0

exec_jobs() { $P -d "$DB" >/dev/null <<'SQL'
do $b$ declare r record; begin for r in select command from cron.job loop execute r.command; end loop; end $b$;
SQL
}
exec_jobs
check "chaque tâche appelle la bonne fonction avec la bonne action" "select string_agg(regexp_replace(url, '^.*/functions/v1/', '')||':'||(body->>'action'), ' ' order by url, body->>'action') from net.calls" "ai-company:report_tick ai-company:tick ai-sales-director:tick"
check "projet visé : izgpvhwhbrgeagjfhfli" "select count(*) from net.calls where url like 'https://izgpvhwhbrgeagjfhfli.supabase.co/functions/v1/%'" 3
check "en-tête x-cron-secret = secret du Vault, contenu JSON" "select count(*) from net.calls where headers->>'x-cron-secret' = '$SECRET' and headers->>'Content-Type' = 'application/json'" 3

run; SECRET2=$(secret)
[ "$SECRET2" = "$SECRET" ] && echo "  ✓ relance : même secret" || { echo "  ✗ relance : le secret a changé"; exit 1; }
check "relance idempotente : 1 secret, 3 tâches" "select ((select count(*) from vault.secrets)=1 and (select count(*) from cron.job)=3)::text" true

$P -d "$DB" -c "delete from vault.secrets where name='ai_cron_secret'" >/dev/null
run; SECRET3=$(secret)
[[ "$SECRET3" =~ ^[0-9a-f]{64}$ && "$SECRET3" != "$SECRET" ]] && echo "  ✓ rotation : nouveau secret après suppression de l'ancien" || { echo "  ✗ rotation"; exit 1; }
$P -d "$DB" -c "truncate net.calls" >/dev/null; exec_jobs
check "après rotation, les tâches existantes utilisent le nouveau secret" "select count(*) from net.calls where headers->>'x-cron-secret' = '$SECRET3'" 3
check "après rotation, ai_cron_secret() rend le nouveau secret" "select public.ai_cron_secret() = '$SECRET3'" t
echo "Planificateur : TOUT EST OK"
