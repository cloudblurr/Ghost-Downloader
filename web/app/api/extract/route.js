import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function extFrom(u, fallback) {
  try {
    const p = new URL(u.split('?')[0]).pathname;
    const e = p.substring(p.lastIndexOf('.'));
    return e.length > 1 && e.length < 6 ? e : fallback;
  } catch { return fallback; }
}

function sanitize(name) {
  return name.replace(/[<>:"/\\|?*\n\r\t]/g, '_').trim().substring(0, 200) || 'untitled';
}

// ── Erome ──
async function extractErome(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.erome.com/' } });
  const html = await resp.text();
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim() || 'Erome Album';
  const images = new Set();
  const videos = new Set();

  $('div.media-group img').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src');
    if (src && !src.includes('logo') && src.includes('.erome.com/') && !src.includes('/a/')) images.add(new URL(src, url).href);
  });
  if (images.size === 0) {
    $('img').each((_, el) => {
      const src = $(el).attr('data-src') || $(el).attr('src');
      if (src) { const f = new URL(src, url).href; if (f.includes('erome.com') && /\.(jpg|jpeg|png|gif|webp)/i.test(f) && !f.includes('logo') && !f.includes('avatar')) images.add(f); }
    });
  }
  $('video source').each((_, el) => { const s = $(el).attr('src'); if (s) videos.add(new URL(s, url).href); });
  $('video[src]').each((_, el) => videos.add(new URL($(el).attr('src'), url).href));
  $('script').each((_, el) => { const t = $(el).html() || ''; const m = t.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/g); if (m) m.forEach(u => videos.add(u)); });

  return {
    site: 'Erome', title, referer: url,
    media: [
      ...[...images].sort().map((u, i) => ({ url: u, type: 'image', filename: `img_${String(i + 1).padStart(3, '0')}${extFrom(u, '.jpg')}` })),
      ...[...videos].sort().map((u, i) => ({ url: u, type: 'video', filename: `vid_${String(i + 1).padStart(3, '0')}${extFrom(u, '.mp4')}` })),
    ],
  };
}

// ── RedGifs single ──
async function extractRedGifs(url) {
  const match = url.match(/redgifs\.com\/(?:watch|ifr)\/([a-zA-Z0-9._-]+)/);
  if (!match) throw new Error('Invalid RedGifs URL');
  const id = match[1].split('#')[0].split('?')[0];
  const { token } = await (await fetch('https://api.redgifs.com/v2/auth/temporary', { headers: { 'User-Agent': UA } })).json();
  const { gif } = await (await fetch(`https://api.redgifs.com/v2/gifs/${id.toLowerCase()}`, { headers: { 'User-Agent': UA, Authorization: `Bearer ${token}` } })).json();
  const hdUrl = gif.urls?.hd || gif.urls?.sd || gif.urls?.gif;
  if (!hdUrl) throw new Error('No video URL found');
  return { site: 'RedGifs', title: `redgifs_${gif.userName || 'unknown'}`, referer: 'https://www.redgifs.com/', authHeader: `Bearer ${token}`, media: [{ url: hdUrl, type: 'video', filename: `${id}${extFrom(hdUrl, '.mp4')}` }] };
}

// ── RedGifs user ──
async function extractRedGifsUser(url) {
  const match = url.match(/redgifs\.com\/users\/([a-zA-Z0-9._-]+)/);
  if (!match) throw new Error('Invalid RedGifs user URL');
  const username = match[1].split('#')[0].split('?')[0];
  const { token } = await (await fetch('https://api.redgifs.com/v2/auth/temporary', { headers: { 'User-Agent': UA } })).json();
  const auth = { 'User-Agent': UA, Authorization: `Bearer ${token}` };
  const all = [];
  let page = 1;
  while (true) {
    const data = await (await fetch(`https://api.redgifs.com/v2/users/${username.toLowerCase()}/search?page=${page}&count=80&order=new`, { headers: auth })).json();
    const gifs = data.gifs || [];
    if (gifs.length === 0) break;
    all.push(...gifs);
    if (page >= (data.pages || 1)) break;
    page++;
  }
  return {
    site: 'RedGifs', title: `redgifs_${username}`, referer: 'https://www.redgifs.com/', authHeader: `Bearer ${token}`,
    media: all.map(g => { const u = g.urls?.hd || g.urls?.sd; return u ? { url: u, type: 'video', filename: `${g.id}${extFrom(u, '.mp4')}` } : null; }).filter(Boolean),
  };
}

