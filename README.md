# Event & Newsletter Site Starter

A config-driven landing page with **event booking, live capacity, newsletter signup, and
automated email** — built on **Netlify + Supabase + Brevo**. Fill in one config file, run
one command, deploy. EU-hosted, DSGVO-friendly, zero tracking cookies.

> Extracted from a real production site ([cashflow-treff.de](https://cashflow-treff.de)) and
> generalised into a reusable template. The shipped `site.config.json` reproduces that site
> verbatim — so the example *is* the documentation.

---

## Why this stack

| Concern | Choice | Payoff |
|---|---|---|
| Hosting + forms | **Netlify** (static + Functions + scheduled) | Free tier, EU edge, zero-ops |
| Data + logic | **Supabase** (Postgres, RLS, Edge Functions) | Atomic booking, one DB, no server to babysit |
| Email | **Brevo** (list + transactional) | Welcome + booking mail without an SMTP server |
| Privacy | self-hosted fonts, no analytics | No cookie banner needed |

Three tiers, clear seams: Netlify serves HTML and form endpoints, Supabase holds data +
business logic behind RLS, Brevo does mail. A Postgres trigger is the **only** bridge between
the DB and the mail service — no code path syncs contacts by hand.

```
Visitor ──▶ Netlify (index.html + signup.js)
                 │ booking            │ newsletter
                 ▼                    ▼
        Supabase book_event()   subscribers upsert
                 │  AFTER INSERT trigger (pg_net)
                 ▼
        sync-brevo-contact ──▶ Brevo list + welcome/booking mail ──▶ Visitor
```

---

## Quick start

```bash
npm install            # (only needed for the optional `serve`/netlify/supabase CLIs)
# 1. edit site.config.json  — brand, theme, events, Brevo + Supabase IDs
npm run generate       # → dist/  (deploy-ready static site + functions + migration)
npm run dev            # generate + preview at http://localhost:5000
```

`dist/` is disposable — it is rebuilt from scratch every run. **You only ever edit
`site.config.json` and the files in `templates/`.**

---

## How it works

```
site.config.json ──▶ scripts/generate.js ──▶ dist/
                          ▲
                     templates/   (HTML / functions / migration with {{tokens}})
                     assets/      (fonts + images, copied verbatim)
```

`generate.js` walks `templates/`, replaces `{{ dotted.tokens }}` from the config, copies
assets, and emits per-event artifacts it computes from `config.events`:

- the signup **choice checkboxes** and the live-capacity wiring
- a Google Calendar link + a standards-compliant **`.ics` file** per event
- the **SQL seed** in the database migration
- the calendar map inside the `book-event` Edge Function

Add or remove an event in `config.events` → every one of those updates on the next
`npm run generate`. No hand-editing.

---

## Configuration reference (`site.config.json`)

| Block | Drives |
|---|---|
| `brand` | name, domain, site URL, contact email, copyright, page `<lang>` |
| `theme` | CSS custom properties (colors as `oklch(...)`, font stacks) |
| `hero` | eyebrow, headline, lede, CTA label, the facts strip |
| `venue` | name, entrance hint, address, arrival/start times (booking mail, `.ics`, calendar) |
| `booking` | `capacity`, `price`, `currency`, `promoCode` (UPPERCASE), payment note |
| `events[]` | `slug`, `label`, `title`, `date`, `start`, `end`, `tzOffset`, `active`, `listed` |
| `supabase` | `projectRef`, `url`, `anonKey` (anon key is public-by-design for RLS) |
| `brevo` | `listId`, `welcomeTemplateId`, sender email/name *(used as defaults; secrets live server-side)* |
| `legal` | operator name/address/email, host name, supervisory authority (Impressum & Datenschutz) |

**Event flags:** `active` controls whether the DB row is bookable (RLS + RPC); `listed`
controls whether the checkbox is shown on the page. An event can be `active:false` to retire
it while keeping its data, or `active:true, listed:false` to keep a private/unlisted booking.

> **Promo codes must be UPPERCASE** — both the SQL RPC and the client compare against the
> uppercased input.

---

## Repo layout

```
site.config.json          ← the one file you fill in
site.config.schema.json   ← field docs + validation
scripts/generate.js       ← the generator (no dependencies)
templates/
  index.html              ← landing page (tokenized)
  impressum/datenschutz/agb.html, legal.css
  netlify.toml
  netlify/functions/       signup · cancel-booking · unsubscribe · heartbeat
  supabase/
    functions/             book-event · cancel-booking · sync-brevo-contact · _shared
    migrations/001_init.sql
assets/  fonts/ (self-hosted Playfair) · images/ (placeholders — drop your own in)
showcase/index.html       ← freelance product landing page (standalone)
docs/DEPLOY.md            ← step-by-step deploy + secrets
```

---

## Deploy

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for the full walkthrough. Short version:

```bash
npm run generate
netlify deploy --prod --dir dist                    # frontend + functions
supabase db push                                    # apply migration
supabase functions deploy book-event
supabase functions deploy cancel-booking
supabase functions deploy sync-brevo-contact --no-verify-jwt   # ← trigger sends no JWT
```

Secrets are **never** baked into `dist/` — set them in the Netlify and Supabase dashboards
(`SUPABASE_*`, `BREVO_*`). DEPLOY.md lists every key.

> **Gotcha that will cost you an evening:** `sync-brevo-contact` must be deployed
> `--no-verify-jwt`. The Postgres trigger calls it without an Authorization header; with JWT
> verification on, every contact sync silently 401s and no mail goes out.

---

## What this template is *not*

- Not a CMS — content longer than the hero/venue lives as editable HTML in `templates/`.
- Not multi-language — strings are German by default (`brand.lang` only sets `<html lang>`).
- `.ics` timezone is `Europe/Berlin`. Change the `VTIMEZONE` block in `generate.js` for others.

---

## License

MIT — yours to adapt, rebrand, and ship.
