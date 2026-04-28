'use client';
import { useState } from 'react';
import { store, useStore } from '@/lib/store';
import { sunDirection, doyToLabel, fmtHour, specificYield } from '@/lib/solar';
import { PANEL_TYPES } from '@/lib/catalog';
import { btnStyle } from './SolarPlanner';
import PanelDashboard from './PanelDashboard';

// kg CO₂ avoided per kWh (EU average grid mix 2024)
const CO2_PER_KWH = 0.257;

export default function SolarTool() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ position: 'absolute', top: 12, right: 12, zIndex: 30, ...btnStyle('primary') }}
      >{open ? '✕ Close' : '☀️ Solar'}</button>

      <aside style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width: 320,
        background: 'rgba(22,33,62,0.95)', backdropFilter: 'blur(8px)',
        borderLeft: '1px solid #2a2a4a', overflowY: 'auto', zIndex: 25,
        padding: '60px 16px 180px', display: 'flex', flexDirection: 'column', gap: 16,
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s ease',
      }}>
        <SolarSidebarContent />
      </aside>

      <SolarTimeBar />
      <PanelDashboard />
    </>
  );
}

function SolarSidebarContent() {
  const solarTime = useStore(s => s.solarTime);
  const solarDay  = useStore(s => s.solarDayOfYear);
  const solarLat  = useStore(s => s.solarLatitude);
  const sun = sunDirection(solarLat, solarDay, solarTime);

  return (
    <>
      <Section title="Solar Irradiance Simulation">
        <p style={{ fontSize: '0.78rem', color: '#9ca3af', lineHeight: 1.5, margin: 0 }}>
          Simulates the sun path for the selected date and location.
          Panel colours show irradiance in real time — click any panel to
          open its daily energy dashboard.
        </p>
      </Section>

      <Divider />

      <Section title="Location">
        <label style={labelStyle}>
          Latitude: <b style={{ color: '#f5a623' }}>{solarLat.toFixed(1)}°</b>
        </label>
        <input
          type="range" min="-70" max="70" step="0.5" value={solarLat}
          onChange={e => store.set({ solarLatitude: +e.target.value })}
          style={{ width: '100%', accentColor: '#f5a623' }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { label: 'Rome',    lat: 41.9 },
            { label: 'Munich',  lat: 48.1 },
            { label: 'Hamburg', lat: 53.5 },
            { label: 'Oslo',    lat: 59.9 },
          ].map(({ label, lat }) => (
            <button key={label}
              onClick={() => store.set({ solarLatitude: lat })}
              style={{
                flex: 1, padding: '4px 0', borderRadius: 4, cursor: 'pointer', fontSize: '0.7rem',
                background: Math.abs(solarLat - lat) < 0.3 ? '#f5a623' : '#2a2a4a',
                color:      Math.abs(solarLat - lat) < 0.3 ? '#1a1a2e' : '#e0e0e0',
                border: 'none', fontWeight: 700,
              }}
            >{label}</button>
          ))}
        </div>
      </Section>

      <Section title={`Date: ${doyToLabel(solarDay)}`}>
        <input
          type="range" min="1" max="365" step="1" value={solarDay}
          onChange={e => store.set({ solarDayOfYear: +e.target.value })}
          style={{ width: '100%', accentColor: '#f5a623' }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { label: 'Jun 21', doy: 172 },
            { label: 'Sep 22', doy: 265 },
            { label: 'Dec 21', doy: 355 },
            { label: 'Mar 20', doy: 79  },
          ].map(({ label, doy }) => (
            <button key={label}
              onClick={() => store.set({ solarDayOfYear: doy })}
              style={{
                flex: 1, padding: '4px 0', borderRadius: 4, cursor: 'pointer', fontSize: '0.7rem',
                background: Math.abs(solarDay - doy) < 3 ? '#f5a623' : '#2a2a4a',
                color:      Math.abs(solarDay - doy) < 3 ? '#1a1a2e' : '#e0e0e0',
                border: 'none', fontWeight: 700,
              }}
            >{label}</button>
          ))}
        </div>
      </Section>

      <Divider />

      <Section title="Sun now">
        <InfoBox rows={[
          ['Time',      fmtHour(solarTime)],
          ['Elevation', sun.belowHorizon ? 'Below horizon' : `${sun.elevationDeg.toFixed(1)}°`],
          ['Azimuth',   sun.belowHorizon ? '—'             : `${sun.azimuthDeg.toFixed(1)}°`],
          ['Status',    sun.belowHorizon ? '🌙 Night'       : '☀️ Day'],
        ]} />
      </Section>

      <Divider />

      <Section title="Irradiance legend">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{
            height: 14, borderRadius: 6,
            background: 'linear-gradient(to right, #1a237e, #ff8c00, #ffff88)',
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#888' }}>
            <span>0 W/m²</span>
            <span>500 W/m²</span>
            <span>1000 W/m²</span>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>
            Click a panel in the 3D view to open its daily energy dashboard.
          </div>
        </div>
      </Section>

      <Divider />

      <ProductionEstimate lat={solarLat} />
    </>
  );
}

