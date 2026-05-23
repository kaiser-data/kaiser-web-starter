#!/usr/bin/env node
/**
 * generate.js — turn site.config.json + templates/ into a deployable site in dist/.
 *
 * No dependencies. Replaces {{ dotted.token }} placeholders in every text file
 * under templates/, copies binary assets verbatim, and emits per-event artifacts
 * (calendar .ics files, Google Calendar links, the SQL seed, choice markup).
 *
 *   node scripts/generate.js            # build into ./dist
 *   node scripts/generate.js --out www  # build into ./www
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TEMPLATES = path.join(ROOT, "templates");
const ASSETS = path.join(ROOT, "assets");

const outArg = process.argv.indexOf("--out");
const OUT = path.join(ROOT, outArg !== -1 ? process.argv[outArg + 1] : "dist");

const TEXT_EXT = new Set([
  ".html", ".css", ".js", ".ts", ".sql", ".toml", ".json",
  ".md", ".txt", ".ics", ".svg", ".xml",
]);

// ── load + validate config ────────────────────────────────────────────────
const configPath = path.join(ROOT, "site.config.json");
if (!fs.existsSync(configPath)) {
  fail(`site.config.json not found at ${configPath}`);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
validate(config);

// ── helpers ─────────────────────────────────────────────────────────────--
function fail(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1); }

/** Flatten scalars into dotted keys: { "brand.name": "...", "booking.price": 18 } */
function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("$")) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      flatten(v, key, out);
    } else if (!Array.isArray(v)) {
      out[key] = String(v);
    }
  }
  return out;
}

/** "2026-05-26T18:30:00" -> "20260526T183000" (calendar compact form) */
const compact = (dt) => dt.replace(/[-:]/g, "").replace(/\.\d+$/, "");
const enc = encodeURIComponent;
const icsEscape = (s) => s.replace(/([,;\\])/g, "\\$1");

/** Full Google Calendar "add event" URL for one event. */
function gcalUrl(ev) {
  const text = enc(config.brand.name);
  const dates = `${compact(ev.start)}/${compact(ev.end)}`;
  const details = enc(
    `${config.venue.arrivalTime} Ankommen, ${config.venue.startTime} Spielen.`
  );
  const location = enc(
    `${config.venue.name} ${config.venue.entranceHint}, ${config.venue.address}`
  );
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates}&details=${details}&location=${location}`;
}

/** Standards-compliant VCALENDAR for one event (Europe/Berlin). */
function icsContent(ev) {
  const loc = `${config.venue.name} ${config.venue.entranceHint}, ${config.venue.address}`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${config.brand.name}//DE`,
    "CALSCALE:GREGORIAN",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Berlin",
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    "TZNAME:CET",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    "TZNAME:CEST",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `DTSTART;TZID=Europe/Berlin:${compact(ev.start)}`,
    `DTEND;TZID=Europe/Berlin:${compact(ev.end)}`,
    `SUMMARY:${icsEscape(config.brand.name)}`,
    `DESCRIPTION:${icsEscape(config.hero.lede)}`,
    `LOCATION:${icsEscape(loc)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

const icsName = (ev) => `termin-${ev.slug}.ics`;

// ── derived tokens ─────────────────────────────────────────────────────────
const events = config.events || [];
const listed = events.filter((e) => e.active && e.listed);

const heroFactsHtml = (config.hero.facts || [])
  .map((f) => `<span class="hero-strip-item">${f}</span>`)
  .join("\n      ");

const eventChoicesHtml = listed
  .map((ev, i) => `<label class="signup-choice" data-slug="${ev.slug}">
                <input type="checkbox" id="evt${i}" value="${ev.label}" onchange="updatePaymentBlock()">
                <div class="signup-choice-text">
                  <strong>${ev.label}</strong>
                  <span class="termin-status" data-slug="${ev.slug}">Verfügbarkeit wird geladen …</span>
                </div>
              </label>`)
  .join("\n              ");

const terminIdsJs = `[${listed.map((_, i) => `'evt${i}'`).join(", ")}]`;

const calDatesJs = JSON.stringify(
  Object.fromEntries(listed.map((ev) => [ev.label, { gcal: gcalUrl(ev), ics: icsName(ev) }])),
  null, 6
).replace(/\n/g, "\n          ");

// signup.js needs every event (even unlisted) so known labels still resolve
const terminToSlugJs = JSON.stringify(
  Object.fromEntries(events.map((ev) => [ev.label, ev.slug])),
  null, 2
).replace(/\n/g, "\n  ");

// book-event/index.ts calendar map: slug -> { ics, gcal }
const bookEventCalendarMapTs = events
  .map((ev) => `    "${ev.slug}": {
      ics: \`\${SITE_URL}/${icsName(ev)}\`,
      gcal: "${gcalUrl(ev)}",
    },`)
  .join("\n");

