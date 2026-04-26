'use client';
import { useStore } from '../lib/store';

export default function DebugHUD() {
  const debugOn = useStore(s => s.debugOn);
  const hud     = useStore(s => s.hud);
  const mode    = useStore(s => s.mode);
  if (!debugOn) return null;

  const rows = [
    ['mode',          mode],
    ['autoOrient',    hud.autoOrient],
    ['modelBounds',   hud.modelBounds],
    ['modelSize',     hud.modelSize],
    ['upTriangles',   hud.upTriangles],
    ['cameraPos',     hud.cameraPos],
    ['cameraTarget',  hud.cameraTarget],
    ['cropRegion',    hud.cropRegion],
    ['clipPlanes',    hud.clipPlanes],
    ['lastHit',       hud.lastHit],
    ['lastNormal',    hud.lastNormal],
    ['detectMsg',     hud.detectMsg],
    ['roofs',         hud.roofCount],
    ['activeRoof',    hud.activeRoof],
  ];

  return (
    <div style={{
      position: 'absolute', top: 64, left: 12, zIndex: 20,
      background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(6px)',
      color: '#e0e0e0', fontFamily: 'ui-monospace, "Cascadia Code", Menlo, monospace',
      fontSize: '11px', lineHeight: 1.5,
      border: '1px solid #f5a623', borderRadius: 6,
      padding: '8px 12px', maxWidth: 480, pointerEvents: 'none',
      boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    }}>
      <div style={{ color: '#f5a623', fontWeight: 700, marginBottom: 4, letterSpacing: '0.08em' }}>🐞 DEBUG OVERLAY</div>
      {rows.map(([k, v]) => (
        <div key={k}>
          <span style={{ color: '#888' }}>{k.padEnd(13, ' ')}</span>
          <span style={{ color: '#f5a623' }}> {v ?? '—'}</span>
        </div>
      ))}
    </div>
  );
}