export function SolarTimeBar() {
  const solarTime = useStore(s => s.solarTime);
  const playing   = useStore(s => s.solarPlaying);
  const [speed, setSpeed] = useState(1); // multiplier: 1=normal, 2=fast, 0.5=slow

  // Expose speed to the store via a custom event so SunAnimator can read it
  // without adding it to the main store.
  const setSpeedAndBroadcast = (v) => {
    setSpeed(v);
    window.dispatchEvent(new CustomEvent('solar:speed', { detail: v }));
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 18,
      left: 'calc((100% - 320px) / 2)',
      transform: 'translateX(-50%)',
      zIndex: 45,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    }}>
      <div style={{
        display: 'flex', gap: 10, background: 'rgba(10,18,34,0.96)',
        border: '1px solid #38506d', borderRadius: 16,
        padding: '10px 16px', alignItems: 'center',
        boxShadow: '0 14px 40px rgba(0,0,0,0.45)',
      }}>
        {/* Play / pause */}
        <button
          onClick={() => store.set(s => ({ solarPlaying: !s.solarPlaying }))}
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: playing ? '#f5a623' : '#2a2a4a',
            color: playing ? '#1a1a2e' : '#f5a623',
            border: 'none', cursor: 'pointer', fontSize: '1rem', fontWeight: 800,
          }}
          title={playing ? 'Pause sun animation' : 'Play sun animation'}
        >{playing ? '⏸' : '▶'}</button>

        {/* Time slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <input
            type="range" min="0" max="24" step="0.1" value={solarTime}
            onChange={e => store.set({ solarTime: +e.target.value, solarPlaying: false })}
            style={{ width: 200, accentColor: '#f5a623' }}
          />
          <span style={{ fontSize: '0.75rem', color: '#f5a623', fontWeight: 700, letterSpacing: '0.05em' }}>
            {fmtHour(solarTime)} — {doyToLabel(store.get().solarDayOfYear)}
          </span>
        </div>

        {/* Speed */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {[['½×', 0.5], ['1×', 1], ['2×', 2], ['4×', 4]].map(([lbl, v]) => (
              <button key={v}
                onClick={() => setSpeedAndBroadcast(v)}
                style={{
                  padding: '3px 6px', borderRadius: 4, cursor: 'pointer', fontSize: '0.65rem',
                  background: speed === v ? '#f5a623' : '#2a2a4a',
                  color:      speed === v ? '#1a1a2e' : '#aaa',
                  border: 'none', fontWeight: 700,
                }}
              >{lbl}</button>
            ))}
          </div>
          <span style={{ fontSize: '0.58rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Speed</span>
        </div>
      </div>
    </div>
  );
}

// ── Production estimate ──────────────────────────────────────────────────
function ProductionEstimate({ lat }) {
  const roofs      = useStore(s => s.roofs);
  const panelIdx   = useStore(s => s.panelTypeIdx);
  const customPanel = useStore(s => s.customPanel);

  const panel = panelIdx === -1 ? customPanel : PANEL_TYPES[panelIdx];
  if (!panel) return null;

  const totalPanels = roofs.reduce((acc, r) => acc + (r.panels?.length ?? 0), 0);
  const totalKwp    = (totalPanels * panel.wp) / 1000;
  const yield_      = specificYield(lat);           // kWh/kWp/year
  const systemEff   = 0.85;                          // inverter + wiring losses
  const annualKwh   = totalKwp * yield_ * systemEff;
  const co2Saved    = annualKwh * CO2_PER_KWH;       // kg/year
  const area        = totalPanels * panel.w * panel.h;
  const panelEff    = panel.efficiency ?? (panel.wp / (1000 * panel.w * panel.h) * 100);

  if (totalPanels === 0) {
    return (
      <Section title="Stima produzione">
        <div style={{ fontSize: '0.78rem', color: '#555' }}>
          Nessun pannello nel workspace — vai nel tab <b style={{ color: '#f5a623' }}>Templates</b> e posiziona i pannelli.
        </div>
      </Section>
    );
  }

  // Monthly breakdown — proportional to daily irradiance at this latitude
  const MONTH_FACTORS = [0.38, 0.52, 0.73, 0.95, 1.12, 1.18, 1.15, 1.08, 0.88, 0.65, 0.42, 0.32];
  const MONTHS_SHORT  = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
  const sumFactors    = MONTH_FACTORS.reduce((a, b) => a + b, 0);
  const monthlyKwh    = MONTH_FACTORS.map(f => (annualKwh * f) / sumFactors);
  const maxMonth      = Math.max(...monthlyKwh);

  return (
    <Section title="Stima produzione">
      {/* Panel info */}
      <div style={{
        background: '#0f172a', border: '1px solid #2a2a4a', borderRadius: 8,
        padding: '10px 12px', fontSize: '0.75rem',
      }}>
        <div style={{ color: '#888', marginBottom: 6, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Pannello selezionato
        </div>
        <div style={{ color: '#e0e0e0', fontWeight: 600 }}>{panel.brand ?? 'Custom'} {panel.model ?? ''}</div>
        <div style={{ color: '#888', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>{panel.wp} Wp</span>
          <span>{panel.w.toFixed(3)}×{panel.h.toFixed(3)} m</span>
          <span>{panelEff.toFixed(1)}% eff.</span>
          {panel.weight_kg && <span>{panel.weight_kg} kg</span>}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <KPI label="Pannelli"      value={totalPanels} />
        <KPI label="Potenza tot."  value={`${totalKwp.toFixed(2)} kWp`} hi />
        <KPI label="Area totale"   value={`${area.toFixed(1)} m²`} />
        <KPI label="Resa spec."    value={`${Math.round(yield_)} kWh/kWp`} />
        <KPI label="Prod. annua"   value={`${Math.round(annualKwh).toLocaleString('it-IT')} kWh`} hi />
        <KPI label="CO₂ evitata"   value={`${(co2Saved / 1000).toFixed(2)} t/anno`} hi />
      </div>

      {/* Monthly bar chart */}
      <div>
        <div style={{ fontSize: '0.68rem', color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Produzione mensile stimata
        </div>
        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 56 }}>
          {monthlyKwh.map((v, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{
                width: '100%', borderRadius: '2px 2px 0 0',
                background: `linear-gradient(to top, #f5a623, #ffdd57)`,
                height: `${(v / maxMonth) * 48}px`,
                minHeight: 2,
              }} />
              <div style={{ fontSize: '0.52rem', color: '#555', textAlign: 'center' }}>{MONTHS_SHORT[i]}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: '0.68rem', color: '#555', marginTop: 4 }}>
          Sistema: {Math.round(systemEff * 100)}% efficienza ·
          Latitudine: {lat.toFixed(1)}°
        </div>
      </div>
    </Section>
  );
}

function KPI({ label, value, hi }) {
  return (
    <div style={{
      background: '#0f172a', border: '1px solid #2a2a4a',
      borderRadius: 6, padding: '6px 10px',
    }}>
      <div style={{ fontSize: '0.62rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: '0.88rem', color: hi ? '#f5a623' : '#cbd5e1', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888' }}>{title}</div>
      {children}
    </div>
  );
}

function Divider() { return <div style={{ height: 1, background: '#2a2a4a' }} />; }

function InfoBox({ rows }) {
  return (
    <div style={{
      background: '#0f172a', border: '1px solid #2a2a4a', borderRadius: 8,
      padding: 12, fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#888' }}>{k}</span>
          <span style={{ color: '#f5a623', fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

const labelStyle = { fontSize: '0.78rem', color: '#cbd5e1', display: 'block' };
