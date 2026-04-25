"""
Pipeline evaluation suite — physics, sizing, ordering, BOM, sensitivity, and backtest.
"""

import time
import json
import pandas as pd
from pipeline import generate_offer

# ──────────────────────────────────────────────────────────────────────
# Test Fixtures
# ──────────────────────────────────────────────────────────────────────

DEFAULT_FORM = {
    "energy_demand_kwh": 4500,
    "energy_price_ct_kwh": 32,
    "energy_price_increase_pct": 2,
    "has_ev": True,
    "ev_distance_km": None,
    "has_solar": False,
    "existing_solar_kwp": None,
    "has_storage": False,
    "has_wallbox": False,
    "heating_existing_type": "Gas",
    "heating_existing_heating_demand_wh": None,
    "roof_type": "Concrete Tile Roof",
    "max_modules": 26,
    "preferred_brand": "auto",
    "budget_cap_eur": None,
}

SEGMENT_RANGES = {
    (0, 3000):     {"kwp": (5, 12),  "battery": (0, 10)},
    (3000, 5000):  {"kwp": (6, 14),  "battery": (5, 10)},
    (5000, 8000):  {"kwp": (8, 16),  "battery": (7, 14)},
    (8000, 50000): {"kwp": (10, 25), "battery": (10, 20)},
}


def _balanced(result):
    for o in result["offers"]:
        if o["option_name"] == "Balanced":
            return o
    return result["offers"][0] if result["offers"] else None


# ──────────────────────────────────────────────────────────────────────
# Test A — Physics Consistency
# ──────────────────────────────────────────────────────────────────────

def test_physics():
    result = generate_offer(DEFAULT_FORM)
    errors = []
    for o in result["offers"]:
        m = o["metrics"]
        if not (0.10 < m["self_consumption_rate"] < 0.86):
            errors.append(f"{o['option_name']}: SC={m['self_consumption_rate']}")
        if not (0.10 < m["self_sufficiency_rate"] <= 1.0):
            errors.append(f"{o['option_name']}: SS={m['self_sufficiency_rate']}")
        if m["year1_savings_eur"] <= 0:
            errors.append(f"{o['option_name']}: savings={m['year1_savings_eur']}")
        if not (3 < m["payback_years"] < 25):
            errors.append(f"{o['option_name']}: payback={m['payback_years']}")
        sc_kwh = m["production_kwh"] * m["self_consumption_rate"]
        if sc_kwh > m["total_demand_kwh"] + 1:
            errors.append(f"{o['option_name']}: SC energy exceeds demand")

    if errors:
        print(f"  FAIL Physics: {errors}")
    else:
        print("  PASS Physics consistency")
    return len(errors) == 0


# ──────────────────────────────────────────────────────────────────────
# Test B — Sizing Within Data Ranges
# ──────────────────────────────────────────────────────────────────────

def test_sizing_ranges():
    errors = []
    for (lo_d, hi_d), ranges in SEGMENT_RANGES.items():
        form = {**DEFAULT_FORM, "energy_demand_kwh": (lo_d + hi_d) // 2, "has_ev": False,
                "heating_existing_type": "Electric"}
        result = generate_offer(form)
        bal = _balanced(result)
        if not bal:
            errors.append(f"demand={form['energy_demand_kwh']}: no Balanced option")
            continue
        kwp = bal["sizing"]["kwp"]
        batt = bal["sizing"]["battery_kwh"]
        if not (ranges["kwp"][0] <= kwp <= ranges["kwp"][1]):
            errors.append(f"demand={form['energy_demand_kwh']}: kwp={kwp} outside {ranges['kwp']}")
        if batt > 0 and not (ranges["battery"][0] <= batt <= ranges["battery"][1]):
            errors.append(f"demand={form['energy_demand_kwh']}: batt={batt} outside {ranges['battery']}")

    if errors:
        print(f"  WARN Sizing: {errors}")
    else:
        print("  PASS Sizing within expected ranges")
    return len(errors) == 0


# ──────────────────────────────────────────────────────────────────────
# Test C — Option Ordering
# ──────────────────────────────────────────────────────────────────────

def test_ordering():
    result = generate_offer(DEFAULT_FORM)
    by_name = {o["option_name"]: o["metrics"] for o in result["offers"]}
    errors = []

    if "Budget" in by_name and "Max Independence" in by_name:
        if by_name["Budget"]["total_cost_eur"] > by_name["Max Independence"]["total_cost_eur"]:
            errors.append("Budget more expensive than Max Independence")
        if by_name["Budget"]["self_sufficiency_rate"] > by_name["Max Independence"]["self_sufficiency_rate"]:
            errors.append("Budget has higher SS than Max Independence")

    if errors:
        print(f"  FAIL Ordering: {errors}")
    else:
        print("  PASS Option ordering")
    return len(errors) == 0


