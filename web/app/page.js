'use client';
import { useState, useRef } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('idle'); // idle | extracting | downloading | done | error
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const abortRef = useRef(null);

  function addLog(type, msg) {
    setLogs(prev => [...prev, { type, msg, ts: Date.now() }]);
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!url.trim()) return;

    setStatus('extracting');
    setLogs([]);
    setProgress(0);
    setResult(null);
    addLog('info', 'Extracting media URLs...');

    try {
      const resp = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await resp.json();

      if (data.error) {
        addLog('error', data.error);
        setStatus('error');
        return;
      }

      addLog('found', `${data.site} — Found ${data.media.length} files`);

      if (data.media.length === 0) {
        addLog('error', 'No media found on this page');
        setStatus('error');
        return;
      }

      // Download all files in browser
      setStatus('downloading');
      const controller = new AbortController();
      abortRef.current = controller;

      const files = [];
      let done = 0;

      for (const item of data.media) {
        if (controller.signal.aborted) break;

        addLog('dl', `${item.filename}`);
        try {
          // Use our proxy endpoint to avoid CORS
          const fileResp = await fetch('/api/proxy?' + new URLSearchParams({
            url: item.url,
            referer: data.referer || '',
            auth: data.authHeader || '',
          }), { signal: controller.signal });

          if (!fileResp.ok) throw new Error(`HTTP ${fileResp.status}`);

          const blob = await fileResp.blob();
          files.push({ name: item.filename, blob });
        } catch (err) {
          if (err.name === 'AbortError') break;
          addLog('error', `Failed: ${item.filename} — ${err.message}`);
        }
        done++;
        setProgress(Math.round((done / data.media.length) * 100));
      }

      if (controller.signal.aborted) {
        addLog('info', 'Cancelled');
        setStatus('idle');
        return;
      }

      // Create ZIP using JSZip (loaded from CDN)
      addLog('info', 'Creating ZIP...');
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const f of files) {
        zip.file(f.name, f.blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      // Trigger download
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zipBlob);
      a.download = `${data.title || 'ghost_download'}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      setResult({ success: files.length, failed: data.media.length - files.length });
      addLog('done', `Downloaded ${files.length}/${data.media.length} files`);
      setStatus('done');

    } catch (err) {
      addLog('error', err.message);
      setStatus('error');
    }
  }

  function handleCancel() {
    if (abortRef.current) abortRef.current.abort();
  }

  const isWorking = status === 'extracting' || status === 'downloading';

  return (
    <>
      <style>{`
        :root {
          --bg: #0a0a0f; --surface: #12121a; --surface2: #1a1a26;
          --border: #2a2a3a; --accent: #7c3aed; --accent-hover: #6d28d9;
          --accent-glow: rgba(124,58,237,0.3); --green: #22c55e; --red: #ef4444;
          --yellow: #eab308; --text: #e4e4e7; --text-dim: #71717a; --radius: 12px;
        }
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; display:flex; flex-direction:column; align-items:center; }
        .container { width:100%; max-width:640px; padding:20px; margin-top:60px; }
        .logo { text-align:center; margin-bottom:40px; }
        .logo h1 { font-size:2.2rem; font-weight:700; letter-spacing:-0.5px; background:linear-gradient(135deg,#7c3aed,#a78bfa,#7c3aed); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
        .logo p { color:var(--text-dim); font-size:0.85rem; margin-top:6px; }
        form { display:flex; gap:10px; margin-bottom:20px; }
        form input { flex:1; padding:14px 18px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); color:var(--text); font-size:0.95rem; outline:none; transition:border-color 0.2s,box-shadow 0.2s; }
        form input:focus { border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-glow); }
        form input::placeholder { color:var(--text-dim); }
        .btn { padding:14px 28px; background:var(--accent); border:none; border-radius:var(--radius); color:white; font-size:0.95rem; font-weight:600; cursor:pointer; transition:background 0.2s,transform 0.1s; white-space:nowrap; }
        .btn:hover { background:var(--accent-hover); }
        .btn:active { transform:scale(0.97); }
        .btn:disabled { opacity:0.5; cursor:not-allowed; }
        .btn-cancel { background:var(--red); }
        .btn-cancel:hover { background:#dc2626; }
        .sites { display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-bottom:30px; }
        .sites span { padding:4px 12px; background:var(--surface2); border:1px solid var(--border); border-radius:20px; font-size:0.75rem; color:var(--text-dim); }
        .panel { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:24px; margin-bottom:20px; }
        .progress-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
        .status { font-size:0.85rem; color:var(--text-dim); }
        .status.ok { color:var(--green); }
        .status.err { color:var(--red); }
        .bar-wrap { width:100%; height:6px; background:var(--surface2); border-radius:3px; overflow:hidden; margin-bottom:16px; }
        .bar { height:100%; background:linear-gradient(90deg,var(--accent),#a78bfa); border-radius:3px; transition:width 0.3s; }
        .log-box { background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:12px 14px; max-height:280px; overflow-y:auto; font-family:'SF Mono','Cascadia Code','Fira Code',monospace; font-size:0.78rem; line-height:1.7; }
        .log-box::-webkit-scrollbar { width:4px; }
        .log-box::-webkit-scrollbar-thumb { background:var(--border); border-radius:2px; }
        .log-line { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .log-line.info { color:#60a5fa; }
        .log-line.found { color:var(--green); }
        .log-line.dl { color:var(--text-dim); }
        .log-line.error { color:var(--red); }
        .log-line.done { color:var(--green); font-weight:600; }
        .spinner { display:inline-block; width:14px; height:14px; border:2px solid rgba(255,255,255,0.3); border-top-color:white; border-radius:50%; animation:spin 0.7s linear infinite; vertical-align:middle; margin-right:6px; }
        @keyframes spin { to { transform:rotate(360deg); } }
        footer { margin-top:auto; padding:30px; text-align:center; font-size:0.75rem; color:var(--text-dim); }
        @media (max-width:480px) { .container { margin-top:30px; padding:12px; } .logo h1 { font-size:1.6rem; } form { flex-direction:column; } .btn { width:100%; } }
      `}</style>

      <div className="container">
        <div className="logo">
          <h1>👻 Ghost</h1>
          <p>Paste a link. Get the media. Any device.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="url"
            placeholder="Paste URL here..."
            value={url}
            onChange={e => setUrl(e.target.value)}
            disabled={isWorking}
            autoFocus
          />
          {isWorking ? (
            <button type="button" className="btn btn-cancel" onClick={handleCancel}>Cancel</button>
          ) : (
            <button type="submit" className="btn" disabled={!url.trim()}>Download</button>
          )}
        </form>

        <div className="sites">
          <span>Erome</span>
          <span>RedGifs</span>
          <span>Imgur</span>
          <span>Bunkr</span>
          <span>Cyberdrop</span>
          <span>Any URL</span>
        </div>

        {logs.length > 0 && (
          <div className="panel">
            <div className="progress-header">
              <span className={`status ${status === 'done' ? 'ok' : status === 'error' ? 'err' : ''}`}>
                {status === 'extracting' && <><span className="spinner" />Extracting...</>}
                {status === 'downloading' && <><span className="spinner" />Downloading {progress}%</>}
                {status === 'done' && '✓ Complete'}
                {status === 'error' && '✗ Error'}
              </span>
            </div>
            <div className="bar-wrap">
              <div className="bar" style={{ width: `${progress}%` }} />
            </div>
            <div className="log-box" ref={el => { if (el) el.scrollTop = el.scrollHeight; }}>
              {logs.map((l, i) => (
                <div key={i} className={`log-line ${l.type}`}>
                  {l.type === 'info' && `● ${l.msg}`}
                  {l.type === 'found' && `✦ ${l.msg}`}
                  {l.type === 'dl' && `↓ ${l.msg}`}
                  {l.type === 'error' && `✗ ${l.msg}`}
                  {l.type === 'done' && `✓ ${l.msg}`}
                </div>
              ))}
            </div>
            {result && (
              <div style={{ textAlign:'center', marginTop:12, fontSize:'0.85rem', color:'var(--text-dim)' }}>
                <span style={{ color:'var(--green)', fontWeight:600 }}>{result.success} downloaded</span>
                {result.failed > 0 && <> · <span style={{ color:'var(--red)', fontWeight:600 }}>{result.failed} failed</span></>}
              </div>
            )}
          </div>
        )}
      </div>
      <footer>Ghost Downloader — deploys on Vercel, downloads to your device.</footer>
    </>
  );
}
