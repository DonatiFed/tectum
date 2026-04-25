'use client';
import { useRef, useState } from 'react';
import { store, useStore } from '@/lib/store';

export default function CropOverlay() {
  const mode = useStore(s => s.mode);
  const [rect, setRect] = useState(null);
  const start = useRef(null);
  const active = mode === 'crop';

  function onDown(e) {
    if (!active || e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY };
    setRect({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
  }
  function onMove(e) {
    if (!start.current) return;
    setRect({ x1: start.current.x, y1: start.current.y, x2: e.clientX, y2: e.clientY });
  }
  function onUp() {
    if (!start.current) return;
    const r = rect;
    start.current = null;
    if (!r) return;
    const w = Math.abs(r.x2 - r.x1);
    const h = Math.abs(r.y2 - r.y1);
    if (w < 8 || h < 8) { setRect(null); return; }
    window.dispatchEvent(new CustomEvent('crop:apply', {
      detail: {
        x1: Math.min(r.x1, r.x2), y1: Math.min(r.y1, r.y2),
        x2: Math.max(r.x1, r.x2), y2: Math.max(r.y1, r.y2),
      },
    }));
    setRect(null);
  }

  // Render overlay only in crop mode (so it doesn't intercept clicks otherwise).
  if (!active) return null;

  const left = rect ? Math.min(rect.x1, rect.x2) : 0;
  const top = rect ? Math.min(rect.y1, rect.y2) : 0;
  const width = rect ? Math.abs(rect.x2 - rect.x1) : 0;
  const height = rect ? Math.abs(rect.y2 - rect.y1) : 0;

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      style={{
        position: 'absolute', inset: 0, zIndex: 15,
        cursor: 'crosshair', background: 'rgba(0,0,0,0.05)',
        userSelect: 'none', touchAction: 'none',
      }}
    >
      {rect && (
        <div style={{
          position: 'absolute', left, top, width, height,
          border: '2px dashed #f5a623',
          background: 'rgba(245, 166, 35, 0.10)',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
          pointerEvents: 'none',
        }} />
      )}
      <div style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(245, 166, 35, 0.95)', color: '#1a1a2e',
        padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: '0.78rem',
        pointerEvents: 'none',
      }}>
        ✂ Drag a rectangle around the building you want to inspect
      </div>
    </div>
  );
}
