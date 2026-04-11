import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const maxDuration = 120;

/* ── Rotating User Agents for bypass ── */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
];
let _uaIdx = 0;
function getUA() { return USER_AGENTS[_uaIdx++ % USER_AGENTS.length]; }
const UA = USER_AGENTS[0];

/* ── Browser-like headers for anti-bot bypass ── */
function browserHeaders(referer = '', extra = {}) {
  const ua = getUA();
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    ...(referer ? { 'Referer': referer } : {}),
    ...extra,
  };
}

/* ── Fetch with retry + UA rotation for bypass ── */
async function fetchWithRetry(url, opts = {}, maxRetries = 2) {
  let lastErr;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const headers = { ...browserHeaders(opts.referer), ...opts.headers };
      const resp = await fetch(url, { ...opts, headers, redirect: 'follow' });
      if (resp.status === 403 || resp.status === 429 || resp.status === 503) {
        // Wait and retry with different UA
        if (i < maxRetries) { await new Promise(r => setTimeout(r, 1000 * (i + 1))); continue; }
      }
      return resp;
    } catch (err) {
      lastErr = err;
      if (i < maxRetries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr || new Error(`Failed to fetch ${url} after ${maxRetries + 1} attempts`);
}

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

/* ── Verb-Animal unique name generator for videos ── */
const VERBS = [
  'dash','leap','soar','drift','surge','prowl','glide','spark','storm','blitz',
  'roam','chase','climb','sweep','flash','crash','bloom','forge','reign','quest',
  'rush','swirl','vault','hover','march','flare','scout','swing','reign','twist',
  'bolt','lunge','stalk','whirl','plunge','coast','dive','trace','shift','pulse',
  'weave','charm','strut','stomp','coast','morph','sway','clasp','nudge','slice',
  'bound','flick','grasp','hover','joust','kneel','merge','orbit','prism','quake',
];
let _vidIdx = 0;
function verbAnimal() {
  const v = VERBS[_vidIdx % VERBS.length];
  const a = ANIMALS[(_vidIdx + 7) % ANIMALS.length]; // offset to avoid same animal as image
  _vidIdx++;
  return `${v}-${a}`;
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
  const resp = await fetchWithRetry(url, { referer: 'https://www.erome.com/' });
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
      ...[...videos].sort().map((u) => ({ url: u, type: 'video', filename: `${verbAnimal()}${extFrom(u, '.mp4')}` })),
    ],
  };
}

