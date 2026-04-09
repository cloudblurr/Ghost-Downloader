export const runtime = 'nodejs';
export const maxDuration = 300;

const PROXY_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');
  const referer = searchParams.get('referer') || '';
  const auth = searchParams.get('auth') || '';
  const dl = searchParams.get('dl');          // "1" → Content-Disposition: attachment
  const filename = searchParams.get('filename') || '';

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url param' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const headers = { 'User-Agent': PROXY_UA };
    if (referer) headers['Referer'] = referer;
    if (auth) headers['Authorization'] = auth;

    // Forward range header for resumable downloads
    const range = request.headers.get('range');
    if (range) headers['Range'] = range;

    const upstream = await fetch(targetUrl, { headers, redirect: 'follow' });
    if (!upstream.ok && upstream.status !== 206) {
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), { status: upstream.status, headers: { 'Content-Type': 'application/json' } });
    }

    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    const cl = upstream.headers.get('content-length');
    const cr = upstream.headers.get('content-range');
    const h = {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Disposition',
      'Accept-Ranges': 'bytes',
    };
    if (cl) h['Content-Length'] = cl;
    if (cr) h['Content-Range'] = cr;

    // Trigger browser's native "Save As" download
    if (dl === '1') {
      const safeName = (filename || 'download').replace(/[^\w.\-() ]/g, '_');
      h['Content-Disposition'] = `attachment; filename="${safeName}"`;
    }

    return new Response(upstream.body, { status: upstream.status, headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}
