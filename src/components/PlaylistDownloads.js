import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { NativeAudio } from '../lib/native-audio';
import { recommendSource } from '../lib/source-matching';

const CONNECTION_KEY = 'yungan-download-connection';

export default function PlaylistDownloads({ playlist, onUpload, onGoogleLogin, uploadAccount = '' }) {
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
  const [nativePairing, setNativePairing] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [sourceChoice, setSourceChoice] = useState('original');
  const useSpotify = playlist?.provider === 'spotify' && sourceChoice === 'original';
  const canUpload = Boolean(onUpload);
  const handled = useRef(new Set());
  const transferBusy = useRef(false);
  const currentUpload = useRef(onUpload);
  const currentAccount = useRef(uploadAccount);
  const autoUploadRef = useRef(autoUpload);
  const active = useRef(true);
  useEffect(() => { currentUpload.current = onUpload; currentAccount.current = uploadAccount; autoUploadRef.current = autoUpload; }, [onUpload, uploadAccount, autoUpload]);
  useEffect(() => {
    const timer = setTimeout(() => { setEntries([]); setSelected({}); setCandidates({}); setNotice(''); setSourceChoice('original'); }, 0);
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
    if (!status.ready) throw new Error('下载组件尚未准备好，请联系应用管理员安装下载组件。');
    setConnection(config);
    if (status.jobs?.length) setJob(status.jobs.at(-1));
    if (!config.integrated) try { localStorage.setItem(CONNECTION_KEY, JSON.stringify(config)); } catch {}
    setNotice(config.integrated ? '下载功能已就绪。' : '下载服务已连接。');
  };
  const connectAutomatically = async () => {
    setConnecting(true); setError('');
    try {
      if (window.electronAPI?.downloads) await connect(await window.electronAPI.downloads.connect());
      else if (Capacitor.isNativePlatform()) {
        setNativePairing(true);
        const saved = JSON.parse(localStorage.getItem(CONNECTION_KEY) || 'null');
        if (saved?.url && saved?.token) await connect(saved);
      } else {
        const response = await fetch('/api/download/bootstrap', { signal: AbortSignal.timeout(10000), cache: 'no-store' });
        if (!response.ok) throw new Error('暂时无法连接下载功能，请稍后重试。');
        await connect(await response.json());
      }
    } catch (requestError) { if (active.current) setError(requestError.message); }
    finally { if (active.current) setConnecting(false); }
  };
  useEffect(() => {
    active.current = true;
    Promise.resolve().then(connectAutomatically);
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
        const account = currentAccount.current;
        const uploadFile = currentUpload.current;
        const cloudKey = `yungan-downloaded-upload:${account}:${key}`;
        try { if (account && localStorage.getItem(cloudKey) === 'complete') handled.current.add(`cloud:${account}:${key}`); } catch {}
        if (Capacitor.isNativePlatform() && !handled.current.has(`local:${key}`)) {
          setTransfer(`保存到手机：${file.name}`);
          await NativeAudio.saveMp3({ url: `${config.url}/files/${task.id}/${encodeURIComponent(file.name)}`, token: config.token, fileName: file.name });
          handled.current.add(`local:${key}`);
        }
        if ((forceCloud || autoUploadRef.current) && uploadFile && !handled.current.has(`cloud:${account}:${key}`)) {
          setTransfer(`上传到 Google Drive：${file.name}`);
          const audio = await fetchFile(config, task, file);
          if (currentAccount.current !== account || !active.current) break;
          await uploadFile(audio);
          handled.current.add(`cloud:${account}:${key}`);
          if (account) try { localStorage.setItem(cloudKey, 'complete'); } catch {}
          if (currentAccount.current !== account) break;
        }
      }
      if (!task.files.length) return;
      setTransfer(Capacitor.isNativePlatform() ? 'MP3 已保存到手机。' : config.integrated ? 'MP3 已生成，可点击保存到本机。' : 'MP3 已保存在电脑下载目录。');
      if (currentUpload.current && (forceCloud || autoUploadRef.current)) setTransfer('MP3 已上传到 Google Drive / Yungan Music。');
    } catch (requestError) { setError(`保存或上传失败：${requestError.message}；可以点击重试上传。`); }
    finally { transferBusy.current = false; }
  };
  useEffect(() => {
    if (!connection || job?.state === 'running' || !job?.files?.length || !canUpload || !autoUpload) return undefined;
    const timer = setTimeout(() => transferFiles(connection, job), 0);
    return () => clearTimeout(timer);
  }, [connection, job?.id, job?.state, canUpload, uploadAccount, autoUpload]); // eslint-disable-line react-hooks/exhaustive-deps
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
    <h2>{useSpotify ? 'Spotify 音源' : '下载 MP3 · 云端保存'}</h2>
    {playlist?.provider === 'spotify' && <div className="download-actions" role="group" aria-label="Spotify 歌单音源选择">
      <button className="outline-button" aria-pressed={sourceChoice === 'original'} onClick={() => setSourceChoice('original')}>Spotify 原平台播放</button>
      <button className="outline-button" aria-pressed={sourceChoice === 'youtube'} onClick={() => setSourceChoice('youtube')}>匹配 YouTube 音源并下载</button>
    </div>}
    {useSpotify && <p>在上方 Spotify 播放器中播放原音源。Spotify 原音频不提供 MP3 导出；需要 MP3 时，可选择匹配 YouTube 音源，下载前核对歌曲版本。</p>}
    {!useSpotify && playlist?.provider === 'spotify' && <p>当前下载来源：YouTube。Spotify 仅提供曲目清单；匹配结果可能是不同版本，请先试听核对。</p>}
    {!useSpotify && !connection && !nativePairing && <p>{connecting ? '正在准备下载功能…' : <button className="outline-button" onClick={connectAutomatically}>重新连接</button>}</p>}
    {!useSpotify && !connection && nativePairing && <><p>当前安卓版本需要连接电脑下载服务。</p>
      <form onSubmit={(event) => { event.preventDefault(); perform(async () => {
        const parsed = new URL(pairing.trim());
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !/^[a-f0-9]{48}$/.test(parsed.hash.slice(1))) throw new Error('请粘贴电脑显示的完整配对链接（含 # 后的配对码）。');
        await connect({ url: parsed.origin, token: parsed.hash.slice(1) });
      }); }}><label htmlFor="download-pairing">电脑配对链接<input id="download-pairing" value={pairing} onChange={(event) => setPairing(event.target.value)} placeholder="http://电脑IP:端口#配对码" type="text" autoComplete="off" /></label><button className="outline-button" disabled={busy || !pairing.trim()}>连接</button></form></>}
    {!useSpotify && connection && <>
      {typeof window !== 'undefined' && window.electronAPI?.downloads && <div><button className="outline-button" onClick={() => perform(async () => {
        const result = await window.electronAPI.downloads.connect({ lan: true }); setMobileLinks(result.pairingLinks);
      })}>开启手机连接</button>{mobileLinks.map((pairingLink) => <p key={pairingLink}><code>{pairingLink}</code><button onClick={() => perform(() => navigator.clipboard.writeText(pairingLink))}>复制配对链接</button></p>)}</div>}
      <div className="download-actions"><button className="outline-button" disabled={busy || !playlist || job?.state === 'running'} onClick={inspect}>{busy ? '正在读取 / 搜索…' : '读取歌单曲目'}</button>
        {entries.some((entry) => entry.search) && <button className="outline-button" disabled={busy || job?.state === 'running'} onClick={matchAll}>批量匹配 YouTube 音源</button>}
        <button className="red-button" disabled={busy || job?.state === 'running' || !entries.some((entry, index) => selected[index] && entry.url)} onClick={() => perform(async () => {
          const result = await request(connection, '/jobs', { entries: entries.filter((entry, index) => selected[index] && entry.url) });
          setJob(result); setTransfer('');
        })}>下载所选为 MP3</button>
        <label><input type="checkbox" checked={autoUpload} onChange={(event) => setAutoUpload(event.target.checked)} /> 完成后自动上传 Drive</label>
      </div>
      {!onUpload && <p>上传云端需要登录 Google Drive。<button className="config-button" onClick={onGoogleLogin}>登录并连接云端</button></p>}
      {entries.length > 0 && <div className="download-track-list">{entries.map((entry, index) => <div className="download-track" key={`${index}:${entry.title}`}>
        <label><input type="checkbox" checked={Boolean(selected[index])} disabled={!entry.url} onChange={(event) => setSelected((value) => ({ ...value, [index]: event.target.checked }))} /><span><b>{entry.title}</b><small>{entry.artist}{entry.matched ? ' · 已匹配 YouTube 音源' : ''}</small></span></label>
        {entry.search && <button disabled={busy} onClick={() => match(entry, index)}>查找 YouTube 音源</button>}
        {entry.url && <a href={entry.url} target="_blank" rel="noopener noreferrer">核对音源 ↗</a>}
        {candidates[index] && <div className="download-candidates">{candidates[index].map((candidate) => <div key={candidate.url}><span>{candidate.title} · {candidate.artist} · {Math.round(candidate.duration / 60)} 分钟</span><a href={candidate.url} target="_blank" rel="noopener noreferrer">试听 ↗</a><button onClick={() => {
          setEntries((value) => value.map((item, position) => position === index ? { ...item, url: candidate.url, matched: true } : item));
          setSelected((value) => ({ ...value, [index]: true })); setCandidates((value) => ({ ...value, [index]: null }));
        }}>使用这个音源</button></div>)}</div>}
      </div>)}</div>}
      {job && <div className="download-job"><p>{job.state === 'running' ? `${job.phase === 'convert' ? '正在转换 MP3' : '正在下载'}：${job.title}` : job.state === 'complete' ? '下载完成' : job.state === 'cancelled' ? '下载已取消' : job.state === 'failed' ? '下载失败，尚未生成 MP3' : '部分音源下载失败'}{job.state === 'running' ? ` · ${job.progress}%` : ` · 已完成 ${job.completed ?? job.files.length} / ${job.total ?? job.files.length}`}</p>{job.state !== 'failed' && <progress value={job.progress} max="100" />}
        {job.state === 'running' && <button onClick={() => perform(() => request(connection, `/jobs/${job.id}`, null, 'DELETE'))}>取消下载</button>}
        {job.error && <details className="login-error"><summary>失败详情（{job.failures?.length || 1} 首）</summary><p style={{ whiteSpace: 'pre-wrap' }}>{job.error}</p></details>}
        {Boolean(job.failures?.length) && job.state !== 'running' && <button className="outline-button" disabled={busy} onClick={() => perform(async () => { setJob(await request(connection, `/jobs/${job.id}/retry`, {})); setTransfer(''); })}>重试失败曲目</button>}
        {job.files.map((file) => <div className="download-file" key={file.name}><span>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span><button disabled={busy} onClick={() => saveFile(file)}>保存 MP3</button></div>)}
        {Boolean(job.files.length) && <button className="outline-button" disabled={!onUpload || busy || job.state === 'running'} onClick={() => transferFiles(connection, job, true)}>上传 / 重试上传到 Drive</button>}
      </div>}
      {nativePairing && <button className="config-button" onClick={() => { setConnection(null); try { localStorage.removeItem(CONNECTION_KEY); } catch {} }}>更换下载服务</button>}
    </>}
    {!useSpotify && notice && <p role="status">{notice}</p>}{!useSpotify && transfer && <p role="status">{transfer}</p>}{!useSpotify && error && <p className="login-error" role="alert">{error}</p>}
  </section>;
}
