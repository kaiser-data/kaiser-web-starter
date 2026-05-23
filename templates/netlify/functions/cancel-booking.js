exports.handler = async (event) => {
  const token = (event.queryStringParameters?.token || '').trim();
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<h1>Server-Konfiguration fehlt</h1>',
    };
  }

  const upstream = `${supabaseUrl}/functions/v1/cancel-booking?token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(upstream, {
      method: 'GET',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    const body = await res.text();
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body,
    };
  } catch (err) {
    console.error('cancel-booking proxy error:', err.message);
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<h1>Stornierung gerade nicht erreichbar</h1><p>Bitte versuche es in ein paar Minuten erneut.</p>',
    };
  }
};
