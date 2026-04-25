'use client';
import { useStore } from '@/lib/store';

const CLICK_DRAG_THRESHOLD_PX = 4;

export default function PolygonOverlay() {
  const mode  = useStore(s => s.mode);
  const draft = useStore(s => s.polygonDraft);
  const active = mode === 'polygon';

  // Track pointer-down position so a click is distinguished from a tiny pan
  // drag — only true clicks should drop a corner.
  function onPointerDown(e) {
    if (!active || e.button !== 0) return;
    e.currentTarget.dataset.downX = String(e.clientX);
    e.currentTarget.dataset.downY = String(e.clientY);
  }
  function onClick(e) {
    if (!active) return;
    const dx = e.clientX - Number(e.currentTarget.dataset.downX || e.clientX);
    const dy = e.clientY - Number(e.currentTarget.dataset.downY || e.clientY);
    if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) return;
    window.dispatchEvent(new CustomEvent('polygon:addPoint', {
      detail: { x: e.clientX, y: e.clientY },
    }));
  }
  function onDoubleClick(e) {
    if (!active) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('polygon:finish'));
  }

  if (!active) return null;
  const count = (draft ?? []).length;

  return (
    <div
      onPointerDown={onPointerDown}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute', inset: 0, zIndex: 14,
        cursor: 'crosshair', background: 'transparent',
        userSelect: 'none', touchAction: 'none',
      }}
    >
      <div style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(6, 182, 212, 0.95)',
        color: '#0a0e1a',
        padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: '0.78rem',
        pointerEvents: 'none', maxWidth: '80%', textAlign: 'center',
      }}>
        ◇ Polygon mode · {count} corner{count === 1 ? '' : 's'} · click corners on the building · double-click to finish
      </div>
      <div style={{
        position: 'absolute', bottom: 90, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 8, pointerEvents: 'auto', zIndex: 16,
      }}>
        <button
          onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('polygon:undo')); }}
          disabled={count === 0}
          style={btn(count > 0, '#38506d', '#cbd5e1')}
          title="Remove last corner"
        >↶ Undo</button>
        <button
          onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('polygon:finish')); }}
          disabled={count < 3}
          style={btn(count >= 3, '#06b6d4', '#0a0e1a')}
          title="Close the polygon and create the roof (need ≥3 corners)"
        >✓ Finish ({count})</button>
        <button
          onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('polygon:cancel')); }}
          style={btn(true, '#4a2030', '#ff7070')}
          title="Discard the polygon in progress"
        >✕ Cancel</button>
      </div>
    </div>
  );
}

function btn(enabled, bg, fg) {
  return {
    background: enabled ? bg : '#2a2a4a',
    color: enabled ? fg : '#666',
    border: 'none', borderRadius: 999, padding: '8px 16px',
    fontSize: '0.8rem', fontWeight: 700,
    cursor: enabled ? 'pointer' : 'not-allowed',
    boxShadow: '0 8px 22px rgba(0,0,0,0.45)',
  };
}
