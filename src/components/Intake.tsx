import React, { useState, useEffect } from 'react';
import { ArrowRight, MapPin, Sun, Minus, Plus } from 'lucide-react';
import { type IntakeData, type EvStatus, type BatteryStatus, type HeatingType } from '../lib/solar';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { cn } from '../lib/utils';

interface IntakeProps {
  onComplete: (data: IntakeData) => void;
}

const DEFAULT_DATA: IntakeData = {
  name: '',
  email: '',
  isOwner: true,
  numPeople: 2,
  houseSize: 120,
  address: '',
  postalCode: '',
  roofType: 'gable',
  roofArea: 80,
  orientation: 'S',
  monthlyBill: 150,
  evStatus: 'none',
  batteryStatus: 'none',
  batteryCapacityKwh: 10,
  heatingType: 'gas',
  wantsHeatPump: false,
};

const HEATING_TYPES: Array<{ value: HeatingType; label: string }> = [
  { value: 'gas',       label: 'Gas' },
  { value: 'oil',       label: 'Oil' },
  { value: 'electric',  label: 'Electric' },
  { value: 'heat_pump', label: 'Heat pump' },
  { value: 'other',     label: 'Other' },
];

function ThreeWay({ value, onChange, labels }: {
  value: string;
  onChange: (v: string) => void;
  labels: [string, string, string];
}) {
  const options = ['has', 'wants', 'none'] as const;
  return (
    <div className="flex gap-2">
      {options.map((opt, i) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            "flex-1 py-3 px-2 rounded-xl border font-medium text-[13px] transition-colors leading-tight",
            value === opt
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border hover:border-primary/30"
          )}
        >
          {labels[i]}
        </button>
      ))}
    </div>
  );
}

