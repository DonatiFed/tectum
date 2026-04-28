export type RoofType = "gable" | "hip" | "flat" | "shed";
export type Orientation = "S" | "SE" | "SW" | "E" | "W" | "N";

export type HeatingType = 'gas' | 'oil' | 'electric' | 'heat_pump' | 'other';
export type EvStatus = 'has' | 'wants' | 'none';
export type BatteryStatus = 'has' | 'wants' | 'none';

export interface IntakeData {
  name: string;
  email: string;
  isOwner: boolean;
  numPeople: number;
  houseSize: number; // m²
  address: string;
  postalCode: string;
  roofType: RoofType;
  roofArea: number; // m²
  orientation: Orientation;
  monthlyBill: number; // EUR
  evStatus: EvStatus;
  batteryStatus: BatteryStatus;
  batteryCapacityKwh: number;
  heatingType: HeatingType;
  wantsHeatPump: boolean;
}

export interface SystemConfig {
  panelCount: number;
  panelWattage: number; // W
  batteryKwh: number;
  includeHeatPump: boolean;
  includeWallbox: boolean;
}

const CONSTANTS = {
  ORIENTATION_FACTOR: {
    "S": 1.0,
    "SE": 0.95,
    "SW": 0.95,
    "E": 0.85,
    "W": 0.85,
    "N": 0.6
  },
  PANEL_AREA: 1.95,
  PANEL_PRICE_PER_W: 0.42,
  INVERTER_BASE: 1800,
  INVERTER_PER_KW: 95,
  BATTERY_PER_KWH: 720,
  HEAT_PUMP: 14500,
  WALLBOX: 1450,
  INSTALL_BASE: 1200,
  INSTALL_PER_KW: 380,
  SUBSIDY_HEAT_PUMP: 4500,
  SUBSIDY_WALLBOX: 600,
  ELECTRICITY_PRICE: 0.35,
  FEED_IN_TARIFF: 0.082,
  SPECIFIC_YIELD: 950
};

export function recommendSystem(intake: IntakeData): SystemConfig {
  const usable = intake.roofArea * (intake.roofType === 'flat' ? 0.55 : 0.7);
  const maxPanels = Math.floor(usable / CONSTANTS.PANEL_AREA);
  
  const yearlyConsumption = Math.round(intake.monthlyBill * 12 / CONSTANTS.ELECTRICITY_PRICE);
  const orientationFactor = CONSTANTS.ORIENTATION_FACTOR[intake.orientation];
  const targetKwp = (yearlyConsumption / (CONSTANTS.SPECIFIC_YIELD * orientationFactor)) * 1.1;
  const targetPanels = Math.ceil((targetKwp * 1000) / 430);
  
  const panelCount = Math.min(maxPanels, Math.max(8, targetPanels));
  const batteryKwh = intake.monthlyBill > 120 ? 10 : 5;
  
  return {
    panelCount,
    panelWattage: 430,
    batteryKwh,
    includeHeatPump: intake.wantsHeatPump,
    includeWallbox: intake.evStatus !== 'none',
  };
}

export interface CostBreakdown {
  panels: number;
  inverter: number;
  battery: number;
  heatPump: number;
  wallbox: number;
  installation: number;
  total: number;
  subsidy: number;
  netTotal: number;
}

export function calculateCosts(cfg: SystemConfig): CostBreakdown {
  const totalKw = (cfg.panelCount * cfg.panelWattage) / 1000;
  
  const panels = totalKw * 1000 * CONSTANTS.PANEL_PRICE_PER_W;
  const inverter = CONSTANTS.INVERTER_BASE + (totalKw * CONSTANTS.INVERTER_PER_KW);
  const battery = cfg.batteryKwh * CONSTANTS.BATTERY_PER_KWH;
  const heatPump = cfg.includeHeatPump ? CONSTANTS.HEAT_PUMP : 0;
  const wallbox = cfg.includeWallbox ? CONSTANTS.WALLBOX : 0;
  const installation = (totalKw * CONSTANTS.INSTALL_PER_KW) + CONSTANTS.INSTALL_BASE;
  
  const total = panels + inverter + battery + heatPump + wallbox + installation;
  const subsidy = (cfg.includeHeatPump ? CONSTANTS.SUBSIDY_HEAT_PUMP : 0) + 
                 (cfg.includeWallbox ? CONSTANTS.SUBSIDY_WALLBOX : 0);
  
  return {
    panels,
    inverter,
    battery,
    heatPump,
    wallbox,
    installation,
    total,
    subsidy,
    netTotal: total - subsidy
  };
}

export interface YieldEstimate {
  yearlyKwh: number;
  selfConsumptionPercentage: number;
  usedKwh: number;
  fedInKwh: number;
  yearlySavings: number;
  paybackYears: number;
  co2Saved: number;
}

export function estimateYield(cfg: SystemConfig, intake: IntakeData): YieldEstimate {
  const totalKw = (cfg.panelCount * cfg.panelWattage) / 1000;
  const orientationFactor = CONSTANTS.ORIENTATION_FACTOR[intake.orientation];
  const yearlyKwh = totalKw * CONSTANTS.SPECIFIC_YIELD * orientationFactor;
  
  const selfConsumption = Math.min(0.45 + (cfg.batteryKwh * 0.025), 0.85);
  
  let yearlyConsumption = Math.round(intake.monthlyBill * 12 / CONSTANTS.ELECTRICITY_PRICE);
  if (cfg.includeHeatPump) yearlyConsumption += 3000; // rough estimate
  if (cfg.includeWallbox) yearlyConsumption += 2000;
  
  const usedKwh = Math.min(yearlyKwh * selfConsumption, yearlyConsumption);
  const fedInKwh = Math.max(yearlyKwh - usedKwh, 0);
  
  const yearlySavings = (usedKwh * CONSTANTS.ELECTRICITY_PRICE) + (fedInKwh * CONSTANTS.FEED_IN_TARIFF);
  
  const costs = calculateCosts(cfg);
  const paybackYears = yearlySavings > 0 ? Number((costs.netTotal / yearlySavings).toFixed(1)) : 0;
  const co2Saved = yearlyKwh * 0.42;

  return {
    yearlyKwh,
    selfConsumptionPercentage: selfConsumption * 100,
    usedKwh,
    fedInKwh,
    yearlySavings,
    paybackYears,
    co2Saved
  };
}

export const fmtEUR = (n: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