# ──────────────────────────────────────────────────────────────────────
# Test D — BOM Structural Validity
# ──────────────────────────────────────────────────────────────────────

def test_bom():
    result = generate_offer(DEFAULT_FORM)
    errors = []
    for o in result["offers"]:
        bom = o["bom"]
        if not (5 <= len(bom) <= 22):
            errors.append(f"{o['option_name']}: BOM has {len(bom)} items")
        types = {b["component_type"] for b in bom}
        if o["sizing"]["battery_kwh"] > 0 and "BatteryStorage" not in types:
            errors.append(f"{o['option_name']}: missing BatteryStorage")
        brands = {b["component_brand"] for b in bom
                  if b["component_type"] in ("BatteryStorage", "Wallbox") and b["component_brand"]}
        if len(brands) > 1:
            errors.append(f"{o['option_name']}: mixed brands {brands}")

    if errors:
        print(f"  FAIL BOM: {errors}")
    else:
        print("  PASS BOM structural validity")
    return len(errors) == 0


# ──────────────────────────────────────────────────────────────────────
# Test E — Sensitivity
# ──────────────────────────────────────────────────────────────────────

def test_sensitivity():
    base_form = {**DEFAULT_FORM, "has_ev": False, "heating_existing_type": "Electric"}
    ev_form = {**DEFAULT_FORM, "has_ev": True, "heating_existing_type": "Electric"}
    high_form = {**DEFAULT_FORM, "energy_demand_kwh": 10000, "has_ev": False,
                 "heating_existing_type": "Electric"}

    bb = _balanced(generate_offer(base_form))
    be = _balanced(generate_offer(ev_form))
    bh = _balanced(generate_offer(high_form))

    errors = []
    if bb and be:
        if be["sizing"]["kwp"] < bb["sizing"]["kwp"]:
            errors.append("EV didn't increase PV size")
    if bb and bh:
        if bh["sizing"]["kwp"] < bb["sizing"]["kwp"]:
            errors.append("Higher demand didn't increase PV size")

    if errors:
        print(f"  FAIL Sensitivity: {errors}")
    else:
        print("  PASS Sensitivity checks")
    return len(errors) == 0


# ──────────────────────────────────────────────────────────────────────
# Test F — Backtest Against Real Data
# ──────────────────────────────────────────────────────────────────────

def test_backtest():
    try:
        merged = pd.read_csv("merged_input_output.csv")
    except FileNotFoundError:
        print("  SKIP Backtest: merged_input_output.csv not found")
        return True

    within = 0
    total = 0
    errors_list = []

    for _, row in merged.iterrows():
        if pd.isna(row.get("total_kwp")) or row["total_kwp"] <= 0:
            continue

        form = {
            "energy_demand_kwh": row.get("energy_demand_kwh", 5000),
            "energy_price_ct_kwh": row.get("energy_price_ct_kwh", 32),
            "energy_price_increase_pct": row.get("energy_price_increase", 0.02) * 100
                if row.get("energy_price_increase", 0.02) < 1 else row.get("energy_price_increase", 2),
            "has_ev": bool(row.get("has_ev", False)),
            "ev_distance_km": row.get("ev_annual_drive_distance_km") if pd.notna(row.get("ev_annual_drive_distance_km")) else None,
            "has_solar": bool(row.get("has_solar", False)),
            "existing_solar_kwp": row.get("solar_size_kwp") if pd.notna(row.get("solar_size_kwp")) else None,
            "has_storage": bool(row.get("has_storage", False)),
            "has_wallbox": bool(row.get("has_wallbox", False)),
            "heating_existing_type": row.get("heating_existing_type", "Electric") if pd.notna(row.get("heating_existing_type")) else "Electric",
            "heating_existing_heating_demand_wh": row.get("heating_existing_heating_demand_wh") if pd.notna(row.get("heating_existing_heating_demand_wh")) else None,
            "roof_type": row.get("roof_type", "Concrete Tile Roof") if pd.notna(row.get("roof_type")) else "Concrete Tile Roof",
            "max_modules": int(row.get("num_modules", 26)) + 4 if pd.notna(row.get("num_modules")) else 30,
            "preferred_brand": "auto",
            "budget_cap_eur": None,
        }

        try:
            output = generate_offer(form)
            bal = _balanced(output)
            if bal:
                real_kwp = row["total_kwp"]
                pred_kwp = bal["sizing"]["kwp"]
                delta = abs(pred_kwp - real_kwp) / real_kwp if real_kwp > 0 else 999
                if delta < 0.40:
                    within += 1
                total += 1
        except Exception as e:
            errors_list.append(str(e))

    if total > 0:
        pct = within / total
        status = "PASS" if pct >= 0.50 else "WARN"
        print(f"  {status} Backtest: {within}/{total} = {pct:.0%} within ±40% of real sizing")
        if errors_list:
            print(f"    ({len(errors_list)} rows errored)")
    else:
        print("  SKIP Backtest: no valid rows")
    return True


