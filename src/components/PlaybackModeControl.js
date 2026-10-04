import { useEffect, useRef, useState } from 'react';
import { PLAYBACK_MODES, playbackMode } from '../lib/playback-policy';

export default function PlaybackModeControl({ value, onChange, Icon, className = '' }) {
  const [open, setOpen] = useState(false);
  const panel = useRef(null);
  const button = useRef(null);
  const selected = playbackMode(value);
  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event) => { if (!panel.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div ref={panel} className={`playback-mode-control ${className}`}>
    <button ref={button} className={`playback-mode${value !== 'order' ? ' active-tool' : ''}`} onClick={() => setOpen(!open)} aria-label={`播放模式：${selected.label}`} aria-expanded={open} aria-haspopup="menu" title={selected.label}>
      <Icon name={selected.icon} size={21} /><span className="mode-label">{selected.label}</span>
    </button>
    {open && <div className="playback-mode-menu" role="menu" aria-label="选择播放模式">{PLAYBACK_MODES.map((mode) => <button key={mode.id} role="menuitemradio" aria-checked={mode.id === value} onClick={() => { setOpen(false); onChange(mode.id); button.current?.focus(); }}><Icon name={mode.icon} size={19} /><span>{mode.label}</span>{mode.id === value && <span aria-hidden="true">✓</span>}</button>)}</div>}
  </div>;
}
