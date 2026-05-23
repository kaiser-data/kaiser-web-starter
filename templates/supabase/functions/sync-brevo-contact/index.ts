import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { upsertBrevoNewsletterContact, ensureBrevoAttribute, sendBrevoTemplateEmail } from "../_shared/brevo.ts";

type SubscriberRow = { id: string; email: string; created_at: string };
type BookingRow = {
  id: string;
  event_id: string;
  name: string;
  email: string;
  promo_code: string | null;
  betrag: number | string;
  newsletter: boolean;
  status: string;
  created_at: string;
};

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: SubscriberRow | BookingRow;
  old_record: unknown;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function terminAttrFromDate(eventDate: string): string {
  // "2026-05-26" -> "TERMIN_2026_05_26"
  return `TERMIN_${eventDate.replaceAll("-", "_")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const webhookSecret = Deno.env.get("DB_WEBHOOK_SECRET")?.trim();
  if (webhookSecret) {
    const provided = req.headers.get("x-webhook-secret")?.trim();
    if (provided !== webhookSecret) return json({ error: "Unauthorized" }, 401);
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (payload.type !== "INSERT") {
    return json({ skipped: true, reason: "not an insert" });
  }

  const table = payload.table;
  const record = payload.record;
  const email = record.email?.trim().toLowerCase();
  if (!email) return json({ error: "email required" }, 400);

  const extraAttributes: Record<string, string | number | boolean> = {};
  let contactName = "";
  let addToNewsletterList = false;
  let sendWelcome = false;

  if (table === "subscribers") {
    extraAttributes.NEWSLETTER = true;
    addToNewsletterList = true;
    // Welcome fires from subscribers-trigger ONLY. The single-source-of-truth
    // rule avoids duplicate sends when a booking-with-newsletter also fires
    // the bookings-trigger in the same transaction.
    sendWelcome = true;
  } else if (table === "bookings") {
    const b = record as BookingRow;
    contactName = b.name || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
    const supabase = supabaseUrl && serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      : null;

    if (supabase) {
      const { data: ev } = await supabase
        .from("events")
        .select("event_date, title")
        .eq("id", b.event_id)
        .maybeSingle();

      if (ev?.event_date) {
        const attrName = terminAttrFromDate(ev.event_date);
        try { await ensureBrevoAttribute(attrName, "boolean"); } catch (_e) { /* ignore */ }
        extraAttributes[attrName] = true;
      }
    }

    const betrag = typeof b.betrag === "string" ? parseFloat(b.betrag) : b.betrag;
    if (!Number.isNaN(betrag)) extraAttributes.BETRAG_LETZTE_BUCHUNG = betrag;

    if (b.promo_code && b.promo_code.trim()) {
      extraAttributes.PROMO_CODE = b.promo_code.trim();
      extraAttributes.PROMO_CODE_ANGEWENDET = true;
    } else {
      extraAttributes.PROMO_CODE_ANGEWENDET = false;
    }

    if (b.newsletter) {
      extraAttributes.NEWSLETTER = true;
      addToNewsletterList = true;
      // NO welcome here — it's the subscribers-trigger's job. book-event
      // upserts a subscribers row on every newsletter-opt-in, so first-time
      // signups get welcome via that path; subsequent bookings just sync
      // attributes (TERMIN_*, BETRAG, PROMO) without a second mail.
    }
  } else {
    return json({ skipped: true, reason: `unknown table: ${table}` });
  }

  const warnings: string[] = [];
  let upsertResult: { skipped?: boolean } = {};

  try {
    upsertResult = await upsertBrevoNewsletterContact({
      email,
      name: contactName,
      extraAttributes,
      addToNewsletterList,
    });
  } catch (err) {
    return json({ error: String(err), table, email }, 502);
  }

  // Welcome mail: explicit template send. Brevo's list-subscription automation
  // does NOT re-fire when an unsubscribed contact resubscribes, so we send
  // ourselves. IMPORTANT: the Brevo automation on list #2 must be disabled,
  // otherwise first-time subscribers receive two welcome mails.
  let welcomeSent = false;
  if (sendWelcome) {
    const welcomeTemplateId = Number(Deno.env.get("BREVO_WELCOME_TEMPLATE_ID") || "0");
    if (welcomeTemplateId > 0) {
      try {
        const r = await sendBrevoTemplateEmail({
          toEmail: email,
          toName: contactName || undefined,
          templateId: welcomeTemplateId,
        });
        welcomeSent = !r.skipped;
      } catch (err) {
        warnings.push(`welcome_send_failed: ${String(err)}`);
      }
    } else {
      warnings.push("welcome_send_skipped: BREVO_WELCOME_TEMPLATE_ID not set");
    }
  }

  return json({ ok: true, table, email, attributes: extraAttributes, ...upsertResult, welcomeSent, warnings });
});
