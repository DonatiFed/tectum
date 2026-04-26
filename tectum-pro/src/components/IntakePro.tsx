import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, ArrowLeft, MapPin, Minus, Plus } from 'lucide-react';
import { type IntakeData, type EvStatus, type BatteryStatus, type HeatingType } from '../lib/solar';
import { cn } from '../lib/utils';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';

interface IntakeProProps {
  onComplete: (data: IntakeData) => void;
  onBack: () => void;
  initial?: IntakeData | null;
}

const DEFAULT_DATA: IntakeData = {
  name: '', email: '', isOwner: true, numPeople: 2, houseSize: 120,
  address: '', postalCode: '', roofType: 'gable', roofArea: 80,
  orientation: 'S', monthlyBill: 150, evStatus: 'none',
  batteryStatus: 'none', batteryCapacityKwh: 10, heatingType: 'gas', wantsHeatPump: false,
};

const HEATING_TYPES: Array<{ value: HeatingType; label: string }> = [
  { value: 'gas', label: 'Gas' },
  { value: 'oil', label: 'Oil' },
  { value: 'electric', label: 'Electric' },
  { value: 'heat_pump', label: 'Heat pump' },
  { value: 'other', label: 'Other' },
];

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn("flex-1 py-3 px-2 rounded-xl border font-medium text-[13px] transition-colors leading-tight",
        selected ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/30"
      )}>{children}</button>
  );
}

function ThreeWay({ value, onChange, labels }: { value: string; onChange: (v: string) => void; labels: [string, string, string] }) {
  const opts = ['has', 'wants', 'none'] as const;
  return (
    <div className="flex gap-2">
      {opts.map((o, i) => <Pill key={o} selected={value === o} onClick={() => onChange(o)}>{labels[i]}</Pill>)}
    </div>
  );
}

