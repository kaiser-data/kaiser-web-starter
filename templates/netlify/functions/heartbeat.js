exports.handler = async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return { statusCode: 500, body: 'missing supabase env' };
  }

  try {
    const res = await fetch(`${url}/rest/v1/subscribers?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    console.log(`heartbeat: status=${res.status}`);
    return { statusCode: 200, body: `ok status=${res.status}` };
  } catch (err) {
    console.error('heartbeat failed:', err.message);
    return { statusCode: 500, body: `error: ${err.message}` };
  }
};

exports.config = {
  schedule: '@weekly',
};