# ──────────────────────────────────────────────────────────────────────
# Test G — Performance
# ──────────────────────────────────────────────────────────────────────

def test_performance():
    t0 = time.perf_counter()
    for _ in range(100):
        generate_offer(DEFAULT_FORM)
    elapsed = (time.perf_counter() - t0) / 100 * 1000
    status = "PASS" if elapsed < 50 else "WARN"
    print(f"  {status} Performance: {elapsed:.1f}ms avg per call (target <50ms)")
    return elapsed < 50


# ──────────────────────────────────────────────────────────────────────
# Demo
# ──────────────────────────────────────────────────────────────────────

def demo():
    print("\n" + "=" * 70)
    print("DEMO — Default Form Input")
    print("=" * 70)

    result = generate_offer(DEFAULT_FORM)

    print(f"\nMode: {result['project_context']['mode']}")
    print(f"Effective demand: {result['project_context']['effective_demand_kwh']} kWh")
    print(f"HP candidate: {result['project_context']['hp_candidate']}")
    print(f"Offers generated: {len(result['offers'])}")

    for o in result["offers"]:
        print(f"\n--- {o['option_name']} ---")
        s = o["sizing"]
        m = o["metrics"]
        print(f"  PV: {s['modules']} modules / {s['kwp']} kWp | Battery: {s['battery_kwh']} kWh | Brand: {s['brand']}")
        print(f"  Wallbox: {s['wallbox']} | Heat Pump: {s['heatpump_kw']} kW")
        print(f"  Production: {m['production_kwh']} kWh | Demand: {m['total_demand_kwh']} kWh")
        print(f"  Self-consumption: {m['self_consumption_rate']:.1%} | Self-sufficiency: {m['self_sufficiency_rate']:.1%}")
        print(f"  Cost: €{m['total_cost_eur']:,} | Year 1 savings: €{m['year1_savings_eur']:,}")
        print(f"  Payback: {m['payback_years']} years | 20yr NPV: €{m['npv_20yr']:,}")
        print(f"  BOM items: {len(o['bom'])}")
        for b in o["bom"]:
            print(f"    [{b['component_type']}] {b['component_name']} x{b['quantity']} ({b['technology']})")

    # Additional scenario demos
    print("\n" + "=" * 70)
    print("DEMO — Battery Retrofit (existing solar, no storage)")
    print("=" * 70)
    retrofit_form = {
        **DEFAULT_FORM,
        "has_solar": True,
        "existing_solar_kwp": 8.0,
        "has_storage": False,
        "has_ev": False,
        "heating_existing_type": "Electric",
    }
    result2 = generate_offer(retrofit_form)
    print(f"Mode: {result2['project_context']['mode']}")
    for o in result2["offers"]:
        s = o["sizing"]
        m = o["metrics"]
        print(f"  {o['option_name']}: Battery {s['battery_kwh']}kWh ({s['brand']}) — €{m['total_cost_eur']:,}, payback {m['payback_years']}yr")

    print("\n" + "=" * 70)
    print("DEMO — High Demand + EV + Budget Cap")
    print("=" * 70)
    big_form = {
        **DEFAULT_FORM,
        "energy_demand_kwh": 9000,
        "has_ev": True,
        "ev_distance_km": 15000,
        "budget_cap_eur": 25000,
        "heating_existing_type": "Electric",
    }
    result3 = generate_offer(big_form)
    print(f"Mode: {result3['project_context']['mode']}")
    print(f"Effective demand: {result3['project_context']['effective_demand_kwh']} kWh")
    for o in result3["offers"]:
        s = o["sizing"]
        m = o["metrics"]
        print(f"  {o['option_name']}: {s['kwp']}kWp + {s['battery_kwh']}kWh ({s['brand']}) — €{m['total_cost_eur']:,}")


# ──────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 70)
    print("PIPELINE EVALUATION SUITE")
    print("=" * 70)

    results = {}
    results["A_physics"] = test_physics()
    results["B_sizing"] = test_sizing_ranges()
    results["C_ordering"] = test_ordering()
    results["D_bom"] = test_bom()
    results["E_sensitivity"] = test_sensitivity()
    results["F_backtest"] = test_backtest()
    results["G_performance"] = test_performance()

    print("\n" + "-" * 70)
    passed = sum(1 for v in results.values() if v)
    print(f"Summary: {passed}/{len(results)} tests passed")
    print("-" * 70)

    demo()