export function IntakePro({ onComplete, onBack, initial }: IntakeProProps) {
  const [data, setData] = useState<IntakeData>(initial || DEFAULT_DATA);

  useEffect(() => { if (initial) setData(initial); }, [initial]);

  const update = (u: Partial<IntakeData>) => setData(p => ({ ...p, ...u }));

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-[14px]">
            <ArrowLeft className="w-4 h-4" /> Projects
          </button>
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Tectum" className="w-8 h-8" />
            <span className="font-display text-2xl">tectum</span>
          </div>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 py-10">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="font-display text-5xl mb-2">New project</h1>
          <p className="text-muted-foreground text-[15px] mb-10">Fill in the customer details to generate a solar design.</p>
        </motion.div>

        <div className="space-y-6">
          {/* Personal */}
          <section className="bg-card rounded-2xl p-6 sm:p-8 border">
            <div className="text-[11px] font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-5">Customer</div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium">Full name</label>
                  <input value={data.name} onChange={e => update({ name: e.target.value })} placeholder="Name"
                    className="w-full h-12 px-4 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all text-[15px]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium">Email</label>
                  <input type="email" value={data.email} onChange={e => update({ email: e.target.value })} placeholder="email@mail.de"
                    className="w-full h-12 px-4 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all text-[15px]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium">Address</label>
                <div className="relative">
                  <MapPin className="absolute left-3.5 top-3.5 w-4 h-4 text-muted-foreground" />
                  <input value={data.address} onChange={e => update({ address: e.target.value })} placeholder="Street and number"
                    className="w-full h-12 pl-10 pr-4 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all text-[15px]" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium">Postal code</label>
                  <input value={data.postalCode} onChange={e => update({ postalCode: e.target.value })} placeholder="10115"
                    className="w-full h-12 px-4 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all text-[15px]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium">People</label>
                  <div className="flex items-center gap-3 h-12">
                    <button onClick={() => update({ numPeople: Math.max(1, data.numPeople - 1) })}
                      className="w-10 h-10 rounded-xl border flex items-center justify-center hover:border-primary/30 transition-colors"><Minus className="w-4 h-4" /></button>
                    <span className="font-display text-3xl w-6 text-center">{data.numPeople}</span>
                    <button onClick={() => update({ numPeople: Math.min(10, data.numPeople + 1) })}
                      className="w-10 h-10 rounded-xl border flex items-center justify-center hover:border-primary/30 transition-colors"><Plus className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium">Owner?</label>
                  <div className="flex gap-2 h-12">
                    <Pill selected={data.isOwner} onClick={() => update({ isOwner: true })}>Yes</Pill>
                    <Pill selected={!data.isOwner} onClick={() => update({ isOwner: false })}>No</Pill>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Property */}
          <section className="bg-card rounded-2xl p-6 sm:p-8 border">
            <div className="text-[11px] font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-5">Property</div>
            <div className="space-y-5">
              <div className="space-y-3">
                <div className="flex justify-between"><label className="text-[13px] font-medium">House size</label><span className="font-medium text-primary text-[14px]">{data.houseSize} m²</span></div>
                <Slider min={30} max={500} step={10} value={[data.houseSize]} onValueChange={v => update({ houseSize: v[0] })} className="py-2" />
              </div>
              <div className="space-y-3">
                <div className="flex justify-between"><label className="text-[13px] font-medium">Roof area</label><span className="font-medium text-primary text-[14px]">{data.roofArea} m²</span></div>
                <Slider min={20} max={200} step={5} value={[data.roofArea]} onValueChange={v => update({ roofArea: v[0] })} className="py-2" />
              </div>
              <div className="space-y-2">
                <label className="text-[13px] font-medium">Roof type</label>
                <div className="grid grid-cols-4 gap-2">
                  {([{ value: 'gable', label: 'Gable' }, { value: 'hip', label: 'Hip' }, { value: 'flat', label: 'Flat' }, { value: 'shed', label: 'Shed' }] as const).map(r => (
                    <Pill key={r.value} selected={data.roofType === r.value} onClick={() => update({ roofType: r.value })}>{r.label}</Pill>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[13px] font-medium">Orientation</label>
                <div className="grid grid-cols-6 gap-2">
                  {(['S', 'SE', 'SW', 'E', 'W', 'N'] as const).map(o => (
                    <Pill key={o} selected={data.orientation === o} onClick={() => update({ orientation: o })}>{o}</Pill>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Energy */}
          <section className="bg-card rounded-2xl p-6 sm:p-8 border">
            <div className="text-[11px] font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-5">Energy</div>
            <div className="space-y-5">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[14px] font-semibold">Monthly bill</label>
                  <span className="text-muted-foreground text-[13px]">~ {(data.monthlyBill * 12).toLocaleString('de-DE')} €/y</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => update({ monthlyBill: Math.max(20, data.monthlyBill - 25) })}
                    className="w-12 h-12 rounded-xl border flex items-center justify-center hover:border-primary/30 transition-colors text-lg shrink-0">−</button>
                  <div className="relative flex-1">
                    <span className="absolute left-4 top-3.5 text-muted-foreground">€</span>
                    <input type="number" value={data.monthlyBill}
                      onChange={e => update({ monthlyBill: Math.max(20, parseInt(e.target.value) || 20) })}
                      className={cn("w-full h-12 pl-8 pr-16 rounded-xl bg-background border text-foreground focus:outline-none focus:border-primary transition-all text-[15px]",
                        "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none")} />
                    <span className="absolute right-4 top-3.5 text-muted-foreground/40 text-[14px]">/ month</span>
                  </div>
                  <button onClick={() => update({ monthlyBill: data.monthlyBill + 25 })}
                    className="w-12 h-12 rounded-xl border flex items-center justify-center hover:border-primary/30 transition-colors text-lg shrink-0">+</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[60, 100, 150, 220, 320].map(a => (
                    <button key={a} onClick={() => update({ monthlyBill: a })}
                      className={cn("px-4 py-1.5 rounded-full text-[13px] font-medium border transition-colors",
                        data.monthlyBill === a ? "bg-card border-border shadow-sm text-foreground" : "bg-background border-border text-foreground hover:border-primary/30"
                      )}>€{a}</button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Equipment */}
          <section className="bg-card rounded-2xl p-6 sm:p-8 border">
            <div className="text-[11px] font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-5">Equipment</div>
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-[14px] font-semibold">EV charging</label>
                <ThreeWay value={data.evStatus} onChange={v => update({ evStatus: v as EvStatus })} labels={['I have one', "I'd like one", 'Not interested']} />
              </div>
              <div className="border-t pt-5 space-y-2">
                <label className="text-[14px] font-semibold">Battery storage</label>
                <ThreeWay value={data.batteryStatus} onChange={v => update({ batteryStatus: v as BatteryStatus })} labels={['I have one', "I'd like one", 'Not interested']} />
                {data.batteryStatus !== 'none' && (
                  <div className="space-y-3 pt-3">
                    <div className="flex justify-between"><label className="text-[13px]">{data.batteryStatus === 'has' ? 'Current' : 'Desired'} capacity</label><span className="font-medium text-primary">{data.batteryCapacityKwh} kWh</span></div>
                    <Slider min={2.5} max={20} step={2.5} value={[data.batteryCapacityKwh]} onValueChange={v => update({ batteryCapacityKwh: v[0] })} className="py-2" />
                  </div>
                )}
              </div>
              <div className="border-t pt-5 space-y-3">
                <label className="text-[14px] font-semibold">Current heating</label>
                <div className="grid grid-cols-5 gap-2">
                  {HEATING_TYPES.map(ht => (
                    <Pill key={ht.value} selected={data.heatingType === ht.value}
                      onClick={() => update({ heatingType: ht.value, wantsHeatPump: ht.value === 'heat_pump' ? false : data.wantsHeatPump })}>{ht.label}</Pill>
                  ))}
                </div>
                {data.heatingType !== 'heat_pump' && (
                  <div className="flex items-center justify-between pt-2">
                    <div>
                      <label className="text-[14px] font-semibold block mb-0.5">Switch to heat pump?</label>
                      <span className="text-[13px] text-muted-foreground">Replace with electric HP</span>
                    </div>
                    <Switch checked={data.wantsHeatPump} onCheckedChange={c => update({ wantsHeatPump: c })} />
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="flex justify-end mt-8 mb-16">
          <button onClick={() => onComplete(data)}
            className="h-11 px-8 rounded-xl bg-primary text-primary-foreground font-semibold text-[15px] flex items-center gap-2 hover:opacity-90 transition-opacity">
            Generate design <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
