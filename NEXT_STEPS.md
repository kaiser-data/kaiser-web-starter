# Stand & nächste Schritte

Stand: 2026-05-24 · Repo: <https://github.com/kaiser-data/kaiser-web-starter> (public)

---

## Was steht

### 1. Template-Engine (konfigurations-getrieben)
- `site.config.json` ist die einzige Datei, die für eine neue Seite ausgefüllt wird —
  Brand, Theme, Termine, Preis, Brevo/Supabase-IDs, Impressums-Felder.
- `scripts/generate.js` (ohne Abhängigkeiten) erzeugt aus Templates + Config das
  deploy-bereite `dist/`.
- Aus `config.events` werden automatisch erzeugt: Checkboxen + Live-Kapazitäts-Anzeige,
  pro Termin ein Google-Calendar-Link + eine `.ics`-Datei, der SQL-Seed der Migration,
  die Kalender-Map in der `book-event`-Edge-Function.
- Validiert: mit den echten Cashflow-Werten reproduziert der Generator die laufende
  Seite 1:1 (Round-Trip). Mit einer testweisen, anders gefärbten „Sunrise Yoga"-Config
  entstand eine völlig andere, in sich konsistente Seite — Beweis, dass es ein echtes
  Template und kein verkleideter Cashflow-Klon ist.

### 2. Templatized Sourcen
- Frontend (`index.html`), drei Rechtsdokumente, gemeinsames `legal.css`
- Netlify-Functions: `signup` · `cancel-booking` · `unsubscribe` · `heartbeat`
- Supabase-Edge-Functions: `book-event` · `cancel-booking` · `sync-brevo-contact`
  (+ `_shared/brevo.ts`, `_shared/cors.ts`)
- **Eine** konsolidierte Migration `001_init.sql` (statt der bisherigen 14-Datei-Historie);
  Project-Ref, Promo-Code und Preis sind jetzt token-getrieben.

### 3. Showcase / Verkaufsseite
- `showcase/index.html` ist auf das verkaufbare Angebot fokussiert:
  **DSGVO-konforme Newsletter-Integration in bestehende Websites**.
- Schwerpunkte: Features, **Kosten (0 € laufend im Free-Tarif)**, **Datenautonomie**,
  **transparente Einrichtungspauschale**.
- Referenz: `cashflow-treff.de` als Live-Beweis des Stacks.

### 4. Dokumentation
- `README.md` — Architektur, Warum-dieser-Stack, Quickstart, Config-Referenz, Layout.
- `docs/DEPLOY.md` — Schritt-für-Schritt-Deploy mit Secrets-Checkliste und der
  wichtigsten Stolperfalle (`--no-verify-jwt` für `sync-brevo-contact`).
- `site.config.schema.json` — Feld-Doku + Validierung.
- `LICENSE` (MIT), `.gitignore`.

---

## Preis-Vorschlag (in der Showcase aktuell)

Beträge sind ein Startpunkt — alle einfach im HTML anpassbar.

| Posten | Preis | Inhalt |
|---|---:|---|
| **Newsletter-Integration** (einmalig) | **390 €** | Datenbank & Mail-Versand auf deinen Konten aufgesetzt · Anmeldeformular in die bestehende Website integriert · Automatische Willkommens-Mail · An-/Abmelde-Flow mit persönlichem Link · DSGVO-Hinweise & Übergabe-Doku |
| **Laufende Kosten** | **0 €** | Im Free-Tarif von Netlify, Supabase, Brevo (≈ 9.000 Mails/Monat, unbegrenzte Kontakte) |
| **Add-on: Termin-Buchung** | **+250 €** | Event-Anmeldung mit Plätze-Anzeige, Bestätigungs-Mail, Storno-Link |

### Argumentations-Spickzettel fürs Verkaufsgespräch
- **Datenhoheit:** Kontakte liegen in der eigenen Supabase-DB (EU/Frankfurt), jederzeit
  als CSV exportierbar, keine Bindung an einen Anbieter.
- **Kein Cookie-Banner:** keine Marketing-Cookies, kein Tracking, selbst-gehostete Schriften.
- **Keine Abo-Falle:** der Kunde besitzt alle Accounts (Netlify, Supabase, Brevo), zahlt
  selbst direkt an die Anbieter — wechselt nur den Dienstleister, wenn er will.
