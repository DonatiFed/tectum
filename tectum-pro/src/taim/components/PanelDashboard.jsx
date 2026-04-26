'use client';
import { useMemo } from 'react';
import { store, useStore } from '../lib/store';
import { PANEL_TYPES } from '../lib/catalog';
import { sunDirection, panelIrradiance, dailyCurve, dailyEnergy, fmtHour } from '../lib/solar';

const dispatch = (name, detail) =>
  window.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined));

export default function PanelDashboard() {
  const db        = useStore(s => s.activePanelDashboard);
  const solarTime = useStore(s => s.solarTime);
  const solarDay  = useStore(s => s.solarDayOfYear);
  const solarLat  = useStore(s => s.solarLatitude);
  const roofs     = useStore(s => s.roofs);
  const panelIdx  = useStore(s => s.panelTypeIdx);
  const custom    = useStore(s => s.customPanel);
  const activeTab = useStore(s => s.activeTab);
  const dropping  = useStore(s => s.mode) === 'panel-drop';
  const clipboard = useStore(s => s.singlePanelClipboard);

  if (!db) return null;
  const roof  = roofs.find(r => r.id === db.roofId);
  const panel = roof?.panels?.[db.index];
  if (!panel) return null;

  const catalogEntry = panelIdx === -1 ? custom : PANEL_TYPES[panelIdx];
  const effPct = catalogEntry?.efficiency ?? (panel.wp ? panel.wp / (1000 * panel.w * panel.h) * 100 : 19);
  const panelEff = effPct / 100;

  const sun   = sunDirection(solarLat, solarDay, solarTime);
  const irr   = sun.belowHorizon ? 0 : panelIrradiance(panel.quat, sun);
  const area  = panel.w * panel.h;
  const power = irr * area * panelEff;

  return (
    <DashboardCard
      panel={panel} irr={irr} area={area} power={power} panelEff={panelEff}
      sun={sun} solarTime={solarTime} solarDay={solarDay} solarLat={solarLat}
      roofId={db.roofId} panelIndex={db.index}
      showActions={activeTab !== 'solar'}
      dropping={dropping} clipboard={clipboard}
    />
  );
}

