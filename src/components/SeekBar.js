import { useEffect, useRef, useState } from 'react';
import { seekPosition } from '../lib/playback-policy';

function timeLabel(value) {
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

export default function SeekBar({ value, duration, disabled, onSeek, onPreview, onSeekStart, onSeekCancel }) {
  const bar = useRef(null);
  const dragging = useRef(false);
  const [draft, setDraft] = useState(null);
  useEffect(() => () => { if (dragging.current) onSeekCancel?.(); }, [onSeekCancel]);
  const position = seekPosition(draft ?? value, duration);
  const unavailable = disabled || !(duration > 0);
  const percentage = duration > 0 ? position / duration * 100 : 0;
  const pointerPosition = (event) => {
    const bounds = bar.current.getBoundingClientRect();
    return seekPosition((event.clientX - bounds.left) / Math.max(1, bounds.width) * duration, duration);
  };
  const preview = (event) => { const next = pointerPosition(event); setDraft(next); onPreview?.(next); return next; };
  return <div ref={bar} className={`seek-bar${unavailable ? ' disabled' : ''}${draft !== null ? ' seeking' : ''}`} role="slider" tabIndex={unavailable ? -1 : 0}
    aria-label="播放进度" aria-valuemin={0} aria-valuemax={Math.round(duration || 0)} aria-valuenow={Math.round(position)} aria-valuetext={`${timeLabel(position)}，共${timeLabel(duration || 0)}`} aria-disabled={unavailable}
    onPointerDown={(event) => {
      if (unavailable || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      onSeekStart?.();
      preview(event);
    }}
    onPointerMove={(event) => { if (dragging.current) preview(event); }}
    onPointerUp={(event) => {
      if (!dragging.current) return;
      const next = preview(event);
      dragging.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setDraft(null);
      onSeek(next);
    }}
    onPointerCancel={() => { dragging.current = false; setDraft(null); onSeekCancel?.(); }}
    onLostPointerCapture={() => { if (dragging.current) { dragging.current = false; setDraft(null); onSeekCancel?.(); } }}
    onKeyDown={(event) => {
      if (unavailable) return;
      const changes = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -15, PageUp: 15 };
      if (!(event.key in changes) && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      onSeek(event.key === 'Home' ? 0 : event.key === 'End' ? duration : seekPosition(position + changes[event.key], duration));
    }}>
    <div className="seek-track"><div className="seek-fill" style={{ width: `${percentage}%` }} /><span className="seek-thumb" style={{ left: `${percentage}%` }} /></div>
  </div>;
}
