# Reonic AI Solar Designer

A 10-step pipeline that takes a customer's situation and generates 3 solar + battery + heat pump options, each with a full Bill of Materials and a personalized AI explanation.

**Speed:** ~3.6ms per run. Stateless — every input change reruns the full pipeline.

---

## How it works

```
Customer Input
    ↓
[1] Context Builder     → Parses inputs, detects mode (full system / battery retrofit / PV only)
    ↓
[2] Candidate Generator → Enumerates all valid combinations of modules × battery × brand × heat pump
    ↓
[3] Physics + Economics → For each candidate: energy simulation (HTW Berlin self-consumption model),
                          20-year NPV, payback, savings with escalating electricity prices
    ↓
[4] Realism Scorer      → Scores each candidate on how similar it is to real German installer designs
    ↓
[5] Option Selector     → Picks 3 distinct options: Budget (cheapest), Balanced (best overall),
                          Max Independence (highest self-sufficiency, includes heat pump if eligible)
    ↓
[6] Product Mapper      → Maps sizing to real products from brand catalogs (Huawei, EcoFlow, etc.)
    ↓
[7] BOM Assembler       → Builds full Bill of Materials: panels, battery, inverter, wallbox,
                          heat pump + accessories, substructure, installation fees
    ↓
[8] Validator           → Checks constraints: brand lock-in, BOM integrity, physical bounds
    ↓
[9] Output Formatter    → Structures the final JSON with all 3 options
    ↓
[10] AI Explanation     → LLM (local Llama 3.2 or Claude) writes a personalized customer explanation
```

## Input

A single JSON object:

```python
{
    "energy_demand_kwh": 5000,       # Annual household electricity consumption
    "energy_price_ct_kwh": 32,       # Current electricity price in ct/kWh
    "energy_price_increase_pct": 2,  # Expected annual price increase (%)
    "has_ev": True,                  # Owns an electric vehicle
    "ev_distance_km": 12000,         # Annual EV driving distance (optional)
    "has_solar": False,              # Already has solar panels
    "existing_solar_kwp": None,      # Existing system size if has_solar
    "has_storage": False,            # Already has a battery
    "has_wallbox": False,            # Already has an EV charger
    "heating_existing_type": "Gas",  # "Gas", "Oil", "Electric", or "District"
    "heating_existing_heating_demand_wh": None,  # Heating demand in Wh (optional)
    "roof_type": "Concrete Tile Roof",           # Roof material
    "max_modules": 26,               # Max panels that fit on the roof (from 3D roof analysis)
    "preferred_brand": "auto",       # "auto" or a specific brand name
    "budget_cap_eur": None,          # Maximum budget (optional)
}
```

## Output

Three options (Budget / Balanced / Max Independence), each containing:

- **Sizing:** kWp, battery kWh, brand, wallbox yes/no, heat pump kW
- **Metrics:** production, self-consumption rate, self-sufficiency rate, total cost, year 1 savings, payback years, 20-year NPV
- **BOM:** Full list of components with types, names, brands, quantities
- **Validation:** Any warnings from the constraint checker
- **AI explanation:** Personalized text explaining the recommendation

## Key design decisions

**Self-consumption model:** HTW Berlin calibrated lookup table, not an exponential formula. Battery lift uses a power-law (`0.05 × battery^0.55 / R^0.35`), capped at 85%.

**Balanced selection:** Weighted score: `0.30 × NPV + 0.45 × realism + 0.25 × self-sufficiency`. This intentionally produces systems ~17% larger than conservative installer designs because it optimizes for the customer's long-term ROI.

**Brand ecosystem lock-in:** Once a brand is chosen for the battery, the wallbox, inverter, and accessories all come from the same brand catalog. This matches how real installers work.

**Heat pump:** When the customer has gas or oil heating, the Max Independence option includes a Vaillant heat pump. Economics include gas cost displacement (COP 3.0). Budget and Balanced stay without heat pump to keep costs moderate.

**Demand-proportional battery:** Low demand → 5 kWh, medium → 7 kWh, high → 10 kWh. This matches the pattern from real German installer data instead of always picking the largest battery.

---

## How changes work

The pipeline is stateless. To change anything, modify the input and rerun. There is no session, no state, no "edit mode."

### Customer changes a slider

Just rerun with the new value. At 3.6ms, the UI can call the pipeline on every slider move.

### Installer overrides a brand

Set `preferred_brand: "Huawei"`. The candidate generator only produces Huawei combinations. Physics, economics, realism scoring, and BOM assembly all work the same — only the search space narrows.

### Customer sets a budget limit

Set `budget_cap_eur: 25000`. Any candidate whose total cost exceeds this is filtered out before option selection. The pipeline still picks the best Budget/Balanced/Max Independence from whatever remains.

### Customer already has solar panels

Set `has_solar: True` and `existing_solar_kwp: 8.0`. The pipeline switches to `battery_retrofit` mode — it only sizes a battery (and optionally wallbox/heat pump), not new PV modules.

### Future extensions

Adding new constraints follows the same pattern:

| Constraint | How to add |
|---|---|
| Exclude specific brands | Add `exclude_brands: ["SAJ"]` → filter in candidate generator |
| Minimum battery size | Add `min_battery_kwh: 10` → filter in candidate generator |
| Force heat pump | Add `force_heatpump: true` → include HP in all options, not just Max Independence |
| Installer margin | Add `installer_margin_pct: 15` → apply in economics step |

The realism scorer and physics engine run after all constraints, so realistic patterns (battery/module ratio, self-consumption bounds, price ranges) hold regardless of what constraints are applied.

---

## Files

| File | Purpose |
|---|---|
| `pipeline.py` | Core pipeline — all 9 steps, ~700 lines |
| `ai_salesperson.py` | Step 10 — LLM explanation (Ollama / Claude / mock) |
| `test_pipeline.py` | 7-test evaluation suite (physics, sizing, ordering, BOM, sensitivity, backtest, performance) |
| `generate_dashboard.py` | Generates `dashboard.html` — interactive evaluation with charts, comparisons, demo |
| `merged_input_output.csv` | 1,062 real German installer projects for backtesting |

## Running

```bash
# Run the test suite
python test_pipeline.py

# Generate the evaluation dashboard
python generate_dashboard.py ollama    # uses local Llama 3.2 for AI explanation
python generate_dashboard.py mock      # uses template fallback

# Run the AI explanation standalone
python ai_salesperson.py ollama

# Use the pipeline in code
from pipeline import generate_offer
result = generate_offer(form)
```

## Backtest results (809 projects)

| Metric | With real roof data | Without (fixed 30 modules) |
|---|---|---|
| kWp within ±40% | 96% | 44% |
| kWp within ±20% | 63% | 22% |
| MAE | 1.5 kWp | 4.8 kWp |
| Battery within ±3 kWh | 65% | 56% |

The roof constraint (`max_modules`) is the single most important input. In production, the 3D roof parser provides this. Battery and brand accuracy are stable regardless of roof strategy.
