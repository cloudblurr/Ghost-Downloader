#!/usr/bin/env python3
"""
Erome Album Downloader
Downloads all images and videos from Erome.com album URLs.
"""

import os
import re
import sys
import time
import hashlib
import argparse
from pathlib import Path
from urllib.parse import urlparse, urljoin

import requests
from bs4 import BeautifulSoup
from tqdm import tqdm


def sanitize_filename(name: str) -> str:
    """Remove or replace characters that are invalid in filenames."""
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    name = name.strip('. ')
    return name[:200] if name else 'untitled'


def get_album_id(url: str) -> str:
    """Extract album ID from an Erome URL."""
    match = re.search(r'/a/([a-zA-Z0-9]+)', url)
    if match:
        return match.group(1)
    return hashlib.md5(url.encode()).hexdigest()[:10]


def fetch_page(url: str, session: requests.Session) -> BeautifulSoup:
    """Fetch and parse an Erome album page."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.erome.com/',
    }
    resp = session.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, 'html.parser')


def extract_media(soup: BeautifulSoup, page_url: str) -> dict:
    """Extract all image and video URLs from the parsed page."""
    images = set()
    videos = set()

    # Extract album title
    title_tag = soup.find('h1')
    title = title_tag.get_text(strip=True) if title_tag else 'Untitled Album'

    # --- Images ---
    # Look for images inside media-group divs
    for div in soup.find_all('div', class_='media-group'):
        for img in div.find_all('img'):
            src = img.get('data-src') or img.get('src')
            if src and not src.endswith('logo-erome-vertical.png'):
                full_url = urljoin(page_url, src)
                # Skip avatar/thumbnail images, keep actual content images
                if '.erome.com/' in full_url and '/a/' not in full_url:
                    images.add(full_url)

    # Fallback: find all img tags with erome CDN URLs
    if not images:
        for img in soup.find_all('img'):
            src = img.get('data-src') or img.get('src')
            if src:
                full_url = urljoin(page_url, src)
                parsed = urlparse(full_url)
                if (parsed.hostname and 'erome.com' in parsed.hostname
                        and any(ext in full_url.lower() for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp'])
                        and 'logo' not in full_url.lower()
                        and 'avatar' not in full_url.lower()
                        and 'icon' not in full_url.lower()):
                    images.add(full_url)

    # --- Videos ---
    # Look for video source tags
    for video in soup.find_all('video'):
        for source in video.find_all('source'):
            src = source.get('src')
            if src:
                full_url = urljoin(page_url, src)
                videos.add(full_url)
        # Also check video src directly
        src = video.get('src')
        if src:
            full_url = urljoin(page_url, src)
            videos.add(full_url)

    # Fallback: search for video URLs in script tags
    for script in soup.find_all('script'):
        text = script.string or ''
        # Find mp4 URLs in JavaScript
        mp4_urls = re.findall(r'https?://[^\s"\']+\.mp4[^\s"\']*', text)
        for url in mp4_urls:
            videos.add(url)

    return {
        'title': title,
        'images': sorted(images),
        'videos': sorted(videos),
    }


def download_file(url: str, dest_path: Path, session: requests.Session, referer: str) -> bool:
    """Download a file with progress bar and resume support."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': referer,
        'Accept': '*/*',
    }

    # Check if file already exists (skip re-downloading)
    if dest_path.exists() and dest_path.stat().st_size > 0:
        print(f"  [SKIP] Already exists: {dest_path.name}")
        return True

    try:
        resp = session.get(url, headers=headers, stream=True, timeout=60)
        resp.raise_for_status()

        total_size = int(resp.headers.get('content-length', 0))

        with open(dest_path, 'wb') as f:
            with tqdm(
                total=total_size,
                unit='B',
                unit_scale=True,
                desc=dest_path.name[:40],
                ncols=80,
                leave=False,
            ) as pbar:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        pbar.update(len(chunk))
        return True

    except requests.RequestException as e:
        print(f"  [ERROR] Failed to download {url}: {e}")
        # Remove partial file
        if dest_path.exists():
            dest_path.unlink()
        return False