- **Wartbar ohne mich:** alles dokumentiert (`README.md`, `DEPLOY.md`); spätere
  Termin-Buchung oder Promo-Codes als Add-on möglich.

---

## Empfohlene nächste Schritte

### Diese Woche
- [ ] **Showcase-Copy gegenlesen** — Tonalität, Preis, Add-on-Beträge in
      `showcase/index.html` final prüfen (Zeilen ~165–245 für Hero/Preis).
- [ ] **Preis-Entscheidung** treffen: 390 € einmalig — passt das, oder lieber gestaffelt
      (z. B. 290 € für reine Anmeldebox vs. 390 € mit Welcome-Mail)?
- [ ] **Showcase deployen.** Optionen:
      a) Auf eine eigene Subdomain (z. B. `web.martinkaiser.de`) via Netlify-Drop —
         `showcase/index.html` ist eigenständig, ein einziger File-Upload genügt.
      b) Als GitHub-Pages auf dem Repo (`Settings → Pages → Branch: main, /showcase`).

### Vor dem ersten echten Kunden
- [ ] **Echten Supabase anon key** in `site.config.json` setzen (steht aktuell als
      `PASTE_YOUR_SUPABASE_ANON_KEY_HERE`-Platzhalter) — sonst lädt die Plätze-Anzeige
      nicht. (Anon-Key ist public-by-design, RLS schützt die Daten.)
- [ ] **Brevo-Liste & Welcome-Template** für die Kundenseite anlegen, IDs in
      `site.config.json` + Supabase-Secrets eintragen (Checkliste in `docs/DEPLOY.md`).
- [ ] **Sender-Domain in Brevo verifizieren** (DKIM + SPF), damit Welcome-Mails nicht
      im Spam landen.

### Optional / mittel­fristig
- [ ] **Screenshots** für die Showcase-Seite ergänzen (z. B. Anmeldeformular,
      Buchungsbestätigungs-Mail) — derzeit rein typografisch.
- [ ] **Newsletter-Only-Preset**: ein zweites Beispiel-Config (`site.config.newsletter.json`)
      ohne Events, falls das Angebot rein newsletter-fokussiert verkauft wird.
- [ ] **Kontaktformular** auf der Showcase statt nur `mailto:` (eigentlich Eat-Your-Own-Dog-Food
      — könnte derselbe `signup`-Flow sein).
- [ ] **README auf der Showcase verlinken** als „Source code & Doku" — verstärkt den
      Senior-Eindruck.
- [ ] **Zweiten echten Kunden** finden und die Übergabe-Erfahrung in eine kurze
      „How it went"-Notiz fassen (zukünftige Showcase-Referenz).

---

## Bekannte Limits / Stolperfallen

- `sync-brevo-contact` muss zwingend mit `--no-verify-jwt` deployed werden, sonst kommt
  der Postgres-Trigger nicht durch (steht in DEPLOY.md, leicht vergessen).
- Promo-Codes müssen in `site.config.json` **UPPERCASE** sein — sowohl SQL als auch
  Client vergleichen nach `upper()`.
- `.ics`-Dateien sind hart auf `Europe/Berlin` getimezoned — für andere Zonen müsste
  der `VTIMEZONE`-Block in `scripts/generate.js` angepasst werden.
- Texte sind deutsch — `brand.lang` setzt nur `<html lang>`, übersetzt nicht.

---

## Wo was liegt

```
~/kaiser-data-freelance/
├─ Cash-Flow/             ← live, unverändert
└─ site-template/         ← dieses Projekt
   ├─ site.config.json    ← die einzige Datei pro Kunden-Site
   ├─ scripts/generate.js
   ├─ templates/          ← Quellen mit {{tokens}}
   ├─ showcase/index.html ← die Verkaufsseite
   ├─ README.md
   ├─ docs/DEPLOY.md
   ├─ NEXT_STEPS.md       ← dieses Dokument
   └─ dist/               ← einmal generiert, deploy-bereit (gitignoriert)
```

Remote: `git@github.com:kaiser-data/kaiser-web-starter.git`
