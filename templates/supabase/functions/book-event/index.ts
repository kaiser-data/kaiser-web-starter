import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendBrevoBookingEmail } from "../_shared/brevo.ts";

type BookEventResult = {
  booking_id: string;
  event_id: string;
  title: string;
  event_slug: string;
  event_date: string;
  start_at: string;
  end_at: string;
  betrag: number;
  remaining_places: number;
  cancel_token: string;
};

const SITE_URL = Deno.env.get("PUBLIC_SITE_URL")?.trim() || "{{brand.siteUrl}}";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function buildCalendarLinks(eventSlug: string) {
  const map: Record<string, { ics: string; gcal: string }> = {
{{derived.bookEventCalendarMapTs}}
  };

  return map[eventSlug] || { ics: SITE_URL, gcal: SITE_URL };
}

function bookingEmailHtml({
  name,
  title,
  eventDate,
  betrag,
  cancelUrl,
  calendarLinks,
}: {
  name: string;
  title: string;
  eventDate: string;
  betrag: number;
  cancelUrl: string;
  calendarLinks: { ics: string; gcal: string };
}) {
  const priceHtml =
    betrag === 0
      ? '<span style="color:#2d7a2d;font-weight:600">0 € (Promo-Code angewendet)</span>'
      : `<strong>${betrag} €</strong> · {{booking.paymentNote}}`;

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto">
    <div style="background:#1a1208;padding:20px 32px;border-radius:12px 12px 0 0">
      <p style="margin:0;font-size:12px;letter-spacing:.10em;text-transform:uppercase;color:rgba(255,250,244,.50)">{{brand.shortName}} · Berlin</p>
    </div>
    <div style="padding:36px 32px;border:1px solid #e8e0d8;border-top:none;border-radius:0 0 12px 12px">
      <h1 style="font-family:Georgia,serif;font-size:26px;line-height:1.1;letter-spacing:-.03em;margin:0 0 6px;color:#1a1208">Buchungsbestätigung</h1>
      <p style="font-size:13px;color:#9a8878;margin:0 0 28px;letter-spacing:.04em;text-transform:uppercase">${title}</p>
      <p style="font-size:14px;line-height:1.7;color:#4a4040;margin:0 0 18px">${name ? `Hallo ${name},` : "Hallo,"}</p>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:28px">
        <tr style="border-bottom:1px solid #e8e0d8">
          <td style="padding:10px 0;color:#9a8878;width:40%">Termin</td>
          <td style="padding:10px 0;color:#1a1208;font-weight:500">${eventDate}</td>
        </tr>
        <tr style="border-bottom:1px solid #e8e0d8">
          <td style="padding:10px 0;color:#9a8878">Einlass</td>
          <td style="padding:10px 0;color:#1a1208">{{venue.arrivalTime}} Uhr · Spielbeginn {{venue.startTime}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e8e0d8">
          <td style="padding:10px 0;color:#9a8878">Ort</td>
          <td style="padding:10px 0;color:#1a1208">{{venue.name}} {{venue.entranceHint}}<br>{{venue.address}}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#9a8878">Teilnahmebeitrag</td>
          <td style="padding:10px 0;color:#1a1208">${priceHtml}</td>
        </tr>
      </table>

      <p style="font-size:14px;line-height:1.7;color:#4a4040;margin:0 0 16px">
        Trage dir den Termin direkt in deinen Kalender ein:
      </p>
      <p style="font-size:14px;line-height:1.7;margin:0 0 24px">
        <a href="${calendarLinks.gcal}" style="color:#1a1208">Google Calendar</a><br>
        <a href="${calendarLinks.ics}" style="color:#1a1208">Apple / Outlook (.ics)</a>
      </p>

      <p style="font-size:14px;line-height:1.7;color:#4a4040;margin:0 0 28px">
        Falls du doch nicht kommen kannst, gib deinen Platz bitte wieder frei:
        <a href="${cancelUrl}" style="color:#1a1208">Buchung stornieren</a>
      </p>

      <a href="${SITE_URL}" style="display:inline-flex;align-items:center;min-height:44px;padding:0 22px;border-radius:999px;background:#1a1208;color:#fff;font-size:14px;font-weight:500;text-decoration:none">
        Zur Website
      </a>
    </div>
  </div>`;
}

function mapRpcError(message = "") {
  switch (message) {
    case "EVENT_REQUIRED":
      return { status: 400, error: "Kein Termin ausgewählt." };
    case "NAME_REQUIRED":
      return { status: 400, error: "Bitte gib deinen Namen ein." };
    case "EMAIL_REQUIRED":
      return { status: 400, error: "Bitte gib eine E-Mail-Adresse ein." };
    case "EVENT_NOT_FOUND":
      return { status: 404, error: "Dieser Termin ist nicht verfügbar." };
    case "ALREADY_BOOKED":
      return { status: 409, error: "Du bist für diesen Termin bereits angemeldet." };
    case "SOLD_OUT":
      return { status: 409, error: "Dieser Termin ist leider ausgebucht." };
    case "INVALID_PROMO_CODE":
      return { status: 400, error: "Ungültiger Promo-Code." };
    default:
      return { status: 500, error: "Buchung fehlgeschlagen." };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let payload: {
    eventSlug?: string;
    name?: string;
    email?: string;
    newsletter?: boolean;
    promoCode?: string;
  };

  try {
    payload = await req.json();
  } catch {
    return json({ error: "Ungültige Anfrage." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase server config fehlt." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc("book_event", {
    p_event_slug: payload.eventSlug?.trim(),
    p_name: payload.name?.trim(),
    p_email: payload.email?.trim(),
    p_newsletter: Boolean(payload.newsletter),
    p_promo_code: payload.promoCode?.trim() || null,
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return json({ error: mapped.error }, mapped.status);
  }

  const result = (data as BookEventResult[])[0];
  if (!result) {
    return json({ error: "Buchung fehlgeschlagen." }, 500);
  }

  // Newsletter opt-in via booking → also create/refresh a subscribers row
  // so the contact ends up on the newsletter list and the Brevo welcome
  // automation fires for first-time opt-ins.
  if (payload.newsletter) {
    try {
      const trimmedName = (payload.name || "").trim();
      await supabase
        .from("subscribers")
        .upsert(
          {
            email: payload.email!.trim().toLowerCase(),
            name: trimmedName || null,
            source: "booking",
            active: true,
            unsubscribed_at: null,
          },
          { onConflict: "email" },
        );
    } catch (_e) { /* non-fatal */ }
  }

  const cancelUrl = `${SITE_URL}/.netlify/functions/cancel-booking?token=${encodeURIComponent(result.cancel_token)}`;
  const calendarLinks = buildCalendarLinks(result.event_slug);

  const warnings: string[] = [];

  try {
    await sendBrevoBookingEmail({
      toEmail: payload.email!.trim(),
      toName: payload.name!.trim(),
      subject: `Buchungsbestätigung – ${result.title}`,
      htmlContent: bookingEmailHtml({
        name: (payload.name || "").trim(),
        title: result.title,
        eventDate: result.event_date,
        betrag: result.betrag,
        cancelUrl,
        calendarLinks,
      }),
    });
  } catch (mailError) {
    warnings.push(String(mailError));
  }

  return json({
    success: true,
    eventSlug: result.event_slug,
    eventDate: result.event_date,
    betrag: result.betrag,
    remainingPlaces: result.remaining_places,
    cancelUrl,
    calendarLinks,
    warnings,
  });
});
