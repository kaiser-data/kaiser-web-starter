const SITE = '{{brand.siteUrl}}';
const BREVO_API_URL = 'https://api.brevo.com/v3';

async function removeFromBrevo(email) {
  const apiKey = process.env.BREVO_API_KEY;
  const listId = process.env.BREVO_NEWSLETTER_LIST_ID;
  if (!apiKey) return;

  if (listId) {
    try {
      await fetch(`${BREVO_API_URL}/contacts/lists/${listId}/contacts/remove`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ emails: [email] }),
      });
    } catch (err) {
      console.warn('Brevo list-remove failed:', err.message);
    }
  }

  try {
    await fetch(`${BREVO_API_URL}/contacts/${encodeURIComponent(email)}`, {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ attributes: { NEWSLETTER: false } }),
    });
  } catch (err) {
    console.warn('Brevo attribute-update failed:', err.message);
  }
}

const page = (title, heading, body) => `<!doctype html>
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
      padding:40px 36px;max-width:420px;width:100%;text-align:center;
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
    <div class="icon">${title === 'Abgemeldet' ? '👋' : '⚠️'}</div>
    <h1>${heading}</h1>
    <p>${body}</p>
    <a href="${SITE}">Zurück zur Website</a>
  </div>
</body>
</html>`;

exports.handler = async (event) => {
  const email = (event.queryStringParameters?.email || '').trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: page('Fehler', 'Ungültige Anfrage', 'Kein gültiger Abmeldelink. Bitte melde dich direkt per E-Mail.'),
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  const res = await fetch(
    `${supabaseUrl}/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ active: false, unsubscribed_at: new Date().toISOString() }),
    }
  );

  if (!res.ok) {
    console.error('Supabase delete error:', await res.text());
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: page('Fehler', 'Etwas hat nicht geklappt', 'Bitte schreib uns direkt: <a href="mailto:{{legal.operatorEmail}}">{{legal.operatorEmail}}</a>'),
    };
  }

  await removeFromBrevo(email);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: page(
      'Abgemeldet',
      'Du wurdest abgemeldet.',
      `<strong>${email}</strong> erhält keine weiteren Nachrichten vom {{brand.name}}.`
    ),
  };
};