// ── Imgur ──
async function extractImgur(url) {
  const albumMatch = url.match(/imgur\.com\/(?:a|gallery)\/(\w+)/);
  if (albumMatch) {
    const id = albumMatch[1];
    const urls = new Set();
    try {
      const data = await (await fetch(`https://api.imgur.com/post/v1/albums/${id}?client_id=546c25a59c58ad7&include=media`, { headers: { 'User-Agent': UA } })).json();
      (data.media || []).forEach(m => { if (m.url) urls.add(m.url); });
    } catch {}
    if (urls.size === 0) {
      const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
      (html.match(/https?:\/\/i\.imgur\.com\/\w+\.\w{3,4}/g) || []).forEach(u => { if (!u.includes('removed')) urls.add(u); });
    }
    return { site: 'Imgur', title: `imgur_${id}`, referer: 'https://imgur.com/', media: [...urls].sort().map(u => ({ url: u, type: /\.mp4/i.test(u) ? 'video' : 'image', filename: new URL(u).pathname.split('/').pop() })) };
  }
  if (/i\.imgur\.com\/\w+\.\w+/.test(url)) {
    const fn = new URL(url).pathname.split('/').pop();
    return { site: 'Imgur', title: 'imgur', referer: 'https://imgur.com/', media: [{ url, type: /\.mp4/i.test(url) ? 'video' : 'image', filename: fn }] };
  }
  throw new Error('Could not parse Imgur URL');
}

// ── Bunkr ──
async function extractBunkr(url) {
  const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim() || 'bunkr_album';
  const urls = new Set();
  $('a[href]').each((_, el) => { try { const h = new URL($(el).attr('href'), url).href; if (new URL(h).hostname.match(/cdn|media-files/)) urls.add(h); } catch {} });
  $('video source, video[src], img[src]').each((_, el) => { const s = $(el).attr('src') || $(el).attr('data-src'); if (s && /\.(mp4|jpg|jpeg|png|gif|webm)/i.test(s)) urls.add(new URL(s, url).href); });
  return { site: 'Bunkr', title: sanitize(title), referer: url, media: [...urls].sort().map((u, i) => ({ url: u, type: /\.(mp4|webm|mkv)/i.test(u) ? 'video' : 'image', filename: decodeURIComponent(new URL(u).pathname.split('/').pop()) || `file_${i + 1}` })) };
}

// ── Cyberdrop ──
async function extractCyberdrop(url) {
  const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const $ = cheerio.load(html);
  const title = $('#title').text().trim() || 'cyberdrop';
  const urls = new Set();
  $('a.image[href]').each((_, el) => urls.add($(el).attr('href')));
  $('a[href]').each((_, el) => { const h = $(el).attr('href'); if (h && (h.includes('fs-') || h.includes('.cyberdrop.')) && /\.(mp4|jpg|png|gif|webm|mkv)/i.test(h)) urls.add(h); });
  return { site: 'Cyberdrop', title: sanitize(title), referer: url, media: [...urls].sort().map((u, i) => ({ url: u, type: /\.(mp4|webm|mkv|mov)/i.test(u) ? 'video' : 'image', filename: decodeURIComponent(new URL(u).pathname.split('/').pop()) || `file_${i + 1}` })) };
}

// ── Generic ──
async function extractGeneric(url) {
  const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const $ = cheerio.load(html);
  const urls = new Set();
  $('video source[src]').each((_, el) => urls.add(new URL($(el).attr('src'), url).href));
  $('video[src]').each((_, el) => urls.add(new URL($(el).attr('src'), url).href));
  $('img').each((_, el) => { const s = $(el).attr('data-src') || $(el).attr('src'); if (s && /\.(jpg|jpeg|png|gif|webp)/i.test(s)) urls.add(new URL(s, url).href); });
  (html.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|webm|mkv|mov)/g) || []).forEach(u => urls.add(u));
  const host = new URL(url).hostname.replace('www.', '');
  return { site: 'Generic', title: sanitize(host), referer: url, media: [...urls].sort().map((u, i) => ({ url: u, type: /\.(mp4|webm|mkv|mov)/i.test(u) ? 'video' : 'image', filename: decodeURIComponent(new URL(u).pathname.split('/').pop()) || `file_${i + 1}` })) };
}

// ── Router ──
function getExtractor(url) {
  if (/erome\.com\/a\//.test(url)) return extractErome;
  if (/redgifs\.com\/(watch|ifr)\//.test(url)) return extractRedGifs;
  if (/redgifs\.com\/users\//.test(url)) return extractRedGifsUser;
  if (/imgur\.com/.test(url)) return extractImgur;
  if (/bunkr+\.\w+/.test(url)) return extractBunkr;
  if (/cyberdrop\.\w+\/a\//.test(url)) return extractCyberdrop;
  return extractGeneric;
}

export async function POST(req) {
  try {
    const { url } = await req.json();
    if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    const result = await getExtractor(url)(url);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Extraction failed' }, { status: 500 });
  }
}
