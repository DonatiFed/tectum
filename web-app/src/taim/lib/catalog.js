import { CATALOGUE_PANELS } from './catalogue-panels';

// PANEL_TYPES shape expected by the rest of the app: { name, w, h, wp }
// Extended with: id, brand, model, efficiency, datasheetUrl
export const PANEL_TYPES = CATALOGUE_PANELS.map(p => ({
  ...p,
  name: `${p.brand} ${p.model} — ${p.wp}Wp`,
}));

export const MODELS = [
  { name: 'Brandenburg',   file: '/models/brandenburg.glb',   icon: '🏗' },
  { name: 'Hamburg',       file: '/models/hamburg.glb',       icon: '⚓' },
  { name: 'North Germany', file: '/models/north-germany.glb', icon: '🌿' },
  { name: 'Ruhr',          file: '/models/ruhr.glb',          icon: '🏭' },
];
