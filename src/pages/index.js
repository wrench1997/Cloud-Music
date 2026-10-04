'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { NativeAudio } from '../lib/native-audio';
import { App } from '@capacitor/app';
import OnlinePlaylists from '../components/OnlinePlaylists';
import AppSettings from '../components/AppSettings';
import MobileNavigation from '../components/MobileNavigation';
import { useAppUpdates } from '../components/AppUpdates';
import SongArtwork from '../components/SongArtwork';
import SeekBar from '../components/SeekBar';
import PlaybackModeControl from '../components/PlaybackModeControl';
import { playbackMode, nativePlaybackMode, nextTrackIndex, shuffleBag, seekPosition } from '../lib/playback-policy';
import { createGoogleDriveApi, isMusicFile, MUSIC_ACCEPT, ROOT_FOLDER, normalizeState } from '../lib/google-drive';
import { locationKey, normalizeFolderPath, openVerifiedGoogleLibrary } from '../lib/google-library';
import { createGoogleLoginRecovery, isTransientError } from '../lib/google-login-recovery';
import { prepareGoogleSignIn, connectGoogle, getGoogleAccessToken, selectGoogleAccount, disconnectGoogle, importGoogleConfig, configureGoogle, openGoogleSetup } from '../lib/google-auth';

const icons = {
  logo: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm3.5 11.4a3.2 3.2 0 1 1-1.7-2.83V6.3l4.2-.95v5.25a3.2 3.2 0 0 1-2.5 2.8Z',
  home: 'M3 11.3 12 4l9 7.3V20h-6v-5H9v5H3v-8.7Z',
  folder: 'M3 5h7l2 2h9v13H3V5Zm2 2v11h14V9h-7L10 7H5Z',
  radio: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-7.1.1a10 10 0 0 0 0 7.8l-1.8.9a12 12 0 0 1 0-9.6l1.8.9Zm14.2 0 1.8-.9a12 12 0 0 1 0 9.6l-1.8-.9a10 10 0 0 0 0-7.8Z',
  heart: 'M12 20.4 4.2 13A5.1 5.1 0 0 1 11.4 5.8l.6.7.6-.7A5.1 5.1 0 0 1 19.8 13L12 20.4Z',
  history: 'M12 4a8 8 0 1 1-7.4 5H2l3.4-3.6L9 9H6.7A6 6 0 1 0 12 6V4Zm-1 4h2v4.6l3 1.7-1 1.7-4-2.3V8Z',
  search: 'M10.7 4a6.7 6.7 0 1 1 0 13.4A6.7 6.7 0 0 1 10.7 4Zm0 2a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4Zm5.8 9.1 4 4-1.4 1.4-4-4 1.4-1.4Z',
  play: 'M8 5v14l11-7L8 5Z',
  pause: 'M7 5h4v14H7V5Zm6 0h4v14h-4V5Z',
  previous: 'M6 5h2v14H6V5Zm3 7 9-7v14l-9-7Z',
  next: 'M16 5h2v14h-2V5ZM6 19V5l9 7-9 7Z',
  volume: 'M4 9h4l5-4v14l-5-4H4V9Zm12.5-1.8a7 7 0 0 1 0 9.6l-1.4-1.4a5 5 0 0 0 0-6.8l1.4-1.4Z',
  list: 'M5 6h14v2H5V6Zm0 5h14v2H5v-2Zm0 5h14v2H5v-2Z',
  order: 'M4 6h11V3l5 4-5 4V8H4V6Zm0 10h11v-3l5 4-5 4v-3H4v-2Z',
  queue: 'M4 5h16v2H4V5Zm0 5h16v2H4v-2Zm0 5h9v2H4v-2Zm12-1 6 4-6 4v-8Z',
  refresh: 'M18.6 6.4A8 8 0 1 0 20 15h-2.1A6 6 0 1 1 17 8l-3 3h7V4l-2.4 2.4Z',
  upload: 'M11 15V7L8 10 6.6 8.6 12 3.2l5.4 5.4L16 10l-3-3v8h-2ZM4 16h2v3h12v-3h2v5H4v-5Z',
  logout: 'M10 4H4v16h6v-2H6V6h4V4Zm4.6 3.6L13.2 9l2 2H9v2h6.2l-2 2 1.4 1.4L19 12l-4.4-4.4Z',
  repeat: 'M7 7h10l-2-2 1.4-1.4L20.8 8l-4.4 4.4L15 11l2-2H7a3 3 0 0 0-3 3H2a5 5 0 0 1 5-5Zm10 10H7l2 2-1.4 1.4L3.2 16l4.4-4.4L9 13l-2 2h10a3 3 0 0 0 3-3h2a5 5 0 0 1-5 5Z',
  shuffle: 'M17 3h4v4l-1.6-1.6-5.2 5.2-1.4-1.4L18 4 17 3ZM3 5h3l12 14-1 1h4v-4l-1.6 1.6L7 3H3v2Zm0 14h4l4-4.6-1.4-1.5L6 17H3v2Z',
  close: 'm6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z',
  settings: 'M12 2l2.2 3.2 3.8-.3.3 3.8L22 11v2l-3.7 2.3-.3 3.8-3.8-.3L12 22l-2.2-3.2-3.8.3-.3-3.8L2 13v-2l3.7-2.3.3-3.8 3.8.3L12 2Zm0 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
};

function Icon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={icons[name]} />
    </svg>
  );
}