def download_album(url: str, output_dir: str = None) -> None:
    """Download all media from an Erome album URL."""
    # Validate URL
    if not re.match(r'https?://(www\.)?erome\.com/a/[a-zA-Z0-9]+', url):
        print(f"[ERROR] Invalid Erome album URL: {url}")
        print("  Expected format: https://www.erome.com/a/ALBUM_ID")
        return

    album_id = get_album_id(url)
    print(f"\n{'='*60}")
    print(f"Erome Album Downloader")
    print(f"{'='*60}")
    print(f"Album URL: {url}")
    print(f"Album ID:  {album_id}")
    print()

    session = requests.Session()

    # Fetch and parse the page
    print("[1/3] Fetching album page...")
    try:
        soup = fetch_page(url, session)
    except requests.RequestException as e:
        print(f"[ERROR] Could not fetch page: {e}")
        return

    # Extract media URLs
    print("[2/3] Extracting media URLs...")
    media = extract_media(soup, url)

    title = sanitize_filename(media['title'])
    print(f"  Album title: {media['title']}")
    print(f"  Images found: {len(media['images'])}")
    print(f"  Videos found: {len(media['videos'])}")

    if not media['images'] and not media['videos']:
        print("\n[WARNING] No media found. The page structure may have changed.")
        return

    # Create output directory
    if output_dir:
        base_dir = Path(output_dir)
    else:
        base_dir = Path.cwd() / 'downloads'

    album_dir = base_dir / f"{title}_{album_id}"
    album_dir.mkdir(parents=True, exist_ok=True)
    print(f"  Save to: {album_dir}")

    # Download all media
    print(f"\n[3/3] Downloading media...")
    total = len(media['images']) + len(media['videos'])
    success = 0
    failed = 0

    # Download images
    if media['images']:
        img_dir = album_dir / 'images'
        img_dir.mkdir(exist_ok=True)
        print(f"\n  --- Images ({len(media['images'])}) ---")
        for i, img_url in enumerate(media['images'], 1):
            parsed = urlparse(img_url.split('?')[0])  # Strip query params for filename
            ext = Path(parsed.path).suffix or '.jpg'
            filename = f"img_{i:03d}{ext}"
            dest = img_dir / filename
            print(f"  [{i}/{len(media['images'])}] {img_url.split('/')[-1].split('?')[0]}")
            if download_file(img_url, dest, session, url):
                success += 1
            else:
                failed += 1
            time.sleep(0.3)  # Be respectful to the server

    # Download videos
    if media['videos']:
        vid_dir = album_dir / 'videos'
        vid_dir.mkdir(exist_ok=True)
        print(f"\n  --- Videos ({len(media['videos'])}) ---")
        for i, vid_url in enumerate(media['videos'], 1):
            parsed = urlparse(vid_url.split('?')[0])
            ext = Path(parsed.path).suffix or '.mp4'
            filename = f"vid_{i:03d}{ext}"
            dest = vid_dir / filename
            print(f"  [{i}/{len(media['videos'])}] {vid_url.split('/')[-1].split('?')[0]}")
            if download_file(vid_url, dest, session, url):
                success += 1
            else:
                failed += 1
            time.sleep(0.5)  # Slightly longer delay for videos

    # Summary
    print(f"\n{'='*60}")
    print(f"Download Complete!")
    print(f"  Total:   {total}")
    print(f"  Success: {success}")
    print(f"  Failed:  {failed}")
    print(f"  Saved to: {album_dir}")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(
        description='Download images and videos from Erome.com album URLs.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python erome_downloader.py https://www.erome.com/a/jMAEBY4L
  python erome_downloader.py https://www.erome.com/a/jMAEBY4L -o ./my_downloads
  python erome_downloader.py url1 url2 url3
        """,
    )
    parser.add_argument(
        'urls',
        nargs='*',
        help='Erome album URL(s) to download',
    )
    parser.add_argument(
        '-o', '--output',
        default=None,
        help='Output directory (default: ./downloads)',
    )
    parser.add_argument(
        '-i', '--interactive',
        action='store_true',
        help='Run in interactive mode (enter URLs one at a time)',
    )

    args = parser.parse_args()

    if args.interactive or not args.urls:
        print("=" * 60)
        print("  Erome Album Downloader - Interactive Mode")
        print("=" * 60)
        print("Enter Erome album URLs (one per line).")
        print("Type 'done' or press Ctrl+C to exit.\n")

        while True:
            try:
                url = input("Enter URL: ").strip()
                if url.lower() in ('done', 'exit', 'quit', 'q', ''):
                    if url == '':
                        continue
                    print("Goodbye!")
                    break
                download_album(url, args.output)
            except KeyboardInterrupt:
                print("\n\nGoodbye!")
                break
    else:
        for url in args.urls:
            download_album(url, args.output)


if __name__ == '__main__':
    main()
