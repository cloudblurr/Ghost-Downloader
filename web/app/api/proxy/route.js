export const runtime = 'nodejs';
export const maxDuration = 300;

/* Rotating UAs to avoid fingerprinting blocks */
const PROXY_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];
let _proxyUaIdx = 0;

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

  // Determine referer from target if not provided
  let effectiveReferer = referer;
  if (!effectiveReferer) {
    try { effectiveReferer = new URL(targetUrl).origin + '/'; } catch {}
  }

  const ua = PROXY_UAS[_proxyUaIdx++ % PROXY_UAS.length];

  async function attemptFetch(attempt = 0) {
    try {
      const headers = {
        'User-Agent': PROXY_UAS[(attempt + _proxyUaIdx) % PROXY_UAS.length],
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'video',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
      };
      if (effectiveReferer) headers['Referer'] = effectiveReferer;
      if (effectiveReferer) headers['Origin'] = new URL(effectiveReferer).origin;
      if (auth) headers['Authorization'] = auth;

      // Forward range header for resumable downloads
      const range = request.headers.get('range');
      if (range) headers['Range'] = range;

      const upstream = await fetch(targetUrl, { headers, redirect: 'follow' });

      // Retry on 403/429/503 with different UA
      if ((upstream.status === 403 || upstream.status === 429 || upstream.status === 503) && attempt < 2) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        return attemptFetch(attempt + 1);
      }

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
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        return attemptFetch(attempt + 1);
      }
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  return attemptFetch();
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}
