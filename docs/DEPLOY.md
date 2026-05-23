# Deploy guide

From an empty Supabase + Netlify + Brevo account to a live site. ~15–20 minutes.

## 0. Prerequisites

```bash
npm i -g netlify-cli supabase   # CLIs
```

You need accounts on **Supabase**, **Netlify**, **Brevo**, and a domain (DNS anywhere).

---

## 1. Supabase — database + edge functions

1. Create a project. Note the **Project Ref** (the `xxxx` in `xxxx.supabase.co`) and the
   **anon** + **service_role** keys (Project Settings → API).
2. Put `projectRef`, `url`, and `anonKey` into `site.config.json` under `supabase`.
   > The anon key is *meant* to be public — RLS is what protects the data.
3. Apply the schema and deploy functions:

```bash
supabase link --project-ref <YOUR_REF>
supabase db push                                  # runs templates/supabase/migrations
supabase functions deploy book-event
supabase functions deploy cancel-booking
supabase functions deploy sync-brevo-contact --no-verify-jwt   # ← REQUIRED
```

4. Set Edge Function secrets (Project Settings → Edge Functions → Secrets, or CLI):

```bash
supabase secrets set \
  BREVO_API_KEY=xkeysib-... \
  BREVO_NEWSLETTER_LIST_ID=2 \
  BREVO_WELCOME_TEMPLATE_ID=1 \
  BREVO_SENDER_EMAIL=hello@your-domain.de \
  BREVO_SENDER_NAME="Your Brand" \
  PUBLIC_SITE_URL=https://your-domain.de
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided to functions automatically.
```

---

## 2. Brevo — list + templates

1. Create a **contact list**; note its numeric ID → `brevo.listId` + `BREVO_NEWSLETTER_LIST_ID`.
2. Create a **transactional template** for the welcome mail; note its ID → `BREVO_WELCOME_TEMPLATE_ID`.
3. Verify your **sender domain** (DKIM + SPF) so mail isn't spam-filed.
4. **Disable** any Brevo list-subscription *automation* welcome mail. This template sends the
   welcome itself (from `sync-brevo-contact`) so it also fires on re-subscribe. Leaving Brevo's
   automation on too = duplicate welcome mails for first-time subscribers.

---

## 3. Netlify — frontend + functions

```bash
npm run generate
netlify deploy --prod --dir dist
```

Set environment variables (Site settings → Environment variables):

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # used by edge fns; safe in Netlify env
```

Point your domain at Netlify (or `netlify domains:add`). The weekly `heartbeat` function keeps
the free-tier Supabase project from auto-pausing — no setup needed, it ships as a scheduled fn.

---

## 4. Smoke test

1. Open the site → the event checkboxes should show **live remaining places**
   (`event_availability` RPC working = DB reachable from the browser).
2. Newsletter-only signup → welcome mail arrives, contact appears on the Brevo list.
3. Book an event → confirmation mail with `.ics` + calendar link + cancel link; the counter
   on the page drops by one.
4. Click the cancel link → branded cancellation page; counter goes back up.

If contacts land on the list but **no mail** arrives, you almost certainly deployed
`sync-brevo-contact` *with* JWT verification. Redeploy it with `--no-verify-jwt`.

---

## Secrets checklist

| Where | Keys |
|---|---|
| Netlify env | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Supabase function secrets | `BREVO_API_KEY`, `BREVO_NEWSLETTER_LIST_ID`, `BREVO_WELCOME_TEMPLATE_ID`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `PUBLIC_SITE_URL` |
| `site.config.json` (public) | `supabase.url`, `supabase.anonKey`, `supabase.projectRef`, `brevo.listId` |

Never put `BREVO_API_KEY` or `SERVICE_ROLE_KEY` into `site.config.json` — they'd end up in `dist/`.
