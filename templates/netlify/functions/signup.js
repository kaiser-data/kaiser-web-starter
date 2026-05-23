const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TERMIN_TO_SLUG = {{derived.terminToSlugJs}};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let name, email, termine, newsletter, promoCode;
  try {
    ({ name = '', email, termine = [], newsletter = false, promoCode = '' } = JSON.parse(event.body || '{}'));
    name      = name?.trim();
    email     = email?.trim().toLowerCase();
    promoCode = promoCode?.trim() || '';
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Ungültige Anfrage.' }) };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' }) };
  }
  if (!Array.isArray(termine) || (!newsletter && termine.length === 0)) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Bitte mindestens eine Option auswählen.' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Backend nicht konfiguriert.' }) };
  }

  const warnings = [];
  const bookings = [];
  let totalBetrag = 0;
  let promoApplied = false;

  for (const termin of termine) {
    const eventSlug = TERMIN_TO_SLUG[termin];
    if (!eventSlug) {
      warnings.push(`Unbekannter Termin: ${termin}`);
      continue;
    }

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/book-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          eventSlug,
          name,
          email,
          newsletter: Boolean(newsletter),
          promoCode: promoCode || null,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        bookings.push({ termin, betrag: data.betrag, eventSlug, remainingPlaces: data.remainingPlaces });
        totalBetrag += data.betrag;
        if (data.betrag === 0 && promoCode) promoApplied = true;
      } else if (res.status === 409 && /bereits angemeldet/i.test(data.error || '')) {
        bookings.push({ termin, betrag: {{booking.price}}, eventSlug, alreadyBooked: true });
      } else if (res.status === 400 && /Promo/i.test(data.error || '')) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Ungültiger Promo-Code.' }) };
      } else {
        warnings.push(`Termin ${termin}: ${data.error || res.statusText}`);
      }
    } catch (err) {
      warnings.push(`Termin ${termin}: ${err.message}`);
    }
  }

  if (newsletter && termine.length === 0) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/subscribers?on_conflict=email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify({
          email,
          name: name || null,
          source: 'newsletter',
          active: true,
          unsubscribed_at: null,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        warnings.push(`Newsletter: ${txt}`);
      }
    } catch (err) {
      warnings.push(`Newsletter: ${err.message}`);
    }
  }

  if (warnings.length > 0) {
    console.error('Signup warnings:', warnings);
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      success: true,
      betrag: totalBetrag,
      promoValid: promoApplied,
      bookings,
      storageDeferred: warnings.length > 0,
    }),
  };
};