function DashboardCard({ panel, irr, area, power, panelEff, sun, solarTime, solarDay, solarLat, roofId, panelIndex, showActions, dropping, clipboard }) {
  // Curve memoised on lat/day/quat — doesn't change with time
  const qx = panel.quat.x, qy = panel.quat.y, qz = panel.quat.z, qw = panel.quat.w;
  const curve = useMemo(
    () => dailyCurve(solarLat, solarDay, panel.quat),
    [solarLat, solarDay, qx, qy, qz, qw], // eslint-disable-line
  );
  const totalEnergyWh = useMemo(
    () => dailyEnergy(solarLat, solarDay, panel.quat) * area * panelEff,
    [solarLat, solarDay, qx, qy, qz, qw, area, panelEff], // eslint-disable-line
  );

  // SVG sparkline
  const CW = 260, CH = 72;
  const polyPts = curve.map(p => `${(p.hour / 24) * CW},${CH - (p.irr / 1000) * CH}`).join(' ');
  const nowX    = (solarTime / 24) * CW;
  const nowY    = CH - (irr / 1000) * CH;

  return (
    <div style={{
      position: 'fixed', bottom: 100, left: 'calc((100% - 320px) / 2)',
      transform: 'translateX(-50%)',
      zIndex: 50,
      background: 'rgba(10,18,34,0.97)',
      border: '1px solid #f5a623', borderRadius: 14,
      padding: '14px 16px', width: 320,
      boxShadow: '0 20px 60px rgba(0,0,0,0.65)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#f5a623', fontWeight: 700, fontSize: '0.85rem' }}>
          ☀️ Panel {panelIndex + 1} &nbsp;·&nbsp;
          <span style={{ color: '#888', fontWeight: 400 }}>{roofId.slice(-8)}</span>
        </span>
        <button
          onClick={() => store.set({ activePanelDashboard: null, selectedPanelKeys: [] })}
          style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}
        >✕</button>
      </div>

      {/* ── Per-panel actions: rotate, delete, copy, drop, place / clear
            on host roof. Lives here (popup) so the right sidebar stays
            focused on the global layout recipe. ── */}
      {showActions && (
        <ActionsBlock
          roofId={roofId} panelIndex={panelIndex}
          dropping={dropping} clipboard={clipboard}
        />
      )}

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <Stat label="Irradiance now" value={`${irr.toFixed(0)} W/m²`} hi={irr > 600} />
        <Stat label="Power now"      value={`${power.toFixed(1)} W`}    hi={power > 50} />
        <Stat label="Panel area"     value={`${area.toFixed(2)} m²`} />
        <Stat label="Daily energy"   value={`${(totalEnergyWh / 1000).toFixed(3)} kWh`} hi />
      </div>

      {/* Angle info */}
      <div style={{
        fontSize: '0.72rem', color: '#9ca3af',
        padding: '6px 8px', background: '#0f172a',
        border: '1px solid #2a2a4a', borderRadius: 6,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>Sun elev: <b style={{ color: '#cbd5e1' }}>{sun.belowHorizon ? '—' : `${sun.elevationDeg.toFixed(1)}°`}</b></span>
        <span>Efficiency: <b style={{ color: '#cbd5e1' }}>{(irr / 10).toFixed(0)}%</b></span>
      </div>

      {/* Daily irradiance chart */}
      <div>
        <div style={{ fontSize: '0.68rem', color: '#666', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Daily irradiance — {fmtHour(solarTime)} cursor
        </div>
        <svg width={CW} height={CH + 14} style={{ display: 'block', borderRadius: 6, overflow: 'visible' }}>
          {/* Background */}
          <rect width={CW} height={CH} rx="4" fill="#0f172a" />
          {/* Filled area */}
          <polygon
            points={`0,${CH} ${polyPts} ${CW},${CH}`}
            fill="rgba(245,166,35,0.12)"
          />
          {/* Line */}
          <polyline points={polyPts} fill="none" stroke="#f5a623" strokeWidth="1.5" strokeLinejoin="round" />
          {/* Current time cursor */}
          <line x1={nowX} y1={0} x2={nowX} y2={CH} stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="3,3" />
          <circle cx={nowX} cy={nowY} r="4" fill="#fff" stroke="#f5a623" strokeWidth="1.5" />
          {/* Axis labels */}
          <text x={1}       y={CH + 12} fontSize="9" fill="#555">00:00</text>
          <text x={CW/2-12} y={CH + 12} fontSize="9" fill="#555">12:00</text>
          <text x={CW - 24} y={CH + 12} fontSize="9" fill="#555">24:00</text>
        </svg>
      </div>
    </div>
  );
}

function ActionsBlock({ roofId, panelIndex, dropping, clipboard }) {
  const rotate = (deltaDeg) =>
    dispatch('panel:rotateOne', { roofId, index: panelIndex, deltaDeg });
  const onDelete = () => {
    dispatch('panel:deleteSelected');
    store.set({ activePanelDashboard: null });
  };
  return (
    <div style={{
      background: '#0f172a', border: '1px solid #2a2a4a', borderRadius: 8,
      padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: '0.66rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Panel actions
      </div>

      {/* Rotation */}
      <div>
        <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: 4 }}>Rotate this panel around its roof normal</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <RotBtn onClick={() => rotate(-15)} title="-15°">↺ -15°</RotBtn>
          <RotBtn onClick={() => rotate(-5)}  title="-5°">↺ -5°</RotBtn>
          <RotBtn onClick={() => rotate(5)}   title="+5°">↻ +5°</RotBtn>
          <RotBtn onClick={() => rotate(15)}  title="+15°">↻ +15°</RotBtn>
        </div>
      </div>

      {/* Delete / Copy */}
      <div style={{ display: 'flex', gap: 6 }}>
        <ActBtn variant="danger" onClick={onDelete} title="Delete this panel">🗑 Delete</ActBtn>
        <ActBtn onClick={() => dispatch('panel:copySelected')} title="Copy this panel as a drop recipe">⎘ Copy</ActBtn>
      </div>

      {/* Drop new panel toggle */}
      <ActBtn
        variant={dropping ? 'success' : 'primary'}
        disabled={!clipboard && !dropping}
        onClick={() => dispatch(dropping ? 'panel:exitDropMode' : 'panel:enterDropMode')}
        title={clipboard ? 'Click on the building to drop more panels with the copied size' : 'Copy a panel first, then drop'}
      >{dropping ? '⏹ Stop dropping' : '✥ Drop new panel'}</ActBtn>

      {/* Place / Clear (whole host roof) */}
      <div style={{ display: 'flex', gap: 6 }}>
        <ActBtn variant="primary"   onClick={() => dispatch('panels:place')} title="Place panels on this roof using the current recipe">▦ Place roof</ActBtn>
        <ActBtn                     onClick={() => dispatch('panels:clear')} title="Clear all panels on this roof">✕ Clear roof</ActBtn>
      </div>
      <div style={{ fontSize: '0.66rem', color: '#666', lineHeight: 1.4 }}>
        Drag-drop with “Drop new panel”: copy a panel, then click anywhere on
        the building to drop matching panels. Esc to stop.
      </div>
    </div>
  );
}

function RotBtn({ onClick, title, children }) {
  return (
    <button
      onClick={onClick} title={title}
      style={{
        flex: 1, padding: '6px 0', borderRadius: 6, cursor: 'pointer',
        background: '#1a2540', color: '#f5a623', border: '1px solid #2a2a4a',
        fontWeight: 700, fontSize: '0.72rem',
      }}
    >{children}</button>
  );
}

function ActBtn({ variant, disabled, onClick, title, children }) {
  const palette = {
    primary: { bg: '#f5a623', fg: '#0d1b2a', border: '#f5a623' },
    success: { bg: '#4ade80', fg: '#0d1b2a', border: '#4ade80' },
    danger:  { bg: '#3b0d0d', fg: '#fecaca', border: '#ff7070' },
    default: { bg: '#1a2540', fg: '#e0e0e0', border: '#2a2a4a' },
  }[variant || 'default'];
  return (
    <button
      onClick={onClick} title={title} disabled={disabled}
      style={{
        flex: 1, padding: '7px 10px', borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        background: palette.bg, color: palette.fg,
        border: `1px solid ${palette.border}`, fontWeight: 700,
        fontSize: '0.74rem',
      }}
    >{children}</button>
  );
}

function Stat({ label, value, hi }) {
  return (
    <div style={{
      background: '#0f172a', border: '1px solid #2a2a4a',
      borderRadius: 6, padding: '6px 10px',
    }}>
      <div style={{ fontSize: '0.62rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: hi ? '#f5a623' : '#cbd5e1', fontWeight: 700 }}>{value}</div>
    </div>
  );
}
