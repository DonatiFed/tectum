'use client';
import { useMemo } from 'react';
import { store, useStore } from '../lib/store';
import { PANEL_TYPES } from '../lib/catalog';
import { sunDirection, panelIrradiance, dailyCurve, dailyEnergy, fmtHour } from '../lib/solar';

export default function PanelDashboard() {
  const db        = useStore(s => s.activePanelDashboard);
  const solarTime = useStore(s => s.solarTime);
  const solarDay  = useStore(s => s.solarDayOfYear);
  const solarLat  = useStore(s => s.solarLatitude);
  const roofs     = useStore(s => s.roofs);
  const panelIdx  = useStore(s => s.panelTypeIdx);
  const custom    = useStore(s => s.customPanel);

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
    />
  );
}

function DashboardCard({ panel, irr, area, power, panelEff, sun, solarTime, solarDay, solarLat, roofId, panelIndex }) {
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

  const incidenceAngle = sun.belowHorizon
    ? '—'
    : `${(90 - Math.asin(Math.max(0, irr / 1000)) * 180 / Math.PI).toFixed(1)}°`;

  return (
    <div style={{
      position: 'fixed', bottom: 100, left: 'calc((100% - 320px) / 2)',
      transform: 'translateX(-50%)',
      zIndex: 50,
      background: 'rgba(10,18,34,0.97)',
      border: '1px solid #f5a623', borderRadius: 14,
      padding: '14px 16px', width: 300,
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
          onClick={() => store.set({ activePanelDashboard: null })}
          style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}
        >✕</button>
      </div>

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
