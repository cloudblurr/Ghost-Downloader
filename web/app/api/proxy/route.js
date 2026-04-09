export const runtime = 'edge';
export const maxDuration = 60;

const PROXY_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');
  const referer = searchParams.get('referer') || '';
  const auth = searchParams.get('auth') || '';

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url param' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const headers = { 'User-Agent': PROXY_UA };
    if (referer) headers['Referer'] = referer;
    if (auth) headers['Authorization'] = auth;

    const upstream = await fetch(targetUrl, { headers, redirect: 'follow' });
    if (!upstream.ok) return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), { status: upstream.status, headers: { 'Content-Type': 'application/json' } });

    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    const cl = upstream.headers.get('content-length');
    const h = {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    };
    if (cl) h['Content-Length'] = cl;

    return new Response(upstream.body, { headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}
