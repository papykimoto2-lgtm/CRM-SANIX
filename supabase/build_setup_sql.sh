#!/bin/sh
# Concatène les migrations (ordre chronologique) en un seul fichier à coller dans Supabase → SQL Editor : setup_all.sql
# À régénérer après toute nouvelle migration : sh supabase/build_setup_sql.sh
cd "$(dirname "$0")" || exit 1
{
  echo "-- SANIX AI — schéma complet : toutes les migrations dans l'ordre (généré par build_setup_sql.sh, ne pas modifier à la main)."
  echo "-- Supabase → SQL Editor → coller ce fichier en une fois → Run. Équivalent de « supabase db push »."
  for f in migrations/*.sql; do printf '\n-- ═══ %s ═══\n' "$(basename "$f")"; cat "$f"; done
} > setup_all.sql
echo "setup_all.sql : $(wc -l < setup_all.sql) lignes, $(ls migrations/*.sql | wc -l) migrations"