// ── RedGifs single ──
async function extractRedGifs(url) {
  const match = url.match(/redgifs\.com\/(?:watch|ifr)\/([a-zA-Z0-9._-]+)/);
  if (!match) throw new Error('Invalid RedGifs URL');
  const id = match[1].split('#')[0].split('?')[0];
  const { token } = await (await fetchWithRetry('https://api.redgifs.com/v2/auth/temporary')).json();
  const { gif } = await (await fetchWithRetry(`https://api.redgifs.com/v2/gifs/${id.toLowerCase()}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const hdUrl = gif.urls?.hd || gif.urls?.sd || gif.urls?.gif;
  if (!hdUrl) throw new Error('No video URL found');
  return { site: 'RedGifs', title: `redgifs_${gif.userName || 'unknown'}`, referer: 'https://www.redgifs.com/', authHeader: `Bearer ${token}`, media: [{ url: hdUrl, type: 'video', filename: `${id}${extFrom(hdUrl, '.mp4')}` }] };
}

// ── RedGifs user ──
async function extractRedGifsUser(url) {
  const match = url.match(/redgifs\.com\/users\/([a-zA-Z0-9._-]+)/);
  if (!match) throw new Error('Invalid RedGifs user URL');
  const username = match[1].split('#')[0].split('?')[0];
  const { token } = await (await fetchWithRetry('https://api.redgifs.com/v2/auth/temporary')).json();
  const auth = { Authorization: `Bearer ${token}` };
  const all = [];
  let page = 1;
  while (true) {
    const data = await (await fetchWithRetry(`https://api.redgifs.com/v2/users/${username.toLowerCase()}/search?page=${page}&count=80&order=new`, { headers: auth })).json();
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
      const data = await (await fetchWithRetry(`https://api.imgur.com/post/v1/albums/${id}?client_id=546c25a59c58ad7&include=media`)).json();
      (data.media || []).forEach(m => { if (m.url) urls.add(m.url); });
    } catch {}
    if (urls.size === 0) {
      const html = await (await fetchWithRetry(url)).text();
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
  const html = await (await fetchWithRetry(url)).text();
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim() || 'bunkr_album';
  const urls = new Set();
  $('a[href]').each((_, el) => { try { const h = new URL($(el).attr('href'), url).href; if (new URL(h).hostname.match(/cdn|media-files/)) urls.add(h); } catch {} });
  $('video source, video[src], img[src]').each((_, el) => { const s = $(el).attr('src') || $(el).attr('data-src'); if (s && /\.(mp4|jpg|jpeg|png|gif|webm)/i.test(s)) urls.add(new URL(s, url).href); });
  return { site: 'Bunkr', title: sanitize(title), referer: url, media: [...urls].sort().map((u) => ({ url: u, type: /\.(mp4|webm|mkv)/i.test(u) ? 'video' : 'image', filename: decodeURIComponent(new URL(u).pathname.split('/').pop()) || `${adjAnimal()}${extFrom(u, '.bin')}` })) };
}

// ── Cyberdrop ──
async function extractCyberdrop(url) {
  const html = await (await fetchWithRetry(url)).text();
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
  const resp = await fetchWithRetry(apiUrl);
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

// ── ShesFreaky (single video page) ──
async function extractShesFreaky(url) {
  const resp = await fetchWithRetry(url, { referer: 'https://www.shesfreaky.com/' });
  const html = await resp.text();
  const $ = cheerio.load(html);
  const media = [];

  const rawTitle = $('title').first().text().trim().replace(/\s*-\s*ShesFreaky$/i, '') || 'ShesFreaky Video';
  const title = sanitize(rawTitle);

  // Primary: <video id="video-id"> <source src="..."> </video>
  const videoSrc = $('video#video-id source[src]').attr('src') || $('video#video-id').attr('src');
  if (videoSrc) {
    media.push({ url: new URL(videoSrc, url).href, type: 'video', filename: `${title}${extFrom(videoSrc, '.mp4')}` });
  }

  // Fallback: look for CDN video URLs in HTML comments and scripts
  if (media.length === 0) {
    const cdnMatches = html.match(/https?:\/\/[^\s"'<>]+\.mjedge\.net\/videos\/[^\s"'<>]+\.mp4[^\s"'<>]*/g) || [];
    const seen = new Set();
    for (const u of cdnMatches) {
      const cleaned = u.replace(/['"]/g, '');
      if (!seen.has(cleaned) && !cleaned.includes('/p_')) { seen.add(cleaned); media.push({ url: cleaned, type: 'video', filename: `${title}${extFrom(cleaned, '.mp4')}` }); break; }
    }
  }

  // Fallback: any .mp4 in script tags
  if (media.length === 0) {
    const mp4s = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/g) || [];
    for (const u of mp4s) {
      if (!u.includes('/p_') && !u.includes('preview')) { media.push({ url: u, type: 'video', filename: `${title}.mp4` }); break; }
    }
  }

  if (media.length === 0) throw new Error('Could not extract ShesFreaky video');
  return { site: 'ShesFreaky', title, referer: 'https://www.shesfreaky.com/', media };
}

// ── ShesFreaky directory / listing page ──
async function extractShesFreakyDir(url) {
  const resp = await fetchWithRetry(url, { referer: 'https://www.shesfreaky.com/' });
  const html = await resp.text();
  const $ = cheerio.load(html);

  const pageTitle = $('title').first().text().trim().replace(/\s*-\s*ShesFreaky$/i, '') || 'ShesFreaky';

  // Collect all unique video page links
  const videoLinks = new Set();
  $('a[href*="/video/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && /\/video\/[^/]+\.html/.test(href)) {
      videoLinks.add(href.startsWith('http') ? href : new URL(href, url).href);
    }
  });

  if (videoLinks.size === 0) throw new Error('No videos found on this ShesFreaky page');

  // Fetch each video page concurrently (limit to 20 to avoid overload)
  const links = [...videoLinks].slice(0, 20);
  const results = await Promise.allSettled(
    links.map(async (vUrl) => {
      try {
        const vResp = await fetchWithRetry(vUrl, { referer: 'https://www.shesfreaky.com/' });
        const vHtml = await vResp.text();
        const v$ = cheerio.load(vHtml);
        const vTitle = sanitize(v$('title').first().text().trim().replace(/\s*-\s*ShesFreaky$/i, '') || 'video');

        let videoSrc = v$('video#video-id source[src]').attr('src') || v$('video#video-id').attr('src');
        if (!videoSrc) {
          const cdnMatch = vHtml.match(/https?:\/\/[^\s"'<>]+\.mjedge\.net\/videos\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
          if (cdnMatch) videoSrc = cdnMatch[0].replace(/['"]/g, '');
        }
        if (!videoSrc) return null;
        return { url: new URL(videoSrc, vUrl).href, type: 'video', filename: `${vTitle}${extFrom(videoSrc, '.mp4')}` };
      } catch { return null; }
    })
  );

  const media = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
  if (media.length === 0) throw new Error('Could not extract any videos from ShesFreaky listing');

  return { site: 'ShesFreaky', title: sanitize(pageTitle), referer: 'https://www.shesfreaky.com/', media };
}

// ── Instagram ──
async function extractInstagram(url) {
  const match = url.match(/instagram\.com\/(?:p|reel|reels|tv|stories)\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('Invalid Instagram URL — use a post, reel, or IGTV link');
  const shortcode = match[1];
  const media = [];

  // Strategy 1: Direct fetch with mobile UA (more likely to include og tags)
  const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': MOBILE_UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' }, redirect: 'follow' });
    const html = await resp.text();
    const $ = cheerio.load(html);

    const ogVideo = $('meta[property="og:video"]').attr('content') || $('meta[property="og:video:url"]').attr('content');
    if (ogVideo) media.push({ url: ogVideo, type: 'video', filename: `ig_${shortcode}.mp4` });

    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage && media.length === 0) media.push({ url: ogImage, type: 'image', filename: `ig_${shortcode}.jpg` });

    // Try JSON-LD
    if (media.length === 0) {
      $('script[type="application/ld+json"]').each((_, s) => {
        try {
          const json = JSON.parse($(s).html());
          if (json.video?.contentUrl && media.length === 0) media.push({ url: json.video.contentUrl, type: 'video', filename: `ig_${shortcode}.mp4` });
          if (json.image && media.length === 0) {
            const imgUrl = Array.isArray(json.image) ? json.image[0] : json.image;
            if (typeof imgUrl === 'string') media.push({ url: imgUrl, type: 'image', filename: `ig_${shortcode}.jpg` });
          }
        } catch {}
      });
    }

    // Try _sharedData / additional_data in script tags
    if (media.length === 0) {
      const allScripts = $('script').toArray().map(s => $(s).html() || '').join('\n');
      // Look for video_url or display_url in embedded JSON data
      const videoUrls = allScripts.match(/"video_url"\s*:\s*"([^"]+)"/g) || [];
      for (const vu of videoUrls) {
        const m = vu.match(/"video_url"\s*:\s*"([^"]+)"/);
        if (m) { const decoded = m[1].replace(/\\u0026/g, '&').replace(/\\/g, ''); media.push({ url: decoded, type: 'video', filename: `ig_${shortcode}.mp4` }); break; }
      }
      if (media.length === 0) {
        const displayUrls = allScripts.match(/"display_url"\s*:\s*"([^"]+)"/g) || [];
        for (const du of displayUrls) {
          const m = du.match(/"display_url"\s*:\s*"([^"]+)"/);
          if (m) { const decoded = m[1].replace(/\\u0026/g, '&').replace(/\\/g, ''); media.push({ url: decoded, type: 'image', filename: `ig_${shortcode}.jpg` }); break; }
        }
      }
    }
  } catch {}

  // Strategy 2: Try the embed page
  if (media.length === 0) {
    try {
      const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
      const embedResp = await fetchWithRetry(embedUrl);
      const embedHtml = await embedResp.text();
      const e$ = cheerio.load(embedHtml);

      // Look for video element
      const embedVideo = e$('video source').attr('src') || e$('video').attr('src');
      if (embedVideo) media.push({ url: embedVideo, type: 'video', filename: `ig_${shortcode}.mp4` });

      // Look for main content image with class EmbeddedMediaImage
      if (media.length === 0) {
        const embedImg = e$('img.EmbeddedMediaImage').attr('src') || e$('img[crossorigin]').attr('src');
        if (embedImg && embedImg.includes('cdninstagram.com')) media.push({ url: embedImg, type: 'image', filename: `ig_${shortcode}.jpg` });
      }

      // Look for video_url / display_url in embed script data
      if (media.length === 0) {
        const embedScripts = e$('script').toArray().map(s => e$(s).html() || '').join('\n');
        const vMatch = embedScripts.match(/"video_url"\s*:\s*"([^"]+)"/) || embedScripts.match(/video_url['"]\s*:\s*['"](https?:[^'"]+)['"]/);
        if (vMatch) { media.push({ url: vMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, ''), type: 'video', filename: `ig_${shortcode}.mp4` }); }
        if (media.length === 0) {
          const dMatch = embedScripts.match(/"display_url"\s*:\s*"([^"]+)"/) || embedScripts.match(/display_url['"]\s*:\s*['"](https?:[^'"]+)['"]/);
          if (dMatch) media.push({ url: dMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, ''), type: 'image', filename: `ig_${shortcode}.jpg` });
        }

        // scontent CDN images from embed
        if (media.length === 0) {
          const scontentUrls = embedHtml.match(/https?:\/\/scontent[^"'\s<>]+/g) || [];
          for (const su of scontentUrls) {
            if (/\.(jpg|jpeg|mp4)/i.test(su) || su.includes('/v/')) {
              const isVid = su.includes('.mp4') || su.includes('/v/');
              media.push({ url: su.replace(/&amp;/g, '&'), type: isVid ? 'video' : 'image', filename: `ig_${shortcode}${isVid ? '.mp4' : '.jpg'}` });
              break;
            }
          }
        }
      }
    } catch {}
  }

  // Strategy 3: Try via ddinstagram proxy (InstaFix)
  if (media.length === 0) {
    try {
      const proxyUrl = url.replace('instagram.com', 'ddinstagram.com');
      const proxyResp = await fetchWithRetry(proxyUrl);
      const proxyHtml = await proxyResp.text();
      const p$ = cheerio.load(proxyHtml);

      const pVideo = p$('meta[property="og:video"]').attr('content') || p$('meta[property="og:video:url"]').attr('content');
      if (pVideo) media.push({ url: pVideo, type: 'video', filename: `ig_${shortcode}.mp4` });

      const pImage = p$('meta[property="og:image"]').attr('content');
      if (pImage && media.length === 0 && pImage.includes('cdninstagram.com')) media.push({ url: pImage, type: 'image', filename: `ig_${shortcode}.jpg` });
    } catch {}
  }

  if (media.length === 0) throw new Error('Could not extract Instagram media — the post may be private or require login');

  return { site: 'Instagram', title: `instagram_${shortcode}`, referer: 'https://www.instagram.com/', media };
}

