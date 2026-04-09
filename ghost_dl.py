#!/usr/bin/env python3
"""
Ghost Downloader - Multi-site media downloader.
Supports: Erome, RedGifs, Imgur, Bunkr, Cyberdrop
"""

import os
import re
import sys
import time
import json
import hashlib
import argparse
from abc import ABC, abstractmethod
from pathlib import Path
from urllib.parse import urlparse, urljoin

import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

# ─────────────────────────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────────────────────────

USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\n\r\t]', '_', name)
    name = name.strip('. ')
    return name[:200] if name else 'untitled'


def download_file(url: str, dest_path: Path, session: requests.Session,
                  referer: str = '', extra_headers: dict = None) -> bool:
    if dest_path.exists() and dest_path.stat().st_size > 0:
        print(f"  [SKIP] Already exists: {dest_path.name}")
        return True

    headers = {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
    }
    if referer:
        headers['Referer'] = referer
    if extra_headers:
        headers.update(extra_headers)

    try:
        resp = session.get(url, headers=headers, stream=True, timeout=120)
        resp.raise_for_status()
        total_size = int(resp.headers.get('content-length', 0))

        with open(dest_path, 'wb') as f:
            with tqdm(total=total_size, unit='B', unit_scale=True,
                      desc=dest_path.name[:40], ncols=80, leave=False) as pbar:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        pbar.update(len(chunk))
        return True
    except requests.RequestException as e:
        print(f"  [ERROR] {e}")
        if dest_path.exists():
            dest_path.unlink()
        return False


# ─────────────────────────────────────────────────────────────
# Base handler
# ─────────────────────────────────────────────────────────────

class SiteHandler(ABC):
    name = 'base'

    @staticmethod
    @abstractmethod
    def matches(url: str) -> bool:
        pass

    @abstractmethod
    def download(self, url: str, output_dir: Path, session: requests.Session) -> dict:
        """Returns {'success': int, 'failed': int, 'folder': Path}"""
        pass


# ─────────────────────────────────────────────────────────────
# Erome
# ─────────────────────────────────────────────────────────────

class EromeHandler(SiteHandler):
    name = 'Erome'

    @staticmethod
    def matches(url: str) -> bool:
        return bool(re.match(r'https?://(www\.)?erome\.com/a/[a-zA-Z0-9]+', url))

    def download(self, url: str, output_dir: Path, session: requests.Session) -> dict:
        album_id = re.search(r'/a/([a-zA-Z0-9]+)', url).group(1)

        headers = {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': 'https://www.erome.com/',
        }
        resp = session.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        # Title
        h1 = soup.find('h1')
        title = sanitize_filename(h1.get_text(strip=True) if h1 else album_id)

        # Images
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

        # Videos
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
        print(f"  Title: {title}")
        print(f"  Images: {len(images)} | Videos: {len(videos)}")

        album_dir = output_dir / f"{title}_{album_id}"
        album_dir.mkdir(parents=True, exist_ok=True)

        success, failed = 0, 0

        if images:
            img_dir = album_dir / 'images'
            img_dir.mkdir(exist_ok=True)
            for i, img_url in enumerate(images, 1):
                ext = Path(urlparse(img_url.split('?')[0]).path).suffix or '.jpg'
                dest = img_dir / f"img_{i:03d}{ext}"
                print(f"  [{i}/{len(images)}] {img_url.split('/')[-1].split('?')[0]}")
                if download_file(img_url, dest, session, url):
                    success += 1
                else:
                    failed += 1
                time.sleep(0.3)

        if videos:
            vid_dir = album_dir / 'videos'
            vid_dir.mkdir(exist_ok=True)
            for i, vid_url in enumerate(videos, 1):
                ext = Path(urlparse(vid_url.split('?')[0]).path).suffix or '.mp4'
                dest = vid_dir / f"vid_{i:03d}{ext}"
                print(f"  [{i}/{len(videos)}] {vid_url.split('/')[-1].split('?')[0]}")
                if download_file(vid_url, dest, session, url):
                    success += 1
                else:
                    failed += 1
                time.sleep(0.5)

        return {'success': success, 'failed': failed, 'folder': album_dir}


