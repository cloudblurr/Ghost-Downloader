#!/usr/bin/env python3
"""
Ghost Downloader — Web UI
Flask app with real-time progress via Server-Sent Events.
Downloads media from Erome, RedGifs, Imgur, Bunkr, Cyberdrop, etc.
Packages results as ZIP for browser download.
"""

import io
import os
import re
import json
import time
import uuid
import shutil
import zipfile
import hashlib
import threading
from abc import ABC, abstractmethod
from pathlib import Path
from urllib.parse import urlparse, urljoin

import requests
from bs4 import BeautifulSoup
from flask import Flask, request, jsonify, send_file, Response, render_template

app = Flask(__name__, static_folder='static', template_folder='templates')

# ─── Config ──────────────────────────────────────────────────
DOWNLOAD_DIR = Path(os.environ.get('GHOST_DOWNLOAD_DIR', './tmp_downloads'))
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_AGE_HOURS = 2  # auto-cleanup old downloads
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

# ─── Job tracking ────────────────────────────────────────────
jobs = {}  # job_id -> {status, progress, logs, folder, ...}
jobs_lock = threading.Lock()


def emit(job_id: str, msg: str, progress: float = None):
    """Append a log message to a job."""
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id]['logs'].append(msg)
            if progress is not None:
                jobs[job_id]['progress'] = progress


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\n\r\t]', '_', name)
    name = name.strip('. ')
    return name[:200] if name else 'untitled'


def download_file(url, dest_path, session, referer='', extra_headers=None, job_id=None):
    if dest_path.exists() and dest_path.stat().st_size > 0:
        if job_id:
            emit(job_id, f"SKIP|{dest_path.name}|already exists")
        return True

    headers = {'User-Agent': USER_AGENT, 'Accept': '*/*'}
    if referer:
        headers['Referer'] = referer
    if extra_headers:
        headers.update(extra_headers)

    try:
        resp = session.get(url, headers=headers, stream=True, timeout=120)
        resp.raise_for_status()
        total = int(resp.headers.get('content-length', 0))
        downloaded = 0

        with open(dest_path, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=32768):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
        return True
    except requests.RequestException as e:
        if job_id:
            emit(job_id, f"ERROR|{dest_path.name}|{e}")
        if dest_path.exists():
            dest_path.unlink()
        return False


# ─────────────────────────────────────────────────────────────
# Site handlers (same logic as ghost_dl.py, adapted for web)
# ─────────────────────────────────────────────────────────────

class SiteHandler(ABC):
    name = 'base'

    @staticmethod
    @abstractmethod
    def matches(url): pass

    @abstractmethod
    def download(self, url, output_dir, session, job_id): pass


