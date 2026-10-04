import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { NativeAudio } from '../lib/native-audio';
import { recommendSource } from '../lib/source-matching';

const CONNECTION_KEY = 'yungan-download-connection';

export default function PlaylistDownloads({ playlist, onUpload, onGoogleLogin }) {
  const [connection, setConnection] = useState(null);
  const [pairing, setPairing] = useState('');
  const [entries, setEntries] = useState([]);
  const [selected, setSelected] = useState({});
  const [candidates, setCandidates] = useState({});
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [autoUpload, setAutoUpload] = useState(true);
  const [transfer, setTransfer] = useState('');
  const [mobileLinks, setMobileLinks] = useState([]);
  const handled = useRef(new Set());
  const transferBusy = useRef(false);
  const currentUpload = useRef(onUpload);
  const autoUploadRef = useRef(autoUpload);
  const active = useRef(true);
  useEffect(() => { currentUpload.current = onUpload; autoUploadRef.current = autoUpload; }, [onUpload, autoUpload]);
  useEffect(() => {
    const timer = setTimeout(() => { setEntries([]); setSelected({}); setCandidates({}); setNotice(''); }, 0);
    return () => clearTimeout(timer);
  }, [playlist?.key]);

  const request = async (config, route, data, method) => {
    const response = await fetch(`${config.url}${route}`, {
      method: method || (data ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${config.token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(route === '/inspect' || route === '/match' ? 180000 : 30000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `请求失败 ${response.status}`);
    return result;
  };
  const connect = async (config) => {
    const status = await request(config, '/status');
    if (!status.ready) throw new Error('电脑端下载工具尚未安装。请运行 npm run media:install。');
    setConnection(config);
    if (status.jobs?.length) setJob(status.jobs.at(-1));
    try { localStorage.setItem(CONNECTION_KEY, JSON.stringify(config)); } catch {}
    setNotice('下载服务已连接。');
  };
  useEffect(() => {
    active.current = true;
    Promise.resolve().then(async () => {
      try {
        if (window.electronAPI?.downloads) {
          await connect(await window.electronAPI.downloads.connect());
        } else {
          const saved = JSON.parse(localStorage.getItem(CONNECTION_KEY) || 'null');
          if (saved?.url && saved?.token) await connect(saved);
        }
      } catch (requestError) { if (active.current) setError(requestError.message); }
    });
    return () => { active.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchFile = async (config, task, file) => {
    const response = await fetch(`${config.url}/files/${task.id}/${encodeURIComponent(file.name)}`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`无法读取 MP3：${response.status}`);
    return new File([await response.blob()], file.name, { type: 'audio/mpeg' });
  };
  const transferFiles = async (config, task, forceCloud = false) => {
    if (transferBusy.current) return;
    transferBusy.current = true;
    try {
      for (const file of task.files) {
        if (!active.current) break;
        const key = `${task.id}:${file.name}`;
        if (Capacitor.isNativePlatform() && !handled.current.has(`local:${key}`)) {
          setTransfer(`保存到手机：${file.name}`);
          await NativeAudio.saveMp3({ url: `${config.url}/files/${task.id}/${encodeURIComponent(file.name)}`, token: config.token, fileName: file.name });
          handled.current.add(`local:${key}`);
        }
        if ((forceCloud || autoUploadRef.current) && currentUpload.current && !handled.current.has(`cloud:${key}`)) {
          setTransfer(`上传到 Google Drive：${file.name}`);
          await currentUpload.current(await fetchFile(config, task, file));
          handled.current.add(`cloud:${key}`);
        }
      }
      setTransfer(Capacitor.isNativePlatform() ? 'MP3 已保存到手机。' : 'MP3 已保存在电脑下载目录。');
      if (currentUpload.current && (forceCloud || autoUploadRef.current)) setTransfer('MP3 已上传到 Google Drive / Yungan Music。');
    } catch (requestError) { setError(`保存或上传失败：${requestError.message}；可以点击重试上传。`); }
    finally { transferBusy.current = false; }
  };
  useEffect(() => {
    if (!connection || !job || job.state !== 'running') return undefined;
    let inFlight = false;
    let alive = true;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await request(connection, `/jobs/${job.id}`);
        if (!alive) return;
        setJob(result);
        if (result.state !== 'running' && result.files.length) await transferFiles(connection, result);
      } catch (requestError) { if (alive) setError(`无法读取下载进度：${requestError.message}`); }
      finally { inFlight = false; }
    }, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [connection, job?.id, job?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const perform = async (action) => {
    setBusy(true); setError('');
    try { await action(); } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  const inspect = () => perform(async () => {
    const result = await request(connection, '/inspect', { url: playlist.url });
    setEntries(result.entries); setCandidates({});
    setSelected(Object.fromEntries(result.entries.map((entry, index) => [index, Boolean(entry.url)])));
    setNotice(`${result.title} · ${result.entries.length} 首。${result.notice || ''}`);
  });
  const match = (entry, index) => perform(async () => {
    const result = await request(connection, '/match', entry);
    setCandidates((value) => ({ ...value, [index]: result }));
  });
  const matchAll = () => perform(async () => {
    const next = [...entries];
    const nextSelection = { ...selected };
    let matched = 0;
    for (let index = 0; index < next.length; index++) {
      if (!next[index].search || next[index].url) continue;
      setNotice(`正在匹配 ${index + 1} / ${next.length}：${next[index].title}`);
      const result = await request(connection, '/match', next[index]);
      const recommendation = recommendSource(next[index], result);
      if (recommendation) {
        next[index] = { ...next[index], url: recommendation.url, matched: true };
        nextSelection[index] = true;
        matched++;
      } else setCandidates((value) => ({ ...value, [index]: result }));
      setEntries([...next]); setSelected({ ...nextSelection });
    }
    setNotice(`已推荐 ${matched} 个音源。请核对版本，再点击下载；未匹配的曲目可手动选择。`);
  });
  const saveFile = (file) => perform(async () => {
    if (Capacitor.isNativePlatform()) {
      await NativeAudio.saveMp3({ url: `${connection.url}/files/${job.id}/${encodeURIComponent(file.name)}`, token: connection.token, fileName: file.name });
      setTransfer(`已保存到手机下载目录：${file.name}`);
    } else {
      const data = await fetchFile(connection, job, file);
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  });

  return <section className="download-panel" aria-label="下载 MP3 并上传云端">
    <h2>下载 MP3 · 云端保存</h2>
    {!connection && <><p>安卓和网页连接电脑上的下载服务；电脑 Electron 版自动连接。电脑先运行 <code>npm run media:install</code>，再运行 <code>npm run media:server</code>，手机和电脑连接同一网络。</p>
      <form onSubmit={(event) => { event.preventDefault(); perform(async () => {
        const parsed = new URL(pairing.trim());
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !/^[a-f0-9]{48}$/.test(parsed.hash.slice(1))) throw new Error('请粘贴电脑显示的完整配对链接（含 # 后的配对码）。');
        await connect({ url: parsed.origin, token: parsed.hash.slice(1) });
      }); }}><label htmlFor="download-pairing">电脑配对链接<input id="download-pairing" value={pairing} onChange={(event) => setPairing(event.target.value)} placeholder="http://电脑IP:端口#配对码" type="text" autoComplete="off" /></label><button className="outline-button" disabled={busy || !pairing.trim()}>连接</button></form></>}
    {connection && <>
      {typeof window !== 'undefined' && window.electronAPI?.downloads && <div><button className="outline-button" onClick={() => perform(async () => {
        const result = await window.electronAPI.downloads.connect({ lan: true }); setMobileLinks(result.pairingLinks);
      })}>开启手机连接</button>{mobileLinks.map((pairingLink) => <p key={pairingLink}><code>{pairingLink}</code><button onClick={() => perform(() => navigator.clipboard.writeText(pairingLink))}>复制配对链接</button></p>)}</div>}
      <div className="download-actions"><button className="outline-button" disabled={busy || !playlist || job?.state === 'running'} onClick={inspect}>{busy ? '正在读取 / 搜索…' : '读取歌单曲目'}</button>
        {entries.some((entry) => entry.search) && <button className="outline-button" disabled={busy || job?.state === 'running'} onClick={matchAll}>批量匹配音源</button>}
        <button className="red-button" disabled={busy || job?.state === 'running' || !entries.some((entry, index) => selected[index] && entry.url)} onClick={() => perform(async () => {
          const result = await request(connection, '/jobs', { entries: entries.filter((entry, index) => selected[index] && entry.url) });
          setJob(result); setTransfer('');
        })}>下载所选为 MP3</button>
        <label><input type="checkbox" checked={autoUpload} onChange={(event) => setAutoUpload(event.target.checked)} /> 完成后自动上传 Drive</label>
      </div>
      {!onUpload && <p>上传云端需要登录 Google Drive。<button className="config-button" onClick={onGoogleLogin}>登录并连接云端</button></p>}
      {entries.length > 0 && <div className="download-track-list">{entries.map((entry, index) => <div className="download-track" key={`${index}:${entry.title}`}>
        <label><input type="checkbox" checked={Boolean(selected[index])} disabled={!entry.url} onChange={(event) => setSelected((value) => ({ ...value, [index]: event.target.checked }))} /><span><b>{entry.title}</b><small>{entry.artist}{entry.matched ? ' · 已匹配 YouTube 音源' : ''}</small></span></label>
        {entry.search && <button disabled={busy} onClick={() => match(entry, index)}>查找音源</button>}
        {entry.url && <a href={entry.url} target="_blank" rel="noopener noreferrer">核对音源 ↗</a>}
        {candidates[index] && <div className="download-candidates">{candidates[index].map((candidate) => <div key={candidate.url}><span>{candidate.title} · {candidate.artist} · {Math.round(candidate.duration / 60)} 分钟</span><a href={candidate.url} target="_blank" rel="noopener noreferrer">试听 ↗</a><button onClick={() => {
          setEntries((value) => value.map((item, position) => position === index ? { ...item, url: candidate.url, matched: true } : item));
          setSelected((value) => ({ ...value, [index]: true })); setCandidates((value) => ({ ...value, [index]: null }));
        }}>使用这个音源</button></div>)}</div>}
      </div>)}</div>}
      {job && <div className="download-job"><p>{job.state === 'running' ? `正在下载 / 转换：${job.title}` : job.state === 'complete' ? '下载完成' : job.state === 'cancelled' ? '下载已取消' : '部分音源下载失败'} · {job.progress}%</p><progress value={job.progress} max="100" />
        {job.state === 'running' && <button onClick={() => perform(() => request(connection, `/jobs/${job.id}`, null, 'DELETE'))}>取消下载</button>}
        {job.error && <p className="login-error">{job.error}</p>}
        {job.files.map((file) => <div className="download-file" key={file.name}><span>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span><button disabled={busy} onClick={() => saveFile(file)}>保存 MP3</button></div>)}
        {Boolean(job.files.length) && <button className="outline-button" disabled={!onUpload || busy || job.state === 'running'} onClick={() => transferFiles(connection, job, true)}>上传 / 重试上传到 Drive</button>}
      </div>}
      <button className="config-button" onClick={() => { setConnection(null); try { localStorage.removeItem(CONNECTION_KEY); } catch {} }}>更换下载服务</button>
    </>}
    {notice && <p role="status">{notice}</p>}{transfer && <p role="status">{transfer}</p>}{error && <p className="login-error" role="alert">{error}</p>}
  </section>;
}