export function Intake({ onComplete }: IntakeProps) {
  const [data, setData] = useState<IntakeData>(DEFAULT_DATA);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('solaric.intake.v1');
        if (saved) setData(prev => ({ ...prev, ...JSON.parse(saved) }));
      } catch (e) {
        console.error('Failed to parse intake data', e);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('solaric.intake.v1', JSON.stringify(data));
      } catch (e) {
        console.error('Failed to save intake data', e);
      }
    }
  }, [data]);

  const updateData = (updates: Partial<IntakeData>) => setData(prev => ({ ...prev, ...updates }));

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col pt-8 sm:pt-16 items-center px-4 pb-16">
      <div className="w-full max-w-xl">
        <header className="flex items-center mb-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-solar flex items-center justify-center text-primary-foreground shadow-sm">
              <Sun className="w-6 h-6" />
            </div>
            <span className="font-display text-3xl tracking-tight">Tectum</span>
          </div>
        </header>

        <h1 className="font-display text-5xl mb-2">Design your solar system</h1>
        <p className="text-muted-foreground text-[15px] mb-10">Fill in your details and we'll build a personalised quote.</p>

        <div className="space-y-6">

          {/* Personal details */}
          <section className="bg-card rounded-[20px] p-6 sm:p-8 border border-border shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
            <div className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-5">Personal details</div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={data.name}
                  onChange={e => updateData({ name: e.target.value })}
                  className="h-12 text-base"
                  placeholder="Enter your full name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={data.email}
                  onChange={e => updateData({ email: e.target.value })}
                  className="h-12 text-base"
                  placeholder="you@example.com"
                />
              </div>
            </div>
          </section>

          {/* House details */}
          <section className="bg-card rounded-[20px] p-6 sm:p-8 border border-border shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
            <div className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-5">House details</div>
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
                  <Input
                    id="address"
                    value={data.address}
                    onChange={e => updateData({ address: e.target.value })}
                    className="pl-10 h-12 text-base"
                    placeholder="Enter street and house number"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="postalCode">Postal code</Label>
                <Input
                  id="postalCode"
                  value={data.postalCode}
                  onChange={e => updateData({ postalCode: e.target.value })}
                  className="max-w-[160px] h-12 text-base"
                  placeholder="e.g. 10115"
                />
              </div>

              <div className="space-y-2">
                <Label>Property owner?</Label>
                <div className="flex gap-3">
                  {([{ label: 'Yes', value: true }, { label: 'No', value: false }] as const).map(opt => (
                    <button
                      key={String(opt.value)}
                      onClick={() => updateData({ isOwner: opt.value })}
                      className={cn(
                        "flex-1 py-3 rounded-xl border font-medium text-[15px] transition-colors",
                        data.isOwner === opt.value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:border-primary/30"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>People in the household</Label>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => updateData({ numPeople: Math.max(1, data.numPeople - 1) })}
                    className="w-11 h-11 rounded-xl border border-border flex items-center justify-center hover:border-primary/40 transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="font-display text-4xl w-8 text-center leading-none">{data.numPeople}</span>
                  <button
                    onClick={() => updateData({ numPeople: Math.min(10, data.numPeople + 1) })}
                    className="w-11 h-11 rounded-xl border border-border flex items-center justify-center hover:border-primary/40 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <span className="text-muted-foreground text-[14px]">{data.numPeople === 1 ? 'person' : 'people'}</span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <Label>House size</Label>
                  <span className="font-medium text-primary">{data.houseSize} m²</span>
                </div>
                <Slider
                  min={30} max={500} step={10}
                  value={[data.houseSize]}
                  onValueChange={v => updateData({ houseSize: v[0] })}
                  className="py-2"
                />
                <div className="flex justify-between text-[13px] text-muted-foreground">
                  <span>30 m²</span><span>500 m²</span>
                </div>
              </div>
            </div>
          </section>

          {/* Energy Consumption */}
          <section className="bg-card rounded-[20px] p-6 sm:p-8 border border-border shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
            <div className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-5">Energy Consumption</div>
            <div className="space-y-6">

              {/* Monthly bill */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <Label className="text-[15px] font-semibold">Monthly electricity bill</Label>
                  <span className="text-muted-foreground text-sm">≈ €{(data.monthlyBill * 12).toLocaleString('de-DE')} / year</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="icon"
                    className="h-12 w-14 shrink-0 rounded-xl bg-background border-border"
                    onClick={() => updateData({ monthlyBill: Math.max(20, data.monthlyBill - 25) })}
                  >
                    <span className="text-xl font-medium">−</span>
                  </Button>
                  <div className="relative flex-1">
                    <span className="absolute left-4 top-[14px] text-muted-foreground">€</span>
                    <Input
                      type="number"
                      value={data.monthlyBill}
                      onChange={e => updateData({ monthlyBill: Math.max(20, parseInt(e.target.value) || 20) })}
                      className={cn(
                        "h-12 pl-8 pr-16 text-left text-[16px] bg-background border-border rounded-xl",
                        "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      )}
                    />
                    <span className="absolute right-4 top-[14px] text-muted-foreground text-[14px]">/ month</span>
                  </div>
                  <Button
                    variant="outline" size="icon"
                    className="h-12 w-14 shrink-0 rounded-xl bg-background border-border"
                    onClick={() => updateData({ monthlyBill: data.monthlyBill + 25 })}
                  >
                    <span className="text-xl font-medium">+</span>
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[60, 100, 150, 220, 320].map(amt => (
                    <button
                      key={amt}
                      onClick={() => updateData({ monthlyBill: amt })}
                      className={cn(
                        "px-4 py-1.5 rounded-full text-[14px] font-medium transition-colors border",
                        data.monthlyBill === amt
                          ? "bg-card text-foreground border-border shadow-sm"
                          : "bg-background border-border text-foreground hover:border-gray-400"
                      )}
                    >
                      €{amt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-5 pt-2 border-t">

                {/* EV / Wallbox */}
                <div className="space-y-2 pt-4">
                  <Label className="text-[15px] font-semibold block">EV charging installation</Label>
                  <p className="text-[13px] text-muted-foreground mb-3">Do you have a wallbox, or would you like one?</p>
                  <ThreeWay
                    value={data.evStatus}
                    onChange={v => updateData({ evStatus: v as EvStatus })}
                    labels={['I have one', "I'd like one", 'Not interested']}
                  />
                </div>

                {/* Battery */}
                <div className="space-y-2 pt-2 border-t">
                  <Label className="text-[15px] font-semibold block pt-4">Battery storage</Label>
                  <p className="text-[13px] text-muted-foreground mb-3">Do you already have a battery, or would you like one?</p>
                  <ThreeWay
                    value={data.batteryStatus}
                    onChange={v => updateData({ batteryStatus: v as BatteryStatus })}
                    labels={['I have one', "I'd like one", 'Not interested']}
                  />
                  {data.batteryStatus !== 'none' && (
                    <div className="space-y-3 pt-4">
                      <div className="flex justify-between items-center">
                        <Label className="text-[14px]">
                          {data.batteryStatus === 'has' ? 'Current capacity' : 'Desired capacity'}
                        </Label>
                        <span className="font-medium text-primary">{data.batteryCapacityKwh} kWh</span>
                      </div>
                      <Slider
                        min={2.5} max={20} step={2.5}
                        value={[data.batteryCapacityKwh]}
                        onValueChange={v => updateData({ batteryCapacityKwh: v[0] })}
                        className="py-2"
                      />
                      <div className="flex justify-between text-[13px] text-muted-foreground">
                        <span>2.5 kWh</span><span>20 kWh</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Heating */}
                <div className="space-y-3 pt-2 border-t">
                  <Label className="text-[15px] font-semibold block pt-4">Current heating type</Label>
                  <div className="grid grid-cols-5 gap-2">
                    {HEATING_TYPES.map(ht => (
                      <button
                        key={ht.value}
                        onClick={() => {
                          updateData({ heatingType: ht.value, wantsHeatPump: ht.value === 'heat_pump' ? false : data.wantsHeatPump });
                        }}
                        className={cn(
                          "py-3 rounded-xl border font-medium text-[12px] transition-colors",
                          data.heatingType === ht.value
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:border-primary/30"
                        )}
                      >
                        {ht.label}
                      </button>
                    ))}
                  </div>
                  {data.heatingType !== 'heat_pump' && (
                    <div className="flex items-center justify-between pt-2">
                      <div>
                        <Label className="text-[14px] font-semibold block mb-0.5">Switch to heat pump?</Label>
                        <span className="text-[13px] text-muted-foreground">Replace your current heating with an electric heat pump</span>
                      </div>
                      <Switch
                        checked={data.wantsHeatPump}
                        onCheckedChange={c => updateData({ wantsHeatPump: c })}
                      />
                    </div>
                  )}
                </div>

              </div>
            </div>
          </section>

        </div>

        <div className="flex justify-end mt-8">
          <Button onClick={() => onComplete(data)} className="gap-2 h-11 px-8 rounded-xl text-[15px] font-semibold">
            Generate design
            <ArrowRight className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
