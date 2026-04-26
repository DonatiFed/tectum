import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import React from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Download, RefreshCw, ChevronDown, ChevronUp, Loader2, Zap, Settings2, SlidersHorizontal } from 'lucide-react';
import { store, useStore } from '../taim/lib/store';
import { CATALOGUE_PANELS } from '../taim/lib/catalogue-panels';
import { Slider } from '../components/ui/slider';
import { cn } from '../lib/utils';

const PIPELINE_URL = 'http://localhost:8001';

const ROOF_TYPE_MAP: Record<string, string> = {
  flat: 'Flat Roof', gable: 'Concrete Tile Roof', hip: 'Clay Tile Roof',
  shed: 'Metal Roof', pitched: 'Concrete Tile Roof',
};
const HEATING_MAP: Record<string, string> = {
  gas: 'Gas', oil: 'Oil', heat_pump: 'Electric', electric: 'Electric', other: 'Gas',
};

interface PipelineConfig {
  panel_catalog: any[];
  brand_batteries: Record<string, number[]>;
  cost_levers: Record<string, { default: number; unit: string; min: number; max: number }>;
  tariffs: Record<string, { default: number; unit: string; min: number; max: number }>;
  selection_tuning: Record<string, { default: number; min: number; max: number }>;
  specific_yield: { default: number; unit: string; min: number; max: number };
  valid_brands: string[];
  valid_roof_types: string[];
}

interface Offer {
  option_name: string;
  sizing: {
    modules: number; kwp: number; battery_kwh: number; brand: string;
    wallbox: boolean; heatpump_kw: number | null;
    panel: { id: string; brand: string; model: string; wp: number; cost_per_panel_eur: number };
  };
  metrics: {
    total_demand_kwh: number; production_kwh: number;
    self_consumption_rate: number; self_sufficiency_rate: number;
    total_cost_eur: number; panel_cost_eur: number; bos_cost_eur: number;
    battery_cost_eur: number; year1_savings_eur: number;
    payback_years: number; npv_20yr: number;
  };
  bom: any[];
}

interface PipelineResult {
  project_context: any;
  active_panel: any;
  cost_range: { min: number; max: number };
  offers: Offer[];
}

interface ProposalsProps {
  onBack: () => void;
}

