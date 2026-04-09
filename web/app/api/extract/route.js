import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/* ── Adjective-Animal unique name generator for images ── */
const ADJECTIVES = [
  'amber','blazing','coral','dusk','ember','frosty','golden','hazy','ivory','jade',
  'keen','lunar','misty','neon','opal','plush','quiet','rosy','silk','tidal',
  'ultra','vivid','warm','xenon','young','zinc','ashen','bold','crisp','deep',
  'epic','faded','grim','holo','iced','jet','knit','lush','matte','nova',
  'onyx','pale','raw','sheer','thin','vim','wild','aqua','blaze','cyan',
  'dew','ebon','fine','glow','hued','inky','jolt','kind','lime','mood',
];
const ANIMALS = [
  'fox','owl','lynx','wolf','bear','hawk','crow','dove','frog','moth',
  'orca','puma','raven','swan','viper','wren','yak','asp','bat','cat',
  'deer','elk','finch','goat','hare','ibis','jay','koi','lark','mink',
  'newt','ocelot','pike','quail','ray','seal','tern','urial','vole','wasp',
  'axis','boa','colt','dace','eel','fawn','gull','heron','iguana','jackal',
  'kudu','lion','mare','narwhal','osprey','parrot','robin','stork','toad','urchin',
];
let _nameIdx = 0;
function adjAnimal() {
  const a = ADJECTIVES[_nameIdx % ADJECTIVES.length];
  const b = ANIMALS[_nameIdx % ANIMALS.length];
  _nameIdx++;
  return `${a}-${b}`;
}

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

const MEDIA_EXT = /\.(mp4|webm|mkv|mov|avi|m4v|flv|wmv|jpg|jpeg|png|gif|webp|bmp|svg|tiff)$/i;

// ── Direct media URL ──
function isDirectMedia(url) {
  try {
    const path = new URL(url.split('?')[0]).pathname;
    return MEDIA_EXT.test(path);
  } catch { return false; }
}

async function extractDirect(url) {
  const filename = decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'media_file';
  const isVideo = /\.(mp4|webm|mkv|mov|avi|m4v|flv|wmv)$/i.test(filename);
  return {
    site: 'Direct URL',
    title: sanitize(filename.replace(/\.\w+$/, '')),
    referer: '',
    media: [{ url, type: isVideo ? 'video' : 'image', filename }],
  };
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
      ...[...images].sort().map((u) => ({ url: u, type: 'image', filename: `${adjAnimal()}${extFrom(u, '.jpg')}` })),
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
  return { site: 'Bunkr', title: sanitize(title), referer: url, media: [...urls].sort().map((u) => ({ url: u, type: /\.(mp4|webm|mkv)/i.test(u) ? 'video' : 'image', filename: decodeURIComponent(new URL(u).pathname.split('/').pop()) || `${adjAnimal()}${extFrom(u, '.bin')}` })) };
}

// ── Cyberdrop ──
async function extractCyberdrop(url) {
  const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const $ = cheerio.load(html);
  const title = $('#title').text().trim() || 'cyberdrop';
  const urls = new Set();
  $('a.image[href]').each((_, el) => urls.add($(el).attr('href')));
  $('a[href]').each((_, el) => { const h = $(el).attr('href'); if (h && (h.includes('fs-') || h.includes('.cyberdrop.')) && /\.(mp4|jpg|png|gif|webm|mkv)/i.test(h)) urls.add(h); });
  return { site: 'Cyberdrop', title: sanitize(title), referer: url, media: [...urls].sort().map((u) => ({ url: u, type: /\.(mp4|webm|mkv|mov)/i.test(u) ? 'video' : 'image', filename: decodeURIComponent(new URL(u).pathname.split('/').pop()) || `${adjAnimal()}${extFrom(u, '.bin')}` })) };
}

