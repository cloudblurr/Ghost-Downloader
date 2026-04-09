import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── Erome ──────────────────────────────────────────────────
async function extractErome(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': 'https://www.erome.com/' },
  });
  const html = await resp.text();
  const $ = cheerio.load(html);

  const title = $('h1').first().text().trim() || 'Erome Album';
  const images = new Set();
  const videos = new Set();

  // Images from media-group divs
  $('div.media-group img').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src');
    if (src && !src.includes('logo') && src.includes('.erome.com/') && !src.includes('/a/')) {
      images.add(new URL(src, url).href);
    }
  });

  // Fallback: all img with erome CDN
  if (images.size === 0) {
    $('img').each((_, el) => {
      const src = $(el).attr('data-src') || $(el).attr('src');
      if (src) {
        const full = new URL(src, url).href;
        if (full.includes('erome.com') && /\.(jpg|jpeg|png|gif|webp)/i.test(full)
            && !full.includes('logo') && !full.includes('avatar')) {
          images.add(full);
        }
      }
    });
  }

  // Videos
  $('video source').each((_, el) => {
    const src = $(el).attr('src');
    if (src) videos.add(new URL(src, url).href);
  });
  $('video[src]').each((_, el) => {
    videos.add(new URL($(el).attr('src'), url).href);
  });
  // MP4 in scripts
  $('script').each((_, el) => {
    const text = $(el).html() || '';
    const matches = text.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/g);
    if (matches) matches.forEach(u => videos.add(u));
  });

  return {
    site: 'Erome',
    title,
    referer: url,
    media: [
      ...[...images].sort().map((u, i) => ({ url: u, type: 'image', filename: `img_${String(i+1).padStart(3,'0')}${extFrom(u, '.jpg')}` })),
      ...[...videos].sort().map((u, i) => ({ url: u, type: 'video', filename: `vid_${String(i+1).padStart(3,'0')}${extFrom(u, '.mp4')}` })),
    ],
  };
}

// ─── RedGifs (single) ───────────────────────────────────────
async function extractRedGifs(url) {
  const match = url.match(/redgifs\.com\/(?:watch|ifr)\/([a-zA-Z0-9._-]+)/);
  if (!match) throw new Error('Invalid RedGifs URL');
  const gifId = match[1].split('#')[0].split('?')[0];

  // Get temp token
  const authResp = await fetch('https://api.redgifs.com/v2/auth/temporary', {
    headers: { 'User-Agent': UA },
  });
  const { token } = await authResp.json();

  // Get gif info
  const gifResp = await fetch(`https://api.redgifs.com/v2/gifs/${gifId.toLowerCase()}`, {
    headers: { 'User-Agent': UA, 'Authorization': `Bearer ${token}` },
  });
  const { gif } = await gifResp.json();
  const urls = gif.urls || {};
  const hdUrl = urls.hd || urls.sd || urls.gif;
  if (!hdUrl) throw new Error('No video URL found');

  return {
    site: 'RedGifs',
    title: `redgifs_${gif.userName || 'unknown'}`,
    referer: 'https://www.redgifs.com/',
    authHeader: `Bearer ${token}`,
    media: [{ url: hdUrl, type: 'video', filename: `${gifId}${extFrom(hdUrl, '.mp4')}` }],
  };
}

// ─── RedGifs User ───────────────────────────────────────────
async function extractRedGifsUser(url) {
  const match = url.match(/redgifs\.com\/users\/([a-zA-Z0-9._-]+)/);
  if (!match) throw new Error('Invalid RedGifs user URL');
  const username = match[1].split('#')[0].split('?')[0];

  const authResp = await fetch('https://api.redgifs.com/v2/auth/temporary', {
    headers: { 'User-Agent': UA },
  });
  const { token } = await authResp.json();
  const auth = { 'User-Agent': UA, 'Authorization': `Bearer ${token}` };

  const allGifs = [];
  let page = 1;
  while (true) {
    const resp = await fetch(
      `https://api.redgifs.com/v2/users/${username.toLowerCase()}/search?page=${page}&count=80&order=new`,
      { headers: auth }
    );
    const data = await resp.json();
    const gifs = data.gifs || [];
    if (gifs.length === 0) break;
    allGifs.push(...gifs);
    if (page >= (data.pages || 1)) break;
    page++;
  }

  const media = allGifs
    .map(g => {
      const u = g.urls?.hd || g.urls?.sd;
      return u ? { url: u, type: 'video', filename: `${g.id}${extFrom(u, '.mp4')}` } : null;
    })
    .filter(Boolean);

  return {
    site: 'RedGifs',
    title: `redgifs_${username}`,
    referer: 'https://www.redgifs.com/',
    authHeader: `Bearer ${token}`,
    media,
  };
}

