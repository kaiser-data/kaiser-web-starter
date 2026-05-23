import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function page(title: string, heading: string, body: string) {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} – {{brand.name}}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
      background:{{theme.bg}};color:{{theme.fg}};
      display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .box{background:#fff;border:1px solid {{theme.border}};border-radius:22px;
      padding:40px 36px;max-width:460px;width:100%;text-align:center;
      box-shadow:0 6px 24px rgba(50,36,22,.08)}
    h1{margin:0 0 12px;font-size:1.4rem;font-weight:600;letter-spacing:-.02em}
    p{margin:0 0 24px;font-size:14px;line-height:1.65;color:{{theme.muted}}}
    a{display:inline-flex;align-items:center;min-height:42px;padding:0 20px;
      border-radius:999px;background:{{theme.fg}};color:#fff;font-size:14px;
      font-weight:500;text-decoration:none}
    .icon{font-size:2rem;margin-bottom:16px}
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">${title === "Storniert" ? "👋" : "⚠️"}</div>
    <h1>${heading}</h1>
    <p>${body}</p>
    <a href="{{brand.siteUrl}}">Zurück zur Website</a>
  </div>
</body>
</html>`;
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...corsHeaders,
    },
  });
}

function mapRpcError(message = "") {
  switch (message) {
    case "TOKEN_REQUIRED":
      return { status: 400, title: "Fehler", heading: "Ungültiger Link", body: "Es wurde kein gültiger Stornolink übergeben." };
    case "BOOKING_NOT_FOUND":
      return { status: 404, title: "Fehler", heading: "Buchung nicht gefunden", body: "Diese Buchung konnte nicht gefunden werden oder der Link ist nicht mehr gültig." };
    case "BOOKING_ALREADY_CANCELLED":
      return { status: 409, title: "Fehler", heading: "Bereits storniert", body: "Diese Buchung wurde bereits storniert." };
    default:
      return { status: 500, title: "Fehler", heading: "Stornierung fehlgeschlagen", body: "Bitte versuche es später erneut oder melde dich direkt per E-Mail." };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const token = new URL(req.url).searchParams.get("token")?.trim() || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";

  if (!supabaseUrl || !serviceRoleKey) {
    return html(page("Fehler", "Server-Konfiguration fehlt", "Die Stornierungsfunktion ist noch nicht vollständig eingerichtet."), 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc("cancel_booking", {
    p_cancel_token: token,
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return html(page(mapped.title, mapped.heading, mapped.body), mapped.status);
  }

  const result = Array.isArray(data) ? data[0] : data;
  return html(
    page(
      "Storniert",
      "Deine Buchung wurde storniert.",
      `${result?.name || "Dein"} Platz für ${result?.event_date || "den Termin"} wurde freigegeben.`
    )
  );
});