// migration seed for events
const eventsSeedSql = events
  .map((ev) => `  ('${ev.slug}', '${ev.title.replace(/'/g, "''")}', '${ev.date}', '${ev.start}${ev.tzOffset}', '${ev.end}${ev.tzOffset}', ${config.booking.capacity}, ${ev.active})`)
  .join(",\n");

// ── build context ───────────────────────────────────────────────────────--
const ctx = flatten(config, "", {});
Object.assign(ctx, {
  "derived.heroFactsHtml": heroFactsHtml,
  "derived.eventChoicesHtml": eventChoicesHtml,
  "derived.terminIdsJs": terminIdsJs,
  "derived.calDatesJs": calDatesJs,
  "derived.terminToSlugJs": terminToSlugJs,
  "derived.bookEventCalendarMapTs": bookEventCalendarMapTs,
  "derived.eventsSeedSql": eventsSeedSql,
});

// ── render ──────────────────────────────────────────────────────────────--
const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;
const missing = new Set();

function render(text, fileLabel) {
  return text.replace(TOKEN_RE, (whole, key) => {
    if (key in ctx) return String(ctx[key]);
    missing.add(`${key}  (in ${fileLabel})`);
    return whole;
  });
}

function isText(file) { return TEXT_EXT.has(path.extname(file).toLowerCase()); }

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

function copyInto(srcDir, destDir, { tokenize }) {
  if (!fs.existsSync(srcDir)) return;
  walk(srcDir, (file) => {
    const rel = path.relative(srcDir, file);
    const dest = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (tokenize && isText(file)) {
      fs.writeFileSync(dest, render(fs.readFileSync(file, "utf8"), rel));
    } else {
      fs.copyFileSync(file, dest);
    }
  });
}

// fresh dist
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 1) templates -> dist (tokenized)
copyInto(TEMPLATES, OUT, { tokenize: true });

// 2) assets -> dist (fonts verbatim, images verbatim)
copyInto(path.join(ASSETS, "fonts"), path.join(OUT, "fonts"), { tokenize: false });
copyInto(path.join(ASSETS, "images"), OUT, { tokenize: false });

// 3) per-event .ics files at site root
for (const ev of events) {
  fs.writeFileSync(path.join(OUT, icsName(ev)), icsContent(ev));
}

// ── report ──────────────────────────────────────────────────────────────--
if (missing.size) {
  console.error("\n⚠  Unresolved tokens (left as-is):");
  for (const m of [...missing].sort()) console.error("   " + m);
}

const fnCount = (() => {
  let n = 0;
  walk(OUT, () => n++);
  return n;
})();

console.log(`\n✓ Generated ${config.brand.name}`);
console.log(`  → ${path.relative(process.cwd(), OUT)}/  (${fnCount} files, ${events.length} events, ${listed.length} listed)`);
console.log(`\nNext: deploy frontend + functions  →  see docs/DEPLOY.md`);
console.log(`      remember to set Supabase + Brevo secrets (not baked into dist).`);

// ── tiny validator ─────────────────────────────────────────────────────────
function validate(c) {
  const need = ["brand.name", "brand.siteUrl", "supabase.url", "booking.price"];
  const flat = flatten(c, "", {});
  const miss = need.filter((k) => !(k in flat) || flat[k] === "");
  if (miss.length) fail(`site.config.json missing required fields: ${miss.join(", ")}`);
  if (!Array.isArray(c.events) || c.events.length === 0) {
    console.warn("⚠  No events configured — booking section will be empty.");
  }
  for (const ev of c.events || []) {
    for (const f of ["slug", "label", "title", "date", "start", "end"]) {
      if (!ev[f]) fail(`event "${ev.slug || "?"}" missing field: ${f}`);
    }
  }
}
