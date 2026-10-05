import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { NativeDownloads, requestNativeDownload, authorizeNativeUpload } from '../lib/native-downloads';
import { recommendSource } from '../lib/source-matching';
import { transferDownloadedFiles } from '../lib/downloaded-transfers';
import { ACTIVE_STATES, normalizeDownloadJob, mergeDownloadJobs, downloadJobLabel, cloudPhase, cloudStatusLabel, nativeCloudConfig, needsNativeCloudUpload } from '../lib/download-job-state';
import MusicDiscovery from './MusicDiscovery';
import { downloadFailureReason, canonicalYoutubeSource, completedSourceUrls, replacementSearch } from '../lib/download-failure-policy';
import styles from './PlaylistDownloads.module.css';

export default function PlaylistDownloads({ playlist, playlistRevision = 0, onUpload, onRepairUpload, onGoogleLogin, uploadAccount = '', uploadEmail = '', onPlayOriginal, onPlayDownloaded, onLibraryChanged, sourceRadio, active: viewActive = true, discoveryMode = false, taste, playlists, onShowDownloads, onShowPlaylist }) {
  const [connection, setConnection] = useState(null);
  const [entries, setEntries] = useState([]);
  const [selected, setSelected] = useState({});
  const [candidates, setCandidates] = useState({});
  const [job, setJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [autoUpload, setAutoUpload] = useState(true);
  const [transfer, setTransfer] = useState('');
  const [transferRevision, setTransferRevision] = useState(0);
  const [mobileLinks, setMobileLinks] = useState([]);
  const [connecting, setConnecting] = useState(true);
  const [transferring, setTransferring] = useState(false);
  const [discoveredEntries, setDiscoveredEntries] = useState(false);
  const [failureCandidates, setFailureCandidates] = useState({});
  const [sourceReplacements, setSourceReplacements] = useState({});
  const runningJob = jobs.find((task) => ACTIVE_STATES.has(task.state));
  const canUpload = Boolean(onUpload);
  const handled = useRef(new Set());
  const transferBusy = useRef(false);
  const currentUpload = useRef(onUpload);
  const currentRepairUpload = useRef(onRepairUpload);
  const currentAccount = useRef(uploadAccount);
  const currentEmail = useRef(uploadEmail);
  const currentLibraryChanged = useRef(onLibraryChanged);
  const currentJobId = useRef(null);
  const currentJobs = useRef([]);
  const downloadedUrls = useRef(new Map());
  const nativeUploadRequests = useRef(new Set());
  const manualCloudJobs = useRef(new Set());
  const repairIntent = useRef(null);
  const autoUploadRef = useRef(autoUpload);
  const active = useRef(true);
  useEffect(() => { currentUpload.current = onUpload; currentRepairUpload.current = onRepairUpload; currentAccount.current = uploadAccount; currentEmail.current = uploadEmail; currentLibraryChanged.current = onLibraryChanged; autoUploadRef.current = autoUpload; }, [onUpload, onRepairUpload, uploadAccount, uploadEmail, onLibraryChanged, autoUpload]);
  useEffect(() => {
    const timer = setTimeout(() => { setEntries([]); setSelected({}); setCandidates({}); setNotice(''); setDiscoveredEntries(false); }, 0);
    return () => clearTimeout(timer);
  }, [playlist?.key, playlistRevision]);

  const request = async (config, route, data, method) => {
    if (!config) throw new Error('下载功能正在准备，请稍后重试。');
    if (config.native) return requestNativeDownload(route, data, method);
    const response = await fetch(`${config.url}${route}`, {
      method: method || (data ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${config.token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(['/inspect', '/match', '/search', '/radio'].includes(route) ? 180000 : 30000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `请求失败 ${response.status}`);
    return result;
  };
  const receiveJobs = (values, selectId) => {
    const next = mergeDownloadJobs(currentJobs.current, values);
    currentJobs.current = next;
    setJobs(next);
    const nextId = selectId || currentJobId.current;
    const selectedJob = next.find((item) => item.id === nextId) || (!nextId ? next[0] : null);
    if (selectedJob) { currentJobId.current = selectedJob.id; setJob(selectedJob); }
  };
  const selectJob = (value) => { const next = normalizeDownloadJob(value); if (!next) return; receiveJobs([next], next.id); setTransfer(''); };
  const connect = async (config) => {
    const status = await request(config, '/status');
    if (!status.ready) throw new Error(status.error || (config.native ? '下载功能暂时未能准备好，请重试。' : '下载组件尚未准备好，请联系应用管理员安装下载组件。'));
    setConnection(config);
    if (status.jobs?.length) receiveJobs(status.jobs);
    setNotice(config.native ? '' : config.integrated ? '下载功能已就绪。' : '下载服务已连接。');
  };
  const connectAutomatically = async () => {
    setConnecting(true); setError('');
    try {
      if (window.electronAPI?.downloads) await connect(await window.electronAPI.downloads.connect());
      else if (Capacitor.isNativePlatform()) await connect({ native: true, integrated: true });
      else {
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
    const localUrls = downloadedUrls.current;
    return () => { active.current = false; for (const item of localUrls.values()) URL.revokeObjectURL(item.url); localUrls.clear(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let alive = true;
    const listeners = [];
    const register = async () => {
      for (const [event, callback] of [
        ['jobChanged', (value) => receiveJobs([value.job || value])],
        ['libraryChanged', () => currentLibraryChanged.current?.()],
      ]) {
        try {
          const handle = await NativeDownloads.addListener(event, (value) => { if (alive) callback(value); });
          if (alive) listeners.push(handle); else await handle.remove();
        } catch (requestError) { if (alive) setError(`无法读取后台任务状态：${requestError.message}`); }
      }
    };
    register();
    return () => { alive = false; for (const listener of listeners) listener.remove(); };
  }, []);

  useEffect(() => {
    if (!connection?.native) return undefined;
    let alive = true;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const status = await request(connection, '/status');
        if (alive && status.jobs) receiveJobs(status.jobs);
      } catch (requestError) { if (alive) setError(`无法读取任务状态：${requestError.message}`); }
      finally { inFlight = false; }
    }, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [connection]);

  const fetchFile = async (config, task, file) => {
    if (config.native) {
      const result = await NativeDownloads.getFile({ jobId: task.id, fileName: file.name });
      const response = await fetch(Capacitor.convertFileSrc(result.uri));
      if (!response.ok) throw new Error('无法读取本机 MP3。');
      return new File([await response.blob()], file.displayName || file.name, { type: 'audio/mpeg' });
    }
    const response = await fetch(`${config.url}/files/${task.id}/${encodeURIComponent(file.name)}`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`无法读取 MP3：${response.status}`);
    return new File([await response.blob()], file.displayName || file.name, { type: 'audio/mpeg' });
  };
  const transferFiles = async (config, task, forceCloud = false, metadataOnly = false) => {
    if (config.native) {
      if (!currentAccount.current) { setTransfer('MP3 已保存在手机，连接 Google 账号后即可上传。'); return; }
      const cloud = nativeCloudConfig(true, currentAccount.current, currentEmail.current);
      manualCloudJobs.current.add(task.id);
      try {
        const updated = await request(config, `/jobs/${task.id}/upload`, { cloud });
        receiveJobs([updated]);
        setTransfer(cloudStatusLabel(updated.cloud));
      } finally { manualCloudJobs.current.delete(task.id); }
      return;
    }
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
        saveLocal: null,
        metadataOnly,
        onStatus: (phase, file) => setTransfer(`${phase === 'save' ? '保存到手机' : metadataOnly ? '更新云端歌曲信息' : '上传到 Google Drive'}：${file.metadata?.title || file.name}`),
      });
      if (!active.current || !result.total) return;
      if (result.interrupted) setTransfer('Google 账号已变更，正在重新检查上传任务。');
      else if (metadataOnly) setTransfer(`已更新 ${result.uploaded} / ${result.total} 首云端文件${result.skipped ? `，${result.skipped} 首未找到可靠信息已跳过` : ''}。${result.uploaded ? '保留原文件 ID。' : ''}`);
      else if (result.cloudRequested) setTransfer(`已上传 ${result.uploaded} / ${result.total} 首到 Google Drive / Yungan Music。`);
      else setTransfer(config.integrated ? 'MP3 已生成，可点击保存到本机。' : 'MP3 已保存在电脑下载目录。');
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
    if (!connection || connection.native || job?.metadataRepair || job?.state === 'running' || !job?.files?.length || !canUpload || !autoUpload) return undefined;
    const timer = setTimeout(() => transferFiles(connection, job), 0);
    return () => clearTimeout(timer);
  }, [connection, job?.id, job?.state, canUpload, uploadAccount, autoUpload, transferRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!connection?.native || !autoUpload || !uploadAccount) return undefined;
    let alive = true;
    const cloud = nativeCloudConfig(true, uploadAccount, uploadEmail);
    const resumeUploads = async () => {
      for (const task of jobs) {
        if (!alive) break;
        const key = `${task.id}:${cloud.accountId}`;
        if (manualCloudJobs.current.has(task.id) || nativeUploadRequests.current.has(key) || !needsNativeCloudUpload(task, cloud)) continue;
        nativeUploadRequests.current.add(key);
        try {
          const updated = await request(connection, `/jobs/${task.id}/upload`, { cloud });
          if (alive) receiveJobs([updated]);
        } catch (requestError) { if (alive) setError(`云端上传未开始：${requestError.message}，可以重试上传。`); }
      }
    };
    resumeUploads();
    return () => { alive = false; };
  }, [connection, jobs, autoUpload, uploadAccount, uploadEmail]);
  useEffect(() => {
    if (!connection || connection.native || !runningJob) return undefined;
    let inFlight = false;
    let alive = true;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await request(connection, `/jobs/${runningJob.id}`);
        if (!alive) return;
        receiveJobs([result]);
        if (result.state !== 'running' && result.files.length) {
          if (runningJob.phase === 'metadata' || result.metadataRepair) {
            await finishRepair(connection, result);
          } else await transferFiles(connection, result);
        }
      } catch (requestError) { if (alive) setError(`无法读取下载进度：${requestError.message}`); }
      finally { inFlight = false; }
    }, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [connection, runningJob?.id, runningJob?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const perform = async (action) => {
    setBusy(true); setError('');
    try { await action(); } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  const connectAndUpload = (task) => perform(async () => {
    if (!onGoogleLogin) throw new Error('暂时无法连接 Google 账号，本机 MP3 已保留。');
    setTransfer('正在确认 Google 授权…');
    manualCloudJobs.current.add(task.id);
    try {
      const updated = await authorizeNativeUpload(task.id, onGoogleLogin, (route, data) => request(connection, route, data));
      receiveJobs([updated]);
      setTransfer(cloudStatusLabel(updated.cloud));
    } catch (requestError) { setTransfer('本机 MP3 已保留，可以稍后重新确认授权并上传。'); throw requestError; }
    finally { manualCloudJobs.current.delete(task.id); }
  });
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
  const failureKey = (task, failure) => `${task.id}:${failure.url}`;
  const findFailureSource = (task, failure) => perform(async () => {
    const search = replacementSearch(failure);
    if (!search) throw new Error('这首歌曲缺少名称，请在发现音乐中搜索其他音源。');
    const result = await request(connection, '/match', { search });
    const used = completedSourceUrls(task.files);
    for (const item of task.failures) { try { used.add(canonicalYoutubeSource(item.url)); } catch { /* A stale source is rejected again by the server. */ } }
    const available = result.filter((candidate) => {
      try { return !used.has(canonicalYoutubeSource(candidate.url)); } catch { return false; }
    });
    setFailureCandidates((value) => ({ ...value, [failureKey(task, failure)]: available }));
  });
  const retryFailures = (task) => perform(async () => {
    const replacements = task.failures.flatMap((failure) => {
      const selectedSource = sourceReplacements[failureKey(task, failure)];
      return selectedSource ? [{ fromUrl: failure.url, url: selectedSource.url }] : [];
    });
    selectJob(await request(connection, `/jobs/${task.id}/retry`, { replacements }));
    setSourceReplacements((value) => Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith(`${task.id}:`))));
    setNotice('正在继续未完成的曲目，已下载歌曲会保留。');
  });
  const startDownload = async (tracks) => {
    if (!connection) throw new Error('下载功能正在准备，请稍后重试。');
    const result = await request(connection, '/jobs', { entries: tracks.map((entry) => ({
      url: entry.url, title: entry.title, artist: entry.artist, album: entry.album,
      duration: entry.duration, coverUrl: entry.coverUrl, matched: entry.matched,
      metadataProvider: entry.metadataProvider, spotifyId: entry.spotifyId,
    })), ...(connection.native ? { cloud: nativeCloudConfig(autoUploadRef.current, currentAccount.current, currentEmail.current) } : {}) });
    selectJob(result);
    onShowDownloads?.();
  };
  const downloadDiscovered = async (tracks) => {
    await startDownload(tracks);
    setEntries(tracks); setCandidates({}); setSelected(Object.fromEntries(tracks.map((entry, index) => [index, Boolean(entry.url)])));
    setDiscoveredEntries(true); setNotice('已开始下载所选发现歌曲，音源来自 YouTube。'); onShowDownloads?.();
  };
  const chooseSpotifyDiscovery = (track) => perform(async () => {
    const result = await request(connection, '/match', track);
    setEntries([track]); setCandidates({ 0: result }); setSelected({}); setDiscoveredEntries(true);
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
  const saveFile = (file, task = job) => perform(async () => {
    if (connection.native) {
      const result = await NativeDownloads.saveFile({ jobId: task.id, fileName: file.name });
      setTransfer(result.message || `已保存 MP3：${file.displayName || file.name}`);
      currentLibraryChanged.current?.();
    } else {
      const data = await fetchFile(connection, task, file);
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = data.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  });
  const playDownloaded = (file, task = job) => perform(async () => {
    if (!onPlayDownloaded) return;
    if (connection.native) {
      const result = await NativeDownloads.getFile({ jobId: task.id, fileName: file.name });
      await onPlayDownloaded({ ...file, localUri: result.uri }, task);
    } else {
      const key = `${task.id}:${file.name}`;
      let item = downloadedUrls.current.get(key);
      if (!item) {
        const blob = await fetchFile(connection, task, file);
        item = { blob, url: URL.createObjectURL(blob) };
        downloadedUrls.current.set(key, item);
      }
      await onPlayDownloaded({ ...file, localUri: item.url, blob: item.blob }, task);
    }
  });

  return <section className="download-panel" aria-label="下载 MP3 并上传云端">
    <div hidden={!discoveryMode}><MusicDiscovery taste={taste} playlists={playlists} incomingRadio={sourceRadio} viewActive={viewActive && discoveryMode} available={Boolean(connection)} canDownload={Boolean(connection) && !busy && (connection.native || !runningJob)} onSearch={(value) => request(connection, '/search', value)} onRadio={(value) => request(connection, '/radio', value)} onMatchTrack={(track) => request(connection, '/match', track)} onInspectSpotify={(url) => request(connection, '/inspect', { url })} onDownload={downloadDiscovered} onChooseSpotifyTrack={chooseSpotifyDiscovery} /></div>
    <h2>{discoveryMode ? '下载与保存' : '下载 MP3 · 云端保存'}</h2>
    {!discoveryMode && !playlist && !discoveredEntries && <p>先在上方粘贴歌单链接并导入，或从“我的歌单”选择一个歌单，也可以在“发现音乐”搜索歌曲。</p>}
    {!discoveryMode && !discoveredEntries && playlist?.provider === 'spotify' && <div className="download-actions" role="group" aria-label="Spotify 原平台播放">
      <button className="config-button" onClick={onPlayOriginal}>在 Spotify 原平台播放 ↗</button>
    </div>}
    {!discoveryMode && playlist?.provider === 'spotify' && <p>下载来源：YouTube。导入 Spotify 曲目后匹配音源，请核对歌曲版本。</p>}
    {!connection && <p>{connecting ? '正在准备下载功能…' : <button className="outline-button" onClick={connectAutomatically}>重试准备下载</button>}</p>}
    {connection && <>
      {typeof window !== 'undefined' && window.electronAPI?.downloads && <div><button className="outline-button" onClick={() => perform(async () => {
        const result = await window.electronAPI.downloads.connect({ lan: true }); setMobileLinks(result.pairingLinks);
      })}>开启手机连接</button>{mobileLinks.map((pairingLink) => <p key={pairingLink}><code>{pairingLink}</code><button onClick={() => perform(() => navigator.clipboard.writeText(pairingLink))}>复制配对链接</button></p>)}</div>}
      {!discoveryMode && <div className="download-actions"><button className="outline-button" disabled={busy || !playlist} onClick={inspect}>{busy ? '正在读取 / 搜索…' : '读取歌单曲目'}</button>
        {entries.some((entry) => entry.search) && <button className="outline-button" disabled={busy} onClick={matchAll}>批量匹配 YouTube 音源</button>}
        <button className="red-button" disabled={busy || (!connection.native && runningJob) || !entries.some((entry, index) => selected[index] && entry.url)} onClick={() => perform(() => startDownload(entries.filter((entry, index) => selected[index] && entry.url)))}>下载所选为 MP3</button>
        <label><input type="checkbox" checked={autoUpload && (!connection.native || Boolean(uploadAccount))} disabled={connection.native && !uploadAccount} onChange={(event) => setAutoUpload(event.target.checked)} /> {connection.native && !uploadAccount ? '自动上传 Drive（需连接账号）' : '完成后自动上传 Drive'}</label>
      </div>}
      {discoveryMode && <div className="download-actions"><label><input type="checkbox" checked={autoUpload && (!connection.native || Boolean(uploadAccount))} disabled={connection.native && !uploadAccount} onChange={(event) => setAutoUpload(event.target.checked)} /> {connection.native && !uploadAccount ? '自动上传 Drive（需连接账号）' : '下载完成后自动上传 Drive'}</label>{jobs.some((task) => ACTIVE_STATES.has(task.state)) && <button className="outline-button" onClick={onShowDownloads}>查看正在下载的任务</button>}</div>}
      {uploadAccount && <p>上传账号：{uploadEmail || '已验证的 Google 账号'}</p>}
      {!uploadAccount && <p>MP3 可以先保存到设备。<button className="config-button" onClick={onGoogleLogin}>连接 Google Drive 后上传</button></p>}
      {!discoveryMode && entries.length > 0 && <div className="download-track-list">{entries.map((entry, index) => <div className="download-track" key={`${index}:${entry.title}`}>
        <label><input type="checkbox" checked={Boolean(selected[index])} disabled={!entry.url} onChange={(event) => setSelected((value) => ({ ...value, [index]: event.target.checked }))} /><span><b>{entry.title}</b><small>{entry.artist}{entry.matched ? ' · 已匹配 YouTube 音源' : ''}</small></span></label>
        {entry.search && <button disabled={busy} onClick={() => match(entry, index)}>查找 YouTube 音源</button>}
        {entry.url && <a href={entry.url} target="_blank" rel="noopener noreferrer">核对音源 ↗</a>}
        {candidates[index] && <div className="download-candidates">{candidates[index].map((candidate) => <div key={candidate.url}><span>{candidate.title} · {candidate.artist} · {Math.round(candidate.duration / 60)} 分钟</span><a href={candidate.url} target="_blank" rel="noopener noreferrer">试听 ↗</a><button onClick={() => {
          setEntries((value) => value.map((item, position) => position === index ? { ...item, url: candidate.url, coverUrl: item.coverUrl || candidate.coverUrl, matched: true } : item));
          setSelected((value) => ({ ...value, [index]: true })); setCandidates((value) => ({ ...value, [index]: null }));
        }}>使用这个音源</button></div>)}</div>}
      </div>)}</div>}
      {!discoveryMode && jobs.length > 0 && <section className="download-task-list" aria-label="下载任务">
        <h3>下载任务 <small>{jobs.length}</small></h3>
        {connection.native && jobs.some((task) => ACTIVE_STATES.has(task.state) || cloudPhase(task.cloud) === 'uploading') && <p role="status">下载和上传会在后台继续，可以返回曲库听歌。</p>}
        {jobs.length > 1 && <div className="download-actions" role="group" aria-label="选择下载任务">{jobs.map((task) => <button className="outline-button" key={task.id} aria-pressed={job?.id === task.id} onClick={() => selectJob(task)}>{task.title || '歌曲下载'} · {downloadJobLabel(task)} · {task.completed} / {task.total}</button>)}</div>}
      </section>}
      {!discoveryMode && job && <div className="download-job"><p>{downloadJobLabel(job)}{ACTIVE_STATES.has(job.state) && job.title ? `：${job.title}` : ''}{ACTIVE_STATES.has(job.state) ? ` · ${job.progress}%` : ` · 已完成 ${job.completed} / ${job.total}`}</p>{job.state !== 'failed' && <progress aria-label="下载进度" value={job.progress} max="100" />}
        {ACTIVE_STATES.has(job.state) && <button className="outline-button" disabled={busy} onClick={() => perform(async () => receiveJobs([await request(connection, `/jobs/${job.id}`, null, 'DELETE')]))}>取消下载</button>}
        {Boolean(job.failures?.length) && !ACTIVE_STATES.has(job.state) && <section className={styles.failures} aria-label="未完成曲目">
          <h3>还有 {job.failures.length} 首未完成</h3><p>已下载的 {job.completed} 首会保留。更换音源会保留原歌曲名称、歌手和封面。</p>
          {job.failures.map((failure) => {
            const reason = downloadFailureReason(failure), key = failureKey(job, failure), selectedSource = sourceReplacements[key];
            return <article key={key} className={styles.failure}>
              <div><strong>{failure.title || '未完成歌曲'}</strong>{failure.artist && <span className={styles.artist}>{failure.artist}</span>}</div>
              <p className={styles.reason}>{reason.label}</p><p>{reason.detail}</p>
              <div className={styles.actions}><button className="outline-button" disabled={busy} onClick={() => findFailureSource(job, failure)}>查找其他音源</button><a href={failure.url} target="_blank" rel="noopener noreferrer">查看原音源 ↗</a></div>
              {failureCandidates[key] && <div className={styles.candidates}><p>候选来自 YouTube 搜索，请核对版本；继续下载时会确认是否可用。</p>
                {failureCandidates[key].length ? failureCandidates[key].map((candidate) => <div key={candidate.url} className={styles.candidate}>
                  <span><strong>{candidate.title}</strong><small>{candidate.artist}{candidate.duration ? ` · ${Math.round(candidate.duration)} 秒` : ''}</small></span>
                  <a href={candidate.url} target="_blank" rel="noopener noreferrer">核对版本 ↗</a>
                  <button className="outline-button" disabled={busy} aria-pressed={selectedSource?.url === candidate.url} onClick={() => setSourceReplacements((value) => ({ ...value, [key]: candidate }))}>{selectedSource?.url === candidate.url ? '已选择' : '选择此音源'}</button>
                </div>) : <p>未找到其他候选，可以在发现音乐中搜索其他版本。</p>}
              </div>}
              {selectedSource && <p className={styles.selection}>已选：{selectedSource.title}。点击下方按钮继续下载。</p>}
            </article>;
          })}
          <button className="red-button" disabled={busy || (!connection.native && Boolean(runningJob)) || job.failures.some((failure) => !downloadFailureReason(failure).canRetry && !sourceReplacements[failureKey(job, failure)])} onClick={() => retryFailures(job)}>{job.failures.some((failure) => sourceReplacements[failureKey(job, failure)]) ? '更换音源并继续' : '重试失败曲目'}</button>
          {job.failures.some((failure) => !downloadFailureReason(failure).canRetry && !sourceReplacements[failureKey(job, failure)]) && <p>请先为限制访问的曲目选择其他音源，再继续下载。</p>}
        </section>}
        {job.error && <details className="login-error"><summary>技术详情（{job.failures?.length || 1} 首）</summary><p style={{ whiteSpace: 'pre-wrap' }}>{job.error}</p></details>}
        {!connection.native && Boolean(job.files.length) && <div className="download-actions"><button className="outline-button" disabled={busy || transferring || !playlist || discoveredEntries || job.state === 'running'} onClick={() => perform(async () => {
          repairIntent.current = { id: job.id, account: currentAccount.current };
          let repairedJob;
          try { repairedJob = await request(connection, `/jobs/${job.id}/repair`, { playlistUrl: playlist.url }); receiveJobs([repairedJob]); }
          catch (requestError) { repairIntent.current = null; throw requestError; }
          setTransfer('');
          setNotice(currentAccount.current && currentRepairUpload.current ? `正在补全 MP3 信息和封面，完成后更新 ${uploadEmail || '当前 Google 账号'} 的云端原文件。` : '正在补全已下载 MP3 的歌曲信息和封面；登录后可更新云端文件。');
          if (repairedJob.state !== 'running') await finishRepair(connection, repairedJob);
        })}>补全已下载歌曲信息</button></div>}
        {job.metadataRepair && job.state !== 'running' && <p role="status">歌曲信息已补全 {job.metadataRepair.completed} / {job.metadataRepair.total} 首。{(Array.isArray(job.metadataRepair.unmatched) ? job.metadataRepair.unmatched.length : Number(job.metadataRepair.unmatched)) > 0 ? '部分歌曲未找到可靠匹配，保留原信息。' : ''}{(Array.isArray(job.metadataRepair.failures) ? job.metadataRepair.failures.length : Number(job.metadataRepair.failures)) > 0 ? '部分文件补全失败，可重新尝试。' : ''}</p>}
        {connection.native && Boolean(job.files.length) && <div className="download-cloud-status"><p role="status">{cloudStatusLabel(job.cloud)}{job.cloud?.email ? ` · ${job.cloud.email}` : ''}</p>{job.cloud?.error && <p className="login-error" role="alert">{job.cloud.error}</p>}
          {!uploadAccount || cloudPhase(job.cloud) === 'login' ? <button className="outline-button" disabled={busy || ACTIVE_STATES.has(job.state)} onClick={() => connectAndUpload(job)}>{cloudPhase(job.cloud) === 'login' ? '确认 Google 授权并续传' : '连接账号并上传'}</button> : <button className="outline-button" disabled={busy || ACTIVE_STATES.has(job.state) || ['uploading', 'pending'].includes(cloudPhase(job.cloud)) || (cloudPhase(job.cloud) === 'complete' && job.cloud?.accountId === uploadAccount)} onClick={() => perform(() => transferFiles(connection, job, true))}>{cloudPhase(job.cloud) === 'failed' ? '重试云端上传' : cloudPhase(job.cloud) === 'complete' && job.cloud?.accountId === uploadAccount ? '已上传到云端' : '上传到 Google Drive'}</button>}
        </div>}
        {!connection.native && Boolean(job.files.length) && (job.metadataRepair ? <button className="outline-button" disabled={!onRepairUpload || !uploadAccount || busy || transferring || job.state === 'running'} onClick={() => transferFiles(connection, job, true, true)}>更新 / 重试更新云端歌曲信息</button> : <button className="outline-button" disabled={!onUpload || busy || transferring || job.state === 'running'} onClick={() => transferFiles(connection, job, true)}>上传 / 重试上传到 Drive</button>)}
        {job.files.some((file) => file.metadataWarnings?.length) && <p role="status">{connection.native ? '部分封面尚未嵌入 MP3，已保留可播放的歌曲文件。' : '部分封面尚未嵌入 MP3，可重新补全歌曲信息后保存。'}</p>}
        {job.files.map((file) => <div className="download-file" key={file.name}><span title={file.name}>{file.metadata?.title || file.name}{file.metadata?.artist ? ` · ${file.metadata.artist}` : ''} · {(Number(file.size) / 1024 / 1024 || 0).toFixed(1)} MB{connection.native && file.cloud && <small>{cloudStatusLabel(file.cloud)}{file.cloud.error ? ` · ${file.cloud.error}` : ''}</small>}</span><div className="download-actions">{onPlayDownloaded && <button className="red-button" disabled={busy} onClick={() => playDownloaded(file)}>立即播放</button>}<button className="outline-button" disabled={busy || (!connection.native && job.state === 'running')} onClick={() => saveFile(file)}>{connection.native ? '保存到音乐目录' : '保存 MP3'}</button></div></div>)}
      </div>}
    </>}
    {notice && <p role="status">{notice}</p>}{transfer && <p role="status">{transfer}</p>}{error && <p className="login-error" role="alert">{error}</p>}
  </section>;
}