// ── TikTok ──
async function extractTikTok(url) {
  // First resolve any short URLs
  const resolved = await fetchWithRetry(url);
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
  const html = await (await fetchWithRetry(url)).text();
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

// ── Pornhub ──
async function extractPornhub(url) {
  const resp = await fetchWithRetry(url, { referer: 'https://www.pornhub.com/' });
  const html = await resp.text();
  const $ = cheerio.load(html);
  const media = [];

  const rawTitle = $('title').first().text().trim().replace(/\s*-\s*Pornhub\.com$/i, '') || 'Pornhub Video';
  const title = sanitize(rawTitle);

  // Strategy 1: Extract from flashvars_ / playerObjList / qualityItems JS
  // PH embeds video URLs in JS variables
  const qualityMap = {};

  // Look for mediaDefinitions in the page JS
  const mediaDefMatch = html.match(/var\s+flashvars_\d+\s*=\s*(\{[\s\S]*?\});/);
  if (mediaDefMatch) {
    try {
      // Extract just the mediaDefinitions array
      const mediaDefsStr = mediaDefMatch[1].match(/"mediaDefinitions"\s*:\s*(\[[\s\S]*?\])(?=\s*[,}])/);
      if (mediaDefsStr) {
        const defs = JSON.parse(mediaDefsStr[1]);
        for (const def of defs) {
          if (def.videoUrl && def.quality && def.format === 'mp4') {
            qualityMap[def.quality] = def.videoUrl;
          }
        }
      }
    } catch {}
  }

  // Strategy 2: Look for direct quality URLs in JS
  if (Object.keys(qualityMap).length === 0) {
    const patterns = [
      /quality_(\d+)p\s*=\s*['"](https?:[^'"]+)['"]/g,
      /videoUrl['"]\s*:\s*['"](https?:[^'"]+)['"]/g,
      /"quality"\s*:\s*"?(\d+)"?\s*,\s*"videoUrl"\s*:\s*"(https?:[^"]+)"/g,
    ];
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(html)) !== null) {
        if (m[2] && m[2].startsWith('http')) {
          qualityMap[m[1]] = m[2].replace(/\\/g, '');
        }
      }
    }
  }

  // Strategy 3: Parse flashvars JSON more aggressively
  if (Object.keys(qualityMap).length === 0) {
    const allFlashvars = html.match(/flashvars_\d+\s*=\s*\{[^;]+/g) || [];
    for (const fv of allFlashvars) {
      const urlMatches = fv.match(/https?:\/\/[^\s"'\\]+\.mp4[^\s"'\\]*/g) || [];
      for (const u of urlMatches) {
        if (!qualityMap['auto']) qualityMap['auto'] = u;
      }
    }
  }

  // Strategy 4: mediaDefinitions with remote URL that returns actual video URLs
  if (Object.keys(qualityMap).length === 0) {
    const remoteMatch = html.match(/"mediaDefinitions"\s*:\s*\[[\s\S]*?\{"defaultQuality".*?"videoUrl"\s*:\s*"(https?:[^"]+)"[\s\S]*?\]/);
    if (remoteMatch) {
      try {
        const remoteUrl = remoteMatch[1].replace(/\\/g, '');
        const remoteResp = await fetchWithRetry(remoteUrl, { referer: url });
        const remoteData = await remoteResp.json();
        if (Array.isArray(remoteData)) {
          for (const item of remoteData) {
            if (item.videoUrl && item.quality) {
              qualityMap[item.quality] = item.videoUrl;
            }
          }
        }
      } catch {}
    }
  }

  // Pick best quality
  const preferredQualities = ['1080', '720', '480', '360', '240', 'auto'];
  let bestUrl = null;
  let bestQuality = 'auto';
  for (const q of preferredQualities) {
    if (qualityMap[q]) { bestUrl = qualityMap[q]; bestQuality = q; break; }
  }
  // Fallback: pick any available
  if (!bestUrl) { const entries = Object.entries(qualityMap); if (entries.length > 0) { bestUrl = entries[0][1]; bestQuality = entries[0][0]; } }

  if (bestUrl) {
    media.push({ url: bestUrl, type: 'video', filename: `${title}_${bestQuality}p.mp4` });
  }

  // Fallback: og:video
  if (media.length === 0) {
    const ogVideo = $('meta[property="og:video"]').attr('content') || $('meta[property="og:video:url"]').attr('content');
    if (ogVideo) media.push({ url: ogVideo, type: 'video', filename: `${title}.mp4` });
  }

  // Fallback: any mp4 in HTML
  if (media.length === 0) {
    const mp4s = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/g) || [];
    const seen = new Set();
    for (const u of mp4s) {
      const cleaned = u.replace(/['"\\]/g, '');
      if (!seen.has(cleaned) && !cleaned.includes('preview') && !cleaned.includes('thumb')) {
        seen.add(cleaned);
        media.push({ url: cleaned, type: 'video', filename: `${title}.mp4` });
        break;
      }
    }
  }

  if (media.length === 0) throw new Error('Could not extract Pornhub video — may require age verification or be geo-blocked');
  return { site: 'Pornhub', title, referer: 'https://www.pornhub.com/', media };
}

// ── XVideos ──
async function extractXvideos(url) {
  const resp = await fetchWithRetry(url, { referer: 'https://www.xvideos.com/' });
  const html = await resp.text();
  const $ = cheerio.load(html);
  const media = [];

  const rawTitle = $('title').first().text().trim().replace(/\s*-\s*XVIDEOS\.COM$/i, '').replace(/\s*-\s*XVideos$/i, '') || 'XVideos Video';
  const title = sanitize(rawTitle);

  // Strategy 1: html5player.setVideoUrl* calls
  const qualityMap = {};
  const patterns = [
    { re: /html5player\.setVideoUrlHigh\(\s*['"]([^'"]+)['"]\s*\)/, q: '720' },
    { re: /html5player\.setVideoUrlLow\(\s*['"]([^'"]+)['"]\s*\)/, q: '360' },
    { re: /html5player\.setVideoHLS\(\s*['"]([^'"]+)['"]\s*\)/, q: 'hls' },
    { re: /html5player\.setVideoUrl1080p\(\s*['"]([^'"]+)['"]\s*\)/, q: '1080' },
  ];
  for (const { re, q } of patterns) {
    const m = html.match(re);
    if (m) qualityMap[q] = m[1];
  }

  // Strategy 2: setVideoUrl with quality param
  const setVideoMatches = html.match(/html5player\.setVideoUrl\w+\(\s*['"]([^'"]+)['"]\s*\)/g) || [];
  for (const svm of setVideoMatches) {
    const m = svm.match(/setVideoUrl(\w+)\(\s*['"]([^'"]+)['"]\s*\)/);
    if (m && m[2].startsWith('http')) {
      qualityMap[m[1].toLowerCase()] = m[2];
    }
  }

  // Pick best quality
  const preferred = ['1080', '720', 'high', '480', '360', 'low', 'hls'];
  let bestUrl = null;
  for (const q of preferred) {
    if (qualityMap[q]) { bestUrl = qualityMap[q]; break; }
  }
  if (!bestUrl) { const vals = Object.values(qualityMap); if (vals.length > 0) bestUrl = vals[0]; }

  if (bestUrl && !bestUrl.includes('.m3u8')) {
    media.push({ url: bestUrl, type: 'video', filename: `${title}.mp4` });
  }

  // Strategy 3: HLS fallback — extract m3u8 then use it directly
  if (media.length === 0 && qualityMap['hls']) {
    media.push({ url: qualityMap['hls'], type: 'video', filename: `${title}.mp4` });
  }

  // Fallback: og tags
  if (media.length === 0) {
    const ogVideo = $('meta[property="og:video"]').attr('content') || $('meta[property="og:video:url"]').attr('content');
    if (ogVideo) media.push({ url: ogVideo, type: 'video', filename: `${title}.mp4` });
  }

  // Fallback: any mp4 in page
  if (media.length === 0) {
    const mp4s = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/g) || [];
    for (const u of mp4s) {
      if (!u.includes('thumb') && !u.includes('preview')) { media.push({ url: u.replace(/['"\\]/g, ''), type: 'video', filename: `${title}.mp4` }); break; }
    }
  }

  if (media.length === 0) throw new Error('Could not extract XVideos video');
  return { site: 'XVideos', title, referer: 'https://www.xvideos.com/', media };
}

// ── XHamster ──
async function extractXhamster(url) {
  const resp = await fetchWithRetry(url, { referer: 'https://xhamster.com/' });
  const html = await resp.text();
  const $ = cheerio.load(html);
  const media = [];

  const rawTitle = $('title').first().text().trim().replace(/\s*-\s*xHamster.*$/i, '') || 'xHamster Video';
  const title = sanitize(rawTitle);

  // Strategy 1: window.initials JSON block
  const initialsMatch = html.match(/window\.initials\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (initialsMatch) {
    try {
      const initials = JSON.parse(initialsMatch[1]);
      const videoModel = initials?.videoModel;
      if (videoModel) {
        const sources = videoModel.sources;
        if (sources?.mp4) {
          // sources.mp4 is an object like { "720p": { url: "..." }, "480p": ... }
          const preferred = ['1080p', '720p', '480p', '360p', '240p'];
          for (const q of preferred) {
            if (sources.mp4[q]?.url) {
              media.push({ url: sources.mp4[q].url, type: 'video', filename: `${title}_${q}.mp4` });
              break;
            }
          }
          // Fallback: pick any mp4 quality
          if (media.length === 0) {
            for (const [q, data] of Object.entries(sources.mp4)) {
              if (data?.url) { media.push({ url: data.url, type: 'video', filename: `${title}_${q}.mp4` }); break; }
            }
          }
        }
        // HLS fallback
        if (media.length === 0 && sources?.hls?.url) {
          media.push({ url: sources.hls.url, type: 'video', filename: `${title}.mp4` });
        }
      }
    } catch {}
  }

  // Strategy 2: JSON-LD
  if (media.length === 0) {
    $('script[type="application/ld+json"]').each((_, el) => {
      if (media.length > 0) return;
      try {
        const json = JSON.parse($(el).html());
        if (json.contentUrl) media.push({ url: json.contentUrl, type: 'video', filename: `${title}.mp4` });
      } catch {}
    });
  }

  // Strategy 3: script data-states or nextjs __NEXT_DATA__
  if (media.length === 0) {
    const nextData = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(\{[\s\S]*?\})<\/script>/);
    if (nextData) {
      try {
        const nd = JSON.parse(nextData[1]);
        const findVideoUrl = (obj) => {
          if (!obj || typeof obj !== 'object') return null;
          if (obj.mp4Url || obj.videoUrl) return obj.mp4Url || obj.videoUrl;
          for (const v of Object.values(obj)) {
            const found = findVideoUrl(v);
            if (found) return found;
          }
          return null;
        };
        const vUrl = findVideoUrl(nd);
        if (vUrl) media.push({ url: vUrl, type: 'video', filename: `${title}.mp4` });
      } catch {}
    }
  }

  // Strategy 4: mp4 URLs in raw HTML
  if (media.length === 0) {
    const mp4s = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/g) || [];
    const seen = new Set();
    for (const u of mp4s) {
      const cleaned = u.replace(/['"\\]/g, '');
      if (!seen.has(cleaned) && !cleaned.includes('thumb') && !cleaned.includes('preview') && !cleaned.includes('/p_')) {
        seen.add(cleaned);
        media.push({ url: cleaned, type: 'video', filename: `${title}.mp4` });
        break;
      }
    }
  }

  // Fallback: og:video
  if (media.length === 0) {
    const ogVideo = $('meta[property="og:video"]').attr('content') || $('meta[property="og:video:url"]').attr('content');
    if (ogVideo) media.push({ url: ogVideo, type: 'video', filename: `${title}.mp4` });
  }

  if (media.length === 0) throw new Error('Could not extract xHamster video');
  return { site: 'xHamster', title, referer: 'https://xhamster.com/', media };
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
  if (/instagram\.com\/(?:p|reel|reels|tv|stories)\//.test(url)) return extractInstagram;
  if (/tiktok\.com/.test(url)) return extractTikTok;
  if (/pornhub\.com\/view_video/.test(url)) return extractPornhub;
  if (/xvideos\.com\/video/.test(url)) return extractXvideos;
  if (/xhamster\.com\/videos\//.test(url)) return extractXhamster;
  if (/shesfreaky\.com\/video\//.test(url)) return extractShesFreaky;
  if (/shesfreaky\.com/.test(url)) return extractShesFreakyDir;
  return extractGeneric;
}

export async function POST(req) {
  try {
    _nameIdx = 0; _vidIdx = 0; _uaIdx = 0; // reset per request
    const body = await req.json();

    // Support single URL or array of URLs for bulk
    if (body.urls && Array.isArray(body.urls)) {
      // Bulk extraction: return array of results
      const results = [];
      for (const rawUrl of body.urls) {
        const url = (rawUrl || '').trim();
        if (!url || !/^https?:\/\//.test(url)) {
          results.push({ url: rawUrl, error: 'Invalid URL' });
          continue;
        }
        try {
          const result = await getExtractor(url)(url);
          results.push({ url, ...result });
        } catch (err) {
          results.push({ url, error: err.message || 'Extraction failed' });
        }
      }
      return NextResponse.json({ bulk: true, results });
    }

    // Single URL (original behavior)
    const { url } = body;
    if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    const result = await getExtractor(url)(url);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Extraction failed' }, { status: 500 });
  }
}
