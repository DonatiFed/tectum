// Maps live store state → pipeline inputs, calls the FastAPI server,
// returns the raw pipeline output ({ project_context, offers }).

const PIPELINE_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_PIPELINE_URL) ||
  'http://localhost:8001';

// Intake form roofType → pipeline SUBSTRUCTURE_MAP key
const ROOF_TYPE_MAP = {
  flat:    'Flat Roof',
  pitched: 'Concrete Tile Roof',
};

// Intake form heatingType → pipeline heating string
const HEATING_MAP = {
  gas:        'Gas',
  oil:        'Oil',
  heat_pump:  'Electric',
  electric:   'Electric',
  district:   'District',
};

export async function callPipeline(storeState) {
  const { intake, roofs } = storeState;

  if (!intake) throw new Error('No intake data found. Open a project that was started from the client form.');

  // energy_demand_kwh: derive from monthly bill (€) at €0.35/kWh
  const monthlyBill   = Number(intake.bill ?? intake.monthlyBill ?? 0);
  const energyDemand  = Math.max(1000, Math.round(monthlyBill * 12 / 0.35));

  // max_modules: total panels placed in the 3D planner
  const totalPanels   = roofs.reduce((s, r) => s + (r.panels?.length ?? 0), 0);
  const maxModules    = Math.max(1, totalPanels);

  const roofType      = ROOF_TYPE_MAP[(intake.roofType ?? 'pitched').toLowerCase()] ?? 'Concrete Tile Roof';
  const heatingType   = HEATING_MAP[(intake.heatingType ?? 'gas').toLowerCase()] ?? 'Gas';

  const body = {
    energy_demand_kwh:                 energyDemand,
    energy_price_ct_kwh:               32,
    energy_price_increase_pct:         2,
    has_ev:                            intake.evStatus === 'has',
    ev_distance_km:                    null,
    has_solar:                         false,
    existing_solar_kwp:                null,
    has_storage:                       intake.batteryStatus === 'has',
    has_wallbox:                       intake.evStatus === 'has',
    heating_existing_type:             heatingType,
    heating_existing_heating_demand_wh: null,
    roof_type:                         roofType,
    max_modules:                       maxModules,
    preferred_brand:                   'auto',
    budget_cap_eur:                    null,
  };

  const resp = await fetch(`${PIPELINE_URL}/api/offer`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Pipeline server error (${resp.status}): ${text}`);
  }

  return resp.json();
}
