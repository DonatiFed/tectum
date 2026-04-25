'use client';
import { useRef, useState } from 'react';
import { store, useStore } from '@/lib/store';

const CLICK_THRESHOLD_PX = 6;

export default function PickOverlay() {
  const mode = useStore(s => s.mode);
  const [rect, setRect] = useState(null);
  const start = useRef(null);
  const additive = useRef(false);
  const active = mode === 'pick';

  function onDown(e) {
    if (!active || e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY };
    additive.current = !!(e.shiftKey || e.metaKey || e.ctrlKey);
    setRect({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
  }
  function onMove(e) {
    if (!start.current) return;
    setRect({ x1: start.current.x, y1: start.current.y, x2: e.clientX, y2: e.clientY });
  }
  function onUp(e) {
    const s = start.current;
    if (!s) return;
    start.current = null;
    const wasAdditive = additive.current;
    setRect(null);
    const w = Math.abs(e.clientX - s.x);
    const h = Math.abs(e.clientY - s.y);
    if (w < CLICK_THRESHOLD_PX || h < CLICK_THRESHOLD_PX) {
      store.set({ hint: 'Drag a rectangle across the roofs you want to select' });
      return;
    }
    window.dispatchEvent(new CustomEvent('roofs:pickInRect', {
      detail: {
        x1: Math.min(s.x, e.clientX), y1: Math.min(s.y, e.clientY),
        x2: Math.max(s.x, e.clientX), y2: Math.max(s.y, e.clientY),
        additive: wasAdditive,
      },
    }));
  }

  if (!active) return null;

  const left   = rect ? Math.min(rect.x1, rect.x2) : 0;
  const top    = rect ? Math.min(rect.y1, rect.y2) : 0;
  const width  = rect ? Math.abs(rect.x2 - rect.x1) : 0;
  const height = rect ? Math.abs(rect.y2 - rect.y1) : 0;
  const isDragging = rect && (width > CLICK_THRESHOLD_PX || height > CLICK_THRESHOLD_PX);

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => { start.current = null; setRect(null); }}
      style={{
        position: 'absolute', inset: 0, zIndex: 15,
        cursor: 'crosshair', background: 'transparent',
        userSelect: 'none', touchAction: 'none',
      }}
    >
      {isDragging && (
        <div style={{
          position: 'absolute', left, top, width, height,
          border: '2px dashed #a855f7',
          background: 'rgba(168, 85, 247, 0.12)',
          pointerEvents: 'none',
        }} />
      )}
      <div style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(168, 85, 247, 0.95)', color: '#0d1b2a',
        padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: '0.78rem',
        pointerEvents: 'none', maxWidth: '80%', textAlign: 'center',
      }}>
        ⬚ Pick mode · drag a rectangle to select every roof inside it · hold Shift to add to current selection
      </div>
    </div>
  );
}