# ─────────────────────────────────────────────────────────────
# RedGifs
# ─────────────────────────────────────────────────────────────

class RedGifsHandler(SiteHandler):
    name = 'RedGifs'
    _token = None

    @staticmethod
    def matches(url: str) -> bool:
        return bool(re.match(r'https?://(www\.)?redgifs\.com/(watch|ifr)/\S+', url))

    def _get_token(self, session: requests.Session) -> str:
        if self._token:
            return self._token
        resp = session.get('https://api.redgifs.com/v2/auth/temporary',
                           headers={'User-Agent': USER_AGENT}, timeout=15)
        resp.raise_for_status()
        self._token = resp.json()['token']
        return self._token

    def _get_gif_info(self, gif_id: str, session: requests.Session) -> dict:
        token = self._get_token(session)
        resp = session.get(
            f'https://api.redgifs.com/v2/gifs/{gif_id.lower()}',
            headers={
                'User-Agent': USER_AGENT,
                'Authorization': f'Bearer {token}',
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()['gif']

    def download(self, url: str, output_dir: Path, session: requests.Session) -> dict:
        # Extract GIF ID from URL
        match = re.search(r'redgifs\.com/(?:watch|ifr)/([a-zA-Z0-9._-]+)', url)
        if not match:
            print(f"  [ERROR] Could not extract RedGifs ID from: {url}")
            return {'success': 0, 'failed': 1, 'folder': output_dir}

        gif_id = match.group(1).split('#')[0].split('?')[0]
        print(f"  GIF ID: {gif_id}")

        try:
            info = self._get_gif_info(gif_id, session)
        except requests.RequestException as e:
            print(f"  [ERROR] API request failed: {e}")
            return {'success': 0, 'failed': 1, 'folder': output_dir}

        urls = info.get('urls', {})
        hd_url = urls.get('hd') or urls.get('sd') or urls.get('gif')
        if not hd_url:
            print("  [ERROR] No download URL found in API response")
            return {'success': 0, 'failed': 1, 'folder': output_dir}

        username = info.get('userName', 'unknown')
        create_date = info.get('createDate', '')

        rg_dir = output_dir / f"redgifs_{sanitize_filename(username)}"
        rg_dir.mkdir(parents=True, exist_ok=True)

        ext = Path(urlparse(hd_url.split('?')[0]).path).suffix or '.mp4'
        dest = rg_dir / f"{gif_id}{ext}"

        print(f"  User: {username}")
        print(f"  Quality: {'HD' if urls.get('hd') else 'SD'}")
        print(f"  Downloading: {gif_id}{ext}")

        token = self._get_token(session)
        extra = {'Authorization': f'Bearer {token}'}

        if download_file(hd_url, dest, session, 'https://www.redgifs.com/', extra):
            return {'success': 1, 'failed': 0, 'folder': rg_dir}
        return {'success': 0, 'failed': 1, 'folder': rg_dir}


# ─────────────────────────────────────────────────────────────
# RedGifs User (download all from a user profile)
# ─────────────────────────────────────────────────────────────

class RedGifsUserHandler(SiteHandler):
    name = 'RedGifs User'
    _token = None

    @staticmethod
    def matches(url: str) -> bool:
        return bool(re.match(r'https?://(www\.)?redgifs\.com/users/\S+', url))

    def _get_token(self, session: requests.Session) -> str:
        if self._token:
            return self._token
        resp = session.get('https://api.redgifs.com/v2/auth/temporary',
                           headers={'User-Agent': USER_AGENT}, timeout=15)
        resp.raise_for_status()
        self._token = resp.json()['token']
        return self._token

    def download(self, url: str, output_dir: Path, session: requests.Session) -> dict:
        match = re.search(r'redgifs\.com/users/([a-zA-Z0-9._-]+)', url)
        if not match:
            print(f"  [ERROR] Could not extract username from: {url}")
            return {'success': 0, 'failed': 1, 'folder': output_dir}

        username = match.group(1).split('#')[0].split('?')[0]
        print(f"  Username: {username}")

        token = self._get_token(session)
        auth_headers = {
            'User-Agent': USER_AGENT,
            'Authorization': f'Bearer {token}',
        }

        rg_dir = output_dir / f"redgifs_{sanitize_filename(username)}"
        rg_dir.mkdir(parents=True, exist_ok=True)

        page = 1
        total_success, total_failed = 0, 0
        all_gifs = []

        # Paginate through all user's GIFs
        print(f"  Fetching GIF list...")
        while True:
            try:
                resp = session.get(
                    f'https://api.redgifs.com/v2/users/{username.lower()}/search',
                    params={'page': page, 'count': 80, 'order': 'new'},
                    headers=auth_headers, timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()
                gifs = data.get('gifs', [])
                if not gifs:
                    break
                all_gifs.extend(gifs)
                total_pages = data.get('pages', 1)
                print(f"    Page {page}/{total_pages} — {len(gifs)} gifs")
                if page >= total_pages:
                    break
                page += 1
                time.sleep(0.5)
            except requests.RequestException as e:
                print(f"  [ERROR] Failed fetching page {page}: {e}")
                break

        print(f"  Total GIFs found: {len(all_gifs)}")

        for i, gif in enumerate(all_gifs, 1):
            urls = gif.get('urls', {})
            hd_url = urls.get('hd') or urls.get('sd') or urls.get('gif')
            gif_id = gif.get('id', f'unknown_{i}')

            if not hd_url:
                print(f"  [{i}/{len(all_gifs)}] {gif_id} — no URL, skipping")
                total_failed += 1
                continue

            ext = Path(urlparse(hd_url.split('?')[0]).path).suffix or '.mp4'
            dest = rg_dir / f"{gif_id}{ext}"

            print(f"  [{i}/{len(all_gifs)}] {gif_id}{ext}")
            extra = {'Authorization': f'Bearer {token}'}
            if download_file(hd_url, dest, session, 'https://www.redgifs.com/', extra):
                total_success += 1
            else:
                total_failed += 1
            time.sleep(0.5)

        return {'success': total_success, 'failed': total_failed, 'folder': rg_dir}


# ─────────────────────────────────────────────────────────────
# Imgur
# ─────────────────────────────────────────────────────────────

class ImgurHandler(SiteHandler):
    name = 'Imgur'

    @staticmethod
    def matches(url: str) -> bool:
        return bool(re.match(r'https?://(www\.|i\.)?imgur\.com/', url))

    def download(self, url: str, output_dir: Path, session: requests.Session) -> dict:
        headers = {'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*'}

        # Single image (i.imgur.com/XXXXX.ext)
        if re.match(r'https?://i\.imgur\.com/\w+\.\w+', url):
            return self._download_single(url, output_dir, session)

        # Album or gallery
        album_match = re.search(r'imgur\.com/(?:a|gallery)/(\w+)', url)
        if album_match:
            album_id = album_match.group(1)
            return self._download_album(url, album_id, output_dir, session, headers)

        # Single post (imgur.com/XXXXX)
        post_match = re.search(r'imgur\.com/(\w+)$', url.rstrip('/'))
        if post_match:
            img_id = post_match.group(1)
            # Try common extensions
            for ext in ['.mp4', '.jpg', '.png', '.gif']:
                direct = f"https://i.imgur.com/{img_id}{ext}"
                try:
                    r = session.head(direct, headers={'User-Agent': USER_AGENT}, timeout=10, allow_redirects=True)
                    if r.status_code == 200 and 'removed' not in r.url:
                        return self._download_single(direct, output_dir, session)
                except requests.RequestException:
                    continue

        print("  [ERROR] Could not determine Imgur content type")
        return {'success': 0, 'failed': 1, 'folder': output_dir}

    def _download_single(self, url: str, output_dir: Path, session: requests.Session) -> dict:
        parsed = urlparse(url)
        filename = Path(parsed.path).name
        img_dir = output_dir / 'imgur'
        img_dir.mkdir(parents=True, exist_ok=True)
        dest = img_dir / filename
        print(f"  Downloading: {filename}")
        ok = download_file(url, dest, session, 'https://imgur.com/')
        return {'success': 1 if ok else 0, 'failed': 0 if ok else 1, 'folder': img_dir}

    def _download_album(self, url: str, album_id: str, output_dir: Path,
                        session: requests.Session, headers: dict) -> dict:
        # Fetch album page and extract images from client-side data
        resp = session.get(url, headers=headers, timeout=30)
        resp.raise_for_status()

        # Try to find image data in page JS
        media_urls = set()
        # Match i.imgur.com URLs
        for m in re.findall(r'https?://i\.imgur\.com/\w+\.\w{3,4}', resp.text):
            if 'removed' not in m.lower():
                media_urls.add(m)

        # Also try the JSON endpoint
        try:
            api_resp = session.get(
                f'https://api.imgur.com/post/v1/albums/{album_id}?client_id=546c25a59c58ad7&include=media',
                headers={'User-Agent': USER_AGENT}, timeout=15,
            )
            if api_resp.status_code == 200:
                data = api_resp.json()
                for item in data.get('media', []):
                    u = item.get('url')
                    if u:
                        media_urls.add(u)
        except Exception:
            pass

        media_urls = sorted(media_urls)
        print(f"  Album: {album_id} — {len(media_urls)} files found")

        album_dir = output_dir / f"imgur_{album_id}"
        album_dir.mkdir(parents=True, exist_ok=True)

        success, failed = 0, 0
        for i, media_url in enumerate(media_urls, 1):
            filename = Path(urlparse(media_url).path).name
            dest = album_dir / filename
            print(f"  [{i}/{len(media_urls)}] {filename}")
            if download_file(media_url, dest, session, 'https://imgur.com/'):
                success += 1
            else:
                failed += 1
            time.sleep(0.3)

        return {'success': success, 'failed': failed, 'folder': album_dir}


# ─────────────────────────────────────────────────────────────
# Bunkr
# ─────────────────────────────────────────────────────────────

class BunkrHandler(SiteHandler):
    name = 'Bunkr'

    @staticmethod
    def matches(url: str) -> bool:
        return bool(re.match(r'https?://(www\.)?bunkr+\.\w+/a/', url)) or \
               bool(re.match(r'https?://(www\.)?bunkr\.\w+/', url))

    def download(self, url: str, output_dir: Path, session: requests.Session) -> dict:
        headers = {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,*/*',
        }
        resp = session.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        title_tag = soup.find('h1')
        title = sanitize_filename(title_tag.get_text(strip=True) if title_tag else 'bunkr_album')

        # Find all file links
        file_urls = set()
        for a in soup.find_all('a', href=True):
            href = a['href']
            full = urljoin(url, href)
            parsed = urlparse(full)
            if parsed.hostname and ('cdn' in parsed.hostname or 'media-files' in parsed.hostname):
                file_urls.add(full)

        # Also check for direct file links in grid items
        for div in soup.find_all('div', class_=re.compile(r'grid-images|grid')):
            for a in div.find_all('a', href=True):
                file_urls.add(urljoin(url, a['href']))

        # Also look for source/video/img tags
        for tag in soup.find_all(['video', 'source', 'img']):
            src = tag.get('src') or tag.get('data-src')
            if src:
                full = urljoin(url, src)
                if any(ext in full.lower() for ext in ['.mp4', '.mkv', '.jpg', '.jpeg', '.png', '.gif', '.webm', '.zip']):
                    file_urls.add(full)

        file_urls = sorted(file_urls)
        print(f"  Title: {title}")
        print(f"  Files found: {len(file_urls)}")

        album_dir = output_dir / title
        album_dir.mkdir(parents=True, exist_ok=True)

        success, failed = 0, 0
        for i, file_url in enumerate(file_urls, 1):
            # For bunkr, individual file pages need another fetch to get the real CDN URL
            if 'bunkr' in urlparse(file_url).hostname if urlparse(file_url).hostname else '':
                try:
                    fr = session.get(file_url, headers=headers, timeout=30)
                    fr.raise_for_status()
                    fsoup = BeautifulSoup(fr.text, 'html.parser')
                    # Look for the actual download link
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
                    if not dl_link:
                        for img in fsoup.find_all('img'):
                            src = img.get('src')
                            if src and 'cdn' in src:
                                dl_link = src
                                break
                    if dl_link:
                        file_url = urljoin(file_url, dl_link)
                    else:
                        print(f"  [{i}/{len(file_urls)}] Could not resolve CDN URL, skipping")
                        failed += 1
                        continue
                except requests.RequestException:
                    pass

            filename = Path(urlparse(file_url.split('?')[0]).path).name or f"file_{i:03d}"
            dest = album_dir / filename
            print(f"  [{i}/{len(file_urls)}] {filename}")
            if download_file(file_url, dest, session, url):
                success += 1
            else:
                failed += 1
            time.sleep(0.5)

        return {'success': success, 'failed': failed, 'folder': album_dir}


# ─────────────────────────────────────────────────────────────
# Cyberdrop
# ─────────────────────────────────────────────────────────────

class CyberdropHandler(SiteHandler):
    name = 'Cyberdrop'

    @staticmethod
    def matches(url: str) -> bool:
        return bool(re.match(r'https?://(www\.)?cyberdrop\.\w+/a/', url))

    def download(self, url: str, output_dir: Path, session: requests.Session) -> dict:
        headers = {'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*'}
        resp = session.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        title_tag = soup.find('h1', id='title')
        title = sanitize_filename(title_tag.get_text(strip=True) if title_tag else 'cyberdrop_album')

        file_urls = set()
        # Cyberdrop uses <a> tags with class 'image' pointing to CDN
        for a in soup.find_all('a', class_='image'):
            href = a.get('href')
            if href:
                file_urls.add(href)

        # Also try looking at all anchor tags
        for a in soup.find_all('a', href=True):
            href = a['href']
            if any(cdn in href for cdn in ['fs-', 'cdn', '.cyberdrop.']):
                if any(ext in href.lower() for ext in ['.mp4', '.jpg', '.jpeg', '.png', '.gif', '.webm', '.mkv', '.zip', '.mov']):
                    file_urls.add(href)

        file_urls = sorted(file_urls)
        print(f"  Title: {title}")
        print(f"  Files found: {len(file_urls)}")

        album_dir = output_dir / title
        album_dir.mkdir(parents=True, exist_ok=True)

        success, failed = 0, 0
        for i, file_url in enumerate(file_urls, 1):
            filename = Path(urlparse(file_url.split('?')[0]).path).name or f"file_{i:03d}"
            dest = album_dir / filename
            print(f"  [{i}/{len(file_urls)}] {filename}")
            if download_file(file_url, dest, session, url):
                success += 1
            else:
                failed += 1
            time.sleep(0.3)

        return {'success': success, 'failed': failed, 'folder': album_dir}


# ─────────────────────────────────────────────────────────────
# Generic fallback (tries to find all media on any page)
# ─────────────────────────────────────────────────────────────

class GenericHandler(SiteHandler):
    name = 'Generic'

    @staticmethod
    def matches(url: str) -> bool:
        return True  # Always matches as fallback

    def download(self, url: str, output_dir: Path, session: requests.Session) -> dict:
        headers = {'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*'}
        resp = session.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        domain = urlparse(url).netloc.replace('www.', '').replace('.', '_')
        title = sanitize_filename(domain)

        media_urls = set()

        # Videos
        for video in soup.find_all('video'):
            for source in video.find_all('source'):
                src = source.get('src')
                if src:
                    media_urls.add(urljoin(url, src))
            if video.get('src'):
                media_urls.add(urljoin(url, video['src']))

        # Images (only large ones, skip icons/avatars)
        for img in soup.find_all('img'):
            src = img.get('data-src') or img.get('src')
            if src:
                full = urljoin(url, src)
                if any(ext in full.lower() for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']):
                    media_urls.add(full)

        # MP4 links in page source
        for m in re.findall(r'https?://[^\s"\'<>]+\.(?:mp4|webm|mkv|mov)', resp.text):
            media_urls.add(m)

        media_urls = sorted(media_urls)
        print(f"  [Generic scraper] Found {len(media_urls)} media files")

        gen_dir = output_dir / title
        gen_dir.mkdir(parents=True, exist_ok=True)

        success, failed = 0, 0
        for i, media_url in enumerate(media_urls, 1):
            filename = Path(urlparse(media_url.split('?')[0]).path).name or f"file_{i:03d}"
            dest = gen_dir / filename
            print(f"  [{i}/{len(media_urls)}] {filename}")
            if download_file(media_url, dest, session, url):
                success += 1
            else:
                failed += 1
            time.sleep(0.3)

        return {'success': success, 'failed': failed, 'folder': gen_dir}


# ─────────────────────────────────────────────────────────────
# Router — picks the right handler for a URL
# ─────────────────────────────────────────────────────────────

HANDLERS = [
    EromeHandler(),
    RedGifsHandler(),
    RedGifsUserHandler(),
    ImgurHandler(),
    BunkrHandler(),
    CyberdropHandler(),
    GenericHandler(),  # Must be last
]


def get_handler(url: str) -> SiteHandler:
    for h in HANDLERS:
        if h.matches(url):
            return h
    return HANDLERS[-1]


# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────

def process_url(url: str, output_dir: Path) -> None:
    handler = get_handler(url)
    print(f"\n{'='*60}")
    print(f"  Ghost Downloader — [{handler.name}]")
    print(f"  URL: {url}")
    print(f"{'='*60}")

    session = requests.Session()
    try:
        result = handler.download(url, output_dir, session)
    except Exception as e:
        print(f"\n  [ERROR] {e}")
        return

    print(f"\n  {'─'*40}")
    print(f"  Success: {result['success']}  |  Failed: {result['failed']}")
    print(f"  Saved to: {result['folder']}")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(
        description='Ghost Downloader — Multi-site media downloader',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Supported sites:
  Erome       https://www.erome.com/a/ALBUM_ID
  RedGifs     https://www.redgifs.com/watch/VIDEO_ID
  RedGifs     https://www.redgifs.com/users/USERNAME  (all videos)
  Imgur        https://imgur.com/a/ALBUM_ID
  Bunkr       https://bunkr.XX/a/ALBUM_ID
  Cyberdrop   https://cyberdrop.XX/a/ALBUM_ID
  Any site    (generic fallback — finds videos/images in page)

Examples:
  python ghost_dl.py https://www.erome.com/a/jMAEBY4L
  python ghost_dl.py https://www.redgifs.com/watch/somevideo
  python ghost_dl.py https://www.redgifs.com/users/someuser
  python ghost_dl.py url1 url2 url3
  python ghost_dl.py -i
        """,
    )
    parser.add_argument('urls', nargs='*', help='URL(s) to download')
    parser.add_argument('-o', '--output', default=None, help='Output directory (default: ./downloads)')
    parser.add_argument('-i', '--interactive', action='store_true', help='Interactive mode')

    args = parser.parse_args()
    output_dir = Path(args.output) if args.output else Path.cwd() / 'downloads'

    if args.interactive or not args.urls:
        print("=" * 60)
        print("  Ghost Downloader — Interactive Mode")
        print("=" * 60)
        print("Supported: Erome, RedGifs, Imgur, Bunkr, Cyberdrop, + any URL")
        print("Enter URLs (one per line). Type 'done' or Ctrl+C to exit.\n")
        while True:
            try:
                url = input("URL: ").strip()
                if url.lower() in ('done', 'exit', 'quit', 'q'):
                    print("Goodbye!")
                    break
                if not url:
                    continue
                process_url(url, output_dir)
            except KeyboardInterrupt:
                print("\n\nGoodbye!")
                break
    else:
        for url in args.urls:
            process_url(url, output_dir)


if __name__ == '__main__':
    main()
