# Installer-Configurable Pipeline Constraints

Parameters the installer can modify from the frontend without breaking the pipeline.
Each parameter only affects economics or selection — never physics or energy simulation.

---

## Tier 1 — Cost Levers (safe, no physics risk)

These are pure cost inputs. Changing them recalculates pricing, payback, and NPV
but does not affect system sizing, energy production, or self-consumption models.

| Parameter | Default | Unit | Description |
|---|---|---|---|
| `BASE_PV_COST_PER_KWP` | 1300 | €/kWp | PV module + inverter + wiring cost per kWp |
| `BASE_BATTERY_COST_PER_KWH` | 600 | €/kWh | Battery storage base cost per kWh |
| `WALLBOX_COST` | 1200 | € | EV charger installed cost (flat) |
| `SERVICE_COST_WITH_PV` | 2500 | € | Labor + misc when PV is included |
| `SERVICE_COST_WITHOUT_PV` | 1000 | € | Labor + misc without PV (battery-only retrofit) |
| `HEATPUMP_COST_PER_KW` | 1800 | €/kW | Heat pump cost per kW thermal capacity |
| `GAS_COST_PER_KWH` | 0.12 | €/kWh | Gas price (used only in heat pump savings calc) |
| `FEED_IN_TARIFF_SMALL` | 0.082 | €/kWh | Feed-in tariff for systems ≤10 kWp |
| `FEED_IN_TARIFF_LARGE` | 0.071 | €/kWh | Feed-in tariff for >10 kWp portion |
| `BRAND_COST_FACTOR` | see below | multiplier | Per-brand battery cost scaling factor |

### Brand Cost Factors

| Brand | Factor | Effect |
|---|---|---|
| Huawei | 1.00 | baseline |
| EcoFlow | 0.95 | 5% cheaper |
| Sigenergy | 1.03 | 3% premium |
| SAJ | 0.92 | 8% cheaper |
| SolarEdge | 1.12 | 12% premium |
| Enphase | 1.08 | 8% premium |

---

## Tier 2 — Catalog & Brand Preferences (safe, affects product selection)

These change which products/brands are available or preferred.
The pipeline still generates valid options — just from a different pool.

| Parameter | Default | Description |
|---|---|---|
| `BRAND_BATTERIES` | per-brand size lists | Available battery sizes (kWh) per brand |
| `BRAND_PRIOR` | Huawei 1.0, EcoFlow 0.92, Sigenergy 0.55, SAJ 0.15, SolarEdge 0.10, Enphase 0.08 | Brand popularity weight in realism scorer |

### Brand Battery Sizes

| Brand | Available Sizes (kWh) |
|---|---|
| Huawei | 5, 7, 10, 14, 15, 20 |
| EcoFlow | 5, 10, 15 |
| Sigenergy | 6, 9, 12, 15 |
| SAJ | 5, 10, 15 |
| SolarEdge | 5, 10, 14 |
| Enphase | 5, 10 |

---

## Tier 3 — Selection Tuning (safe but changes recommendations)

These affect which of the 3 options (Budget / Balanced / Max Independence) gets selected.
Should be exposed with bounded sliders to prevent nonsensical values.

| Parameter | Default | Suggested Range | Description |
|---|---|---|---|
| Balanced weight: NPV | 0.30 | 0.10–0.50 | How much financial return matters in "Balanced" pick |
| Balanced weight: Realism | 0.45 | 0.20–0.60 | How much installer-pattern matching matters |
| Balanced weight: Self-sufficiency | 0.25 | 0.10–0.40 | How much energy independence matters |
| `max_payback_years` (no HP) | 20 | 15–25 | Max payback threshold to include an option |
| `max_payback_years` (with HP) | 25 | 20–30 | Same, relaxed for heat pump combos |
| `min_battery_kwh` | 5 | 0–10 | Minimum battery for full_system / retrofit modes |

> **Note:** The three balanced weights must sum to 1.0. The frontend should enforce this constraint.

---

## Do NOT Expose (physics-critical)

These parameters are hardcoded for a reason. Changing them produces
silently wrong energy estimates or breaks the pipeline entirely.

| Parameter | Value | Why locked |
|---|---|---|
| `MODULE_WP` | 450 W | Module-count-to-kWp conversion — breaks all sizing |
| `SPECIFIC_YIELD` | 950 kWh/kWp/yr | Core of every energy production calculation |
| `_SC_TABLE` | HTW Berlin lookup | Empirically calibrated self-consumption model |
| Battery lift formula | `0.05 * kWh^0.55` | Empirical curve fit for battery self-consumption boost |
| `DISCOUNT_RATE` | 0.03 | Changes all 20-year NPV projections |
| `GAS_BOILER_EFFICIENCY` | 0.90 | Physics constant for heat pump comparison |
| Realism scorer point values | various | Market-calibrated heuristic weights |
| `COMMON_BATTERY_SIZES` weights | various | Demand-proportional scoring table |

---

## Implementation Notes

To apply installer overrides, pass an `overrides` dict alongside the form input:

```python
result = run_pipeline(form_data, overrides={
    "BASE_PV_COST_PER_KWP": 1400,
    "WALLBOX_COST": 1100,
    "FEED_IN_TARIFF_SMALL": 0.081,
})
```

The pipeline merges overrides into its constants before running.
Any key not present in `overrides` keeps its default value.
