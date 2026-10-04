import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { NativeAudio } from '../lib/native-audio';
import { recommendSource } from '../lib/source-matching';
import { transferDownloadedFiles } from '../lib/downloaded-transfers';
import MusicDiscovery from './MusicDiscovery';

const CONNECTION_KEY = 'yungan-download-connection';

export default function PlaylistDownloads({ playlist, playlistRevision = 0, onUpload, onRepairUpload, onGoogleLogin, uploadAccount = '', uploadEmail = '', onPlayOriginal, discoveryMode = false, taste, playlists, onShowDownloads, onShowPlaylist }) {
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
  const [transferRevision, setTransferRevision] = useState(0);
  const [mobileLinks, setMobileLinks] = useState([]);
  const [nativePairing, setNativePairing] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [sourceChoice, setSourceChoice] = useState('original');
  const [transferring, setTransferring] = useState(false);
  const [discoveredEntries, setDiscoveredEntries] = useState(false);
  const useSpotify = !discoveryMode && !discoveredEntries && playlist?.provider === 'spotify' && sourceChoice === 'original';
  const canUpload = Boolean(onUpload);
  const handled = useRef(new Set());
  const transferBusy = useRef(false);
  const currentUpload = useRef(onUpload);
  const currentRepairUpload = useRef(onRepairUpload);
  const currentAccount = useRef(uploadAccount);
  const repairIntent = useRef(null);
  const autoUploadRef = useRef(autoUpload);
  const active = useRef(true);
  useEffect(() => { currentUpload.current = onUpload; currentRepairUpload.current = onRepairUpload; currentAccount.current = uploadAccount; autoUploadRef.current = autoUpload; }, [onUpload, onRepairUpload, uploadAccount, autoUpload]);
  useEffect(() => {
    const timer = setTimeout(() => { setEntries([]); setSelected({}); setCandidates({}); setNotice(''); setSourceChoice('original'); setDiscoveredEntries(false); }, 0);
    return () => clearTimeout(timer);
  }, [playlist?.key, playlistRevision]);

  const request = async (config, route, data, method) => {
    const response = await fetch(`${config.url}${route}`, {
      method: method || (data ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${config.token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(['/inspect', '/match', '/search', '/radio'].includes(route) ? 180000 : 30000),
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
    return new File([await response.blob()], file.displayName || file.name, { type: 'audio/mpeg' });
  };
  const transferFiles = async (config, task, forceCloud = false, metadataOnly = false) => {
    if (!metadataOnly && task.metadataRepair) return;
    if (transferBusy.current) return;
    transferBusy.current = true; setTransferring(true);
    const startingAccount = currentAccount.current;
    setError('');
    try {
      let storage;
      try { storage = localStorage; } catch {}
      const result = await transferDownloadedFiles(task, {
        getAccount: () => currentAccount.current, getUpload: () => metadataOnly ? currentRepairUpload.current : currentUpload.current,
        shouldUpload: () => metadataOnly || forceCloud || autoUploadRef.current, isActive: () => active.current,
        fetchFile: (file) => fetchFile(config, task, file), handled: handled.current, storage,
        saveLocal: !metadataOnly && Capacitor.isNativePlatform() ? (file) => NativeAudio.saveMp3({ url: `${config.url}/files/${task.id}/${encodeURIComponent(file.name)}`, token: config.token, fileName: file.displayName || file.name }) : null,
        metadataOnly,
        onStatus: (phase, file) => setTransfer(`${phase === 'save' ? '保存到手机' : metadataOnly ? '更新云端歌曲信息' : '上传到 Google Drive'}：${file.metadata?.title || file.name}`),
      });
      if (!active.current || !result.total) return;
      if (result.interrupted) setTransfer('Google 账号已变更，正在重新检查上传任务。');
      else if (metadataOnly) setTransfer(`已更新 ${result.uploaded} / ${result.total} 首云端文件${result.skipped ? `，${result.skipped} 首未找到可靠信息已跳过` : ''}。${result.uploaded ? '保留原文件 ID。' : ''}`);
      else if (result.cloudRequested) setTransfer(`已上传 ${result.uploaded} / ${result.total} 首到 Google Drive / Yungan Music。`);
      else setTransfer(Capacitor.isNativePlatform() ? 'MP3 已保存到手机。' : config.integrated ? 'MP3 已生成，可点击保存到本机。' : 'MP3 已保存在电脑下载目录。');
    } catch (requestError) { if (active.current) setError(metadataOnly ? `云端歌曲信息更新失败：${requestError.message}；可以点击重试更新。` : `保存或上传失败：${requestError.message}；可以点击重试上传。`); }
    finally {
      transferBusy.current = false;
      if (active.current) setTransferring(false);
      if (active.current && startingAccount !== currentAccount.current) setTransferRevision((value) => value + 1);
    }
  };
  const finishRepair = async (config, task) => {
    const intent = repairIntent.current;
    repairIntent.current = null;
    if (intent?.id === task.id && intent.account && intent.account === currentAccount.current && currentRepairUpload.current) {
      setNotice('本地歌曲信息补全结束，正在更新云端原文件。');
      await transferFiles(config, task, true, true);
      if (active.current) setNotice('本地歌曲信息补全结束。');
    }
    else setNotice(currentAccount.current && currentRepairUpload.current ? '本地歌曲信息已补全，可点击“更新云端歌曲信息”保存到当前账号。' : '本地歌曲信息已补全，登录 Google Drive 后可更新云端文件。');
  };
  useEffect(() => {
    if (!connection || job?.metadataRepair || job?.state === 'running' || !job?.files?.length || !canUpload || !autoUpload) return undefined;
    const timer = setTimeout(() => transferFiles(connection, job), 0);
    return () => clearTimeout(timer);
  }, [connection, job?.id, job?.state, canUpload, uploadAccount, autoUpload, transferRevision]); // eslint-disable-line react-hooks/exhaustive-deps
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
        if (result.state !== 'running' && result.files.length) {
          if (job.phase === 'metadata' || result.metadataRepair) {
            await finishRepair(connection, result);
          } else await transferFiles(connection, result);
        }
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
    setEntries(result.entries); setCandidates({}); setDiscoveredEntries(false); onShowPlaylist?.();
    setSelected(Object.fromEntries(result.entries.map((entry, index) => [index, Boolean(entry.url)])));
    setNotice(`${result.title} · ${result.entries.length} 首。${result.notice || ''}`);
  });
  const match = (entry, index) => perform(async () => {
    const result = await request(connection, '/match', entry);
    setCandidates((value) => ({ ...value, [index]: result }));
  });
  const startDownload = async (tracks) => {
    if (!connection) throw new Error('请先连接下载服务。');
    const result = await request(connection, '/jobs', { entries: tracks.map((entry) => ({
      url: entry.url, title: entry.title, artist: entry.artist, album: entry.album,
      duration: entry.duration, coverUrl: entry.coverUrl, matched: entry.matched,
      metadataProvider: entry.metadataProvider, spotifyId: entry.spotifyId,
    })) });
    setJob(result); setTransfer('');
  };
  const downloadDiscovered = async (tracks) => {
    await startDownload(tracks);
    setEntries(tracks); setCandidates({}); setSelected(Object.fromEntries(tracks.map((entry, index) => [index, Boolean(entry.url)])));
    setDiscoveredEntries(true); setSourceChoice('youtube'); setNotice('已开始下载所选发现歌曲，音源来自 YouTube。'); onShowDownloads?.();
  };
  const chooseSpotifyDiscovery = (track) => perform(async () => {
    const result = await request(connection, '/match', track);
    setEntries([track]); setCandidates({ 0: result }); setSelected({}); setDiscoveredEntries(true); setSourceChoice('youtube');
    setNotice('已读取 Spotify 曲目。请选择并核对一个 YouTube 音源，再下载 MP3。'); onShowDownloads?.();
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
        next[index] = { ...next[index], url: recommendation.url, coverUrl: next[index].coverUrl || recommendation.coverUrl, matched: true };
        nextSelection[index] = true;
        matched++;
      } else setCandidates((value) => ({ ...value, [index]: result }));
      setEntries([...next]); setSelected({ ...nextSelection });
    }
    setNotice(`已推荐 ${matched} 个音源。请核对版本，再点击下载；未匹配的曲目可手动选择。`);
  });
  const saveFile = (file) => perform(async () => {
    if (Capacitor.isNativePlatform()) {
      await NativeAudio.saveMp3({ url: `${connection.url}/files/${job.id}/${encodeURIComponent(file.name)}`, token: connection.token, fileName: file.displayName || file.name });
      setTransfer(`已保存到手机下载目录：${file.displayName || file.name}`);
    } else {
      const data = await fetchFile(connection, job, file);
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = data.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  });

  return <section className="download-panel" aria-label="下载 MP3 并上传云端">
    {discoveryMode && <MusicDiscovery taste={taste} playlists={playlists} available={Boolean(connection)} canDownload={Boolean(connection) && !busy && job?.state !== 'running'} onSearch={(value) => request(connection, '/search', value)} onRadio={(value) => request(connection, '/radio', value)} onMatchTrack={(track) => request(connection, '/match', track)} onInspectSpotify={(url) => request(connection, '/inspect', { url })} onDownload={downloadDiscovered} onChooseSpotifyTrack={chooseSpotifyDiscovery} />}
    <h2>{discoveryMode ? '搜索与下载服务' : '下载 MP3 · 云端保存'}</h2>
    {!discoveryMode && !playlist && !discoveredEntries && <p>先在上方粘贴歌单链接并导入，或从“我的歌单”选择一个歌单，也可以在“发现音乐”搜索歌曲。</p>}
    {!discoveryMode && !discoveredEntries && playlist?.provider === 'spotify' && <div className="download-actions" role="group" aria-label="Spotify 歌单音源选择">
      <button className="outline-button" aria-pressed={sourceChoice === 'original'} onClick={() => { setSourceChoice('original'); onPlayOriginal?.(); }}>Spotify 原平台播放 ↗</button>
      <button className="outline-button" aria-pressed={sourceChoice === 'youtube'} onClick={() => setSourceChoice('youtube')}>匹配 YouTube 下载 MP3</button>
    </div>}
    {useSpotify && <p>Spotify 原音频不提供 MP3 导出。选择“Spotify 原平台播放”听原音源；需要 MP3 时，选择“匹配 YouTube 下载 MP3”并核对歌曲版本。</p>}
    {!discoveryMode && !useSpotify && playlist?.provider === 'spotify' && <p>当前下载来源：YouTube。Spotify 仅提供曲目清单；匹配结果可能是不同版本，请先试听核对。</p>}
    {!useSpotify && !connection && !nativePairing && <p>{connecting ? '正在准备下载功能…' : <button className="outline-button" onClick={connectAutomatically}>重新连接</button>}</p>}
    {!useSpotify && !connection && nativePairing && <><p>连接下载服务后即可读取曲目、下载 MP3。当前安卓版本需要连接同一网络的电脑下载服务。</p>
      <form onSubmit={(event) => { event.preventDefault(); perform(async () => {
        const parsed = new URL(pairing.trim());
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !/^[a-f0-9]{48}$/.test(parsed.hash.slice(1))) throw new Error('请粘贴电脑显示的完整配对链接（含 # 后的配对码）。');
        await connect({ url: parsed.origin, token: parsed.hash.slice(1) });
      }); }}><label htmlFor="download-pairing">电脑配对链接<input id="download-pairing" value={pairing} onChange={(event) => setPairing(event.target.value)} placeholder="http://电脑IP:端口#配对码" type="text" autoComplete="off" /></label><button className="outline-button" disabled={busy || !pairing.trim()}>连接</button></form></>}
    {!useSpotify && connection && <>
      {typeof window !== 'undefined' && window.electronAPI?.downloads && <div><button className="outline-button" onClick={() => perform(async () => {
        const result = await window.electronAPI.downloads.connect({ lan: true }); setMobileLinks(result.pairingLinks);
      })}>开启手机连接</button>{mobileLinks.map((pairingLink) => <p key={pairingLink}><code>{pairingLink}</code><button onClick={() => perform(() => navigator.clipboard.writeText(pairingLink))}>复制配对链接</button></p>)}</div>}
      {!discoveryMode && <div className="download-actions"><button className="outline-button" disabled={busy || !playlist || job?.state === 'running'} onClick={inspect}>{busy ? '正在读取 / 搜索…' : '读取歌单曲目'}</button>
        {entries.some((entry) => entry.search) && <button className="outline-button" disabled={busy || job?.state === 'running'} onClick={matchAll}>批量匹配 YouTube 音源</button>}
        <button className="red-button" disabled={busy || job?.state === 'running' || !entries.some((entry, index) => selected[index] && entry.url)} onClick={() => perform(() => startDownload(entries.filter((entry, index) => selected[index] && entry.url)))}>下载所选为 MP3</button>
        <label><input type="checkbox" checked={autoUpload} onChange={(event) => setAutoUpload(event.target.checked)} /> 完成后自动上传 Drive</label>
      </div>}
      {discoveryMode && <div className="download-actions"><label><input type="checkbox" checked={autoUpload} onChange={(event) => setAutoUpload(event.target.checked)} /> 下载完成后自动上传 Drive</label>{job?.state === 'running' && <button className="outline-button" onClick={onShowDownloads}>查看正在下载的任务</button>}</div>}
      {onUpload && uploadAccount && <p>上传账号：{uploadEmail || '已验证的 Google 账号'}</p>}
      {!onUpload && <p>上传云端需要登录 Google Drive。<button className="config-button" onClick={onGoogleLogin}>登录并连接云端</button></p>}
      {!discoveryMode && entries.length > 0 && <div className="download-track-list">{entries.map((entry, index) => <div className="download-track" key={`${index}:${entry.title}`}>
        <label><input type="checkbox" checked={Boolean(selected[index])} disabled={!entry.url} onChange={(event) => setSelected((value) => ({ ...value, [index]: event.target.checked }))} /><span><b>{entry.title}</b><small>{entry.artist}{entry.matched ? ' · 已匹配 YouTube 音源' : ''}</small></span></label>
        {entry.search && <button disabled={busy} onClick={() => match(entry, index)}>查找 YouTube 音源</button>}
        {entry.url && <a href={entry.url} target="_blank" rel="noopener noreferrer">核对音源 ↗</a>}
        {candidates[index] && <div className="download-candidates">{candidates[index].map((candidate) => <div key={candidate.url}><span>{candidate.title} · {candidate.artist} · {Math.round(candidate.duration / 60)} 分钟</span><a href={candidate.url} target="_blank" rel="noopener noreferrer">试听 ↗</a><button onClick={() => {
          setEntries((value) => value.map((item, position) => position === index ? { ...item, url: candidate.url, coverUrl: item.coverUrl || candidate.coverUrl, matched: true } : item));
          setSelected((value) => ({ ...value, [index]: true })); setCandidates((value) => ({ ...value, [index]: null }));
        }}>使用这个音源</button></div>)}</div>}
      </div>)}</div>}
      {!discoveryMode && job && <div className="download-job"><p>{job.state === 'running' ? `${job.phase === 'metadata' ? '正在补全歌曲信息' : job.phase === 'convert' ? '正在转换 MP3' : '正在下载'}：${job.title}` : job.state === 'complete' ? '下载完成' : job.state === 'cancelled' ? '下载已取消' : job.state === 'failed' ? '下载失败，尚未生成 MP3' : '部分音源下载失败'}{job.state === 'running' ? ` · ${job.progress}%` : ` · 已完成 ${job.completed ?? job.files.length} / ${job.total ?? job.files.length}`}</p>{job.state !== 'failed' && <progress value={job.progress} max="100" />}
        {job.state === 'running' && <button onClick={() => perform(() => request(connection, `/jobs/${job.id}`, null, 'DELETE'))}>取消下载</button>}
        {job.error && <details className="login-error"><summary>失败详情（{job.failures?.length || 1} 首）</summary><p style={{ whiteSpace: 'pre-wrap' }}>{job.error}</p></details>}
        {Boolean(job.failures?.length) && job.state !== 'running' && <button className="outline-button" disabled={busy} onClick={() => perform(async () => { setJob(await request(connection, `/jobs/${job.id}/retry`, {})); setTransfer(''); })}>重试失败曲目</button>}
        {Boolean(job.files.length) && <div className="download-actions"><button className="outline-button" disabled={busy || transferring || !playlist || discoveredEntries || job.state === 'running'} onClick={() => perform(async () => {
          repairIntent.current = { id: job.id, account: currentAccount.current };
          let repairedJob;
          try { repairedJob = await request(connection, `/jobs/${job.id}/repair`, { playlistUrl: playlist.url }); setJob(repairedJob); }
          catch (requestError) { repairIntent.current = null; throw requestError; }
          setTransfer('');
          setNotice(currentAccount.current && currentRepairUpload.current ? `正在补全 MP3 信息和封面，完成后更新 ${uploadEmail || '当前 Google 账号'} 的云端原文件。` : '正在补全已下载 MP3 的歌曲信息和封面；登录后可更新云端文件。');
          if (repairedJob.state !== 'running') await finishRepair(connection, repairedJob);
        })}>补全已下载歌曲信息</button></div>}
        {job.metadataRepair && job.state !== 'running' && <p role="status">歌曲信息已补全 {job.metadataRepair.completed} / {job.metadataRepair.total} 首。{(Array.isArray(job.metadataRepair.unmatched) ? job.metadataRepair.unmatched.length : Number(job.metadataRepair.unmatched)) > 0 ? '部分歌曲未找到可靠匹配，保留原信息。' : ''}{(Array.isArray(job.metadataRepair.failures) ? job.metadataRepair.failures.length : Number(job.metadataRepair.failures)) > 0 ? '部分文件补全失败，可重新尝试。' : ''}</p>}
        {Boolean(job.files.length) && (job.metadataRepair ? <button className="outline-button" disabled={!onRepairUpload || !uploadAccount || busy || transferring || job.state === 'running'} onClick={() => transferFiles(connection, job, true, true)}>更新 / 重试更新云端歌曲信息</button> : <button className="outline-button" disabled={!onUpload || busy || transferring || job.state === 'running'} onClick={() => transferFiles(connection, job, true)}>上传 / 重试上传到 Drive</button>)}
        {job.files.some((file) => file.metadataWarnings?.length) && <p role="status">部分封面尚未嵌入 MP3，可重新补全歌曲信息后保存。</p>}
        {job.files.map((file) => <div className="download-file" key={file.name}><span title={file.name}>{file.metadata?.title || file.name}{file.metadata?.artist ? ` · ${file.metadata.artist}` : ''} · {(file.size / 1024 / 1024).toFixed(1)} MB</span><button disabled={busy || job.state === 'running'} onClick={() => saveFile(file)}>保存 MP3</button></div>)}
      </div>}
      {nativePairing && <button className="config-button" onClick={() => { setConnection(null); try { localStorage.removeItem(CONNECTION_KEY); } catch {} }}>更换下载服务</button>}
    </>}
    {!useSpotify && notice && <p role="status">{notice}</p>}{!useSpotify && transfer && <p role="status">{transfer}</p>}{!useSpotify && error && <p className="login-error" role="alert">{error}</p>}
  </section>;
}