// ─── Imgur ───────────────────────────────────────────────────
async function extractImgur(url) {
  const albumMatch = url.match(/imgur\.com\/(?:a|gallery)\/(\w+)/);

  if (albumMatch) {
    const albumId = albumMatch[1];
    const mediaUrls = new Set();

    // Try API
    try {
      const apiResp = await fetch(
        `https://api.imgur.com/post/v1/albums/${albumId}?client_id=546c25a59c58ad7&include=media`,
        { headers: { 'User-Agent': UA } }
      );
      if (apiResp.ok) {
        const data = await apiResp.json();
        (data.media || []).forEach(item => { if (item.url) mediaUrls.add(item.url); });
      }
    } catch {}

    // Fallback: scrape page
    if (mediaUrls.size === 0) {
      const resp = await fetch(url, { headers: { 'User-Agent': UA } });
      const html = await resp.text();
      const matches = html.match(/https?:\/\/i\.imgur\.com\/\w+\.\w{3,4}/g);
      if (matches) matches.forEach(u => { if (!u.includes('removed')) mediaUrls.add(u); });
    }

    return {
      site: 'Imgur',
      title: `imgur_${albumId}`,
      referer: 'https://imgur.com/',
      media: [...mediaUrls].sort().map((u, i) => ({
        url: u, type: /\.mp4/i.test(u) ? 'video' : 'image',
        filename: new URL(u).pathname.split('/').pop(),
      })),
    };
  }

  // Single image
  if (/i\.imgur\.com\/\w+\.\w+/.test(url)) {
    const filename = new URL(url).pathname.split('/').pop();
    return {
      site: 'Imgur',
      title: 'imgur',
      referer: 'https://imgur.com/',
      media: [{ url, type: /\.mp4/i.test(url) ? 'video' : 'image', filename }],
    };
  }

  throw new Error('Could not parse Imgur URL');
}

// ─── Bunkr ──────────────────────────────────────────────────
async function extractBunkr(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  const html = await resp.text();
  const $ = cheerio.load(html);

  const title = $('h1').first().text().trim() || 'bunkr_album';
  const fileUrls = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const full = new URL(href, url).href;
    try {
      const h = new URL(full).hostname;
      if (h && (h.includes('cdn') || h.includes('media-files'))) fileUrls.add(full);
    } catch {}
  });

  $('video source, video[src], img[src]').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (src && /\.(mp4|jpg|jpeg|png|gif|webm)/i.test(src)) {
      fileUrls.add(new URL(src, url).href);
    }
  });

  return {
    site: 'Bunkr',
    title: sanitize(title),
    referer: url,
    media: [...fileUrls].sort().map((u, i) => ({
      url: u, type: /\.(mp4|webm|mkv)/i.test(u) ? 'video' : 'image',
      filename: decodeURIComponent(new URL(u).pathname.split('/').pop()) || `file_${i+1}`,
    })),
  };
}

// ─── Cyberdrop ──────────────────────────────────────────────
async function extractCyberdrop(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  const html = await resp.text();
  const $ = cheerio.load(html);

  const title = $('#title').text().trim() || 'cyberdrop';
  const fileUrls = new Set();

  $('a.image[href]').each((_, el) => { fileUrls.add($(el).attr('href')); });
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && (href.includes('fs-') || href.includes('.cyberdrop.')) &&
        /\.(mp4|jpg|png|gif|webm|mkv)/i.test(href)) {
      fileUrls.add(href);
    }
  });

  return {
    site: 'Cyberdrop',
    title: sanitize(title),
    referer: url,
    media: [...fileUrls].sort().map((u, i) => ({
      url: u, type: /\.(mp4|webm|mkv|mov)/i.test(u) ? 'video' : 'image',
      filename: decodeURIComponent(new URL(u).pathname.split('/').pop()) || `file_${i+1}`,
    })),
  };
}

// ─── Generic ────────────────────────────────────────────────
async function extractGeneric(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  const html = await resp.text();
  const $ = cheerio.load(html);

  const mediaUrls = new Set();
  $('video source[src]').each((_, el) => mediaUrls.add(new URL($(el).attr('src'), url).href));
  $('video[src]').each((_, el) => mediaUrls.add(new URL($(el).attr('src'), url).href));
  $('img').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src');
    if (src && /\.(jpg|jpeg|png|gif|webp)/i.test(src)) {
      mediaUrls.add(new URL(src, url).href);
    }
  });
  const mp4s = html.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|webm|mkv|mov)/g);
  if (mp4s) mp4s.forEach(u => mediaUrls.add(u));

  const hostname = new URL(url).hostname.replace('www.', '');
  return {
    site: 'Generic',
    title: sanitize(hostname),
    referer: url,
    media: [...mediaUrls].sort().map((u, i) => ({
      url: u, type: /\.(mp4|webm|mkv|mov)/i.test(u) ? 'video' : 'image',
      filename: decodeURIComponent(new URL(u).pathname.split('/').pop()) || `file_${i+1}`,
    })),
  };
}

// ─── Helpers ────────────────────────────────────────────────
function extFrom(url, fallback) {
  try {
    const path = new URL(url.split('?')[0]).pathname;
    const ext = path.substring(path.lastIndexOf('.'));
    return ext.length > 1 && ext.length < 6 ? ext : fallback;
  } catch { return fallback; }
}

function sanitize(name) {
  return name.replace(/[<>:"/\\|?*\n\r\t]/g, '_').trim().substring(0, 200) || 'untitled';
}

// ─── Router ─────────────────────────────────────────────────
function getExtractor(url) {
  if (/erome\.com\/a\//.test(url)) return extractErome;
  if (/redgifs\.com\/(watch|ifr)\//.test(url)) return extractRedGifs;
  if (/redgifs\.com\/users\//.test(url)) return extractRedGifsUser;
  if (/imgur\.com/.test(url)) return extractImgur;
  if (/bunkr+\.\w+/.test(url)) return extractBunkr;
  if (/cyberdrop\.\w+\/a\//.test(url)) return extractCyberdrop;
  return extractGeneric;
}

// ─── API handler ────────────────────────────────────────────
export async function POST(req) {
  try {
    const { url } = await req.json();
    if (!url || !/^https?:\/\//.test(url)) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    const extractor = getExtractor(url);
    const result = await extractor(url);

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Extraction failed' }, { status: 500 });
  }
}
