# SANIX AI SALES DIRECTOR — backend Supabase

## Composants
| Élément | Rôle |
|---|---|
| `migrations/20261109000000_ai_sales_director.sql` | Schéma : prospects (score /100 généré), fil omnicanal, offres, RDV, relances, validations, audit immuable, RLS |
| `functions/ai-sales-director` | Missions Lead Hunter, qualification, premier contact, relances planifiées (`tick`) |
| `functions/whatsapp-webhook` | Messages entrants WhatsApp → dossier unique → réponse de l'agent |
| `functions/_shared/agent.ts` | Orchestrateur Claude (`claude-opus-5-5`) + outils métier cloisonnés |

## Déploiement
```bash
supabase db push
supabase secrets set ANTHROPIC_API_KEY=... CRON_SECRET=$(openssl rand -hex 32) \
  ALLOWED_ORIGINS=https://crm-sanix.vercel.app \
  WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=... \
  WHATSAPP_TEMPLATE_FIRST=sanix_premier_contact \
  RESEND_API_KEY=... EMAIL_FROM="SANIX AFRICA <commercial@sanix-africa.ci>" EMAIL_REPLY_TO=... DEMO_VISIO_URL=...
supabase functions deploy ai-sales-director
supabase functions deploy whatsapp-webhook --no-verify-jwt   # authentifié par signature HMAC Meta
```
Webhook Meta : `https://<ref>.supabase.co/functions/v1/whatsapp-webhook` (champ `messages`).

Relances automatiques (toutes les 15 min) :
```sql
select cron.schedule('ai-followups','*/15 * * * *', $$
  select net.http_post('https://<ref>.supabase.co/functions/v1/ai-sales-director',
    '{"action":"tick"}'::jsonb, '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'))$$);
```

## Mise en service
1. Créer les comptes dans Supabase Auth, puis `insert into ai_operators(user_id, nom, role, remise_max_pct) values (...)`.
2. Renseigner `ai_availability` (créneaux des commerciaux).
3. Compléter `ai_products.fonctionnalites` / `questions_decouverte` : **l'agent ne cite que ces fonctionnalités**.
4. Compléter `ai_pricing` (installation, formation, migration, 100-Inox, SNIFI). Sans tarif → aucun prix, escalade.
5. Faire approuver par Meta le modèle `sanix_premier_contact` (1 variable : nom du contact).

## Garde-fous
- `contrat_signe`, `paiement_confirme`, `marche_gagne` : bloqués en base pour l'agent (direction uniquement).
- Remise > délégation agent → `ai_approvals` ; > plafond direction → refusée.
- « STOP » entrant → `opt_out` automatique, relances annulées, envoi bloqué.
- Mention IA ajoutée au premier message ; fenêtre 24 h WhatsApp respectée (hors fenêtre : modèle approuvé).
- Outils cloisonnés au prospect en cours (anti-injection) ; contenu prospect/web traité comme donnée.
- `ai_actions` append-only : chaque appel LLM et outil journalisé (tokens inclus).
