'use client';
import { useRef, useState } from 'react';
import { useStore } from '@/lib/store';

const CLICK_THRESHOLD_PX = 6;       // <= → treat as a click on a roof segment

export default function EraseOverlay() {
  const mode = useStore(s => s.mode);
  const activeId = useStore(s => s.activeRoofId);
  const [points, setPoints] = useState(null);
  const drawing = useRef(false);
  const active = mode === 'erase';

  function onDown(e) {
    if (!active || e.button !== 0) return;
    drawing.current = true;
    setPoints([[e.clientX, e.clientY]]);
  }
  function onMove(e) {
    if (!drawing.current) return;
    setPoints(prev => {
      if (!prev) return [[e.clientX, e.clientY]];
      const last = prev[prev.length - 1];
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      if (dx * dx + dy * dy < 4) return prev;
      return [...prev, [e.clientX, e.clientY]];
    });
  }
  function onUp(e) {
    if (!drawing.current) return;
    drawing.current = false;
    const pts = points;
    setPoints(null);
    if (!pts || pts.length === 0) return;

    let pathLen = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i-1][0], dy = pts[i][1] - pts[i-1][1];
      pathLen += Math.hypot(dx, dy);
    }

    // Short stroke → click on a segment to delete it
    if (pathLen < CLICK_THRESHOLD_PX || pts.length < 2) {
      window.dispatchEvent(new CustomEvent('roof:deleteAt', {
        detail: { x: pts[0][0], y: pts[0][1] },
      }));
      return;
    }

    // Drag → delete every roof whose polygon outline the stroke crosses
    window.dispatchEvent(new CustomEvent('roof:deleteByEdgeCross', {
      detail: { points: pts },
    }));
  }

  if (!active) return null;

  const pathStr = points && points.length
    ? 'M ' + points.map(p => `${p[0]} ${p[1]}`).join(' L ')
    : '';

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      style={{
        position: 'absolute', inset: 0, zIndex: 15,
        cursor: 'crosshair', background: 'transparent',
        userSelect: 'none', touchAction: 'none',
      }}
    >
      {pathStr && (
        <svg width="100%" height="100%"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <path d={pathStr} stroke="#ff3344" strokeWidth="14"
            fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
          <path d={pathStr} stroke="#ffffff" strokeWidth="2"
            fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
        </svg>
      )}
      <div style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(255, 51, 68, 0.95)',
        color: '#fff',
        padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: '0.78rem',
        pointerEvents: 'none', maxWidth: '80%', textAlign: 'center',
      }}>
        ✏ Click a segment to delete it · Or drag across edges — every roof your stroke crosses gets erased on release
      </div>
    </div>
  );
}

