// Panel catalogue (real-world metres / watt-peak)
export const PANEL_TYPES = [
  { name: 'Standard 400W (1.7×1.0m)', w: 1.0, h: 1.7, wp: 400 },
  { name: 'Compact 300W (1.5×0.9m)',  w: 0.9, h: 1.5, wp: 300 },
  { name: 'Large 600W (2.1×1.1m)',    w: 1.1, h: 2.1, wp: 600 },
  { name: 'Half-Cut 380W (1.7×1.0m)', w: 1.0, h: 1.7, wp: 380 },
  { name: 'Bifacial 450W (1.8×1.0m)', w: 1.0, h: 1.8, wp: 450 },
  { name: 'CSV 440Wp module',         w: 1.0, h: 1.78, wp: 440 },
  { name: 'CSV 410Wp module',         w: 1.0, h: 1.72, wp: 410 },
  { name: 'CSV 350Wp module',         w: 1.0, h: 1.65, wp: 350 },
];

export const MODELS = [
  { name: 'Brandenburg',   file: '/models/brandenburg.glb',   icon: '🏗' },
  { name: 'Hamburg',       file: '/models/hamburg.glb',       icon: '⚓' },
  { name: 'North Germany', file: '/models/north-germany.glb', icon: '🌿' },
  { name: 'Ruhr',          file: '/models/ruhr.glb',          icon: '🏭' },
];