function formatTime(seconds) {
  if (!Number.isFinite(Number(seconds))) return '00:00';
  const value = Math.max(0, Math.floor(Number(seconds)));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function formatStorage(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

const stateKey = (session) => `yungan-state:google:${session.accountId}`;

function GoogleLogo() {
  return <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.4Z" /><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4H3.1v2.6A10 10 0 0 0 12 22Z" /><path fill="#FBBC05" d="M6.4 14.1a6 6 0 0 1 0-4.2V7.3H3.1a10 10 0 0 0 0 9.4l3.3-2.6Z" /><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.9 5.3l3.3 2.6A6 6 0 0 1 12 5.9Z" /></svg>;
}

function Login({ onOnlinePlaylists, onGoogleLogin, onImportConfig, onConfigure, onOpenSetup, onToggleSetup, loginEmail, onLoginEmail, showSetup, setupMessage, googleReady, googleConfigured, isDesktop, isNative, rememberedLogin, restoringLogin, busy, error }) {
  const [configText, setConfigText] = useState('');
  const submitConfig = async (event) => {
    event.preventDefault();
    if (await onConfigure(configText)) setConfigText('');
  };
  return (
    <main className="login-page">
      <section className={`login-card${showSetup ? ' setup-open' : ''}`}>
        <div className="login-logo"><Icon name="logo" size={34} /></div>
        <p className="eyebrow">YUNGAN MUSIC</p>
        <h1>登录 Google，打开目录</h1>
        <p className="login-hint">{rememberedLogin ? '已记住 Google 账号，恢复连接后即可打开音乐目录。' : '验证你的 Google 账号后，进入 Drive 文件夹，选择自己的音乐播放。'}</p>
        <ol className="login-steps"><li><span>1</span>Google 登录验证</li><li><span>2</span>打开音乐目录</li><li><span>3</span>选歌播放</li></ol>
        <div className="google-login">
          {googleReady && !isDesktop && !isNative && <label>Google 账号邮箱（可选）<input type="email" value={loginEmail} onChange={(event) => onLoginEmail(event.target.value)} placeholder="填写要连接的 Google 账号，留空可选择账号" disabled={busy} autoComplete="email" /></label>}
          <button className="google-button" onClick={onGoogleLogin} disabled={busy || !googleReady || restoringLogin}><GoogleLogo />{restoringLogin ? '正在恢复登录…' : busy ? '正在连接 Google…' : !googleReady ? '正在准备 Google 登录…' : rememberedLogin ? '恢复已登录账号' : '使用 Google 账号登录'}</button>
          {googleReady && !googleConfigured && <p className="setup-hint">首次连接需要一次 Google 应用配置。点击登录会打开 Google 官方设置页面，完成后就能进入音乐目录。</p>}
          <div className="config-actions">
            {isDesktop && <button className="config-button" onClick={onImportConfig} disabled={busy}>{googleConfigured ? '更换配置并登录' : '已有配置？导入并登录'}</button>}
            <button className="config-button" onClick={onToggleSetup} disabled={busy || !googleReady} aria-expanded={showSetup} aria-controls="google-setup">{showSetup ? '收起连接设置' : googleConfigured ? 'Google 连接设置' : '首次连接设置'}</button>
          </div>
        </div>
        {showSetup && <section className="google-setup" id="google-setup" aria-labelledby="google-setup-title">
          <h2 id="google-setup-title">连接你的 Google Drive</h2>
          <p className="setup-intro">Google 需要先识别“云感音乐”这个应用。配置只需做一次，之后点击登录即可授权。</p>
          <ol className="setup-steps">
            <li><b>登录 Google，创建项目</b><p>在 Google Cloud 中创建一个项目，例如 Yungan Music。</p><button type="button" onClick={() => onOpenSetup('console')} disabled={busy}>打开 Google 官方设置 ↗</button></li>
            <li><b>启用 Google Drive API</b><p>选择刚创建的项目，开启 Drive API，让应用读取音乐目录。</p><button type="button" onClick={() => onOpenSetup('drive')} disabled={busy}>打开 Drive API 设置 ↗</button></li>
            <li><b>创建应用登录配置</b><p>在 Google Auth Platform 中配置应用，选择“外部用户”，将自己的邮箱加入测试用户。数据访问添加 drive.readonly 和 drive.file 两项权限。</p><p>{isNative ? '创建 Android 客户端，登记包名 com.music.player 和 APK 的签名 SHA-1。' : isDesktop ? '创建“桌面应用 / Desktop app”客户端，下载 JSON 配置。' : '创建“Web 应用 / Web application”客户端，复制客户端 ID 或下载 JSON。'}</p>{!isDesktop && !isNative && <p>已授权 JavaScript 来源填写：<code>{typeof window !== 'undefined' ? window.location.origin : ''}</code></p>}<button type="button" onClick={() => onOpenSetup('clients')} disabled={busy}>打开客户端设置 ↗</button></li>
            {!isNative && <li><b>{isDesktop ? '导入配置，立即登录' : '保存配置，返回登录'}</b>
              {isDesktop && <button type="button" className="setup-import" onClick={onImportConfig} disabled={busy}>选择 JSON 并登录</button>}
              <form onSubmit={submitConfig}>
                <label htmlFor="google-client-config">{isDesktop ? '或粘贴桌面客户端 JSON' : 'Web 客户端 ID 或 JSON'}</label>
                <textarea id="google-client-config" rows={isDesktop ? 4 : 3} value={configText} onChange={(event) => setConfigText(event.target.value)} placeholder={isDesktop ? '粘贴从 Google 下载的完整 JSON 配置' : '粘贴 Web 客户端 ID 或完整 JSON 配置'} disabled={busy} autoComplete="off" spellCheck={false} />
                <button type="submit" className="setup-submit" disabled={busy || !configText.trim()}>{isDesktop ? '保存配置并登录' : '保存配置'}</button>
              </form>
            </li>}
          </ol>
        </section>}
        {setupMessage && <p className="setup-message" role="status">{setupMessage}</p>}
        {error && <p className="login-error" role="alert">{error}</p>}
        <p className="login-safe">授权读取 Drive 目录和音乐；上传与播放记录保存在应用曲库中。Google 密码由 Google 管理。</p>
        <div className="online-login-entry"><button className="outline-button" onClick={onOnlinePlaylists} disabled={busy}>歌单下载 · Spotify / YouTube Music</button><p>粘贴歌单链接即可打开，无需 Google Drive 登录或 JSON 配置。</p></div>
      </section>
    </main>
  );
}

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const { hasUpdate } = useAppUpdates();
  const [showOnlinePlaylists, setShowOnlinePlaylists] = useState(false);
  const [onlineMode, setOnlineMode] = useState('download');
  const [savingSong, setSavingSong] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState('');
  const [credentials, setCredentials] = useState(null);
  const [songs, setSongs] = useState([]);
  const [folders, setFolders] = useState([]);
  const [folderPath, setFolderPath] = useState([ROOT_FOLDER]);
  const [playbackQueue, setPlaybackQueue] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.72);
  const [showVolume, setShowVolume] = useState(false);
  const [activeNav, setActiveNav] = useState('云端曲库');
  const [isNative, setIsNative] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [playMode, setPlayMode] = useState('order');
  const [favorites, setFavorites] = useState([]);
  const [recent, setRecent] = useState([]);
  const [driveApi, setDriveApi] = useState(null);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [rememberedLogin, setRememberedLogin] = useState(false);
  const [restoringLogin, setRestoringLogin] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showGoogleSetup, setShowGoogleSetup] = useState(false);
  const [setupMessage, setSetupMessage] = useState('');
  const [storageQuota, setStorageQuota] = useState(null);
  const [audioSrc, setAudioSrc] = useState('');
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [trackReady, setTrackReady] = useState(false);
  const [upload, setUpload] = useState(null);
  const [syncStatus, setSyncStatus] = useState('');
  const audioRef = useRef(null);
  const contentRef = useRef(null);
  const nativeLoadedRef = useRef(false);
  const nativeQueueRef = useRef([]);
  const uploadInputRef = useRef(null);
  const uploadControllerRef = useRef(null);
  const repairSongsRef = useRef(null);
  const playbackControllerRef = useRef(null);
  const playbackRequestRef = useRef(0);
  const blobUrlRef = useRef('');
  const sessionGenerationRef = useRef(0);
  const musicStateRef = useRef({ favorites: [], recent: [] });
  const syncRevisionRef = useRef(0);
  const playerActionsRef = useRef({});
  const directoryRequestRef = useRef(0);
  const folderPathRef = useRef([ROOT_FOLDER]);
  const loginRecoveryRef = useRef(null);
  const startLoginRecoveryRef = useRef(null);
  const rememberedLoginRef = useRef(false);
  const automaticRestoreAllowedRef = useRef(true);
  const loginRecoveryCycleRef = useRef(0);
  const googleLoginRef = useRef(null);
  const playModeRef = useRef('order');
  const shuffleRef = useRef({ key: '', remaining: [], history: [] });
  const seekingRef = useRef(false);
  const seekRequestRef = useRef(null);
  const seekRevisionRef = useRef(0);
  const modeChangingRef = useRef(0);

  const api = credentials ? driveApi : null;
  const isGoogle = credentials?.provider === 'google';
  const accountName = credentials?.username || '我的账号';
  const effectiveDuration = duration > 0 ? duration : Number(currentSong?.duration) || 0;

  useEffect(() => {
    let active = true;
    Promise.resolve().then(async () => {
      let saved = 'order';
      try { saved = playbackMode(localStorage.getItem('yungan-playback-mode')).id; } catch {}
      if (Capacitor.isNativePlatform()) {
        try {
          const state = await NativeAudio.getState();
          saved = nativePlaybackMode(state.repeatMode, state.shuffleEnabled);
        } catch {}
      }
      if (active) { playModeRef.current = saved; setPlayMode(saved); }
    });
    return () => { active = false; };
  }, []);

  const updatePlaybackPosition = useCallback((position) => {
    if (seekingRef.current) return;
    const pending = seekRequestRef.current;
    if (pending && pending.songId === currentSong?.id && Date.now() < pending.until && Math.abs(position - pending.position) > 2) return;
    seekRequestRef.current = null;
    setProgress(Math.max(0, position));
  }, [currentSong?.id]);

  const beginSeek = useCallback(() => { seekingRef.current = true; }, []);
  const cancelSeek = useCallback(() => { seekingRef.current = false; }, []);

  const applyNativeMode = async (id) => {
    const mode = playbackMode(id);
    modeChangingRef.current += 1;
    try {
      await NativeAudio.setShuffleMode({ enabled: mode.shuffle });
      await NativeAudio.setRepeatMode({ mode: mode.repeat });
    } finally { modeChangingRef.current -= 1; }
  };

  const visibleSongs = useMemo(() => {
    let source = songs;
    if (activeNav === '我的收藏') source = songs.filter((song) => favorites.includes(song.id));
    if (activeNav === '最近播放') source = recent.map((id) => songs.find((song) => song.id === id)).filter(Boolean);
    const normalized = query.trim().toLowerCase();
    if (!normalized) return source;
    return source.filter((song) => [song.title, song.artist, song.album]
      .some((field) => String(field || '').toLowerCase().includes(normalized)));
  }, [songs, query, activeNav, favorites, recent]);

  const nativeQueue = (queue) => queue.map((song) => ({
    id: song.id,
    title: song.title || '未知歌曲',
    artist: song.artist || '未知歌手',
    album: song.album || '',
    cover: song.coverUrl || '',
    durationMillis: Math.round((Number(song.duration) || 0) * 1000),
    url: api.mediaUrl(song.id),
  }));

  const applyMusicState = (state) => {
    musicStateRef.current = state;
    setFavorites(state.favorites);
    setRecent(state.recent);
  };

  const readCachedState = (session) => {
    try { return JSON.parse(localStorage.getItem(stateKey(session)) || 'null'); } catch { return null; }
  };

  const persistMusicState = useCallback((state = musicStateRef.current) => {
    if (!credentials || !api) return;
    musicStateRef.current = state;
    const key = stateKey(credentials);
    localStorage.setItem(key, JSON.stringify({ ...state, dirty: isGoogle }));
    if (!isGoogle) return;
    const generation = sessionGenerationRef.current;
    const revision = ++syncRevisionRef.current;
    setSyncStatus('正在同步…');
    api.saveState(state).then(() => {
      if (generation !== sessionGenerationRef.current || revision !== syncRevisionRef.current) return;
      localStorage.setItem(key, JSON.stringify({ ...state, dirty: false }));
      setSyncStatus('收藏与播放记录已同步');
    }).catch((requestError) => {
      if (generation !== sessionGenerationRef.current || revision !== syncRevisionRef.current) return;
      setSyncStatus('同步失败，已保存在本机');
      setError(requestError.message);
    });
  }, [credentials, api, isGoogle]);

  const rememberSong = useCallback((song) => {
    const next = [song.id, ...musicStateRef.current.recent.filter((id) => id !== song.id)].slice(0, 50);
    setRecent(next);
    persistMusicState({ ...musicStateRef.current, recent: next });
  }, [persistMusicState]);

  const applyDirectory = useCallback((directory, path, session) => {
    folderPathRef.current = path;
    setFolderPath(path);
    setFolders(directory.folders);
    setSongs(directory.songs);
    localStorage.setItem(locationKey(session.accountId), JSON.stringify(path));
    setCurrentSong((song) => song ? directory.songs.find((item) => item.id === song.id) || song : directory.songs[0] || null);
    setPlaybackQueue((queue) => queue.map((song) => directory.songs.find((item) => item.id === song.id) || song));
    nativeQueueRef.current = nativeQueueRef.current.map((song) => directory.songs.find((item) => item.id === song.id) || song);
  }, []);

  const openDirectory = useCallback(async (path, nextApi = api) => {
    if (!nextApi || !credentials) return;
    const request = ++directoryRequestRef.current;
    const generation = sessionGenerationRef.current;
    const nextPath = normalizeFolderPath(path);
    setBusy(true);
    setError('');
    try {
      const folder = await nextApi.getFolder(nextPath.at(-1).id);
      const directory = await nextApi.listDirectory(folder.id);
      if (generation !== sessionGenerationRef.current || request !== directoryRequestRef.current) return;
      nextPath[nextPath.length - 1] = folder;
      applyDirectory(directory, nextPath, credentials);
      setActiveNav('云端曲库');
      setQuery('');
    } catch (requestError) {
      if (generation === sessionGenerationRef.current && request === directoryRequestRef.current) setError(requestError.message);
    } finally {
      if (generation === sessionGenerationRef.current && request === directoryRequestRef.current) setBusy(false);
    }
  }, [api, credentials, applyDirectory]);

  const openUploads = async () => {
    if (!api || busy || upload) return;
    const generation = sessionGenerationRef.current;
    setBusy(true);
    try {
      const folder = await api.ensureFolder();
      if (generation === sessionGenerationRef.current) await openDirectory([ROOT_FOLDER, folder]);
    } catch (requestError) {
      if (generation === sessionGenerationRef.current) setError(requestError.message);
    } finally {
      if (generation === sessionGenerationRef.current) setBusy(false);
    }
  };

  const loadLibrary = async (nextApi = api) => {
    if (!nextApi) return;
    setBusy(true);
    setError('');
    const generation = sessionGenerationRef.current;
    const revision = syncRevisionRef.current;
    const request = ++directoryRequestRef.current;
    const path = folderPathRef.current;
    try {
      await nextApi.flush().catch(() => {});
      const [directory, remoteState, account] = await Promise.all([
        nextApi.listDirectory(path.at(-1).id), nextApi.loadState(), nextApi.getAccount(),
      ]);
      if (generation !== sessionGenerationRef.current || request !== directoryRequestRef.current) return;
      applyDirectory(directory, path, credentials);
      if (remoteState && revision === syncRevisionRef.current && !readCachedState(credentials)?.dirty) {
        applyMusicState(remoteState);
        localStorage.setItem(stateKey(credentials), JSON.stringify({ ...remoteState, dirty: false }));
      }
      if (account) setStorageQuota(account.storageQuota);
    } catch (requestError) {
      if (generation === sessionGenerationRef.current && request === directoryRequestRef.current) setError(requestError.message);
    } finally {
      if (generation === sessionGenerationRef.current && request === directoryRequestRef.current) setBusy(false);
    }
  };

  const googleLogin = async ({ interactive = true, account } = {}) => {
    if (interactive) {
      automaticRestoreAllowedRef.current = false;
      loginRecoveryRef.current?.stop();
      setRestoringLogin(false);
    }
    const generation = ++sessionGenerationRef.current;
    ++directoryRequestRef.current;
    setBusy(true);
    setError('');
    setSetupMessage('');
    setCredentials(null);
    setDriveApi(null);
    setCurrentSong(null);
    setPlaybackQueue([]);
    setShowPlayer(false);
    setShowQueue(false);
    uploadControllerRef.current?.abort();
    if (interactive) {
      ++playbackRequestRef.current;
      playbackControllerRef.current?.abort();
      audioRef.current?.pause();
      if (Capacitor.isNativePlatform()) NativeAudio.stop().catch(() => {});
      nativeLoadedRef.current = false;
      nativeQueueRef.current = [];
      setAudioSrc('');
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = ''; }
      setIsPlaying(false);
      setLoadingTrack(false);
      setTrackReady(false);
    }
    try {
      await connectGoogle({ interactive, account });
      let email = account;
      const nextApi = createGoogleDriveApi(async (options) => {
        // Pending requests from an old account must not borrow the new account's token.
        const checkSession = () => {
          if (generation !== sessionGenerationRef.current) throw Object.assign(new Error('Google 账号已切换，请重新登录。'), { code: 'GOOGLE_AUTH_REQUIRED' });
        };
        checkSession();
        const token = await getGoogleAccessToken({ ...options, account: email });
        checkSession();
        return token;
      });
      const { session, storageQuota: quota, path, directory, remoteState, notice, stateError } = await openVerifiedGoogleLibrary(nextApi, {
        expectedEmail: account,
        onVerifiedAccount: async (verified) => {
          if (generation !== sessionGenerationRef.current) throw Object.assign(new Error('Google 登录已取消。'), { code: 'GOOGLE_LOGIN_CANCELLED' });
          email = verified.email;
          await selectGoogleAccount(email);
          if (generation !== sessionGenerationRef.current) throw Object.assign(new Error('Google 登录已取消。'), { code: 'GOOGLE_LOGIN_CANCELLED' });
          rememberedLoginRef.current = true;
          setRememberedLogin(true);
          setLoginEmail(email);
        },
        readLocation: (accountId) => {
          try { return JSON.parse(localStorage.getItem(locationKey(accountId)) || 'null'); } catch { return null; }
        },
      });
      if (generation !== sessionGenerationRef.current) return;
      const cached = readCachedState(session);
      const state = normalizeState(cached?.dirty || !remoteState ? cached : remoteState);
      localStorage.setItem(stateKey(session), JSON.stringify({ ...state, dirty: Boolean(cached?.dirty) }));
      setCredentials(session);
      setDriveApi(nextApi);
      applyDirectory(directory, path, session);
      setActiveNav('云端曲库');
      setQuery('');
      setError([notice, stateError && `播放记录暂时无法同步：${stateError}`].filter(Boolean).join(' '));
      setStorageQuota(quota);
      applyMusicState(state);
      setSyncStatus(stateError ? '播放记录读取失败' : cached?.dirty ? '有记录待同步' : '收藏与播放记录已同步');
      if (cached?.dirty) {
        try {
          await nextApi.saveState(state);
          if (generation === sessionGenerationRef.current) {
            localStorage.setItem(stateKey(session), JSON.stringify({ ...state, dirty: false }));
            setSyncStatus('收藏与播放记录已同步');
          }
        } catch (syncError) {
          // The account and library are already connected. A failed background
          // sync must not restart login and discard a queue the user just opened.
          if (generation === sessionGenerationRef.current) {
            setSyncStatus('播放记录有更新待同步');
            setError(`播放记录暂时无法同步：${syncError.message}`);
            if (syncError.code === 'GOOGLE_AUTH_REQUIRED') {
              rememberedLoginRef.current = false;
              setRememberedLogin(false);
            }
          }
        }
      }
      return generation === sessionGenerationRef.current ? { connected: true } : { cancelled: true };
    } catch (requestError) {
      if (generation === sessionGenerationRef.current && requestError.code === 'GOOGLE_ACCOUNT_MISMATCH') await disconnectGoogle().catch(() => {});
      if (requestError.code === 'GOOGLE_CONFIG_REQUIRED') setShowGoogleSetup(true);
      if (generation === sessionGenerationRef.current) {
        if (['GOOGLE_AUTH_REQUIRED', 'GOOGLE_AUTH_DENIED', 'GOOGLE_ACCOUNT_MISMATCH'].includes(requestError.code)) {
          rememberedLoginRef.current = false;
          setRememberedLogin(false);
        }
        setError(requestError.message);
        if (interactive && rememberedLoginRef.current && isTransientError(requestError)) startLoginRecoveryRef.current?.();
      }
      return { error: requestError, cancelled: generation !== sessionGenerationRef.current };
    } finally {
      if (generation === sessionGenerationRef.current) setBusy(false);
    }
  };

  const importConfig = async () => {
    setBusy(true);
    setError('');
    try {
      const status = await importGoogleConfig();
      if (status?.canceled) return;
      setGoogleConfigured(Boolean(status?.configured));
      if (status?.configured) {
        setShowGoogleSetup(false);
        await googleLogin();
      }
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const saveGoogleConfig = async (text) => {
    setBusy(true);
    setError('');
    setSetupMessage('');
    try {
      const status = await configureGoogle(text);
      setGoogleConfigured(Boolean(status?.configured));
      setShowGoogleSetup(false);
      if (isDesktop) await googleLogin();
      else setSetupMessage('配置已保存。点击“使用 Google 账号登录”完成 Drive 授权。');
      return true;
    } catch (requestError) { setError(requestError.message); return false; }
    finally { setBusy(false); }
  };

  const openSetup = (destination = 'console') => {
    setError('');
    return openGoogleSetup(destination).catch((requestError) => setError(requestError.message));
  };

  const beginGoogleLogin = () => {
    if (googleConfigured && rememberedLoginRef.current) {
      return startLoginRecoveryRef.current?.();
    }
    if (googleConfigured) return googleLogin({ account: !isDesktop && !isNative ? loginEmail.trim() || undefined : undefined });
    setShowGoogleSetup(true);
    return openSetup();
  };
  useEffect(() => { googleLoginRef.current = googleLogin; });

  useEffect(() => {
    let active = true;
    let nativeListener;
    const generationCounter = sessionGenerationRef;
    // Legacy directory caches are not credentials; restore only a platform-held Google authorization.
    localStorage.removeItem('yungan-session');
    const makeRecovery = (cycle) => createGoogleLoginRecovery({
      attempt: async () => {
        const status = await prepareGoogleSignIn();
        if (!active || !automaticRestoreAllowedRef.current || cycle !== loginRecoveryCycleRef.current) return { cancelled: true };
        setIsNative(Capacitor.isNativePlatform());
        setIsDesktop(Boolean(window.electronAPI?.google));
        setGoogleReady(true);
        setGoogleConfigured(status.configured);
        rememberedLoginRef.current = Boolean(status.connected);
        setRememberedLogin(Boolean(status.connected));
        if (typeof status.account === 'string') setLoginEmail(status.account);
        if (!status.connected) return false;
        setRestoringLogin(true);
        return googleLoginRef.current({ interactive: false, account: status.account });
      },
      onState: ({ state, error: requestError }) => {
        if (!active) return;
        setRestoringLogin(rememberedLoginRef.current && (state === 'connecting' || state === 'retrying'));
        if (requestError) {
          setGoogleReady(true);
          setError(requestError.message);
        }
      },
    });
    const startRecovery = () => {
      if (!active) return;
      loginRecoveryRef.current?.stop();
      automaticRestoreAllowedRef.current = true;
      const recovery = makeRecovery(++loginRecoveryCycleRef.current);
      loginRecoveryRef.current = recovery;
      return recovery.start();
    };
    startLoginRecoveryRef.current = startRecovery;
    const retry = () => { if (active && rememberedLoginRef.current) loginRecoveryRef.current?.retry(); };
    const foreground = () => { if (document.visibilityState === 'visible') retry(); };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', foreground);
    if (Capacitor.isNativePlatform()) {
      App.addListener('appStateChange', ({ isActive }) => { if (isActive) retry(); })
        .then((listener) => { if (active) nativeListener = listener; else listener.remove(); }).catch(() => {});
    }
    startRecovery();
    return () => {
      active = false;
      ++generationCounter.current;
      loginRecoveryRef.current?.stop();
      if (startLoginRecoveryRef.current === startRecovery) startLoginRecoveryRef.current = null;
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', foreground);
      nativeListener?.remove();
    };
  }, []);

  useEffect(() => () => {
    uploadControllerRef.current?.abort();
    playbackControllerRef.current?.abort();
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    if (isNative) NativeAudio.setVolume({ volume }).catch(() => {});
  }, [volume, isNative, credentials]);

  useEffect(() => {
    if (!isNative) return undefined;
    let listener;
    let active = true;
    App.addListener('backButton', () => {
      if (menuOpen) {
        setMenuOpen(false);
      } else if (showSettings) {
        setShowSettings(false);
      } else if (showOnlinePlaylists) {
        setShowOnlinePlaylists(false);
      } else if (showQueue) {
        setShowQueue(false);
      } else if (showPlayer) {
        setShowPlayer(false);
      } else if (credentials && folderPath.length > 1 && !busy && !upload) {
        openDirectory(folderPath.slice(0, -1));
      } else {
        App.minimizeApp();
      }
    }).then((handle) => { if (active) listener = handle; else handle.remove(); });
    return () => { active = false; listener?.remove(); };
  }, [isNative, menuOpen, showSettings, showOnlinePlaylists, showPlayer, showQueue, credentials, folderPath, busy, upload, openDirectory]);

  useEffect(() => {
    if (!isNative || !credentials || showOnlinePlaylists) return undefined;
    const generation = sessionGenerationRef.current;
    const timer = setInterval(async () => {
      if (!nativeLoadedRef.current) return;
      const playbackRevision = playbackRequestRef.current;
      try {
        const state = await NativeAudio.getState();
        if (generation !== sessionGenerationRef.current || playbackRevision !== playbackRequestRef.current) return;
        setIsPlaying(Boolean(!state.ended && (state.playing || state.playWhenReady)));
        if (!modeChangingRef.current) {
          const nextMode = nativePlaybackMode(state.repeatMode, state.shuffleEnabled);
          if (nextMode !== playModeRef.current) {
            playModeRef.current = nextMode;
            setPlayMode(nextMode);
            try { localStorage.setItem('yungan-playback-mode', nextMode); } catch {}
          }
        }
        updatePlaybackPosition(Number(state.position || 0) / 1000);
        if (Number(state.duration) > 0) setDuration(Number(state.duration) / 1000);
        const track = nativeQueueRef.current[state.index];
        if (track && track.id !== currentSong?.id) { setCurrentSong(track); rememberSong(track); }
        if (state.error) setError(state.error);
      } catch {}
    }, 750);
    return () => clearInterval(timer);
  }, [isNative, credentials, currentSong, rememberSong, showOnlinePlaylists, updatePlaybackPosition]);

  const startSong = async (song, queue = songs, { preserveShuffle = false } = {}) => {
    if (!api || !song) return;
    const nextQueue = queue.some((item) => item.id === song.id) ? queue : [song];
    const queueKey = nextQueue.map((item) => item.id).join('|');
    if (!preserveShuffle || shuffleRef.current.key !== queueKey) shuffleRef.current = { key: queueKey, remaining: shuffleBag(nextQueue.length, nextQueue.findIndex((item) => item.id === song.id)), history: [song.id] };
    const request = ++playbackRequestRef.current;
    playbackControllerRef.current?.abort();
    playbackControllerRef.current = new AbortController();
    audioRef.current?.pause();
    setCurrentSong(song);
    setPlaybackQueue(nextQueue);
    setProgress(0);
    setDuration(Number(song.duration) || 0);
    seekingRef.current = false;
    seekRequestRef.current = null;
    ++seekRevisionRef.current;
    setIsPlaying(false);
    setTrackReady(false);
    nativeLoadedRef.current = false;
    setLoadingTrack(true);
    try {
      if (isNative) {
        if (isGoogle) await getGoogleAccessToken({ account: credentials.email });
        if (request !== playbackRequestRef.current) return;
        nativeQueueRef.current = nextQueue;
        await applyNativeMode(playModeRef.current);
        if (request !== playbackRequestRef.current) return;
        await NativeAudio.setQueue({ tracks: nativeQueue(nextQueue), index: nextQueue.findIndex((item) => item.id === song.id), position: 0 });
        if (request !== playbackRequestRef.current) return;
        nativeLoadedRef.current = true;
      } else {
        let url;
        if (window.electronAPI?.google) url = await window.electronAPI.google.streamUrl(song.id);
        else url = URL.createObjectURL(await api.downloadSong(song.id, playbackControllerRef.current.signal));
        if (request !== playbackRequestRef.current) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = url.startsWith('blob:') ? url : '';
        if (audioRef.current?.getAttribute('src') === url) {
          if (Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0) setDuration(audioRef.current.duration);
          audioRef.current.currentTime = 0;
          await audioRef.current.play();
        }
        setAudioSrc(url);
      }
      if (request === playbackRequestRef.current) { rememberSong(song); setTrackReady(true); setIsPlaying(true); }
    } catch (requestError) {
      if (request === playbackRequestRef.current && requestError.name !== 'AbortError') { setError(requestError.message); setAudioSrc(''); }
    } finally {
      if (request === playbackRequestRef.current) setLoadingTrack(false);
    }
  };

  const playSong = (song) => currentSong?.id === song.id && (audioSrc || nativeLoadedRef.current) ? togglePlay() : startSong(song, visibleSongs);

  const togglePlay = async () => {
    if (!currentSong) return;
    if (loadingTrack) return;
    if ((!isNative && !audioSrc) || (isNative && !nativeLoadedRef.current)) { await startSong(currentSong, playbackQueue.length ? playbackQueue : songs); return; }
    try {
    if (isNative) {
      if (isPlaying) await NativeAudio.pause();
      else await NativeAudio.play();
      setIsPlaying(!isPlaying);
      return;
    }
    if (!audioRef.current) return;
    if (audioRef.current.paused) await audioRef.current.play();
    else audioRef.current.pause();
    } catch (requestError) { setError(requestError.message); setIsPlaying(false); }
  };

  const playOffset = async (offset, automatic = false) => {
    const queue = playbackQueue.length ? playbackQueue : songs;
    if (!queue.length) return;
    try {
      if (isNative && nativeLoadedRef.current) {
        if (offset > 0) await NativeAudio.next();
        else await NativeAudio.previous();
        return;
      }
      const index = Math.max(0, queue.findIndex((song) => song.id === currentSong?.id));
      let next;
      if (playModeRef.current === 'shuffle' && queue.length > 1) {
        const shuffle = shuffleRef.current;
        if (offset < 0 && shuffle.history.length > 1) {
          shuffle.history.pop();
          next = queue.findIndex((song) => song.id === shuffle.history.at(-1));
          // Rebuild a round after rewinding so the previously next track can be heard again.
          shuffle.remaining = shuffleBag(queue.length, next);
        } else if (offset < 0) {
          next = index;
        } else {
          if (!shuffle.remaining.length) shuffle.remaining = shuffleBag(queue.length, index);
          next = shuffle.remaining.shift();
          shuffle.history.push(queue[next].id);
          shuffle.history = shuffle.history.slice(-100);
        }
      } else next = offset > 0 ? nextTrackIndex(index, queue.length, playModeRef.current, automatic) : (index - 1 + queue.length) % queue.length;
      if (next < 0) { setIsPlaying(false); return; }
      await startSong(queue[next], queue, { preserveShuffle: true });
    } catch (requestError) { setError(requestError.message); }
  };
  const playNext = () => playOffset(1);
  const playPrevious = () => playOffset(-1);

  useEffect(() => {
    playerActionsRef.current = showOnlinePlaylists ? {} : { 'toggle-play': togglePlay, next: playNext, previous: playPrevious };
  });

  useEffect(() => window.electronAPI?.onPlayerCommand((command) => {
    Promise.resolve().then(() => playerActionsRef.current[command]?.()).catch((requestError) => setError(requestError.message));
  }), []);

  useEffect(() => {
    window.electronAPI?.updatePlayerState({
      canPlay: Boolean(credentials && currentSong && !loadingTrack), playing: isPlaying,
      title: currentSong?.title || '', artist: currentSong?.artist || '',
    });
  }, [credentials, currentSong, isPlaying, loadingTrack]);

  const seekTo = async (value) => {
    const position = seekPosition(value, effectiveDuration);
    const songId = currentSong?.id;
    const revision = ++seekRevisionRef.current;
    seekingRef.current = false;
    seekRequestRef.current = { songId, position, until: Date.now() + 2500 };
    setProgress(position);
    try {
      if (isNative) await NativeAudio.seekTo({ position: Math.round(position * 1000) });
      else if (audioRef.current) audioRef.current.currentTime = position;
    } catch (requestError) {
      if (revision !== seekRevisionRef.current) return;
      seekRequestRef.current = null;
      setError(`跳转失败：${requestError.message}`);
    }
  };

  const changePlayMode = async (id) => {
    const previous = playModeRef.current;
    const next = playbackMode(id).id;
    playModeRef.current = next;
    setPlayMode(next);
    try {
      if (isNative) await applyNativeMode(next);
      else if (audioRef.current) audioRef.current.loop = next === 'repeat-one';
      try { localStorage.setItem('yungan-playback-mode', next); } catch {}
      const queue = playbackQueue.length ? playbackQueue : songs;
      const index = queue.findIndex((song) => song.id === currentSong?.id);
      shuffleRef.current = { key: queue.map((song) => song.id).join('|'), remaining: shuffleBag(queue.length, index), history: currentSong ? [currentSong.id] : [] };
    } catch (requestError) {
      playModeRef.current = previous;
      setPlayMode(previous);
      if (isNative) await applyNativeMode(previous).catch(() => {});
      setError(`切换播放模式失败：${requestError.message}`);
    }
  };

  const toggleFavorite = () => {
    if (!currentSong) return;
    const current = musicStateRef.current.favorites;
    const next = current.includes(currentSong.id) ? current.filter((id) => id !== currentSong.id) : [...current, currentSong.id];
    setFavorites(next);
    persistMusicState({ ...musicStateRef.current, favorites: next });
  };

  const logout = async () => {
    automaticRestoreAllowedRef.current = false;
    loginRecoveryRef.current?.stop();
    rememberedLoginRef.current = false;
    setRememberedLogin(false);
    setRestoringLogin(false);
    setLoginEmail('');
    const previousApi = api;
    const previousGoogle = isGoogle;
    ++sessionGenerationRef.current;
    ++directoryRequestRef.current;
    ++playbackRequestRef.current;
    uploadControllerRef.current?.abort();
    playbackControllerRef.current?.abort();
    audioRef.current?.pause();
    if (isNative) await NativeAudio.stop().catch(() => {});
    localStorage.removeItem('yungan-session');
    setCredentials(null);
    setSongs([]);
    setFolders([]);
    setFolderPath([ROOT_FOLDER]);
    folderPathRef.current = [ROOT_FOLDER];
    setPlaybackQueue([]);
    setCurrentSong(null);
    setIsPlaying(false);
    setDriveApi(null);
    setAudioSrc('');
    setUpload(null);
    setLoadingTrack(false);
    setTrackReady(false);
    setShowPlayer(false);
    setShowQueue(false);
    setActiveNav('云端曲库');
    setQuery('');
    setError('');
    setBusy(true);
    nativeLoadedRef.current = false;
    nativeQueueRef.current = [];
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = ''; }
    try {
      if (previousGoogle) { await previousApi.flush().catch(() => {}); await disconnectGoogle(); }
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const uploadMusic = async (fileList) => {
    const files = Array.from(fileList || []).filter(isMusicFile);
    if (!files.length || !isGoogle || uploadControllerRef.current) return;
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    const generation = sessionGenerationRef.current;
    const failures = [];
    let completed = 0;
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    let finishedBytes = 0;
    try {
      const folder = await api.ensureFolder();
      if (generation !== sessionGenerationRef.current) return;
      await openDirectory([ROOT_FOLDER, folder]);
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUpload({ name: file.name, index: index + 1, total: files.length, percent: Math.round(finishedBytes / Math.max(1, totalBytes) * 100) });
        try {
          const song = await api.uploadMusic(file, { signal: controller.signal, onProgress: (loaded) => {
            if (generation === sessionGenerationRef.current) setUpload({ name: file.name, index: index + 1, total: files.length, percent: Math.round((finishedBytes + loaded) / Math.max(1, totalBytes) * 100) });
          } });
          if (generation !== sessionGenerationRef.current) return;
          if (folderPathRef.current.at(-1).id === folder.id) setSongs((current) => [...current.filter((item) => item.id !== song.id), song].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')));
          setCurrentSong((current) => current || song);
          completed += 1;
        } catch (requestError) {
          if (controller.signal.aborted) break;
          failures.push(`${file.name}：${requestError.message}`);
          if (requestError.code === 'GOOGLE_AUTH_REQUIRED') break;
        }
        finishedBytes += file.size;
      }
      if (generation === sessionGenerationRef.current) {
        setError(failures.length ? `已上传 ${completed} 首；${failures.join('；')}` : controller.signal.aborted ? `上传已取消，已完成 ${completed} 首。` : '');
        api.getAccount().then((data) => { if (generation === sessionGenerationRef.current) setStorageQuota(data.storageQuota); }).catch(() => {});
      }
    } catch (requestError) {
      if (generation === sessionGenerationRef.current) setError(requestError.message);
    } finally {
      if (uploadControllerRef.current === controller) uploadControllerRef.current = null;
      if (generation === sessionGenerationRef.current) setUpload(null);
    }
  };

  const saveCurrentSong = async () => {
    if (!api || !currentSong || savingSong) return;
    setSavingSong(true);
    setDownloadNotice('');
    setError('');
    const song = currentSong;
    try {
      if (isNative) {
        const result = await NativeAudio.saveDriveSong({ id: song.id, fileName: song.fileName || song.title, mimeType: song.mimeType || 'application/octet-stream' });
        setDownloadNotice(result.message);
      } else {
        const blob = await api.downloadSong(song.id);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = (song.fileName || song.title).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setDownloadNotice(`已发起下载：${song.fileName || song.title}（保留原格式）`);
      }
    } catch (requestError) { setError(`保存失败：${requestError.message}`); }
    finally { setSavingSong(false); }
  };

  const openOnlinePlaylists = async (mode = 'download') => {
    setMenuOpen(false);
    ++playbackRequestRef.current;
    playbackControllerRef.current?.abort();
    audioRef.current?.pause();
    if (isNative) {
      try { await NativeAudio.pause(); } catch (requestError) { setError(requestError.message); return; }
    }
    setAudioSrc('');
    setIsPlaying(false);
    setLoadingTrack(false);
    // Android keeps its paused native queue while finding songs. Its progress
    // control must remain ready when returning and resuming the same song.
    if (!isNative) setTrackReady(false);
    setShowPlayer(false);
    setShowQueue(false);
    setShowSettings(false);
    setOnlineMode(mode === 'discover' ? 'discover' : 'download');
    setShowOnlinePlaylists(true);
  };
  const openDiscovery = () => openOnlinePlaylists('discover');

  const uploadDownloadedMp3 = api && credentials ? async (file, metadata) => {
    const generation = sessionGenerationRef.current;
    const folder = await api.ensureFolder();
    const song = await api.uploadMusic(file, { metadata });
    if (generation === sessionGenerationRef.current && folderPathRef.current.at(-1).id === folder.id) setSongs((items) => [...items.filter((item) => item.id !== song.id), song]);
    return song;
  } : null;
  const repairDownloadedMp3 = api && credentials ? async (file, metadata, fileRecord) => {
    const generation = sessionGenerationRef.current;
    if (repairSongsRef.current?.api !== api) repairSongsRef.current = { api, songs: api.listSongs().catch((failure) => { if (repairSongsRef.current?.api === api) repairSongsRef.current = null; throw failure; }) };
    const library = await repairSongsRef.current.songs;
    if (generation !== sessionGenerationRef.current) throw new Error('Google 账号已变更，请重新补全歌曲信息。');
    const originalName = fileRecord?.originalName || file.name;
    const sourceMatches = metadata?.sourceUrl ? library.filter((song) => song.sourceUrl === metadata.sourceUrl) : [];
    const original = sourceMatches.length === 1 ? sourceMatches[0] : library.find((song) => song.fileName === originalName || song.fileName === file.name);
    if (!original) throw new Error(`云端未找到原歌曲：${originalName}，已跳过，避免重复上传。`);
    const song = await api.updateMusic(original.id, file, { metadata });
    Object.assign(original, song);
    if (generation === sessionGenerationRef.current) {
      setSongs((items) => items.map((item) => item.id === song.id ? song : item));
      setCurrentSong((item) => item?.id === song.id ? song : item);
      setPlaybackQueue((items) => items.map((item) => item.id === song.id ? song : item));
      nativeQueueRef.current = nativeQueueRef.current.map((item) => item.id === song.id ? song : item);
    }
    return song;
  } : null;
  const openSettings = () => { setMenuOpen(false); setShowPlayer(false); setShowQueue(false); setShowSettings(true); };
  const navigation = <MobileNavigation open={menuOpen} onOpen={() => setMenuOpen(true)} onClose={closeMenu} active={showSettings ? 'settings' : showOnlinePlaylists ? onlineMode === 'discover' ? 'discover' : 'playlists' : 'library'} onLibrary={() => { setMenuOpen(false); setShowSettings(false); setShowOnlinePlaylists(false); setActiveNav('云端曲库'); }} onPlaylists={openOnlinePlaylists} onDiscover={openDiscovery} onSettings={openSettings} email={credentials?.email} hasUpdate={hasUpdate} standalone={!credentials || showOnlinePlaylists || showSettings} />;
  const settingsPage = <AppSettings user={credentials} onLogin={() => { setShowSettings(false); setShowOnlinePlaylists(false); beginGoogleLogin(); }} onBack={() => setShowSettings(false)} onOpenPlaylists={openOnlinePlaylists} busy={busy} />;
  if (showOnlinePlaylists) return <>{navigation}{showSettings && settingsPage}<div hidden={showSettings}><OnlinePlaylists initialMode={onlineMode} taste={{ songs, favorites, recent, currentSong, currentQueue: playbackQueue }} onClose={() => setShowOnlinePlaylists(false)} onUpload={credentials ? uploadDownloadedMp3 : undefined} onRepairUpload={repairDownloadedMp3} uploadAccount={credentials?.accountId || ''} uploadEmail={credentials?.email || ''} onGoogleLogin={() => { setShowOnlinePlaylists(false); beginGoogleLogin(); }} /></div></>;
  if (!credentials) return <>{navigation}{showSettings ? settingsPage : <Login onOnlinePlaylists={openOnlinePlaylists} onGoogleLogin={beginGoogleLogin} onImportConfig={importConfig} onConfigure={saveGoogleConfig} onOpenSetup={openSetup} onToggleSetup={() => setShowGoogleSetup((value) => !value)} loginEmail={loginEmail} onLoginEmail={setLoginEmail} showSetup={showGoogleSetup} setupMessage={setupMessage} googleReady={googleReady} googleConfigured={googleConfigured} isDesktop={isDesktop} isNative={isNative} rememberedLogin={rememberedLogin} restoringLogin={restoringLogin} busy={busy} error={error} />}</>;

  const navItems = [
    ['云端曲库', 'folder'], ['我的收藏', 'heart'], ['最近播放', 'history'],
  ];

  return (
    <>{navigation}{showSettings && settingsPage}<div className="music-app" style={showSettings ? { display: 'none' } : undefined}>
      <aside className="sidebar">
        <div className="brand"><span><Icon name="logo" size={25} /></span><strong>云感音乐</strong></div>
        <nav>
          <p>在线音乐</p>
          {navItems.map(([label, icon]) => (
            <button
              key={label}
              className={activeNav === label ? 'active' : ''}
              onClick={() => {
                setActiveNav(label);
                contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <Icon name={icon} size={19} /> <span>{label}</span>
            </button>
          ))}
          <button onClick={openDiscovery}><Icon name="search" size={19} /><span>发现音乐</span></button>
          <p>Google Drive</p>
          <button onClick={openOnlinePlaylists}><Icon name="radio" size={19} /><span>歌单下载</span></button>
          <button disabled={busy || Boolean(upload)} onClick={() => openDirectory([ROOT_FOLDER])}><Icon name="home" size={19} /><span>我的云盘</span></button>
          <button disabled={busy || Boolean(upload)} onClick={openUploads}><Icon name="upload" size={19} /><span>上传目录</span></button>
          <p>应用</p>
          <button onClick={openSettings}><Icon name="settings" size={19} /><span>设置</span>{hasUpdate && <small className="sidebar-update-dot">有更新</small>}</button>
        </nav>
        <div className="sidebar-status">
          <span className="status-dot" />
          <div><b>Google 账号已验证</b><small>{credentials.email}</small></div>
        </div>
      </aside>

      <section className="main-view">
        <header className="topbar">
          <div className="nav-arrows"><button aria-label="返回上级目录" disabled={busy || Boolean(upload) || folderPath.length < 2} onClick={() => openDirectory(folderPath.slice(0, -1))}>‹</button><button aria-label="返回我的云盘" disabled={busy || Boolean(upload) || folderPath.length < 2} onClick={() => openDirectory([ROOT_FOLDER])}><Icon name="home" size={16} /></button></div>
          <label className="search-box"><Icon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前目录的音乐" /></label>
          <div className="top-actions">
            {isGoogle && <button title="上传音乐到 Google Drive" aria-label="上传音乐" disabled={Boolean(upload) || busy} onClick={() => uploadInputRef.current?.click()}><Icon name="upload" /></button>}
            <button title="刷新曲库" aria-label="刷新曲库" disabled={busy || Boolean(upload)} onClick={() => loadLibrary()}><Icon name="refresh" /></button>
            <span className="avatar">{accountName.slice(0, 1).toUpperCase()}</span>
            <span className="username">{accountName}</span>
            <button title="退出登录" aria-label="退出登录" disabled={busy} onClick={logout}><Icon name="logout" /></button>
          </div>
        </header>

        <div className="content-scroll" ref={contentRef}>
          <section className="playlist-hero">
            <div className="hero-cover">
              <Icon name="logo" size={52} />
            </div>
            <div className="hero-info">
              <span className="playlist-tag">音乐目录</span>
              <h1>{activeNav === '云端曲库' ? folderPath.at(-1).name : activeNav}</h1>
              <p><span className="tiny-avatar">{accountName[0].toUpperCase()}</span>{accountName} · Google Drive</p>
              <div className="hero-actions">
                <button className="red-button" disabled={!visibleSongs.length || busy || loadingTrack} onClick={() => startSong(visibleSongs[0], visibleSongs)}><Icon name="play" size={17} />播放全部</button>
                <button className="outline-button" disabled={!currentSong || savingSong} onClick={saveCurrentSong}>{savingSong ? '正在保存…' : '保存当前歌曲原文件'}</button>
                {isGoogle && <button className="outline-button upload-button" disabled={Boolean(upload) || busy} onClick={() => uploadInputRef.current?.click()}><Icon name="upload" size={17} />上传音乐</button>}
                <button className="outline-button" disabled={busy || Boolean(upload)} onClick={() => loadLibrary()}><Icon name="refresh" size={17} />刷新曲库</button>
              </div>
            </div>
          </section>

          <section className="directory-panel" aria-label="Google Drive 音乐目录">
            {downloadNotice && <p className="setup-message" role="status">{downloadNotice}</p>}
            <header><div><Icon name="folder" size={21} /><h2>我的音乐目录</h2><small>{folders.length} 个文件夹 · {songs.length} 首音乐</small></div><button disabled={busy || Boolean(upload)} onClick={() => openDirectory([ROOT_FOLDER])}>我的云盘</button><button disabled={busy || Boolean(upload)} onClick={openUploads}>上传目录</button></header>
            <nav className="directory-breadcrumbs" aria-label="当前目录路径">
              {folderPath.map((folder, index) => <span key={`${folder.id}:${index}`}><button aria-current={index === folderPath.length - 1 ? 'page' : undefined} disabled={busy || Boolean(upload) || index === folderPath.length - 1} title={folder.name} onClick={() => openDirectory(folderPath.slice(0, index + 1))}>{folder.name}</button>{index < folderPath.length - 1 && <i>›</i>}</span>)}
            </nav>
            {busy && <p className="directory-loading" role="status">正在读取音乐目录…</p>}
            {!busy && Boolean(folders.length) && <div className="folder-grid">{folders.map((folder) => <button className="drive-folder" key={folder.id} title={`打开 ${folder.name}`} disabled={Boolean(upload)} onClick={() => openDirectory([...folderPath, folder])}><Icon name="folder" size={26} /><span>{folder.name}</span><b>›</b></button>)}</div>}
            {!busy && !folders.length && <p className="directory-hint">当前目录没有子文件夹。下方显示此目录中的音乐。</p>}
          </section>

          {isGoogle && <section className="drive-status" aria-live="polite">
            <div><GoogleLogo /><span>{storageQuota ? `Google 空间已用 ${formatStorage(storageQuota.usage)}${storageQuota.limit ? ` / ${formatStorage(storageQuota.limit)}` : ''}` : '音乐保存在你的 Google Drive'}</span></div>
            <div><span>{syncStatus}</span>{(syncStatus.includes('失败') || syncStatus.includes('待同步')) && <button onClick={() => persistMusicState()}>重试同步</button>}<button disabled={busy || Boolean(upload)} onClick={() => googleLogin({ account: credentials.email })}>重新连接</button></div>
          </section>}
          {upload && <section className="upload-progress" aria-live="polite"><div><span>正在上传 {upload.index} / {upload.total} · {upload.name}</span><button onClick={() => uploadControllerRef.current?.abort()}>取消上传</button></div><progress value={upload.percent} max="100" /><small>{upload.percent}%</small></section>}

          <section className="track-section">
            <div className="tabs"><span className="selected">歌曲 <sup>{visibleSongs.length}</sup></span><small>当前目录{activeNav !== '云端曲库' ? ` · ${activeNav}` : ''}</small></div>
            {error && <div className="inline-error" role="alert">{error}</div>}
            {loadingTrack && <div className="buffering" aria-live="polite">正在读取音频…</div>}
            <div className="track-head"><span>#</span><span>标题</span><span>专辑</span><span>时长</span></div>
            <div className="track-list">
              {busy && !songs.length ? <div className="empty">正在读取云端曲库…</div> : visibleSongs.map((song, index) => (
                <button key={song.id} disabled={busy} className={`track-row ${currentSong?.id === song.id ? 'playing' : ''}`} onClick={() => playSong(song)}>
                  <span className="track-index">{currentSong?.id === song.id && isPlaying ? <i className="equalizer"><b /><b /><b /></i> : String(index + 1).padStart(2, '0')}</span>
                  <span className="track-title">
                    <span className="art"><SongArtwork song={song} api={api} fallback={<Icon name="logo" size={20} />} /></span>
                    <span><b>{song.title || '未知歌曲'}</b><small>{song.artist || '未知歌手'}</small></span>
                  </span>
                  <span className="album">{song.album || '未知专辑'}</span>
                  <span className="track-duration">{formatTime(song.duration)}</span>
                </button>
              ))}
              {!busy && !visibleSongs.length && <div className="empty">{query ? '没有找到匹配的歌曲' : activeNav === '我的收藏' ? '收藏此目录中的歌曲，它们会出现在这里' : activeNav === '最近播放' ? '此目录中听过的歌曲会出现在这里' : folders.length ? '打开上面的文件夹，找到你的音乐' : '这个目录还没有音乐，可返回上级目录继续查找，或上传音乐'}{activeNav === '云端曲库' && !query && !folders.length && <button className="red-button empty-upload" disabled={Boolean(upload)} onClick={() => uploadInputRef.current?.click()}>上传到 Yungan Music</button>}</div>}
            </div>
          </section>
        </div>
      </section>

      <footer className="player">
        <button className="player-song" onClick={() => setShowPlayer(true)}>
          <span className="player-art"><SongArtwork song={currentSong} api={api} fallback={<Icon name="logo" />} /></span>
          <span><b>{currentSong?.title || '未播放'}</b><small>{currentSong?.artist || '从曲库选择歌曲'}</small></span>
          <span onClick={(event) => { event.stopPropagation(); toggleFavorite(); }} className={favorites.includes(currentSong?.id) ? 'is-favorite' : ''}><Icon name="heart" size={19} /></span>
        </button>
        <div className="player-center">
          <div className="player-controls">
            <button onClick={playPrevious} aria-label="上一首" disabled={!currentSong || loadingTrack}><Icon name="previous" size={19} /></button>
            <button className="main-play" onClick={togglePlay} disabled={!currentSong || loadingTrack} aria-label={isPlaying ? '暂停' : '播放'}><Icon name={isPlaying ? 'pause' : 'play'} size={21} /></button>
            <button onClick={playNext} aria-label="下一首" disabled={!currentSong || loadingTrack}><Icon name="next" size={19} /></button>
          </div>
          <div className="progress-row"><span>{formatTime(progress)}</span><SeekBar value={progress} duration={effectiveDuration} disabled={loadingTrack || !trackReady} onSeek={seekTo} onPreview={setProgress} onSeekStart={beginSeek} onSeekCancel={cancelSeek} /><span>{formatTime(effectiveDuration)}</span></div>
        </div>
        <div className="player-tools">
          <PlaybackModeControl className="repeat-tool" value={playMode} onChange={changePlayMode} Icon={Icon} />
          <button className="volume-button" onClick={() => setShowVolume((shown) => !shown)} aria-label="音量"><Icon name="volume" size={19} /></button>
          <div className={`volume-control ${showVolume ? 'open' : ''}`}>
            <input aria-label="音量调节" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
            <span>{Math.round(volume * 100)}%</span>
          </div>
          <button className="queue-tool" onClick={() => setShowQueue(true)} aria-label="播放队列"><Icon name="queue" size={20} /><span className="queue-label">队列</span></button>
        </div>
        {!isNative && <audio ref={audioRef} src={audioSrc || undefined} autoPlay={Boolean(audioSrc)} loop={playMode === 'repeat-one'} onTimeUpdate={(event) => updatePlaybackPosition(event.currentTarget.currentTime || 0)} onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration) && event.currentTarget.duration > 0) setDuration(event.currentTarget.duration); }} onEnded={() => playOffset(1, true)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onError={() => { if (audioSrc) { setIsPlaying(false); setError('无法播放这首歌曲，请检查网络、Google 授权或音频格式。'); } }} />}
      </footer>

      {showPlayer && (
        <section className="full-player">
          <button className="full-close" onClick={() => setShowPlayer(false)} aria-label="关闭"><Icon name="close" size={25} /></button>
          <div className={`vinyl ${isPlaying ? 'spinning' : ''}`}>
            <div><SongArtwork song={currentSong} api={api} fallback={<Icon name="logo" size={52} />} /></div>
          </div>
          <div className="full-meta"><h2>{currentSong?.title || '未播放'}</h2><p>{currentSong?.artist || '未知歌手'} · {currentSong?.album || '未知专辑'}</p><button className="song-radio-entry" onClick={openDiscovery} disabled={!currentSong}><Icon name="radio" size={18} />从这首歌开启电台</button></div>
          <button className={`full-heart ${favorites.includes(currentSong?.id) ? 'is-favorite' : ''}`} onClick={toggleFavorite} aria-label={favorites.includes(currentSong?.id) ? '取消收藏' : '收藏歌曲'}><Icon name="heart" size={25} /></button>
          <div className="full-progress"><SeekBar value={progress} duration={effectiveDuration} disabled={loadingTrack || !trackReady} onSeek={seekTo} onPreview={setProgress} onSeekStart={beginSeek} onSeekCancel={cancelSeek} /><div><span>{formatTime(progress)}</span><span>{formatTime(effectiveDuration)}</span></div></div>
          <div className="full-controls">
            <PlaybackModeControl value={playMode} onChange={changePlayMode} Icon={Icon} />
            <button onClick={playPrevious} aria-label="上一首" disabled={!currentSong || loadingTrack}><Icon name="previous" size={28} /></button>
            <button className="full-play" onClick={togglePlay} disabled={!currentSong || loadingTrack} aria-label={isPlaying ? '暂停' : '播放'}><Icon name={isPlaying ? 'pause' : 'play'} size={31} /></button>
            <button onClick={playNext} aria-label="下一首" disabled={!currentSong || loadingTrack}><Icon name="next" size={28} /></button>
            <button className="queue-tool" onClick={() => setShowQueue(true)} aria-label="播放队列"><Icon name="queue" size={23} /><span className="queue-label">队列</span></button>
          </div>
        </section>
      )}

      {showQueue && (
        <div className="queue-backdrop" onClick={() => setShowQueue(false)}>
          <section className="queue-sheet" onClick={(event) => event.stopPropagation()}>
            <header><div><h3>播放队列</h3><p>{playbackQueue.length} 首歌曲</p></div><button onClick={() => setShowQueue(false)}><Icon name="close" /></button></header>
            <div>{playbackQueue.map((song, index) => <button key={song.id} className={currentSong?.id === song.id ? 'current' : ''} onClick={() => currentSong?.id === song.id ? togglePlay() : startSong(song, playbackQueue)}><span>{String(index + 1).padStart(2, '0')}</span><span><b>{song.title}</b><small>{song.artist || '未知歌手'}</small></span><em>{formatTime(song.duration)}</em></button>)}{!playbackQueue.length && <p className="empty">选择一首音乐开始播放</p>}</div>
          </section>
        </div>
      )}
      {isGoogle && <input ref={uploadInputRef} className="hidden-file-input" type="file" multiple accept={MUSIC_ACCEPT} aria-label="选择要上传的音乐文件" onChange={(event) => { uploadMusic(event.target.files); event.target.value = ''; }} />}
    </div></>
  );
}
