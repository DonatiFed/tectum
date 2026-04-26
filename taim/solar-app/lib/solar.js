// Solar position + irradiance math — no React/THREE deps

export function sunDirection(latDeg, doy, hour) {
  const D = Math.PI / 180;
  const decl = -23.45 * Math.cos((360 / 365) * (doy + 10) * D) * D;
  const lat  = latDeg * D;
  const ha   = (hour - 12) * 15 * D; // hour angle

  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const alt    = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  if (sinAlt <= 0) return { x: 0, y: -1, z: 0, elevationDeg: alt / D, azimuthDeg: 0, belowHorizon: true };

  const cosAz  = (Math.sin(decl) - Math.sin(lat) * sinAlt) / (Math.cos(lat) * Math.cos(alt) + 1e-9);
  const azRaw  = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  const az     = ha > 0 ? 2 * Math.PI - azRaw : azRaw; // afternoon: sun in west

  // Scene convention: +Y = up, North = -Z, East = +X
  return {
    x: Math.cos(alt) * Math.sin(az),
    y: Math.sin(alt),
    z: -Math.cos(alt) * Math.cos(az),
    elevationDeg: alt / D,
    azimuthDeg:   az  / D,
    belowHorizon: false,
  };
}

// quat: THREE.Quaternion — panel normal is local +Y axis
// sunDir: {x,y,z} from sunDirection()
// Returns irradiance 0..1000 W/m²
export function panelIrradiance(quat, sunDir, peakIrr = 1000) {
  // Rotate local +Y by the panel quaternion to get world normal
  const { x: qx, y: qy, z: qz, w: qw } = quat;
  // Apply quaternion to vector (0,1,0) manually for zero-dep
  // result = q * (0,1,0) * q⁻¹
  const ix =  qw * 0 + qy * 0 - qz * 1; // qw*nx + qy*nz - qz*ny — but nx=0,ny=1,nz=0
  // Shortcut: rotating (0,1,0) by quat gives:
  const nx = 2 * (qx * qy - qw * qz);
  const ny = 1 - 2 * (qx * qx + qz * qz);
  const nz = 2 * (qy * qz + qw * qx);
  const dot = nx * sunDir.x + ny * sunDir.y + nz * sunDir.z;
  return Math.max(0, dot) * peakIrr;
}

// Full 24h irradiance curve for one panel, step = 0.25h
export function dailyCurve(latDeg, doy, quat, steps = 96) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const hour = (i / steps) * 24;
    const dir  = sunDirection(latDeg, doy, hour);
    pts.push({ hour, irr: dir.belowHorizon ? 0 : panelIrradiance(quat, dir) });
  }
  return pts;
}

// Integrate daily energy [Wh/m²] via trapezoidal rule
export function dailyEnergy(latDeg, doy, quat) {
  const pts = dailyCurve(latDeg, doy, quat, 480);
  let sum = 0;
  const dt = 24 / 480;
  for (let i = 1; i < pts.length; i++) sum += (pts[i].irr + pts[i - 1].irr) * 0.5 * dt;
  return sum; // Wh/m²
}

// dark-blue → orange → yellow-white
export function irradianceToHex(irr) {
  const t = Math.min(1, Math.max(0, irr / 1000));
  let r, g, b;
  if (t < 0.5) {
    const u = t * 2;
    r = Math.round(26  + (255 - 26)  * u);
    g = Math.round(35  + (140 - 35)  * u);
    b = Math.round(126 + (0   - 126) * u);
  } else {
    const u = (t - 0.5) * 2;
    r = 255;
    g = Math.round(140 + (255 - 140) * u);
    b = Math.round(0   + (136 - 0)   * u);
  }
  return (r << 16) | (g << 8) | b;
}

// Annual specific yield [kWh/kWp] as a function of latitude — simplified PVGIS model
export function specificYield(latDeg) {
  return Math.max(700, 1750 - 14 * Math.max(0, Math.abs(latDeg) - 28));
}

export function doyToLabel(doy) {
  const d = new Date(2024, 0, Math.max(1, Math.min(366, doy)));
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

export function fmtHour(h) {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