// ── Twitter / X ──
async function extractTwitter(url) {
  const match = url.match(/(?:twitter\.com|x\.com)\/.+\/status\/(\d+)/);
  if (!match) throw new Error('Invalid Twitter/X URL');
  const id = match[1];

  // Use fxtwitter API for reliable extraction
  const apiUrl = `https://api.fxtwitter.com/status/${id}`;
  const resp = await fetch(apiUrl, { headers: { 'User-Agent': UA } });
  if (!resp.ok) throw new Error('Failed to fetch tweet');
  const data = await resp.json();

  if (!data.tweet) throw new Error('Tweet not found');
  const tweet = data.tweet;
  const media = [];

  if (tweet.media?.videos) {
    tweet.media.videos.forEach((v, i) => {
      const videoUrl = v.url;
      if (videoUrl) media.push({ url: videoUrl, type: 'video', filename: `tweet_${id}_vid_${i + 1}.mp4` });
    });
  }

  if (tweet.media?.photos) {
    tweet.media.photos.forEach((p, i) => {
      const photoUrl = p.url;
      if (photoUrl) media.push({ url: photoUrl, type: 'image', filename: `tweet_${id}_img_${i + 1}${extFrom(photoUrl, '.jpg')}` });
    });
  }

  // Fallback: single media fields
  if (media.length === 0 && tweet.media?.all) {
    tweet.media.all.forEach((m, i) => {
      const u = m.url;
      if (u) media.push({ url: u, type: m.type === 'video' ? 'video' : 'image', filename: `tweet_${id}_${i + 1}${extFrom(u, '.jpg')}` });
    });
  }

  if (media.length === 0) throw new Error('No media found in tweet');

  return { site: 'Twitter/X', title: `tweet_${id}`, referer: 'https://x.com/', media };
}

// ── Instagram ──
async function extractInstagram(url) {
  const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('Invalid Instagram URL — use a post, reel, or IGTV link');
  const shortcode = match[1];

  // Try fetching the page and extracting og: meta tags
  const resp = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  const html = await resp.text();
  const $ = cheerio.load(html);
  const media = [];

  // Check og:video first (reels, video posts)
  const ogVideo = $('meta[property="og:video"]').attr('content') || $('meta[property="og:video:url"]').attr('content');
  if (ogVideo) {
    media.push({ url: ogVideo, type: 'video', filename: `ig_${shortcode}.mp4` });
  }

  // Check og:image
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage && media.length === 0) {
    media.push({ url: ogImage, type: 'image', filename: `ig_${shortcode}.jpg` });
  }

  // Try to find media in embedded JSON
  if (media.length === 0) {
    const scripts = $('script[type="application/ld+json"]').toArray();
    for (const s of scripts) {
      try {
        const json = JSON.parse($(s).html());
        if (json.video?.contentUrl) media.push({ url: json.video.contentUrl, type: 'video', filename: `ig_${shortcode}.mp4` });
        if (json.image && media.length === 0) {
          const imgUrl = Array.isArray(json.image) ? json.image[0] : json.image;
          if (typeof imgUrl === 'string') media.push({ url: imgUrl, type: 'image', filename: `ig_${shortcode}.jpg` });
        }
      } catch {}
    }
  }

  if (media.length === 0) throw new Error('Could not extract Instagram media — the post may be private');

  return { site: 'Instagram', title: `instagram_${shortcode}`, referer: 'https://www.instagram.com/', media };
}

