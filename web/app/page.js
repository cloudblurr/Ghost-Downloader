'use client';
import React, { useState, useRef, useEffect } from 'react';

var S = {
  page: { fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: '#0a0a0f', color: '#e4e4e7', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', margin: 0 },
  container: { width: '100%', maxWidth: 640, padding: 20, marginTop: 60 },
  logo: { textAlign: 'center', marginBottom: 40 },
  h1: { fontSize: '2.2rem', fontWeight: 700, background: 'linear-gradient(135deg,#7c3aed,#a78bfa,#7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', margin: 0 },
  sub: { color: '#71717a', fontSize: '0.85rem', marginTop: 6 },
  form: { display: 'flex', gap: 10, marginBottom: 20 },
  input: { flex: 1, padding: '14px 18px', background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 12, color: '#e4e4e7', fontSize: '0.95rem', outline: 'none' },
  btn: { padding: '14px 28px', background: '#7c3aed', border: 'none', borderRadius: 12, color: 'white', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 30 },
  tag: { padding: '4px 12px', background: '#1a1a26', border: '1px solid #2a2a3a', borderRadius: 20, fontSize: '0.75rem', color: '#71717a' },
  panel: { background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 12, padding: 24, marginBottom: 20 },
  barWrap: { width: '100%', height: 6, background: '#1a1a26', borderRadius: 3, overflow: 'hidden', marginBottom: 16 },
  bar: { height: '100%', background: 'linear-gradient(90deg,#7c3aed,#a78bfa)', borderRadius: 3, transition: 'width 0.3s' },
  logBox: { background: '#0a0a0f', border: '1px solid #2a2a3a', borderRadius: 8, padding: '12px 14px', maxHeight: 280, overflowY: 'auto', fontFamily: "'SF Mono','Cascadia Code','Fira Code',monospace", fontSize: '0.78rem', lineHeight: '1.7' },
};

var LC = { info: '#60a5fa', found: '#22c55e', dl: '#71717a', error: '#ef4444', done: '#22c55e' };
var LP = { info: '\u25CF', found: '\u2726', dl: '\u2193', error: '\u2717', done: '\u2713' };
var SITES = ['Erome', 'RedGifs', 'Imgur', 'Bunkr', 'Cyberdrop', 'Any URL'];

export default function GhostPage() {
  var _url = useState(''), url = _url[0], setUrl = _url[1];
  var _st = useState('idle'), status = _st[0], setStatus = _st[1];
  var _lg = useState([]), logs = _lg[0], setLogs = _lg[1];
  var _pr = useState(0), progress = _pr[0], setProgress = _pr[1];
  var _rs = useState(null), result = _rs[0], setResult = _rs[1];
  var abortRef = useRef(null);
  var logRef = useRef(null);

  useEffect(function() {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  function addLog(type, msg) {
    setLogs(function(p) { return p.concat([{ type: type, msg: msg }]); });
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    if (!url.trim()) return;
    setStatus('extracting'); setLogs([]); setProgress(0); setResult(null);
    addLog('info', 'Extracting media URLs...');
    try {
      var resp = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) });
      var data = await resp.json();
      if (data.error) { addLog('error', data.error); setStatus('error'); return; }
      addLog('found', data.site + ' - found ' + data.media.length + ' file(s)');
      if (data.media.length === 0) { addLog('error', 'No media found'); setStatus('error'); return; }
      setStatus('downloading');
      var controller = new AbortController();
      abortRef.current = controller;
      var blobs = [], done = 0;
      for (var i = 0; i < data.media.length; i++) {
        var item = data.media[i];
        if (controller.signal.aborted) break;
        addLog('dl', item.filename);
        try {
          var params = new URLSearchParams({ url: item.url, referer: data.referer || '', auth: data.authHeader || '' });
          var r = await fetch('/api/proxy?' + params.toString(), { signal: controller.signal });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          blobs.push({ name: item.filename, blob: await r.blob() });
        } catch (err) { if (err.name === 'AbortError') break; addLog('error', 'Failed: ' + item.filename); }
        done++;
        setProgress(Math.round((done / data.media.length) * 100));
      }
      if (controller.signal.aborted) { addLog('info', 'Cancelled'); setStatus('idle'); return; }
      addLog('info', 'Creating ZIP...');
      var JSZip = (await import('jszip')).default;
      var zip = new JSZip();
      for (var j = 0; j < blobs.length; j++) zip.file(blobs[j].name, blobs[j].blob);
      var zipBlob = await zip.generateAsync({ type: 'blob' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(zipBlob);
      a.download = (data.title || 'ghost_download') + '.zip';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      setResult({ ok: blobs.length, fail: data.media.length - blobs.length });
      addLog('done', 'Done - ' + blobs.length + '/' + data.media.length + ' files');
      setStatus('done');
    } catch (err) { addLog('error', err.message); setStatus('error'); }
  }

  var working = status === 'extracting' || status === 'downloading';
  var statusText = status === 'extracting' ? 'Extracting...' : status === 'downloading' ? 'Downloading ' + progress + '%' : status === 'done' ? 'Complete' : status === 'error' ? 'Error' : '';
  var statusColor = status === 'done' ? '#22c55e' : status === 'error' ? '#ef4444' : '#71717a';

  return React.createElement('div', { style: S.page },
    React.createElement('div', { style: S.container },
      React.createElement('div', { style: S.logo },
        React.createElement('h1', { style: S.h1 }, 'Ghost'),
        React.createElement('p', { style: S.sub }, 'Paste a link. Get the media. Any device.')
      ),
      React.createElement('form', { onSubmit: handleSubmit, style: S.form },
        React.createElement('input', { type: 'url', placeholder: 'Paste URL here...', value: url, onChange: function(e) { setUrl(e.target.value); }, disabled: working, autoFocus: true, style: S.input }),
        working
          ? React.createElement('button', { type: 'button', onClick: function() { if (abortRef.current) abortRef.current.abort(); }, style: Object.assign({}, S.btn, { background: '#ef4444' }) }, 'Cancel')
          : React.createElement('button', { type: 'submit', disabled: !url.trim(), style: S.btn }, 'Download')
      ),
      React.createElement('div', { style: S.tags }, SITES.map(function(s) { return React.createElement('span', { key: s, style: S.tag }, s); })),
      logs.length > 0 ? React.createElement('div', { style: S.panel },
        React.createElement('div', { style: { marginBottom: 14, fontSize: '0.85rem', color: statusColor } }, statusText),
        React.createElement('div', { style: S.barWrap }, React.createElement('div', { style: Object.assign({}, S.bar, { width: progress + '%' }) })),
        React.createElement('div', { ref: logRef, style: S.logBox },
          logs.map(function(l, i) {
            return React.createElement('div', { key: i, style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: LC[l.type] || '#e4e4e7' } }, (LP[l.type] || ' ') + ' ' + l.msg);
          })
        ),
        result ? React.createElement('div', { style: { textAlign: 'center', marginTop: 12, fontSize: '0.85rem', color: '#71717a' } },
          React.createElement('span', { style: { color: '#22c55e', fontWeight: 600 } }, result.ok + ' downloaded'),
          result.fail > 0 ? React.createElement('span', null, ' | ', React.createElement('span', { style: { color: '#ef4444', fontWeight: 600 } }, result.fail + ' failed')) : null
        ) : null
      ) : null
    )
  );
}