const fmtEUR = (n: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const pct = (v: number) => `${Math.round(v * 100)}%`;

// ── Installer presets ──────────────────────────────────────────────────

interface Preset {
  label: string;
  description: string;
  values: {
    pvCost: number; batteryCost: number; wallboxCost: number;
    serviceCost: number; heatpumpCost: number;
  };
}

const INSTALLER_PRESETS: Preset[] = [
  {
    label: 'Standard',
    description: 'Average market rates',
    values: { pvCost: 750, batteryCost: 600, wallboxCost: 1200, serviceCost: 2500, heatpumpCost: 1800 },
  },
  {
    label: 'Premium',
    description: 'Higher-end components',
    values: { pvCost: 1000, batteryCost: 800, wallboxCost: 1800, serviceCost: 3500, heatpumpCost: 2400 },
  },
  {
    label: 'Economy',
    description: 'Cost-sensitive pricing',
    values: { pvCost: 550, batteryCost: 450, wallboxCost: 900, serviceCost: 1800, heatpumpCost: 1400 },
  },
];

// ── Components ─────────────────────────────────────────────────────────

function ProposalCard({ offer, selected, onClick }: { offer: Offer; selected: boolean; onClick: () => void }) {
  const s = offer.sizing;
  const m = offer.metrics;
  const isBalanced = offer.option_name === 'Balanced';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-2xl border-2 bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-md",
        selected ? "border-primary shadow-md" : "border-border",
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="font-display text-2xl">{offer.option_name}</div>
          <div className="text-[12px] text-muted-foreground mt-0.5">
            {s.brand}{s.battery_kwh > 0 ? ` · ${s.battery_kwh} kWh battery` : ' · No battery'}
            {s.wallbox ? ' · Wallbox' : ''}
            {s.heatpump_kw ? ` · ${s.heatpump_kw} kW heat pump` : ''}
          </div>
        </div>
        {isBalanced && (
          <span className="px-3 py-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold">
            Recommended
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-5">
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">System</div>
          <div className="font-semibold text-[15px]">{s.kwp.toFixed(1)} kWp · {s.modules} panels</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Battery</div>
          <div className="font-semibold text-[15px]">{s.battery_kwh > 0 ? `${s.battery_kwh} kWh` : '—'}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Self-consumption</div>
          <div className="font-semibold text-[15px]">{pct(m.self_consumption_rate)}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Self-sufficiency</div>
          <div className="font-semibold text-[15px] text-primary">{pct(m.self_sufficiency_rate)}</div>
        </div>
      </div>

      <div className="border-t pt-4 space-y-2">
        <div className="flex justify-between items-baseline">
          <span className="text-[13px] text-muted-foreground">Total cost</span>
          <span className="font-display text-3xl">{fmtEUR(m.total_cost_eur)}</span>
        </div>
        <div className="flex justify-between text-[13px]">
          <span className="text-muted-foreground">Annual savings</span>
          <span className="font-semibold text-green-400">{fmtEUR(m.year1_savings_eur)}/yr</span>
        </div>
        <div className="flex justify-between text-[13px]">
          <span className="text-muted-foreground">Payback</span>
          <span className="font-semibold">{m.payback_years.toFixed(1)} years</span>
        </div>
        <div className="flex justify-between text-[13px]">
          <span className="text-muted-foreground">20-yr NPV</span>
          <span className={cn("font-semibold", m.npv_20yr > 0 ? "text-green-400" : "text-red-400")}>{fmtEUR(m.npv_20yr)}</span>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t flex gap-2 flex-wrap">
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-secondary text-muted-foreground">
          Panels: {fmtEUR(m.panel_cost_eur)}
        </span>
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-secondary text-muted-foreground">
          BOS: {fmtEUR(m.bos_cost_eur)}
        </span>
        {m.battery_cost_eur > 0 && (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-secondary text-muted-foreground">
            Battery: {fmtEUR(m.battery_cost_eur)}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function ParamSlider({ label, value, onChange, min, max, step, unit, displayFn, hint }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; unit: string;
  displayFn?: (v: number) => string; hint?: string;
}) {
  const display = displayFn ? displayFn(value) : `${value} ${unit}`;
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <div>
          <label className="text-[13px] font-medium">{label}</label>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <span className="font-medium text-primary text-[14px] shrink-0 ml-4">{display}</span>
      </div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={v => onChange(v[0])} className="py-1" />
    </div>
  );
}

function Section({ title, icon, children, defaultOpen = true }: { title: string; icon?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-card rounded-2xl border overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <div className="text-[11px] font-semibold tracking-[0.1em] uppercase text-muted-foreground">{title}</div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-6 pb-6 space-y-4">{children}</div>}
    </section>
  );
}

// ── Main ───────────────────────────────────────────────────────────────

export default function Proposals({ onBack }: ProposalsProps) {
  const intake = useStore((s: any) => s.intake);
  const roofs = useStore((s: any) => s.roofs);
  const panelTypeIdx = useStore((s: any) => s.panelTypeIdx ?? 0);
  const customPanel = useStore((s: any) => s.customPanel);

  const totalPanels = useMemo(
    () => (roofs || []).reduce((s: number, r: any) => s + (r.panels?.length ?? 0), 0),
    [roofs]
  );

  const selectedPanelId = useMemo(() => {
    if (panelTypeIdx === -1) return 'auto';
    const catalogEntry = (CATALOGUE_PANELS as any[])[panelTypeIdx];
    return catalogEntry?.id ?? 'auto';
  }, [panelTypeIdx]);

  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(1);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [activePreset, setActivePreset] = useState(0);

  // Client-facing controls (top level)
  const [preferredBrand, setPreferredBrand] = useState('auto');
  const [energyPrice, setEnergyPrice] = useState(32);
  const [budgetCap, setBudgetCap] = useState(0);  // 0 = no limit, >0 = hard cap

  // Assumptions (collapsible)
  const [energyPriceIncrease, setEnergyPriceIncrease] = useState(2);
  const [specificYield, setSpecificYield] = useState(950);
  const [fitSmall, setFitSmall] = useState(0.082);
  const [fitLarge, setFitLarge] = useState(0.071);
  const [gasCost, setGasCost] = useState(0.12);

  // Installer pricing (collapsible)
  const [pvCost, setPvCost] = useState(750);
  const [batteryCost, setBatteryCost] = useState(600);
  const [wallboxCost, setWallboxCost] = useState(1200);
  const [serviceCost, setServiceCost] = useState(2500);
  const [heatpumpCost, setHeatpumpCost] = useState(1800);

  const debounceRef = useRef<number>(0);

  const costRange = result?.cost_range ?? null;
  const budgetMin = costRange ? Math.floor(costRange.min / 1000) * 1000 : 5000;
  const budgetMax = costRange ? Math.ceil(costRange.max / 1000) * 1000 : 80000;

  const applyPreset = useCallback((idx: number) => {
    const p = INSTALLER_PRESETS[idx].values;
    setPvCost(p.pvCost);
    setBatteryCost(p.batteryCost);
    setWallboxCost(p.wallboxCost);
    setServiceCost(p.serviceCost);
    setHeatpumpCost(p.heatpumpCost);
    setActivePreset(idx);
  }, []);

  useEffect(() => {
    fetch(`${PIPELINE_URL}/api/config`)
      .then(r => r.json())
      .then(cfg => {
        setConfig(cfg);
        setPvCost(cfg.cost_levers.base_pv_cost_per_kwp.default);
        setBatteryCost(cfg.cost_levers.base_battery_cost_per_kwh.default);
        setWallboxCost(cfg.cost_levers.wallbox_cost.default);
        setServiceCost(cfg.cost_levers.service_cost_with_pv.default);
        setHeatpumpCost(cfg.cost_levers.heatpump_cost_per_kw.default);
        setGasCost(cfg.cost_levers.gas_cost_per_kwh.default);
        setFitSmall(cfg.tariffs.feed_in_tariff_small.default);
        setFitLarge(cfg.tariffs.feed_in_tariff_large.default);
        setSpecificYield(cfg.specific_yield.default);
      })
      .catch(() => setError('Could not connect to pipeline server. Run: uvicorn server:app --port 8001'));
  }, []);

  const fetchPipeline = useCallback(async () => {
    if (!intake || totalPanels === 0) return;

    const monthlyBill = Number(intake.monthlyBill ?? intake.bill ?? 150);
    const energyDemand = Math.max(1000, Math.round(monthlyBill * 12 / 0.35));
    const roofType = ROOF_TYPE_MAP[(intake.roofType ?? 'gable').toLowerCase()] ?? 'Concrete Tile Roof';
    const heatingType = HEATING_MAP[(intake.heatingType ?? 'gas').toLowerCase()] ?? 'Gas';

    const body: any = {
      energy_demand_kwh: energyDemand,
      energy_price_ct_kwh: energyPrice,
      energy_price_increase_pct: energyPriceIncrease,
      has_ev: intake.evStatus === 'has' || intake.evStatus === 'wants',
      ev_distance_km: null,
      has_solar: false,
      existing_solar_kwp: null,
      has_storage: intake.batteryStatus === 'has',
      existing_battery_kwh: intake.batteryStatus === 'has' ? (intake.batteryCapacityKwh ?? null) : null,
      has_wallbox: intake.evStatus === 'has',
      heating_existing_type: heatingType,
      heating_existing_heating_demand_wh: null,
      wants_heatpump: intake.wantsHeatPump !== false,
      roof_type: roofType,
      orientation: intake.orientation ?? 'S',
      max_modules: Math.max(1, totalPanels),
      preferred_brand: preferredBrand,
      budget_cap_eur: budgetCap > 0 ? budgetCap : null,
      overrides: {
        selected_panel_id: selectedPanelId,
        base_pv_cost_per_kwp: pvCost,
        base_battery_cost_per_kwh: batteryCost,
        wallbox_cost: wallboxCost,
        service_cost_with_pv: serviceCost,
        heatpump_cost_per_kw: heatpumpCost,
        gas_cost_per_kwh: gasCost,
        feed_in_tariff_small: fitSmall,
        feed_in_tariff_large: fitLarge,
        specific_yield: specificYield,
      },
    };

    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${PIPELINE_URL}/api/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`Server error (${resp.status})`);
      const data = await resp.json();
      setResult(data);
      if (selectedIdx >= data.offers.length) setSelectedIdx(0);
    } catch (e: any) {
      setError(e.message || 'Pipeline error');
    } finally {
      setLoading(false);
    }
  }, [intake, totalPanels, selectedPanelId, preferredBrand, energyPrice, energyPriceIncrease, budgetCap,
      pvCost, batteryCost, wallboxCost, serviceCost, heatpumpCost,
      gasCost, fitSmall, fitLarge, specificYield]);

  useEffect(() => {
    if (!config) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(fetchPipeline, 350);
    return () => clearTimeout(debounceRef.current);
  }, [fetchPipeline, config]);

  const handleDownloadPDF = async () => {
    if (!result || !result.offers.length) return;
    setPdfLoading(true);
    try {
      const { pdf } = await import('@react-pdf/renderer');
      const { default: SolarReportPDF } = await import('../taim/components/SolarReportPDF');
      const { buildReportProps } = await import('../taim/lib/reportData');

      const storeState = store.get();
      const selectedOfferName = offers[selectedIdx]?.option_name;
      const props = buildReportProps(storeState, result, selectedOfferName);

      const canvas = document.querySelector('canvas');
      const screenshot = canvas ? canvas.toDataURL('image/jpeg', 0.88) : null;

      const blob = await pdf(React.createElement(SolarReportPDF, { ...props, screenshot })).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Tectum_Report_${intake?.name || 'Project'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`PDF generation failed: ${e.message}`);
    } finally {
      setPdfLoading(false);
    }
  };

  const offers = result?.offers ?? [];
  const activePanel = result?.active_panel;

  if (!intake) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="font-display text-3xl mb-2">No project data</div>
          <p className="text-muted-foreground mb-4">Open a project from the dashboard first.</p>
          <button onClick={onBack} className="h-10 px-5 rounded-xl bg-primary text-primary-foreground font-semibold text-[14px]">
            Go back
          </button>
        </div>
      </div>
    );
  }

  if (totalPanels === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="font-display text-3xl mb-2">No panels placed</div>
          <p className="text-muted-foreground mb-4">Go back to the 3D planner and place panels on the roof first.</p>
          <button onClick={onBack} className="h-10 px-5 rounded-xl bg-primary text-primary-foreground font-semibold text-[14px]">
            Back to planner
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-[14px]">
            <ArrowLeft className="w-4 h-4" /> Back to planner
          </button>
          <img src="/logo-liquid.svg" alt="Tectum" className="h-8" />
          <button
            onClick={handleDownloadPDF}
            disabled={pdfLoading || !offers.length}
            className={cn(
              "h-10 px-5 rounded-xl font-semibold text-[14px] flex items-center gap-2 transition-opacity",
              offers.length && !pdfLoading
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download PDF
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Title */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="font-display text-5xl mb-1">Proposals</h1>
          <p className="text-muted-foreground text-[15px]">
            {intake.name ? `${intake.name} · ` : ''}
            {totalPanels} panel{totalPanels !== 1 ? 's' : ''} placed
            {activePanel ? ` · ${activePanel.brand} ${activePanel.model} (${activePanel.wp}W)` : ''}
            {intake.address ? ` · ${intake.address}` : ''}
          </p>
          <p className="text-muted-foreground text-[13px] mt-1">
            All proposals use the same {totalPanels} panels. They differ in battery, wallbox, and heat pump configuration.
          </p>
        </motion.div>

        {/* ── Top-level client controls ── */}
        {config && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <div className="bg-card rounded-2xl border p-6">
              <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
                {/* Budget */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <div>
                      <label className="text-[13px] font-medium">Customer budget</label>
                      <p className="text-[11px] text-muted-foreground">
                        {costRange ? `Solutions from ${fmtEUR(costRange.min)} to ${fmtEUR(costRange.max)}` : 'Loading range…'}
                      </p>
                    </div>
                    <span className="font-medium text-primary text-[14px] shrink-0 ml-4">
                      {budgetCap === 0 || budgetCap >= budgetMax ? 'No limit' : fmtEUR(budgetCap)}
                    </span>
                  </div>
                  <Slider
                    min={budgetMin} max={budgetMax} step={1000}
                    value={[budgetCap === 0 ? budgetMax : budgetCap]}
                    onValueChange={v => setBudgetCap(v[0] >= budgetMax ? 0 : v[0])}
                    className="py-1"
                  />
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>{fmtEUR(budgetMin)}</span>
                    <span>No limit</span>
                  </div>
                </div>

                {/* Electricity price */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <div>
                      <label className="text-[13px] font-medium">Electricity price</label>
                      <p className="text-[11px] text-muted-foreground">What the customer pays today</p>
                    </div>
                    <span className="font-medium text-primary text-[14px] shrink-0 ml-4">{energyPrice.toFixed(1)} ct/kWh</span>
                  </div>
                  <Slider min={15} max={60} step={0.5} value={[energyPrice]} onValueChange={v => setEnergyPrice(v[0])} className="py-1" />
                </div>

                {/* Battery brand */}
                <div className="space-y-2">
                  <label className="text-[13px] font-medium">Battery brand</label>
                  <p className="text-[11px] text-muted-foreground">Customer or installer preference</p>
                  <select
                    value={preferredBrand}
                    onChange={e => setPreferredBrand(e.target.value)}
                    className="w-full h-10 px-4 rounded-xl bg-background border border-border text-foreground focus:outline-none focus:border-primary transition-all text-[14px]"
                  >
                    <option value="auto">Auto (best match)</option>
                    {config.valid_brands.map((b: string) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[14px] flex items-center justify-between">
            <span>{error}</span>
            <button onClick={fetchPipeline} className="flex items-center gap-1 font-semibold hover:underline">
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && !offers.length && !error && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary mr-3" />
            <span className="text-muted-foreground">Computing proposals…</span>
          </div>
        )}

        {/* Proposal cards */}
        {offers.length > 0 && (
          <div className="grid gap-5 grid-cols-1 md:grid-cols-3 mb-10">
            {offers.map((offer, i) => (
              <ProposalCard
                key={offer.option_name}
                offer={offer}
                selected={selectedIdx === i}
                onClick={() => setSelectedIdx(i)}
              />
            ))}
          </div>
        )}

        {/* Recalculating indicator */}
        {loading && offers.length > 0 && (
          <div className="flex items-center gap-2 mb-6 text-[13px] text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Recalculating…
          </div>
        )}

        {/* ── Collapsible sections ── */}
        {config && (
          <div className="grid gap-5 grid-cols-1 lg:grid-cols-2 items-start">

            {/* Adjust assumptions */}
            <Section title="Adjust assumptions" icon={<SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground" />} defaultOpen={false}>
              <p className="text-[12px] text-muted-foreground -mt-1 mb-2">
                Market assumptions that affect savings and payback projections.
              </p>
              <ParamSlider label="Annual price increase" value={energyPriceIncrease} onChange={setEnergyPriceIncrease}
                min={0} max={8} step={0.5} unit="%"
                displayFn={v => `${v.toFixed(1)}%`}
                hint="Expected annual electricity price increase" />
              <ParamSlider label="Specific yield" value={specificYield} onChange={setSpecificYield}
                min={700} max={1400} step={10} unit="kWh/kWp/yr"
                hint="Local solar irradiance — ~950 for Germany, ~1100+ for southern Europe" />
              <ParamSlider label="Feed-in tariff (≤10 kWp)" value={fitSmall} onChange={setFitSmall}
                min={0} max={0.20} step={0.001} unit="€/kWh"
                displayFn={v => `${(v * 100).toFixed(1)} ct/kWh`}
                hint="Rate paid for surplus energy fed to the grid" />
              <ParamSlider label="Feed-in tariff (>10 kWp)" value={fitLarge} onChange={setFitLarge}
                min={0} max={0.20} step={0.001} unit="€/kWh"
                displayFn={v => `${(v * 100).toFixed(1)} ct/kWh`} />
              <ParamSlider label="Gas price" value={gasCost} onChange={setGasCost}
                min={0.05} max={0.30} step={0.005} unit="€/kWh"
                displayFn={v => `${(v * 100).toFixed(1)} ct/kWh`}
                hint="Used for heat pump savings calculation" />
            </Section>

            {/* Installer costs */}
            <Section title="Installer costs" icon={<Settings2 className="w-3.5 h-3.5 text-muted-foreground" />} defaultOpen={false}>
              <p className="text-[12px] text-muted-foreground -mt-1 mb-2">
                Your component and labor costs. Adjust before the client meeting.
              </p>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {INSTALLER_PRESETS.map((preset, i) => (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(i)}
                    className={cn(
                      "rounded-xl border-2 px-3 py-3 text-left transition-all hover:shadow-sm",
                      activePreset === i ? "border-primary bg-primary/5" : "border-border hover:border-primary/30",
                    )}
                  >
                    <div className="font-semibold text-[13px]">{preset.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{preset.description}</div>
                  </button>
                ))}
              </div>

              <ParamSlider label="BOS (inverter + wiring + mounting)" value={pvCost} onChange={v => { setPvCost(v); setActivePreset(-1); }}
                min={300} max={1500} step={50} unit="€/kWp"
                displayFn={v => `€${v}/kWp`}
                hint="Balance-of-system, excluding panel hardware" />
              <ParamSlider label="Battery storage" value={batteryCost} onChange={v => { setBatteryCost(v); setActivePreset(-1); }}
                min={200} max={1200} step={25} unit="€/kWh"
                displayFn={v => `€${v}/kWh`} />
              <ParamSlider label="Wallbox (EV charger)" value={wallboxCost} onChange={v => { setWallboxCost(v); setActivePreset(-1); }}
                min={500} max={3000} step={50} unit="€"
                displayFn={v => fmtEUR(v)} />
              <ParamSlider label="Service & installation" value={serviceCost} onChange={v => { setServiceCost(v); setActivePreset(-1); }}
                min={500} max={5000} step={100} unit="€"
                displayFn={v => fmtEUR(v)}
                hint="Labor and installation costs" />
              <ParamSlider label="Heat pump" value={heatpumpCost} onChange={v => { setHeatpumpCost(v); setActivePreset(-1); }}
                min={800} max={3500} step={50} unit="€/kW"
                displayFn={v => `€${v}/kW`} />
            </Section>
          </div>
        )}

        <div className="h-16" />
      </div>
    </div>
  );
}
