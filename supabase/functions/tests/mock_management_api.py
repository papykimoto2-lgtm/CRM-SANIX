#!/usr/bin/env python3
"""Faux serveur de l'API de gestion Supabase pour les essais de supabase/tools/deploy_functions.sh (non livré en production).

Variables : MOCK_TOKEN (jeton attendu), MOCK_STATE (fichier JSON d'état écrit à chaque requête), MOCK_PORT_FILE (reçoit le port),
MOCK_MODE : normal | legacy (API de déploiement absente, repli historique) | jwton (Verify JWT actif après déploiement) | novault (pas de secret au Vault)
MOCK_ANTHROPIC=1 : le secret ANTHROPIC_API_KEY existe déjà ; MOCK_NET=bad : le planificateur reçoit des 404.
"""
import json, os, re, secrets, sys
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

TOKEN = os.environ["MOCK_TOKEN"]
MODE = os.environ.get("MOCK_MODE", "normal")
VAULT = secrets.token_hex(32)
STATE = {"functions": {}, "secrets": {}, "calls": [], "deploys": [], "vault": VAULT, "deleted": []}
if os.environ.get("MOCK_ANTHROPIC") == "1":
    STATE["secrets"]["ANTHROPIC_API_KEY"] = "x"
if os.environ.get("MOCK_PRESET_FUNCTION"):
    STATE["functions"][os.environ["MOCK_PRESET_FUNCTION"]] = {"slug": os.environ["MOCK_PRESET_FUNCTION"], "name": os.environ["MOCK_PRESET_FUNCTION"], "status": "ACTIVE", "version": 1, "verify_jwt": True}


def save():
    with open(os.environ["MOCK_STATE"], "w") as f:
        json.dump({**STATE, "cron_secret_matches_vault": STATE["secrets"].get("CRON_SECRET") == VAULT}, f)


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send(self, code, obj=None, raw=None):
        body = raw if raw is not None else (json.dumps(obj).encode() if obj is not None else b"")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_any(self, method):
        u = urlparse(self.path)
        path, q = u.path, parse_qs(u.query)
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        STATE["calls"].append({"m": method, "p": path + ("?" + u.query if u.query else ""), "len": len(body)})
        try:
            self.route(method, path, q, body)
        finally:
            save()

    def route(self, method, path, q, body):
        # Sondages publics des fonctions Edge
        if path.startswith("/functions/v1/"):
            name = path.split("/")[3]
            if name not in STATE["functions"]:
                return self.send(404, {"message": "Function not found"})
            if name == "whatsapp-webhook":
                return self.send(403, raw=b"Forbidden")
            if "CRON_SECRET" not in STATE["secrets"]:
                return self.send(500, {"error": "Erreur interne"})
            return self.send(401 if self.headers.get("x-cron-secret") != STATE["secrets"]["CRON_SECRET"] else 202, {"error": "Non autorisé"})
        # API de gestion
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self.send(401, {"message": "JWT could not be decoded"})
        m = re.match(r"^/v1/projects/([^/]+)(/.*)?$", path)
        if not m:
            return self.send(404, {"message": "not found"})
        sub = m.group(2) or ""
        if sub == "" and method == "GET":
            return self.send(200, {"id": m.group(1), "name": "Mock SANIX", "status": "ACTIVE_HEALTHY"})
        if sub == "/functions/deploy" and method == "POST":
            if MODE == "legacy":
                return self.send(404, {"message": "Cannot POST /v1/projects/x/functions/deploy"})
            ctype = self.headers.get("Content-Type", "")
            msg = BytesParser(policy=policy.HTTP).parsebytes(b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + body)
            parts = {}
            for p in msg.iter_parts():
                parts[p.get_param("name", header="content-disposition")] = (p.get_filename(), p.get_payload(decode=True))
            meta = json.loads(parts["metadata"][1])
            fname, content = parts["file"]
            slug = q.get("slug", [""])[0]
            STATE["deploys"].append({"slug": slug, "meta": meta, "filename": fname, "size": len(content)})
            ok = meta.get("entrypoint_path") == "index.ts" and meta.get("name") == slug and fname == "index.ts" and len(content) > 1000
            if not ok:
                return self.send(400, {"message": "metadata invalide"})
            old = STATE["functions"].get(slug)
            STATE["functions"][slug] = {"slug": slug, "name": slug, "status": "ACTIVE", "version": (old["version"] + 1) if old else 1,
                                        "verify_jwt": True if MODE == "jwton" else bool(meta.get("verify_jwt"))}
            return self.send(201, STATE["functions"][slug])
        if sub == "/functions" and method == "GET":
            return self.send(200, list(STATE["functions"].values()))
        if sub == "/functions" and method == "POST":  # historique : création
            j = json.loads(body)
            STATE["deploys"].append({"slug": j["slug"], "legacy": "create", "size": len(j.get("body", "")), "verify_jwt": j.get("verify_jwt")})
            STATE["functions"][j["slug"]] = {"slug": j["slug"], "name": j["name"], "status": "ACTIVE", "version": 1, "verify_jwt": bool(j.get("verify_jwt"))}
            return self.send(201, STATE["functions"][j["slug"]])
        fm = re.match(r"^/functions/([a-z0-9-]+)$", sub)
        if fm:
            slug = fm.group(1)
            f = STATE["functions"].get(slug)
            if method == "GET":
                return self.send(200, f) if f else self.send(404, {"message": "Function not found"})
            if method == "PATCH":
                if not f:
                    return self.send(404, {"message": "Function not found"})
                j = json.loads(body)
                if "verify_jwt" in j:
                    f["verify_jwt"] = bool(j["verify_jwt"])
                if "body" in j:
                    f["version"] += 1
                    STATE["deploys"].append({"slug": slug, "legacy": "update", "size": len(j["body"]), "verify_jwt": j.get("verify_jwt")})
                return self.send(200, f)
            if method == "DELETE":
                STATE["deleted"].append(slug)
                STATE["functions"].pop(slug, None)
                return self.send(200, {})
        if sub == "/database/query" and method == "POST":
            sql = json.loads(body)["query"]
            if "vault.decrypted_secrets" in sql:
                return self.send(201, [] if MODE == "novault" else [{"decrypted_secret": VAULT}])
            if "select now()" in sql:
                return self.send(201, [{"t": "2026-11-09 20:00:00+00"}])
            if "net._http_response" in sql:
                return self.send(201, [{"n": "404 : 4"}] if os.environ.get("MOCK_NET") == "bad" else [{"n": "200 : 1"}, {"n": "202 : 3"}])
            if "cron.job" in sql:
                return self.send(201, [{"r": "3 tâches planifiées, 0 agent(s) suspendu(s), missions : a_faire=11 en_attente=14"}])
            if "ai_incidents" in sql:
                return self.send(201, [])
            return self.send(400, {"message": "requête inattendue"})
        if sub == "/secrets" and method == "POST":
            for s in json.loads(body):
                STATE["secrets"][s["name"]] = s["value"]
            return self.send(201, {})
        if sub == "/secrets" and method == "GET":
            return self.send(200, [{"name": k, "value": "digest"} for k in STATE["secrets"]])
        return self.send(404, {"message": f"route inconnue {method} {sub}"})

    def do_GET(self): self.handle_any("GET")
    def do_POST(self): self.handle_any("POST")
    def do_PATCH(self): self.handle_any("PATCH")
    def do_DELETE(self): self.handle_any("DELETE")


srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
with open(os.environ["MOCK_PORT_FILE"], "w") as f:
    f.write(str(srv.server_address[1]))
save()
srv.serve_forever()