class EromeHandler(SiteHandler):
    name = 'Erome'

    @staticmethod
    def matches(url):
        return bool(re.match(r'https?://(www\.)?erome\.com/a/[a-zA-Z0-9]+', url))

    def download(self, url, output_dir, session, job_id):
        album_id = re.search(r'/a/([a-zA-Z0-9]+)', url).group(1)
        emit(job_id, f"INFO|Fetching Erome album {album_id}...")

        headers = {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': 'https://www.erome.com/',
        }
        resp = session.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        h1 = soup.find('h1')
        title = sanitize_filename(h1.get_text(strip=True) if h1 else album_id)

        images = set()
        for div in soup.find_all('div', class_='media-group'):
            for img in div.find_all('img'):
                src = img.get('data-src') or img.get('src')
                if src and 'logo' not in src.lower():
                    full = urljoin(url, src)
                    if '.erome.com/' in full and '/a/' not in full:
                        images.add(full)
        if not images:
            for img in soup.find_all('img'):
                src = img.get('data-src') or img.get('src')
                if src:
                    full = urljoin(url, src)
                    p = urlparse(full)
                    if (p.hostname and 'erome.com' in p.hostname
                            and any(ext in full.lower() for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp'])
                            and 'logo' not in full.lower() and 'avatar' not in full.lower()):
                        images.add(full)

        videos = set()
        for video in soup.find_all('video'):
            for source in video.find_all('source'):
                src = source.get('src')
                if src:
                    videos.add(urljoin(url, src))
            if video.get('src'):
                videos.add(urljoin(url, video['src']))
        for script in soup.find_all('script'):
            text = script.string or ''
            for u in re.findall(r'https?://[^\s"\']+\.mp4[^\s"\']*', text):
                videos.add(u)

        images = sorted(images)
        videos = sorted(videos)
        total = len(images) + len(videos)
        emit(job_id, f"FOUND|{len(images)} images, {len(videos)} videos")

        album_dir = output_dir / f"{title}_{album_id}"
        album_dir.mkdir(parents=True, exist_ok=True)

        done, success, failed = 0, 0, 0

        for i, img_url in enumerate(images, 1):
            ext = Path(urlparse(img_url.split('?')[0]).path).suffix or '.jpg'
            dest = album_dir / f"img_{i:03d}{ext}"
            emit(job_id, f"DL|img_{i:03d}{ext}|{i}/{len(images)}", progress=done / max(total, 1) * 100)
            if download_file(img_url, dest, session, url, job_id=job_id):
                success += 1
            else:
                failed += 1
            done += 1
            time.sleep(0.2)

        for i, vid_url in enumerate(videos, 1):
            ext = Path(urlparse(vid_url.split('?')[0]).path).suffix or '.mp4'
            dest = album_dir / f"vid_{i:03d}{ext}"
            emit(job_id, f"DL|vid_{i:03d}{ext}|{i}/{len(videos)}", progress=done / max(total, 1) * 100)
            if download_file(vid_url, dest, session, url, job_id=job_id):
                success += 1
            else:
                failed += 1
            done += 1
            time.sleep(0.3)

        return {'success': success, 'failed': failed, 'folder': album_dir, 'title': title}


class RedGifsHandler(SiteHandler):
    name = 'RedGifs'
    _token = None

    @staticmethod
    def matches(url):
        return bool(re.match(r'https?://(www\.)?redgifs\.com/(watch|ifr)/\S+', url))

    def _get_token(self, session):
        if self._token:
            return self._token
        resp = session.get('https://api.redgifs.com/v2/auth/temporary',
                           headers={'User-Agent': USER_AGENT}, timeout=15)
        resp.raise_for_status()
        self._token = resp.json()['token']
        return self._token

    def download(self, url, output_dir, session, job_id):
        match = re.search(r'redgifs\.com/(?:watch|ifr)/([a-zA-Z0-9._-]+)', url)
        if not match:
            emit(job_id, "ERROR|Could not extract RedGifs ID")
            return {'success': 0, 'failed': 1, 'folder': output_dir, 'title': 'error'}

        gif_id = match.group(1).split('#')[0].split('?')[0]
        emit(job_id, f"INFO|Fetching RedGifs video: {gif_id}")

        token = self._get_token(session)
        resp = session.get(
            f'https://api.redgifs.com/v2/gifs/{gif_id.lower()}',
            headers={'User-Agent': USER_AGENT, 'Authorization': f'Bearer {token}'},
            timeout=15,
        )
        resp.raise_for_status()
        info = resp.json()['gif']

        urls = info.get('urls', {})
        hd_url = urls.get('hd') or urls.get('sd') or urls.get('gif')
        if not hd_url:
            emit(job_id, "ERROR|No download URL found")
            return {'success': 0, 'failed': 1, 'folder': output_dir, 'title': gif_id}

        username = info.get('userName', 'unknown')
        rg_dir = output_dir / f"redgifs_{sanitize_filename(username)}"
        rg_dir.mkdir(parents=True, exist_ok=True)

        ext = Path(urlparse(hd_url.split('?')[0]).path).suffix or '.mp4'
        dest = rg_dir / f"{gif_id}{ext}"

        emit(job_id, f"FOUND|1 video (HD)")
        emit(job_id, f"DL|{gif_id}{ext}|1/1", progress=0)

        extra = {'Authorization': f'Bearer {token}'}
        ok = download_file(hd_url, dest, session, 'https://www.redgifs.com/', extra, job_id=job_id)

        return {'success': 1 if ok else 0, 'failed': 0 if ok else 1,
                'folder': rg_dir, 'title': f"redgifs_{username}"}


class RedGifsUserHandler(SiteHandler):
    name = 'RedGifs User'
    _token = None

    @staticmethod
    def matches(url):
        return bool(re.match(r'https?://(www\.)?redgifs\.com/users/\S+', url))

    def _get_token(self, session):
        if self._token:
            return self._token
        resp = session.get('https://api.redgifs.com/v2/auth/temporary',
                           headers={'User-Agent': USER_AGENT}, timeout=15)
        resp.raise_for_status()
        self._token = resp.json()['token']
        return self._token

    def download(self, url, output_dir, session, job_id):
        match = re.search(r'redgifs\.com/users/([a-zA-Z0-9._-]+)', url)
        if not match:
            emit(job_id, "ERROR|Could not extract username")
            return {'success': 0, 'failed': 1, 'folder': output_dir, 'title': 'error'}

        username = match.group(1).split('#')[0].split('?')[0]
        emit(job_id, f"INFO|Fetching all videos from user: {username}")

        token = self._get_token(session)
        auth = {'User-Agent': USER_AGENT, 'Authorization': f'Bearer {token}'}

        rg_dir = output_dir / f"redgifs_{sanitize_filename(username)}"
        rg_dir.mkdir(parents=True, exist_ok=True)

        page, all_gifs = 1, []
        while True:
            try:
                resp = session.get(
                    f'https://api.redgifs.com/v2/users/{username.lower()}/search',
                    params={'page': page, 'count': 80, 'order': 'new'},
                    headers=auth, timeout=15)
                resp.raise_for_status()
                data = resp.json()
                gifs = data.get('gifs', [])
                if not gifs:
                    break
                all_gifs.extend(gifs)
                emit(job_id, f"INFO|Page {page}/{data.get('pages', '?')} — {len(gifs)} gifs")
                if page >= data.get('pages', 1):
                    break
                page += 1
                time.sleep(0.5)
            except requests.RequestException as e:
                emit(job_id, f"ERROR|Page fetch failed: {e}")
                break

        emit(job_id, f"FOUND|{len(all_gifs)} videos total")

        success, failed = 0, 0
        for i, gif in enumerate(all_gifs, 1):
            urls = gif.get('urls', {})
            hd_url = urls.get('hd') or urls.get('sd')
            gif_id = gif.get('id', f'unknown_{i}')
            if not hd_url:
                failed += 1
                continue

            ext = Path(urlparse(hd_url.split('?')[0]).path).suffix or '.mp4'
            dest = rg_dir / f"{gif_id}{ext}"
            emit(job_id, f"DL|{gif_id}{ext}|{i}/{len(all_gifs)}",
                 progress=i / max(len(all_gifs), 1) * 100)

            extra = {'Authorization': f'Bearer {token}'}
            if download_file(hd_url, dest, session, 'https://www.redgifs.com/', extra, job_id=job_id):
                success += 1
            else:
                failed += 1
            time.sleep(0.3)

        return {'success': success, 'failed': failed, 'folder': rg_dir,
                'title': f"redgifs_{username}"}


class ImgurHandler(SiteHandler):
    name = 'Imgur'

    @staticmethod
    def matches(url):
        return bool(re.match(r'https?://(www\.|i\.)?imgur\.com/', url))

    def download(self, url, output_dir, session, job_id):
        emit(job_id, f"INFO|Fetching Imgur content...")

        # Single direct image
        if re.match(r'https?://i\.imgur\.com/\w+\.\w+', url):
            filename = Path(urlparse(url).path).name
            img_dir = output_dir / 'imgur'
            img_dir.mkdir(parents=True, exist_ok=True)
            dest = img_dir / filename
            emit(job_id, f"DL|{filename}|1/1", progress=0)
            ok = download_file(url, dest, session, 'https://imgur.com/', job_id=job_id)
            return {'success': 1 if ok else 0, 'failed': 0 if ok else 1,
                    'folder': img_dir, 'title': 'imgur'}

        # Album
        album_match = re.search(r'imgur\.com/(?:a|gallery)/(\w+)', url)
        if album_match:
            album_id = album_match.group(1)
            media_urls = set()

            resp = session.get(url, headers={'User-Agent': USER_AGENT}, timeout=30)
            for m in re.findall(r'https?://i\.imgur\.com/\w+\.\w{3,4}', resp.text):
                if 'removed' not in m.lower():
                    media_urls.add(m)

            try:
                api_resp = session.get(
                    f'https://api.imgur.com/post/v1/albums/{album_id}?client_id=546c25a59c58ad7&include=media',
                    headers={'User-Agent': USER_AGENT}, timeout=15)
                if api_resp.status_code == 200:
                    for item in api_resp.json().get('media', []):
                        u = item.get('url')
                        if u:
                            media_urls.add(u)
            except Exception:
                pass

            media_urls = sorted(media_urls)
            emit(job_id, f"FOUND|{len(media_urls)} files")

            album_dir = output_dir / f"imgur_{album_id}"
            album_dir.mkdir(parents=True, exist_ok=True)

            success, failed = 0, 0
            for i, media_url in enumerate(media_urls, 1):
                filename = Path(urlparse(media_url).path).name
                dest = album_dir / filename
                emit(job_id, f"DL|{filename}|{i}/{len(media_urls)}",
                     progress=i / max(len(media_urls), 1) * 100)
                if download_file(media_url, dest, session, 'https://imgur.com/', job_id=job_id):
                    success += 1
                else:
                    failed += 1
                time.sleep(0.3)
            return {'success': success, 'failed': failed, 'folder': album_dir,
                    'title': f"imgur_{album_id}"}

        emit(job_id, "ERROR|Could not determine Imgur content type")
        return {'success': 0, 'failed': 1, 'folder': output_dir, 'title': 'imgur'}


class BunkrHandler(SiteHandler):
    name = 'Bunkr'

    @staticmethod
    def matches(url):
        return bool(re.match(r'https?://(www\.)?bunkr+\.\w+/', url))

    def download(self, url, output_dir, session, job_id):
        emit(job_id, "INFO|Fetching Bunkr album...")
        headers = {'User-Agent': USER_AGENT}
        resp = session.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        h1 = soup.find('h1')
        title = sanitize_filename(h1.get_text(strip=True) if h1 else 'bunkr_album')

        file_urls = set()
        for a in soup.find_all('a', href=True):
            href = a['href']
            full = urljoin(url, href)
            p = urlparse(full)
            if p.hostname and ('cdn' in p.hostname or 'media-files' in p.hostname):
                file_urls.add(full)
        for tag in soup.find_all(['video', 'source', 'img']):
            src = tag.get('src') or tag.get('data-src')
            if src:
                full = urljoin(url, src)
                if any(ext in full.lower() for ext in ['.mp4', '.jpg', '.jpeg', '.png', '.gif', '.webm']):
                    file_urls.add(full)

        file_urls = sorted(file_urls)
        emit(job_id, f"FOUND|{len(file_urls)} files")

        album_dir = output_dir / title
        album_dir.mkdir(parents=True, exist_ok=True)

        success, failed = 0, 0
        for i, file_url in enumerate(file_urls, 1):
            # Resolve CDN URLs from individual file pages
            if urlparse(file_url).hostname and 'bunkr' in (urlparse(file_url).hostname or ''):
                try:
                    fr = session.get(file_url, headers=headers, timeout=30)
                    fsoup = BeautifulSoup(fr.text, 'html.parser')
                    dl_link = None
                    for source in fsoup.find_all('source'):
                        dl_link = source.get('src')
                        if dl_link:
                            break
                    if not dl_link:
                        for a in fsoup.find_all('a', href=True):
                            if 'download' in a.get('class', []) or 'download' in a.text.lower():
                                dl_link = a['href']
                                break
                    if dl_link:
                        file_url = urljoin(file_url, dl_link)
                    else:
                        failed += 1
                        continue
                except Exception:
                    pass

            filename = Path(urlparse(file_url.split('?')[0]).path).name or f"file_{i:03d}"
            dest = album_dir / filename
            emit(job_id, f"DL|{filename}|{i}/{len(file_urls)}",
                 progress=i / max(len(file_urls), 1) * 100)
            if download_file(file_url, dest, session, url, job_id=job_id):
                success += 1
            else:
                failed += 1
            time.sleep(0.3)

        return {'success': success, 'failed': failed, 'folder': album_dir, 'title': title}


class CyberdropHandler(SiteHandler):
    name = 'Cyberdrop'

    @staticmethod
    def matches(url):
        return bool(re.match(r'https?://(www\.)?cyberdrop\.\w+/a/', url))

    def download(self, url, output_dir, session, job_id):
        emit(job_id, "INFO|Fetching Cyberdrop album...")
        resp = session.get(url, headers={'User-Agent': USER_AGENT}, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        h1 = soup.find('h1', id='title')
        title = sanitize_filename(h1.get_text(strip=True) if h1 else 'cyberdrop')

        file_urls = set()
        for a in soup.find_all('a', class_='image'):
            href = a.get('href')
            if href:
                file_urls.add(href)
        for a in soup.find_all('a', href=True):
            href = a['href']
            if any(cdn in href for cdn in ['fs-', 'cdn', '.cyberdrop.']):
                if any(ext in href.lower() for ext in ['.mp4', '.jpg', '.png', '.gif', '.webm', '.mkv']):
                    file_urls.add(href)

        file_urls = sorted(file_urls)
        emit(job_id, f"FOUND|{len(file_urls)} files")

        album_dir = output_dir / title
        album_dir.mkdir(parents=True, exist_ok=True)

        success, failed = 0, 0
        for i, file_url in enumerate(file_urls, 1):
            filename = Path(urlparse(file_url.split('?')[0]).path).name or f"file_{i:03d}"
            dest = album_dir / filename
            emit(job_id, f"DL|{filename}|{i}/{len(file_urls)}",
                 progress=i / max(len(file_urls), 1) * 100)
            if download_file(file_url, dest, session, url, job_id=job_id):
                success += 1
            else:
                failed += 1
            time.sleep(0.3)

        return {'success': success, 'failed': failed, 'folder': album_dir, 'title': title}


class GenericHandler(SiteHandler):
    name = 'Generic'

    @staticmethod
    def matches(url):
        return True

    def download(self, url, output_dir, session, job_id):
        emit(job_id, "INFO|Generic scraper — scanning page for media...")
        resp = session.get(url, headers={'User-Agent': USER_AGENT}, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        domain = urlparse(url).netloc.replace('www.', '').replace('.', '_')
        title = sanitize_filename(domain)

        media = set()
        for video in soup.find_all('video'):
            for source in video.find_all('source'):
                src = source.get('src')
                if src:
                    media.add(urljoin(url, src))
            if video.get('src'):
                media.add(urljoin(url, video['src']))
        for img in soup.find_all('img'):
            src = img.get('data-src') or img.get('src')
            if src:
                full = urljoin(url, src)
                if any(ext in full.lower() for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']):
                    media.add(full)
        for m in re.findall(r'https?://[^\s"\'<>]+\.(?:mp4|webm|mkv|mov)', resp.text):
            media.add(m)

        media = sorted(media)
        emit(job_id, f"FOUND|{len(media)} media files")

        gen_dir = output_dir / title
        gen_dir.mkdir(parents=True, exist_ok=True)

        success, failed = 0, 0
        for i, media_url in enumerate(media, 1):
            filename = Path(urlparse(media_url.split('?')[0]).path).name or f"file_{i:03d}"
            dest = gen_dir / filename
            emit(job_id, f"DL|{filename}|{i}/{len(media)}",
                 progress=i / max(len(media), 1) * 100)
            if download_file(media_url, dest, session, url, job_id=job_id):
                success += 1
            else:
                failed += 1
            time.sleep(0.2)

        return {'success': success, 'failed': failed, 'folder': gen_dir, 'title': title}


# ─── Handler registry ────────────────────────────────────────
HANDLERS = [
    EromeHandler(),
    RedGifsHandler(),
    RedGifsUserHandler(),
    ImgurHandler(),
    BunkrHandler(),
    CyberdropHandler(),
    GenericHandler(),
]


def get_handler(url):
    for h in HANDLERS:
        if h.matches(url):
            return h
    return HANDLERS[-1]


# ─── Background worker ───────────────────────────────────────
def run_download(job_id, url):
    handler = get_handler(url)
    with jobs_lock:
        jobs[job_id]['handler'] = handler.name

    emit(job_id, f"INFO|Detected site: {handler.name}")
    session = requests.Session()

    try:
        result = handler.download(url, DOWNLOAD_DIR / job_id, session, job_id)
        # Create ZIP
        emit(job_id, "INFO|Packaging ZIP...", progress=95)
        folder = result['folder']
        zip_name = f"{result['title']}.zip"
        zip_path = DOWNLOAD_DIR / job_id / zip_name

        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for file in sorted(folder.rglob('*')):
                if file.is_file() and file != zip_path:
                    zf.write(file, file.relative_to(folder))

        with jobs_lock:
            jobs[job_id]['status'] = 'done'
            jobs[job_id]['progress'] = 100
            jobs[job_id]['zip_path'] = str(zip_path)
            jobs[job_id]['zip_name'] = zip_name
            jobs[job_id]['success'] = result['success']
            jobs[job_id]['failed'] = result['failed']
        emit(job_id, f"DONE|{result['success']} succeeded, {result['failed']} failed")

    except Exception as e:
        with jobs_lock:
            jobs[job_id]['status'] = 'error'
            jobs[job_id]['error'] = str(e)
        emit(job_id, f"ERROR|{e}")


# ─── Cleanup old downloads ───────────────────────────────────
def cleanup_old():
    now = time.time()
    try:
        for d in DOWNLOAD_DIR.iterdir():
            if d.is_dir() and (now - d.stat().st_mtime) > MAX_AGE_HOURS * 3600:
                shutil.rmtree(d, ignore_errors=True)
                with jobs_lock:
                    jobs.pop(d.name, None)
    except Exception:
        pass


# ─── Routes ──────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/download', methods=['POST'])
def start_download():
    data = request.get_json()
    url = (data or {}).get('url', '').strip()
    if not url:
        return jsonify({'error': 'No URL provided'}), 400

    # Basic URL validation
    if not re.match(r'https?://', url):
        return jsonify({'error': 'Invalid URL'}), 400

    job_id = uuid.uuid4().hex[:12]
    with jobs_lock:
        jobs[job_id] = {
            'status': 'running',
            'progress': 0,
            'logs': [],
            'url': url,
            'handler': '',
        }

    (DOWNLOAD_DIR / job_id).mkdir(parents=True, exist_ok=True)

    t = threading.Thread(target=run_download, args=(job_id, url), daemon=True)
    t.start()

    # Run cleanup in background
    threading.Thread(target=cleanup_old, daemon=True).start()

    return jsonify({'job_id': job_id})


@app.route('/api/status/<job_id>')
def job_status(job_id):
    # Validate job_id format (hex only)
    if not re.match(r'^[a-f0-9]{12}$', job_id):
        return jsonify({'error': 'Invalid job ID'}), 400
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    return jsonify({
        'status': job['status'],
        'progress': job.get('progress', 0),
        'handler': job.get('handler', ''),
        'logs': job.get('logs', [])[-50:],  # Last 50 log entries
        'success': job.get('success', 0),
        'failed': job.get('failed', 0),
        'zip_name': job.get('zip_name', ''),
    })


@app.route('/api/stream/<job_id>')
def stream(job_id):
    """Server-Sent Events stream for real-time progress."""
    if not re.match(r'^[a-f0-9]{12}$', job_id):
        return Response('Invalid job ID', status=400)

    def generate():
        last_idx = 0
        while True:
            with jobs_lock:
                job = jobs.get(job_id)
            if not job:
                yield f"data: {json.dumps({'type': 'error', 'msg': 'Job not found'})}\n\n"
                break

            logs = job.get('logs', [])
            new_logs = logs[last_idx:]
            last_idx = len(logs)

            for log in new_logs:
                yield f"data: {json.dumps({'type': 'log', 'msg': log, 'progress': job.get('progress', 0)})}\n\n"

            if job['status'] in ('done', 'error'):
                yield f"data: {json.dumps({'type': job['status'], 'progress': job.get('progress', 0), 'success': job.get('success', 0), 'failed': job.get('failed', 0), 'zip_name': job.get('zip_name', '')})}\n\n"
                break

            time.sleep(0.5)

    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


@app.route('/api/download/<job_id>/zip')
def download_zip(job_id):
    if not re.match(r'^[a-f0-9]{12}$', job_id):
        return jsonify({'error': 'Invalid job ID'}), 400

    with jobs_lock:
        job = jobs.get(job_id)

    if not job or job['status'] != 'done':
        return jsonify({'error': 'Download not ready'}), 404

    zip_path = Path(job['zip_path'])
    if not zip_path.exists():
        return jsonify({'error': 'ZIP file not found'}), 404

    # Ensure path is within DOWNLOAD_DIR (path traversal protection)
    try:
        zip_path.resolve().relative_to(DOWNLOAD_DIR.resolve())
    except ValueError:
        return jsonify({'error': 'Access denied'}), 403

    return send_file(zip_path, as_attachment=True,
                     download_name=job.get('zip_name', 'download.zip'))


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=port, debug=debug, threaded=True)