// ── TikTok ──
async function extractTikTok(url) {
  // First resolve any short URLs
  const resolved = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  const finalUrl = resolved.url;
  const html = await resolved.text();
  const $ = cheerio.load(html);
  const media = [];

  // Extract video ID from final URL
  const idMatch = finalUrl.match(/\/video\/(\d+)/) || finalUrl.match(/\/(\d+)/);
  const videoId = idMatch ? idMatch[1] : 'tiktok';

  // Check og:video
  const ogVideo = $('meta[property="og:video"]').attr('content') || $('meta[property="og:video:url"]').attr('content');
  if (ogVideo) {
    media.push({ url: ogVideo, type: 'video', filename: `tiktok_${videoId}.mp4` });
  }

  // Check for video URLs in scripts
  if (media.length === 0) {
    const scriptContent = $('script#__UNIVERSAL_DATA_FOR_REHYDRATION__').html() ||
                          $('script#SIGI_STATE').html() || '';
    const videoUrls = scriptContent.match(/https?:\\?\/\\?\/[^"'\s]+\.mp4[^"'\s]*/g) || [];
    const seen = new Set();
    for (const raw of videoUrls) {
      const cleaned = raw.replace(/\\u002F/g, '/').replace(/\\/g, '');
      if (!seen.has(cleaned) && !cleaned.includes('music')) {
        seen.add(cleaned);
        media.push({ url: cleaned, type: 'video', filename: `tiktok_${videoId}.mp4` });
        break; // just need one
      }
    }
  }

  // Fallback: og:image
  if (media.length === 0) {
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage) media.push({ url: ogImage, type: 'image', filename: `tiktok_${videoId}.jpg` });
  }

  if (media.length === 0) throw new Error('Could not extract TikTok media');

  return { site: 'TikTok', title: `tiktok_${videoId}`, referer: 'https://www.tiktok.com/', media };
}

// ── Generic ──
async function extractGeneric(url) {
  const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const $ = cheerio.load(html);
  const urls = new Set();

  // og:video and og:image first
  const ogVideo = $('meta[property="og:video"]').attr('content') || $('meta[property="og:video:url"]').attr('content');
  if (ogVideo) urls.add(new URL(ogVideo, url).href);
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage && /\.(jpg|jpeg|png|gif|webp)/i.test(ogImage)) urls.add(new URL(ogImage, url).href);

  // Video elements
  $('video source[src]').each((_, el) => urls.add(new URL($(el).attr('src'), url).href));
  $('video[src]').each((_, el) => urls.add(new URL($(el).attr('src'), url).href));

  // Images (high quality only)
  $('img').each((_, el) => {
    const s = $(el).attr('data-src') || $(el).attr('src');
    if (s && /\.(jpg|jpeg|png|gif|webp)/i.test(s)) {
      try { urls.add(new URL(s, url).href); } catch {}
    }
  });

  // Regex for video URLs in raw HTML
  (html.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|webm|mkv|mov)/g) || []).forEach(u => urls.add(u));

  const host = new URL(url).hostname.replace('www.', '');
  return { site: 'Generic', title: sanitize(host), referer: url, media: [...urls].sort().map((u) => ({ url: u, type: /\.(mp4|webm|mkv|mov|avi|m4v|flv|wmv)/i.test(u) ? 'video' : 'image', filename: decodeURIComponent(new URL(u).pathname.split('/').pop()) || `${adjAnimal()}${extFrom(u, '.bin')}` })) };
}

// ── Router ──
function getExtractor(url) {
  if (isDirectMedia(url)) return extractDirect;
  if (/erome\.com\/a\//.test(url)) return extractErome;
  if (/redgifs\.com\/(watch|ifr)\//.test(url)) return extractRedGifs;
  if (/redgifs\.com\/users\//.test(url)) return extractRedGifsUser;
  if (/imgur\.com/.test(url)) return extractImgur;
  if (/bunkr+\.\w+/.test(url)) return extractBunkr;
  if (/cyberdrop\.\w+\/a\//.test(url)) return extractCyberdrop;
  if (/(?:twitter\.com|x\.com)\/.+\/status\//.test(url)) return extractTwitter;
  if (/instagram\.com\/(?:p|reel|reels|tv)\//.test(url)) return extractInstagram;
  if (/tiktok\.com/.test(url)) return extractTikTok;
  return extractGeneric;
}

export async function POST(req) {
  try {
    _nameIdx = 0; // reset per request
    const { url } = await req.json();
    if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    const result = await getExtractor(url)(url);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Extraction failed' }, { status: 500 });
  }
}
