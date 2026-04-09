'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

/* ── constants ── */
const CONCURRENCY = 6;
const MAX_RETRIES = 2;
const KEEPALIVE_MS = 15000;
const DIRECT_DL_DELAY = 350; // ms between direct-download triggers

const SITES = [
  'Erome', 'RedGifs', 'Twitter / X', 'Instagram', 'TikTok',
  'Imgur', 'Bunkr', 'Cyberdrop', 'Direct URLs',
];

/* ── Wake Lock helper ── */
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) return await navigator.wakeLock.request('screen');
  } catch { /* not supported or denied */ }
  return null;
}

/* ── Parallel download with concurrency limit ── */
async function downloadParallel(items, concurrency, downloadFn, signal) {
  let idx = 0;
  const results = new Array(items.length).fill(null);

  async function worker() {
    while (idx < items.length) {
      if (signal?.aborted) return;
      const i = idx++;
      results[i] = await downloadFn(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

/* ── Format bytes ── */
function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/* ── styles ── */
const S = {
  page: { display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', padding: '0 16px' },
  container: { width: '100%', maxWidth: 680, paddingTop: 48, paddingBottom: 60 },
  logo: { textAlign: 'center', marginBottom: 12 },
  h1: {
    fontSize: '2.6rem', fontWeight: 800, letterSpacing: '-0.03em',
    background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 50%, #c4b5fd 100%)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
  },
  sub: { color: '#52525b', fontSize: '0.9rem', marginTop: 4 },

  /* tabs */
  tabBar: { display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 32, background: '#111115', borderRadius: 12, padding: 4 },
  tab: {
    padding: '10px 24px', borderRadius: 10, border: 'none', fontSize: '0.85rem', fontWeight: 600,
    cursor: 'pointer', color: '#71717a', background: 'transparent', transition: 'all 0.2s',
  },
  tabActive: {
    padding: '10px 24px', borderRadius: 10, border: 'none', fontSize: '0.85rem', fontWeight: 600,
    cursor: 'pointer', color: '#e4e4e7', background: '#1c1c28', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
  },

  /* form */
  form: { display: 'flex', gap: 10, marginBottom: 16 },
  input: {
    flex: 1, padding: '14px 18px', background: '#111115', border: '1px solid #27272a',
    borderRadius: 12, color: '#e4e4e7', fontSize: '0.95rem', outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  btn: {
    padding: '14px 28px', background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', border: 'none',
    borderRadius: 12, color: 'white', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer',
    whiteSpace: 'nowrap', boxShadow: '0 2px 12px rgba(124, 58, 237, 0.25)',
  },
  btnCancel: {
    padding: '14px 28px', background: 'linear-gradient(135deg, #ef4444, #dc2626)', border: 'none',
    borderRadius: 12, color: 'white', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },

  /* site tags */
  tags: { display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 28 },
  tag: {
    padding: '5px 14px', background: '#111115', border: '1px solid #1e1e2a',
    borderRadius: 20, fontSize: '0.75rem', color: '#52525b', fontWeight: 500,
  },

  /* panel */
  panel: {
    background: 'rgba(17, 17, 21, 0.8)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid #1e1e2a', borderRadius: 16, padding: 24, marginBottom: 20,
    animation: 'fadeIn 0.3s ease-out',
  },

  /* progress */
  barWrap: { width: '100%', height: 6, background: '#1a1a24', borderRadius: 3, overflow: 'hidden', marginBottom: 20 },
  bar: {
    height: '100%', borderRadius: 3, transition: 'width 0.4s ease',
    background: 'linear-gradient(90deg, #7c3aed, #a78bfa, #7c3aed)',
    backgroundSize: '200% 100%', animation: 'gradientShift 2s ease infinite',
  },

  /* file list */
  fileList: {
    display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto',
    padding: '2px 0',
  },
  fileRow: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
    borderRadius: 8, fontSize: '0.8rem', fontFamily: "'SF Mono','Cascadia Code','Fira Code',monospace",
  },
  fileName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  /* Ghost Search */
  searchPanel: {
    textAlign: 'center', padding: '60px 24px',
    background: 'rgba(17, 17, 21, 0.6)', backdropFilter: 'blur(12px)',
    border: '1px solid #1e1e2a', borderRadius: 16,
    animation: 'fadeIn 0.3s ease-out',
  },
  searchIcon: { fontSize: '3rem', marginBottom: 16, opacity: 0.3 },
  comingSoon: {
    display: 'inline-block', padding: '6px 16px', borderRadius: 20,
    background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(167,139,250,0.1))',
    border: '1px solid rgba(124,58,237,0.25)', color: '#a78bfa',
    fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 16,
  },
  searchDesc: { color: '#52525b', fontSize: '0.85rem', lineHeight: 1.6, maxWidth: 380, margin: '0 auto' },
  searchInput: {
    width: '100%', maxWidth: 420, padding: '14px 18px', background: '#111115',
    border: '1px solid #27272a', borderRadius: 12, color: '#3f3f46',
    fontSize: '0.95rem', outline: 'none', margin: '24px auto 0', display: 'block',
  },

  /* footer */
  footer: { textAlign: 'center', color: '#27272a', fontSize: '0.75rem', marginTop: 40 },
};

/* ── File status icon & color ── */
const FILE_STATUS = {
  queued:      { icon: '·', color: '#3f3f46' },
  downloading: { icon: '↓', color: '#60a5fa' },
  done:        { icon: '✓', color: '#22c55e' },
  error:       { icon: '✗', color: '#ef4444' },
};

export default function GhostPage() {
  const [tab, setTab] = useState('download');
  const [url, setUrl] = useState('');
  const [dlMode, setDlMode] = useState('direct'); // 'direct' (fast, individual) | 'zip'
  const [status, setStatus] = useState('idle'); // idle | extracting | downloading | zipping | done | error
  const [files, setFiles] = useState([]); // [{ filename, status, size }]
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [notification, setNotification] = useState('');
  const abortRef = useRef(null);
  const wakeLockRef = useRef(null);
  const keepaliveRef = useRef(null);
  const fileListRef = useRef(null);

  /* ── Ghost Search state ── */
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState('idle'); // idle | searching | done | error
  const [searchResults, setSearchResults] = useState([]);
  const [searchMeta, setSearchMeta] = useState(null); // { total, sources_searched, search_time_ms, parsed }
  const [searchError, setSearchError] = useState('');

  /* auto-scroll file list */
  useEffect(() => {
    if (fileListRef.current) fileListRef.current.scrollTop = fileListRef.current.scrollHeight;
  }, [files]);

  /* warn before leaving during download */
  useEffect(() => {
    const handler = (e) => {
      if (status === 'downloading' || status === 'extracting' || status === 'zipping') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [status]);

  /* re-acquire wake lock on visibility change */
  useEffect(() => {
    const handler = async () => {
      if (document.visibilityState === 'visible' && wakeLockRef.current) {
        try { wakeLockRef.current = await acquireWakeLock(); } catch {}
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  /* cleanup on unmount */
  useEffect(() => {
    return () => {
      if (keepaliveRef.current) clearInterval(keepaliveRef.current);
      if (wakeLockRef.current) { try { wakeLockRef.current.release(); } catch {} }
    };
  }, []);

  const updateFile = useCallback((idx, updates) => {
    setFiles(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });
  }, []);

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setStatus('extracting');
    setFiles([]);
    setProgress(0);
    setResult(null);
    setNotification('Extracting media URLs…');

    try {
      /* acquire wake lock */
      wakeLockRef.current = await acquireWakeLock();

      /* start keepalive pings to prevent connection drops */
      keepaliveRef.current = setInterval(() => {
        fetch('/api/extract', { method: 'HEAD', keepalive: true }).catch(() => {});
      }, KEEPALIVE_MS);

      /* extract */
      const resp = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await resp.json();

      if (data.error) {
        setNotification(data.error);
        setStatus('error');
        cleanup();
        return;
      }

      if (!data.media || data.media.length === 0) {
        setNotification('No media found at this URL');
        setStatus('error');
        cleanup();
        return;
      }

      setNotification(`${data.site} — found ${data.media.length} file(s)`);

      /* build folder-safe title prefix for per-URL organization */
      const folderName = (data.title || 'ghost_download').replace(/[<>:"/\\|?*\n\r\t]/g, '_').replace(/\s+/g, ' ').trim().substring(0, 100);

      /* init file list */
      const initFiles = data.media.map(m => ({ filename: m.filename, status: 'queued', size: null }));
      setFiles(initFiles);

      const controller = new AbortController();
      abortRef.current = controller;

      /* ── Direct download mode (fast, default) ── */
      if (dlMode === 'direct') {
        setStatus('downloading');
        let completed = 0;
        let failed = 0;

        for (let i = 0; i < data.media.length; i++) {
          if (controller.signal.aborted) break;

          const item = data.media[i];
          updateFile(i, { status: 'downloading' });

          const params = new URLSearchParams({
            url: item.url,
            referer: data.referer || '',
            auth: data.authHeader || '',
            dl: '1',
            filename: `${folderName}_${item.filename}`,
          });

          try {
            const a = document.createElement('a');
            a.href = '/api/proxy?' + params.toString();
            a.download = `${folderName}_${item.filename}`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            a.remove();
            completed++;
            updateFile(i, { status: 'done' });
          } catch {
            failed++;
            updateFile(i, { status: 'error' });
          }

          setProgress(Math.round(((completed + failed) / data.media.length) * 100));

          // Small delay between triggers to prevent browser from blocking
          if (i < data.media.length - 1) {
            await new Promise(r => setTimeout(r, DIRECT_DL_DELAY));
          }
        }

        setResult({ ok: completed, fail: failed });
        setNotification(`Done — ${completed}/${data.media.length} files sent to browser`);
        setStatus('done');
        cleanup();
        return;
      }

      /* ── ZIP download mode ── */
      setStatus('downloading');
      let completed = 0;

      const results = await downloadParallel(data.media, CONCURRENCY, async (item, idx) => {
        if (controller.signal.aborted) return null;

        updateFile(idx, { status: 'downloading' });

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const params = new URLSearchParams({
              url: item.url,
              referer: data.referer || '',
              auth: data.authHeader || '',
            });
            const r = await fetch('/api/proxy?' + params.toString(), {
              signal: controller.signal,
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const blob = await r.blob();
            const size = blob.size;
            completed++;
            setProgress(Math.round((completed / data.media.length) * 100));
            updateFile(idx, { status: 'done', size });
            return { name: item.filename, blob };
          } catch (err) {
            if (err.name === 'AbortError') return null;
            if (attempt === MAX_RETRIES) {
              completed++;
              setProgress(Math.round((completed / data.media.length) * 100));
              updateFile(idx, { status: 'error' });
              return null;
            }
          }
        }
        return null;
      }, controller.signal);

      if (controller.signal.aborted) {
        setNotification('Cancelled');
        setStatus('idle');
        cleanup();
        return;
      }

      const successBlobs = results.filter(Boolean);

      /* zip phase */
      setStatus('zipping');
      setNotification('Creating ZIP archive…');

      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const folder = zip.folder(folderName);
      for (const b of successBlobs) folder.file(b.name, b.blob);

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 1 }, // fast compression
      });

      const a = document.createElement('a');
      a.href = URL.createObjectURL(zipBlob);
      a.download = (data.title || 'ghost_download') + '.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      const failCount = data.media.length - successBlobs.length;
      setResult({ ok: successBlobs.length, fail: failCount, zipSize: zipBlob.size });
      setNotification(`Done — ${successBlobs.length}/${data.media.length} files (${fmtSize(zipBlob.size)})`);
      setStatus('done');
      cleanup();
    } catch (err) {
      setNotification(err.message);
      setStatus('error');
      cleanup();
    }
  }

  function cleanup() {
    if (keepaliveRef.current) { clearInterval(keepaliveRef.current); keepaliveRef.current = null; }
    if (wakeLockRef.current) { try { wakeLockRef.current.release(); } catch {} wakeLockRef.current = null; }
  }

  async function handleSearch(e) {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    setSearchStatus('searching');
    setSearchResults([]);
    setSearchMeta(null);
    setSearchError('');

    try {
      const resp = await fetch('/api/ghost-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, per_page: 30 }),
      });
      const data = await resp.json();

      if (data.error) {
        setSearchError(data.error);
        setSearchStatus('error');
        return;
      }

      setSearchResults(data.results || []);
      setSearchMeta({
        total: data.total,
        sources_searched: data.sources_searched || [],
        search_time_ms: data.search_time_ms,
        parsed: data.parsed,
      });
      setSearchStatus('done');
    } catch (err) {
      setSearchError(err.message || 'Search failed');
      setSearchStatus('error');
    }
  }

  function handleCancel() {
    if (abortRef.current) abortRef.current.abort();
  }

  const working = status === 'extracting' || status === 'downloading' || status === 'zipping';
  const statusColor = status === 'done' ? '#22c55e' : status === 'error' ? '#ef4444' : '#a78bfa';

  return (
    <div style={S.page}>
      <div style={S.container}>
        {/* ── Header ── */}
        <div style={S.logo}>
          <h1 style={S.h1}>Ghost</h1>
          <p style={S.sub}>Paste a link. Get the media. Any device.</p>
        </div>

        {/* ── Tabs ── */}
        <div style={S.tabBar}>
          <button
            style={tab === 'download' ? S.tabActive : S.tab}
            onClick={() => setTab('download')}
          >
            Download
          </button>
          <button
            style={tab === 'search' ? S.tabActive : S.tab}
            onClick={() => setTab('search')}
          >
            Ghost Search
          </button>
        </div>

        {/* ── Download Tab ── */}
        {tab === 'download' && (
          <div className="fade-in">
            <form onSubmit={handleSubmit} style={S.form}>
              <input
                type="url"
                placeholder="Paste any URL here…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={working}
                autoFocus
                style={S.input}
              />
              {working ? (
                <button type="button" onClick={handleCancel} style={S.btnCancel}>
                  Cancel
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!url.trim()}
                  style={{ ...S.btn, ...(url.trim() ? {} : S.btnDisabled) }}
                >
                  Download
                </button>
              )}
            </form>

            {/* ── Download mode toggle ── */}
            <div style={{
              display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 16,
              background: '#111115', borderRadius: 10, padding: 3, maxWidth: 320, margin: '0 auto 16px',
            }}>
              <button
                type="button"
                onClick={() => setDlMode('direct')}
                disabled={working}
                style={{
                  flex: 1, padding: '7px 14px', borderRadius: 8, border: 'none', fontSize: '0.78rem',
                  fontWeight: 600, cursor: working ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                  color: dlMode === 'direct' ? '#e4e4e7' : '#52525b',
                  background: dlMode === 'direct' ? '#1c1c28' : 'transparent',
                  boxShadow: dlMode === 'direct' ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
                }}
              >
                ⚡ Fast
              </button>
              <button
                type="button"
                onClick={() => setDlMode('zip')}
                disabled={working}
                style={{
                  flex: 1, padding: '7px 14px', borderRadius: 8, border: 'none', fontSize: '0.78rem',
                  fontWeight: 600, cursor: working ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                  color: dlMode === 'zip' ? '#e4e4e7' : '#52525b',
                  background: dlMode === 'zip' ? '#1c1c28' : 'transparent',
                  boxShadow: dlMode === 'zip' ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
                }}
              >
                📦 ZIP
              </button>
            </div>

            <div style={S.tags}>
              {SITES.map((s) => (
                <span key={s} style={S.tag}>{s}</span>
              ))}
            </div>

            {/* ── Download Panel ── */}
            {(status !== 'idle' || files.length > 0) && (
              <div style={S.panel}>
                {/* status line */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 16, fontSize: '0.85rem',
                }}>
                  <span style={{ color: statusColor, fontWeight: 600 }}>
                    {status === 'extracting' && '● Extracting…'}
                    {status === 'downloading' && `↓ Downloading ${progress}%`}
                    {status === 'zipping' && '◐ Creating ZIP…'}
                    {status === 'done' && '✓ Complete'}
                    {status === 'error' && '✗ Error'}
                  </span>
                  {status === 'downloading' && (
                    <span style={{ color: '#3f3f46', fontSize: '0.78rem' }}>
                      {dlMode === 'direct' ? '⚡ direct' : `${CONCURRENCY}x parallel`}
                    </span>
                  )}
                </div>

                {/* progress bar */}
                <div style={S.barWrap}>
                  <div style={{
                    ...S.bar,
                    width: status === 'extracting' ? '15%' : status === 'zipping' ? '100%' : progress + '%',
                    ...(status === 'extracting' ? { animation: 'shimmer 1.5s infinite, gradientShift 2s ease infinite', backgroundSize: '200% 100%' } : {}),
                    ...(status === 'done' ? { background: '#22c55e', animation: 'none' } : {}),
                    ...(status === 'error' ? { background: '#ef4444', animation: 'none' } : {}),
                  }} />
                </div>

                {/* notification */}
                {notification && (
                  <div style={{
                    padding: '8px 12px', background: 'rgba(124, 58, 237, 0.06)',
                    borderRadius: 8, marginBottom: 16, fontSize: '0.82rem', color: '#a1a1aa',
                  }}>
                    {notification}
                  </div>
                )}

                {/* file list */}
                {files.length > 0 && (
                  <div ref={fileListRef} style={S.fileList}>
                    {files.map((f, i) => {
                      const st = FILE_STATUS[f.status] || FILE_STATUS.queued;
                      return (
                        <div key={i} style={{
                          ...S.fileRow,
                          background: f.status === 'downloading' ? 'rgba(96, 165, 250, 0.04)' : 'transparent',
                        }}>
                          <span style={{
                            color: st.color, fontWeight: 600, width: 16, textAlign: 'center',
                            ...(f.status === 'downloading' ? { animation: 'pulse 1s infinite' } : {}),
                          }}>
                            {st.icon}
                          </span>
                          <span style={{ ...S.fileName, color: f.status === 'queued' ? '#3f3f46' : '#a1a1aa' }}>
                            {f.filename}
                          </span>
                          {f.size != null && (
                            <span style={{ color: '#3f3f46', fontSize: '0.75rem', flexShrink: 0 }}>
                              {fmtSize(f.size)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* result summary */}
                {result && (
                  <div style={{
                    display: 'flex', justifyContent: 'center', gap: 16,
                    marginTop: 16, paddingTop: 16, borderTop: '1px solid #1e1e2a',
                    fontSize: '0.85rem',
                  }}>
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>
                      {result.ok} downloaded
                    </span>
                    {result.fail > 0 && (
                      <span style={{ color: '#ef4444', fontWeight: 600 }}>
                        {result.fail} failed
                      </span>
                    )}
                    {result.zipSize && (
                      <span style={{ color: '#52525b' }}>
                        {fmtSize(result.zipSize)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Ghost Search Tab ── */}
        {tab === 'search' && (
          <div className="fade-in">
            {/* Search bar */}
            <form onSubmit={handleSearch} style={S.form}>
              <input
                type="text"
                placeholder="Search across all platforms…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={searchStatus === 'searching'}
                autoFocus={tab === 'search'}
                style={{ ...S.input, borderColor: searchStatus === 'error' ? '#ef4444' : undefined }}
              />
              <button
                type="submit"
                disabled={!searchQuery.trim() || searchStatus === 'searching'}
                style={{
                  ...S.btn,
                  ...(!searchQuery.trim() || searchStatus === 'searching' ? S.btnDisabled : {}),
                }}
              >
                {searchStatus === 'searching' ? '…' : 'Search'}
              </button>
            </form>

            {/* Source tags */}
            <div style={S.tags}>
              {['Erome', 'RedGifs', 'Pornhub', 'XVideos', 'Stash', 'ThePornDB', 'Brave'].map((s) => (
                <span key={s} style={{
                  ...S.tag,
                  ...(searchMeta?.sources_searched?.includes(s.toLowerCase()) ? {
                    borderColor: 'rgba(124, 58, 237, 0.4)',
                    color: '#a78bfa',
                    background: 'rgba(124, 58, 237, 0.08)',
                  } : {}),
                }}>
                  {s}
                </span>
              ))}
            </div>

            {/* Searching indicator */}
            {searchStatus === 'searching' && (
              <div style={S.panel}>
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div style={{
                    width: 24, height: 24, border: '2.5px solid #27272a', borderTopColor: '#7c3aed',
                    borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite',
                  }} />
                  <div style={{ color: '#71717a', fontSize: '0.85rem' }}>
                    Searching across all sources…
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {searchStatus === 'error' && (
              <div style={{ ...S.panel, borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                <div style={{ color: '#ef4444', fontSize: '0.85rem', textAlign: 'center' }}>
                  ✗ {searchError}
                </div>
              </div>
            )}

            {/* Results */}
            {searchStatus === 'done' && (
              <>
                {/* Meta bar */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 16, fontSize: '0.78rem', color: '#52525b',
                }}>
                  <span>{searchMeta?.total || 0} results from {searchMeta?.sources_searched?.length || 0} sources</span>
                  <span>{searchMeta?.search_time_ms || 0}ms</span>
                </div>

                {/* Parsed query chips */}
                {searchMeta?.parsed && (searchMeta.parsed.performers?.length > 0 || searchMeta.parsed.tags?.length > 0) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                    {(searchMeta.parsed.performers || []).map(p => (
                      <span key={p} style={{
                        padding: '3px 10px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600,
                        background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)',
                        color: '#22c55e',
                      }}>
                        👤 {p}
                      </span>
                    ))}
                    {(searchMeta.parsed.tags || []).map(t => (
                      <span key={t} style={{
                        padding: '3px 10px', borderRadius: 6, fontSize: '0.72rem',
                        background: 'rgba(124, 58, 237, 0.08)', border: '1px solid rgba(124, 58, 237, 0.15)',
                        color: '#a78bfa',
                      }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {/* Results grid */}
                {searchResults.length > 0 ? (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: 12,
                  }}>
                    {searchResults.map((r) => (
                      <a
                        key={r.id}
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          background: '#111115', border: '1px solid #1e1e2a', borderRadius: 12,
                          overflow: 'hidden', textDecoration: 'none', color: '#e4e4e7',
                          transition: 'border-color 0.2s, transform 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = '#7c3aed';
                          e.currentTarget.style.transform = 'translateY(-2px)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#1e1e2a';
                          e.currentTarget.style.transform = 'translateY(0)';
                        }}
                      >
                        {/* Thumbnail */}
                        <div style={{
                          width: '100%', height: 120, background: '#0a0a0f',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          position: 'relative', overflow: 'hidden',
                        }}>
                          {r.thumbnail ? (
                            <img
                              src={r.thumbnail}
                              alt=""
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              loading="lazy"
                            />
                          ) : (
                            <span style={{ color: '#27272a', fontSize: '2rem' }}>
                              {r.media_type === 'video' ? '▶' : '◻'}
                            </span>
                          )}
                          {/* Source badge */}
                          <span style={{
                            position: 'absolute', top: 6, left: 6, padding: '2px 8px',
                            background: 'rgba(0,0,0,0.7)', borderRadius: 6,
                            fontSize: '0.65rem', color: '#a1a1aa', fontWeight: 600,
                            backdropFilter: 'blur(4px)',
                          }}>
                            {r.source}
                          </span>
                          {/* Duration badge */}
                          {r.duration != null && (
                            <span style={{
                              position: 'absolute', bottom: 6, right: 6, padding: '2px 8px',
                              background: 'rgba(0,0,0,0.7)', borderRadius: 6,
                              fontSize: '0.65rem', color: '#e4e4e7', fontFamily: 'monospace',
                              backdropFilter: 'blur(4px)',
                            }}>
                              {Math.floor(r.duration / 60)}:{String(r.duration % 60).padStart(2, '0')}
                            </span>
                          )}
                        </div>
                        {/* Info */}
                        <div style={{ padding: '10px 12px' }}>
                          <div style={{
                            fontSize: '0.78rem', fontWeight: 500, lineHeight: 1.4,
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                          }}>
                            {r.title}
                          </div>
                          <div style={{
                            display: 'flex', gap: 8, marginTop: 6, fontSize: '0.68rem', color: '#52525b',
                          }}>
                            {r.views != null && <span>{r.views > 1000 ? (r.views / 1000).toFixed(0) + 'k' : r.views} views</span>}
                            {r.relevance_score > 0 && (
                              <span style={{
                                color: r.relevance_score > 0.7 ? '#22c55e' : r.relevance_score > 0.4 ? '#a78bfa' : '#52525b',
                              }}>
                                {Math.round(r.relevance_score * 100)}% match
                              </span>
                            )}
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div style={{
                    textAlign: 'center', padding: '40px 0', color: '#3f3f46', fontSize: '0.85rem',
                  }}>
                    No results found. Try different keywords.
                  </div>
                )}
              </>
            )}

            {/* Empty state */}
            {searchStatus === 'idle' && (
              <div style={{ ...S.panel, textAlign: 'center', padding: '48px 24px' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 16, opacity: 0.2 }}>🔍</div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#e4e4e7', marginBottom: 8 }}>
                  Ghost Search
                </h3>
                <p style={{ color: '#52525b', fontSize: '0.82rem', lineHeight: 1.6, maxWidth: 360, margin: '0 auto' }}>
                  AI-powered search across Erome, RedGifs, Pornhub, XVideos, Stash, ThePornDB, and Brave.
                  Type naturally — Ghost understands performers, tags, and context.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <div style={S.footer}>Ghost v0.3.0</div>
      </div>
    </div>
  );
}