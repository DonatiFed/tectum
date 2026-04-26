'use client';

import { useState } from 'react';

const dispatch  = (name, detail) => window.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined));
const rotate    = (dir)     => dispatch('cam:rotate',  dir);
const compass   = (bearing) => dispatch('cam:compass', bearing);
const zoom      = (dir)     => dispatch('cam:zoom',    dir);
const preset    = (name)    => dispatch(name);

// Sidebar occupies 320px on the right. The rotation pad sits docked against
// the LEFT edge of the visible canvas inside a collapsible panel — the
// installer can hide it to free up space and bring it back at any time.
// Always rendered (every tab) so view controls are universally reachable.
const LEFT_EDGE = 18;
const COL_GAP   = 10;

export default function RotationPad() {
  const [open, setOpen] = useState(true);

  const anchor = {
    position: 'absolute',
    left: LEFT_EDGE,
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 44,
    display: 'flex', alignItems: 'center', gap: 8,
    pointerEvents: 'none',
  };

  // Collapse handle — a vertical pill on the left edge that toggles the pad.
  const handle = (
    <button
      onClick={() => setOpen(o => !o)}
      title={open ? 'Hide view controls' : 'Show view controls'}
      style={{
        pointerEvents: 'auto',
        width: 22, minHeight: 64,
        background: '#0d1b2a',
        border: '2px solid #f5a623',
        borderRadius: 12,
        color: '#f5a623', fontWeight: 800, fontSize: '0.85rem',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '8px 0',
        boxShadow: '0 8px 18px rgba(0,0,0,0.55)',
        writingMode: 'vertical-rl',
        letterSpacing: '0.12em',
      }}
    >{open ? '◀  Hide' : '▶  View'}</button>
  );

  if (!open) {
    return <div style={anchor}>{handle}</div>;
  }

  return (
    <div style={anchor}>
      {handle}
      {/* Tilt + rotate arrows — vertical 3-row layout per column */}
      <div style={col()}>
        <RoundBtn variant="arrow" onClick={() => rotate('up')}    title="Tilt up 15°">⤒</RoundBtn>
        <Spacer />
        <RoundBtn variant="arrow" onClick={() => rotate('down')}  title="Tilt down 15°">⤓</RoundBtn>
      </div>
      <div style={col()}>
        <RoundBtn variant="arrow" onClick={() => rotate('left')}  title="Rotate left 15°">↺</RoundBtn>
        <Spacer />
        <RoundBtn variant="arrow" onClick={() => rotate('right')} title="Rotate right 15°">↻</RoundBtn>
      </div>
      {/* Cardinal compass presets — 2×2 grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, auto)', gap: COL_GAP, pointerEvents: 'auto' }}>
        <RoundBtn variant="compass" onClick={() => compass('N')} title="View from North">N</RoundBtn>
        <RoundBtn variant="compass" onClick={() => compass('E')} title="View from East">E</RoundBtn>
        <RoundBtn variant="compass" onClick={() => compass('W')} title="View from West">W</RoundBtn>
        <RoundBtn variant="compass" onClick={() => compass('S')} title="View from South">S</RoundBtn>
      </div>
      {/* Zoom + view presets — 2×3 grid (zoom column + reset/top/45 column).
          Lives on the side panel so it's reachable from every tab. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, auto)', gap: COL_GAP, pointerEvents: 'auto' }}>
        <RoundBtn variant="compass" onClick={() => zoom('in')}  title="Zoom in">＋</RoundBtn>
        <RoundBtn variant="preset"  onClick={() => preset('cam:reset')} title="Reset framing">⟲</RoundBtn>
        <RoundBtn variant="compass" onClick={() => zoom('out')} title="Zoom out">－</RoundBtn>
        <RoundBtn variant="preset"  onClick={() => preset('cam:top')}   title="Top-down view">⬒</RoundBtn>
        <span />
        <RoundBtn variant="preset"  onClick={() => preset('cam:persp')} title="45° vertical tilt" highlight>45°</RoundBtn>
      </div>
    </div>
  );
}

const col = () => ({
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: COL_GAP,
  pointerEvents: 'auto',
});
const Spacer = () => <div style={{ width: 44, height: 8 }} />;

function RoundBtn({ variant, onClick, title, children, highlight }) {
  const isCompass = variant === 'compass';
  const isPreset  = variant === 'preset';
  const size      = (isCompass || isPreset) ? 40 : 46;
  const fontSize  = (isCompass || isPreset) ? '0.85rem' : '1.2rem';
  // Fully opaque palette — the pad is now docked at the canvas edge so it
  // can be solid without crowding the model. The "highlight" flag inverts
  // the palette so a single button (e.g. 45°) reads as the primary action.
  const baseBg     = highlight ? '#f5a623' : '#0d1b2a';
  const baseBorder = '#f5a623';
  const baseColor  = highlight ? '#0d1b2a' : '#f5a623';
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: size, height: size, borderRadius: '50%',
        background: baseBg,
        border: `2px solid ${baseBorder}`,
        color: baseColor,
        fontSize, fontWeight: 800,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 18px rgba(0,0,0,0.55)',
        transition: 'background 0.15s, color 0.15s',
        letterSpacing: isCompass ? '0.04em' : 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#f5a623';
        e.currentTarget.style.color      = '#0d1b2a';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = baseBg;
        e.currentTarget.style.color      = baseColor;
      }}
    >{children}</button>
  );
}
