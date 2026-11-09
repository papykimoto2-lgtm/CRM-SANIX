#!/usr/bin/env python3
"""Vérifie que chaque colonne lue / filtrée / écrite par l'interface existe dans le schéma PostgreSQL réel.
Usage : PGHOST=… PGPORT=… PGUSER=… ./schema_check.py   (après ui_test.js, qui journalise les requêtes dans out/queries.json)"""
import json, os, subprocess, sys
q = json.load(open(os.path.join(os.path.dirname(__file__), "out", "queries.json")))
db = os.environ.get("UI_DB", "vc_ui")
def cols(t):
    return set(subprocess.run(["psql", "-d", db, "-Atc", f"select column_name from information_schema.columns where table_schema='public' and table_name='{t}'"], capture_output=True, text=True).stdout.split())
cache, bad, seen = {}, [], set()
for e in q:
    if "table" not in e: continue
    t = e["table"]; c = cache.setdefault(t, cols(t))
    if not c: bad.append((t, "table inconnue")); continue
    used = set()
    if e["op"] == "select" and e["cols"] != "*" and "(" not in e["cols"]: used |= {x.strip() for x in e["cols"].split(",")}
    used |= {f[0] for f in e["filters"] if f[0]} | set(e["orders"])
    if isinstance(e.get("payload"), list): used |= set(e["payload"])
    bad += [(t, u) for u in used if u not in c]; seen.add(t)
print("tables vérifiées :", ", ".join(sorted(seen))); print("anomalies :", bad or "aucune"); sys.exit(1 if bad else 0)
