'use client';

const dispatch  = (name, detail) => window.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined));
const rotate    = (dir)     => dispatch('cam:rotate',  dir);
const compass   = (bearing) => dispatch('cam:compass', bearing);

// Sidebar occupies 320px on the right. The rotation pad sits as two stacked
// columns docked against the LEFT edge of the visible canvas — far enough
// from the centre to never overlap the TabsBar, hint, sidebars or bottom
// dock. Buttons are fully opaque so they read clearly against the 3D scene.
const LEFT_EDGE = 18;
const COL_GAP   = 10;

export default function RotationPad() {
  // Vertical centre column = tilt arrows; second column to its right = rotate
  // arrows; cardinals (N/E/S/W) sit directly below in a 2×2 mini-pad.
  const anchor = {
    position: 'absolute',
    left: LEFT_EDGE,
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 44,
    display: 'flex', alignItems: 'center', gap: 14,
    pointerEvents: 'none',
  };

  return (
    <div style={anchor}>
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
    </div>
  );
}

const col = () => ({
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: COL_GAP,
  pointerEvents: 'auto',
});
const Spacer = () => <div style={{ width: 44, height: 8 }} />;

function RoundBtn({ variant, onClick, title, children }) {
  const isCompass = variant === 'compass';
  const size      = isCompass ? 40 : 46;
  const fontSize  = isCompass ? '0.85rem' : '1.2rem';
  // Fully opaque palette — the pad is now docked at the canvas edge so it
  // can be solid without crowding the model.
  const baseBg     = '#0d1b2a';
  const baseBorder = '#f5a623';
  const baseColor  = '#f5a623';
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
