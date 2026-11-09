#!/usr/bin/env bash
# Prépare la base modèle « vc_tpl » (stub Auth + migrations). Usage : PGHOST=... PGPORT=... ./setup_db.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../migrations"
P="psql -v ON_ERROR_STOP=1 -q -U ${PGUSER:-postgres}"
$P -d postgres -c 'drop database if exists vc_tpl' -c 'create database vc_tpl' 2>&1 | grep -v NOTICE || true
$P -d vc_tpl -f "$HERE/auth_stub.sql" $(for f in "$MIG"/*.sql; do printf -- '-f %s ' "$f"; done) 2>&1 | grep -v NOTICE || true
echo "Base modèle prête : vc_tpl"
