import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ArrowLeft, Check, Lightbulb, MapPin, Zap, Activity } from 'lucide-react';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { type IntakeData, type SystemConfig, recommendSystem, calculateCosts, estimateYield, fmtEUR } from '../lib/solar';
import { Button } from './ui/button';
import SolarReportPDF from './SolarReportPDF';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { cn } from '../lib/utils';
import { RoofModel } from './RoofModel';

const IconPanel = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-sm">
    <rect x="3" y="4" width="18" height="16" rx="2" fill="currentColor" fillOpacity="0.15"/>
    <line x1="9" y1="4" x2="9" y2="20" />
    <line x1="15" y1="4" x2="15" y2="20" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </svg>
);

const IconBattery = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-sm">
    <rect x="6" y="5" width="12" height="16" rx="2" fill="currentColor" fillOpacity="0.15"/>
    <line x1="9" y1="2" x2="15" y2="2" />
    <line x1="10" y1="13" x2="14" y2="13" />
    <line x1="12" y1="11" x2="12" y2="15" />
  </svg>
);

const IconHeatPump = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-sm">
    <rect x="3" y="5" width="18" height="14" rx="2" fill="currentColor" fillOpacity="0.15"/>
    <circle cx="15" cy="12" r="4" />
    <line x1="6" y1="9" x2="9" y2="9" />
    <line x1="6" y1="12" x2="9" y2="12" />
    <line x1="6" y1="15" x2="9" y2="15" />
  </svg>
);

const IconWallbox = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-sm">
    <rect x="5" y="4" width="9" height="15" rx="2" fill="currentColor" fillOpacity="0.15"/>
    <circle cx="9.5" cy="11.5" r="2.5" />
    <path d="M14 14c3 0 5-1 5-4v-1" />
    <rect x="18" y="7" width="2" height="4" rx="1" />
  </svg>
);

interface PlannerProps {
  intake: IntakeData;
  onBack: () => void;
}

export function Planner({ intake, onBack }: PlannerProps) {
  const initial = useMemo(() => recommendSystem(intake), [intake]);
  const [cfg, setCfg] = useState<SystemConfig>(initial);
  
  const [recalculating, setRecalculating] = useState(false);
  const firstRun = useRef(true);
  
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setRecalculating(true);
    const t = setTimeout(() => setRecalculating(false), 450);
    return () => clearTimeout(t);
  }, [cfg]);

  const costs = useMemo(() => calculateCosts(cfg), [cfg]);
  const yield_ = useMemo(() => estimateYield(cfg, intake), [cfg, intake]);
  
  const totalKwp = (cfg.panelCount * cfg.panelWattage / 1000).toFixed(2);
  const maxPanels = Math.floor(intake.roofArea * (intake.roofType === 'flat' ? 0.55 : 0.7) / 1.95);

  const scenarios = useMemo(() => {
    const s1: SystemConfig = { ...initial, batteryKwh: 0, includeHeatPump: false, includeWallbox: false };
    const s2: SystemConfig = { ...initial, batteryKwh: Math.max(10, initial.batteryKwh), includeWallbox: intake.evStatus !== 'none', includeHeatPump: false };
    const s3: SystemConfig = { ...initial, batteryKwh: Math.max(12, initial.batteryKwh), includeHeatPump: true, includeWallbox: true };
    return [
      { id: 'essentials', label: 'Solar essentials', sub: 'Panels only', cfg: s1, cost: calculateCosts(s1), yld: estimateYield(s1, intake) },
      { id: 'balanced', label: 'Balanced', sub: '+ Battery', cfg: s2, cost: calculateCosts(s2), yld: estimateYield(s2, intake) },
      { id: 'all-in', label: 'All-electric', sub: 'HP & Wallbox', cfg: s3, cost: calculateCosts(s3), yld: estimateYield(s3, intake) },
    ];
  }, [initial, intake]);

  const activeScenarioId = useMemo(() => {
    return scenarios.find(s => 
      s.cfg.panelCount === cfg.panelCount && 
      s.cfg.batteryKwh === cfg.batteryKwh && 
      s.cfg.includeHeatPump === cfg.includeHeatPump &&
      s.cfg.includeWallbox === cfg.includeWallbox
    )?.id;
  }, [cfg, scenarios]);

  const tips = useMemo(() => {
    const ts: string[] = [];
    if (intake.orientation === 'S') ts.push("South-facing — ideal exposure (~12% extra yield).");
    if (intake.orientation === 'N') ts.push("North-facing reduces yield ~40%.");
    if (intake.monthlyBill > 180 && cfg.batteryKwh < 8) ts.push("Add a 10 kWh battery to lift self-use to ~70%.");
    if (intake.evStatus !== 'none' && !cfg.includeWallbox) ts.push("Wallbox unlocks €600 subsidy + solar charging.");
    if (intake.wantsHeatPump && !cfg.includeHeatPump) ts.push("Combining HP + solar cuts heating cost ~60%.");
    if (cfg.panelCount === maxPanels) ts.push("Roof fully utilised — extra demand → battery.");
    if (yield_.paybackYears > 0 && yield_.paybackYears < 9) ts.push("Strong economics — beats DE average of ~11 yrs.");
    return ts.slice(0, 3);
  }, [intake, cfg, yield_, maxPanels]);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden relative">
      <header className="h-[60px] flex-none border-b bg-background flex items-center px-6 justify-between z-10 relative">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-solar rounded-md flex items-center justify-center text-foreground font-bold">☀</div>
          <span className="font-display text-2xl text-primary">tectum</span>
        </div>
        <div className="text-sm text-muted-foreground font-medium flex items-center gap-2">
          {intake.address}
        </div>
        <div className="w-[100px] flex justify-end">
          <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground gap-2">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 relative overflow-hidden">
        
        {/* Center 3D Viewer */}
        <div className="col-span-1 lg:col-span-2 relative bg-gradient-sky flex flex-col overflow-hidden">
          {/* Stat chips */}
          <div className="absolute top-8 left-8 z-10 flex flex-col gap-3 flex-wrap pointer-events-none">
            <div className="bg-white/80 backdrop-blur-md px-5 py-3 rounded-[40px] shadow-[0_4px_12px_rgba(0,0,0,0.05)] border border-white/50">
              <div className="text-[11px] uppercase font-bold tracking-[0.05em] text-muted-foreground opacity-60 mb-0.5 flex items-center gap-1.5"><Zap className="w-3 h-3"/> System Size</div>
              <div className="font-display text-2xl leading-none">{totalKwp}<span className="text-sm font-sans ml-1">kWp</span></div>
            </div>
            <div className="bg-white/80 backdrop-blur-md px-5 py-3 rounded-[40px] shadow-[0_4px_12px_rgba(0,0,0,0.05)] border border-white/50">
              <div className="text-[11px] uppercase font-bold tracking-[0.05em] text-muted-foreground opacity-60 mb-0.5 flex items-center gap-1.5"><Activity className="w-3 h-3"/> Annual Yield</div>
              <div className="font-display text-2xl leading-none">{Math.round(yield_.yearlyKwh).toLocaleString('de-DE')}<span className="text-sm font-sans ml-1">kWh</span></div>
            </div>
            <div className="bg-white/80 backdrop-blur-md px-5 py-3 rounded-[40px] shadow-[0_4px_12px_rgba(0,0,0,0.05)] border border-white/50">
              <div className="text-[11px] uppercase font-bold tracking-[0.05em] text-muted-foreground opacity-60 mb-0.5">Self Use</div>
              <div className="font-display text-2xl leading-none">{Math.round(yield_.selfConsumptionPercentage)}<span className="text-sm font-sans ml-1">%</span></div>
            </div>
          </div>

          {/* 3D Canvas */}
          <div className="flex-1 absolute inset-0">
             <RoofModel />
          </div>

          {/* Hotbar */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10">
            <div className="bg-white/90 backdrop-blur-md p-1.5 rounded-xl shadow-[0_10px_30px_rgba(45,55,119,0.15)] border border-white flex gap-1.5">
              <div className={cn("relative w-14 h-14 rounded-lg border transition-all flex items-center justify-center", cfg.panelCount > 0 ? "bg-primary border-primary text-white" : "bg-secondary border-border text-foreground/60")}>
                <IconPanel />
                {cfg.panelCount > 0 && <span className="absolute bottom-1 right-1 text-white text-[10px] font-bold">{cfg.panelCount}</span>}
              </div>
              <div className={cn("relative w-14 h-14 rounded-lg border transition-all flex items-center justify-center", cfg.batteryKwh > 0 ? "bg-primary border-primary text-white" : "bg-secondary border-border text-foreground/60")}>
                <IconBattery />
                {cfg.batteryKwh > 0 && <span className="absolute bottom-1 right-1 text-white text-[10px] font-bold">{cfg.batteryKwh}</span>}
              </div>
              <div className={cn("relative w-14 h-14 rounded-lg border transition-all flex items-center justify-center", cfg.includeHeatPump ? "bg-primary border-primary text-white" : "bg-secondary border-border text-foreground/60")}>
                <IconHeatPump />
              </div>
              <div className={cn("relative w-14 h-14 rounded-lg border transition-all flex items-center justify-center", cfg.includeWallbox ? "bg-primary border-primary text-white" : "bg-secondary border-border text-foreground/60")}>
                <IconWallbox />
              </div>
            </div>
          </div>
        </div>

        {/* Right Rail */}
        <div className="h-full overflow-y-auto scrollbar-hide bg-background border-l z-20 flex flex-col w-full">
          <div className="p-8 flex-1 flex flex-col gap-10">
            
            <section>
              <div className="text-xs font-semibold tracking-[0.05em] uppercase text-muted-foreground mb-3">Recommended</div>
              <h2 className="font-display text-5xl leading-none mb-3">{totalKwp} kWp system</h2>
              <div className="text-[15px] text-foreground flex items-center gap-1.5">
                {yield_.paybackYears > 0 ? `Payback in ${yield_.paybackYears} years` : 'No payback'} <span className="font-bold">·</span> saves {fmtEUR(yield_.yearlySavings)}/y
              </div>
            </section>

            <section className="space-y-4">
              <div className="text-xs font-semibold tracking-[0.05em] uppercase text-muted-foreground">Compare Scenarios</div>
              <div className="flex flex-col gap-3">
                {scenarios.map(s => {
                  const isActive = activeScenarioId === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setCfg(s.cfg)}
                      className={cn(
                        "w-full text-left p-5 rounded-[12px] border transition-all relative overflow-hidden bg-card",
                        isActive ? "border-primary shadow-[0_0_0_1px_rgba(35,45,110,1)]" : "border-border shadow-sm hover:border-gray-300"
                      )}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-semibold text-[15px] text-foreground">{s.label}</span>
                        {isActive && <Check className="w-5 h-5 text-primary" />}
                      </div>
                      <div className="text-[13px] text-muted-foreground mb-4">{s.sub}</div>
                      <div className="flex justify-between items-baseline">
                        <span className="text-[13px] text-muted-foreground">Net</span>
                        <span className="font-semibold text-[16px]">{fmtEUR(s.cost.netTotal)}</span>
                      </div>
                      <div className="flex justify-between items-baseline mt-1">
                        <span className="text-[13px] text-muted-foreground">Payback</span>
                        <span className="text-[13px] text-foreground font-medium">{yield_.paybackYears} y <span className="text-muted-foreground font-normal">·</span> saves {fmtEUR(s.yld.yearlySavings)}/y</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section
              className="overflow-hidden transition-all duration-500 ease-in-out"
              style={{ maxHeight: tips.length > 0 ? tips.length * 80 + 48 : 0, opacity: tips.length > 0 ? 1 : 0 }}
            >
              <div className="space-y-3 pb-1">
                <div className="text-xs font-semibold tracking-[0.05em] uppercase text-muted-foreground flex items-center gap-2">
                  <Lightbulb className="w-4 h-4" /> Smart tips
                </div>
                {tips.map((tip, i) => (
                  <div key={i} className="bg-[#FAF9F5] border border-border px-5 py-4 rounded-[12px] text-[14px] text-foreground">
                    <span className="leading-relaxed">{tip}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-6 pt-2">
               <div className="text-xs font-semibold tracking-[0.05em] uppercase text-muted-foreground">Refine your design</div>
               
               <div className="space-y-3">
                  <div className="flex justify-between items-baseline mb-1">
                    <Label className="text-[16px] font-semibold">Solar panels</Label>
                    <span className="text-[15px] text-muted-foreground">{cfg.panelCount} × {cfg.panelWattage}W</span>
                  </div>
                  <div className="group relative">
                    <Slider 
                      min={4} max={maxPanels} step={1}
                      value={[cfg.panelCount]} 
                      onValueChange={v => setCfg(p => ({...p, panelCount: v[0]}))}
                      className="py-1 [&_[role=slider]]:h-5 [&_[role=slider]]:w-5 [&_[role=slider]]:border-[3px]"
                    />
                  </div>
                  <div className="flex justify-between text-[13px] text-muted-foreground pt-1">
                    <span>4</span>
                    <span>max 32</span>
                  </div>
               </div>

               <div className="space-y-3 pt-2">
                  <div className="flex justify-between items-baseline mb-1">
                    <Label className="text-[16px] font-semibold">Battery storage</Label>
                    <span className="text-[15px] text-muted-foreground">{cfg.batteryKwh} kWh</span>
                  </div>
                  <div className="group relative">
                    <Slider 
                      min={0} max={20} step={2.5}
                      value={[cfg.batteryKwh]} 
                      onValueChange={v => setCfg(p => ({...p, batteryKwh: v[0]}))}
                      className="py-1 [&_[role=slider]]:h-5 [&_[role=slider]]:w-5 [&_[role=slider]]:border-[3px]"
                    />
                  </div>
               </div>

               <div className="pt-2 flex flex-col gap-4">
                 <div className="flex items-center justify-between pointer-events-auto">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <Zap className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div>
                        <Label className="text-[15px] font-semibold block mb-0.5">Heat pump</Label>
                        <span className="text-[14px] text-muted-foreground">Replace fossil heating</span>
                      </div>
                    </div>
                    <Switch checked={cfg.includeHeatPump} onCheckedChange={c => setCfg(p => ({...p, includeHeatPump: c}))} />
                 </div>
                 <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <Activity className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div>
                        <Label className="text-[15px] font-semibold block mb-0.5">EV wallbox</Label>
                        <span className="text-[14px] text-muted-foreground">11 kW charging</span>
                      </div>
                    </div>
                    <Switch checked={cfg.includeWallbox} onCheckedChange={c => setCfg(p => ({...p, includeWallbox: c}))} />
                 </div>
               </div>
            </section>

            <section className="space-y-4 pt-2">
              <div className="text-xs font-semibold tracking-[0.05em] uppercase text-muted-foreground mb-4">Cost breakdown</div>
              
              <div className="flex justify-between text-[15px] text-muted-foreground">
                <span>Solar panels</span>
                <span className="text-foreground font-medium">{(cfg.panelCount * 250).toLocaleString('de-DE')} €</span>
              </div>
              <div className="flex justify-between text-[15px] text-muted-foreground">
                <span>Inverter</span>
                <span className="text-foreground font-medium">{costs.inverter.toLocaleString('de-DE')} €</span>
              </div>
              <div className="flex justify-between text-[15px] text-muted-foreground">
                <span>Battery</span>
                <span className="text-foreground font-medium">{costs.battery.toLocaleString('de-DE')} €</span>
              </div>
              <div className="flex justify-between text-[15px] text-muted-foreground">
                <span>Installation</span>
                <span className="text-foreground font-medium">{costs.installation.toLocaleString('de-DE')} €</span>
              </div>
              
              <div className="border-t pt-4 mt-2 flex justify-between text-[16px] font-bold">
                <span>Subtotal</span>
                <span>{fmtEUR(costs.total)}</span>
              </div>
            </section>
          </div>

          <div className="bg-primary text-primary-foreground p-8 rounded-none">
             <div className="flex justify-between items-baseline mb-6">
                <div className="text-[16px] opacity-90">Net investment</div>
                <div className="font-display text-5xl leading-none">{fmtEUR(costs.netTotal)}</div>
             </div>
             
             <div className="border-t border-white/20 pt-6 mb-8 flex justify-between">
                <div>
                   <div className="opacity-80 text-[13px] mb-1">Yearly savings</div>
                   <div className="font-bold text-[18px]">{fmtEUR(yield_.yearlySavings)}</div>
                </div>
                <div>
                   <div className="opacity-80 text-[13px] mb-1">CO₂ saved/year</div>
                   <div className="font-bold text-[18px]">{(yield_.co2Saved / 1000).toFixed(1)} t</div>
                </div>
             </div>

             <PDFDownloadLink
               document={<SolarReportPDF intake={intake} cfg={cfg} costs={costs} yield_={yield_} />}
               fileName={`tectum_solar_quote_${new Date().toISOString().slice(0,10)}.pdf`}
               style={{ textDecoration: 'none' }}
             >
               {({ loading }) => (
                 <Button className="w-full bg-white text-primary hover:bg-gray-100 h-12 text-[16px] font-semibold rounded-[8px]">
                   {loading ? 'Generating PDF…' : 'Request installation quote'}
                 </Button>
               )}
             </PDFDownloadLink>
          </div>
        </div>
      </div>
    </div>
  );
}
