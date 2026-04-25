"""
Reonic Solar Offer Generation Pipeline

Stateless pipeline: form JSON → 3 offer options with BOM.
Each slider change re-runs the entire pipeline (<50ms).
"""

import math

# ──────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────

MODULE_WP = 450
SPECIFIC_YIELD = 950  # kWh/kWp/yr, Germany average

BRAND_BATTERIES = {
    "Huawei":     [5, 7, 10, 14, 15, 20],
    "EcoFlow":    [5, 10, 15],
    "Sigenergy":  [6, 9, 12, 15],
    "SAJ":        [5, 10, 15],
    "SolarEdge":  [5, 10, 14],
    "Enphase":    [5, 10],
}

BRAND_COST_FACTOR = {
    "Huawei":    1.00,
    "EcoFlow":   0.95,
    "Sigenergy": 1.03,
    "SAJ":       0.92,
    "SolarEdge": 1.12,
    "Enphase":   1.08,
}

HEATPUMP_SIZES_KW = [5.5, 7.5, 10.5, 12.5]

FEED_IN_TARIFF_SMALL = 0.082   # €/kWh for ≤10 kWp
FEED_IN_TARIFF_LARGE = 0.071   # €/kWh for >10 kWp portion
BASE_PV_COST_PER_KWP = 1300
BASE_BATTERY_COST_PER_KWH = 600
WALLBOX_COST = 1200
SERVICE_COST_WITH_PV = 2500
SERVICE_COST_WITHOUT_PV = 1000
HEATPUMP_COST_PER_KW = 1800
GAS_COST_PER_KWH = 0.12          # €/kWh gas (German avg 2024)
GAS_BOILER_EFFICIENCY = 0.90
DISCOUNT_RATE = 0.03

COMMON_BATTERY_SIZES = {
    10: 1.0, 5: 0.8, 7: 0.7, 9: 0.65, 15: 0.6,
    14: 0.5, 6: 0.35, 12: 0.3, 20: 0.25, 0: 0.4,
}

BRAND_PRIOR = {
    "Huawei": 1.0, "EcoFlow": 0.92, "Sigenergy": 0.55,
    "SAJ": 0.15, "SolarEdge": 0.10, "Enphase": 0.08,
}

# ──────────────────────────────────────────────────────────────────────
# Product Catalogs
# ──────────────────────────────────────────────────────────────────────

BATTERY_CATALOG = {
    "Huawei": {
        5: "Battery 5kWh", 7: "Battery 7kWh", 10: "Battery 10kWh",
        14: "Battery 14kWh", 15: "Battery 15kWh",
        20: "Battery 5kWh Extension B",
    },
    "EcoFlow": {
        5: "Battery LFP 5kWh", 10: "Battery LFP 10kWh", 15: "Battery LFP 15kWh",
    },
    "Sigenergy": {
        6: "Sigenergy AIOS Battery 6kWh", 9: "Sigenergy AIOS Battery 9kWh",
        12: "Sigenergy Stack Battery 12kWh", 15: "Sigenergy AIOS Battery 9kWh",
    },
    "SAJ": {
        5: "Battery 5kWh Pro", 10: "Battery 10kWh Pro", 15: "Battery 15kWh Pro",
    },
    "SolarEdge": {
        5: "Home Battery 4.6kWh", 10: "Home Battery 9.2kWh", 14: "Home Battery 13.8kWh",
    },
    "Enphase": {
        5: "Battery 5kWh Flex Phase", 10: "Battery 10kWh Modular",
    },
}

WALLBOX_CATALOG = {
    "Huawei":    {"name": "Wallbox",                   "kw": 22},
    "EcoFlow":   {"name": "Wallbox 11kW v2",           "kw": 11},
    "Sigenergy": {"name": "Sigenergy AC Wallbox 11kW", "kw": 11},
    "SAJ":       {"name": "EV Charger B",              "kw": 11},
    "SolarEdge": {"name": "Smart EV Charger",          "kw": 11},
    "Enphase":   {"name": "EV Charger C",              "kw": 11},
}

HEATPUMP_CATALOG = {
    5.5:  {"name": "Heat Pump 5.5kW 230V",  "brand": "Vaillant", "voltage": 230},
    7.5:  {"name": "Heat Pump 7.5kW 230V",  "brand": "Vaillant", "voltage": 230},
    10.5: {"name": "Heat Pump 10.5kW 400V", "brand": "Vaillant", "voltage": 400},
    12.5: {"name": "Heat Pump 12.5kW 400V", "brand": "Vaillant", "voltage": 400},
}

SUBSTRUCTURE_MAP = {
    "Concrete Tile Roof":  "Substructure Concrete Tile Roof",
    "Clay Tile Roof":      "Substructure Clay Tile Roof",
    "Concrete Roof":       "Substructure Concrete Roof",
    "Clay Roof":           "Substructure Clay Roof",
    "Flat Roof":           "Substructure Flat Roof",
    "Metal Roof":          "Substructure Metal Roof",
    "Flat Roof East/West": "Substructure Flat Roof East/West",
    "Flat Roof South":     "Substructure Flat Roof South",
    "Trapezoidal Sheet":   "Substructure Trapezoidal Sheet",
    "Bitumen Roof":        "Substructure Bitumen Roof Mounting",
    "Standing Seam":       "Substructure Standing Seam",
}

DC_INSTALL_MAP = {
    "Concrete Tile Roof": "DC Install Concrete Tile Roof",
    "Clay Tile Roof":     "DC Install Clay Tile Roof",
    "Concrete Roof":      "DC Install Concrete Roof",
    "Flat Roof":          "DC Install Flat Roof",
}

BRAND_RULES = {
    "Huawei": {
        "inverter_bundled": True,
        "accessories": [
            {"type": "AccessoryToModule", "name": "Energy Manager B", "qty": 1},
        ],
        "conditional_accessories": [
            {"type": "AccessoryToModule", "name": "Power Optimizer 600W",
             "qty_rule": "per_module", "condition": lambda opt: opt["modules"] > 20},
        ],
    },
    "EcoFlow": {
        "inverter_bundled": True,
        "accessories": [],
        "conditional_accessories": [],
    },
    "Sigenergy": {
        "inverter_bundled": False,
        "accessories": [],
        "conditional_accessories": [],
    },
    "SAJ": {
        "inverter_bundled": True,
        "accessories": [
            {"type": "AccessoryToBatteryStorage", "name": "Smart Guard 63A", "qty": 1},
        ],
        "conditional_accessories": [],
    },
    "SolarEdge": {
        "inverter_bundled": False,
        "accessories": [
            {"type": "AccessoryToModule", "name": "Power Optimizer 600W", "qty_rule": "per_module"},
            {"type": "AccessoryToInverter", "name": "Home Energy Monitor", "qty": 1},
        ],
        "conditional_accessories": [],
    },
    "Enphase": {
        "inverter_bundled": True,
        "accessories": [],
        "conditional_accessories": [],
    },
}


# ──────────────────────────────────────────────────────────────────────
# Step 1 — Context Builder
# ──────────────────────────────────────────────────────────────────────

def _select_mode(form):
    if form["has_solar"] and form["has_storage"]:
        return "addon_only"
    if form["has_solar"]:
        return "battery_retrofit"
    if form["has_storage"]:
        return "pv_only"
    return "full_system"


def build_context(form):
    base_demand = form["energy_demand_kwh"]

    ev_demand = 0
    if form["has_ev"]:
        ev_demand = form["ev_distance_km"] * 0.20 if form.get("ev_distance_km") else 3000

    effective_demand = base_demand + ev_demand
    max_modules = form["max_modules"]
    max_kwp = max_modules * MODULE_WP / 1000

    hp_candidate = (
        form.get("heating_existing_type") in ("Gas", "Oil")
        and not form.get("has_solar")
    )

    mode = _select_mode(form)

    return {
        **form,
        "module_wp": MODULE_WP,
        "specific_yield": SPECIFIC_YIELD,
        "base_demand_kwh": base_demand,
        "ev_demand_kwh": ev_demand,
        "effective_demand_kwh": effective_demand,
        "max_kwp": max_kwp,
        "hp_candidate": hp_candidate,
        "mode": mode,
    }


# ──────────────────────────────────────────────────────────────────────
# Step 2 — Candidate Generator
# ──────────────────────────────────────────────────────────────────────

def generate_candidates(ctx):
    mode = ctx["mode"]
    candidates = []

    if mode in ("battery_retrofit", "addon_only"):
        module_range = [0]
    else:
        lo = min(8, ctx["max_modules"])
        module_range = list(range(lo, ctx["max_modules"] + 1, 2))

    if mode in ("pv_only", "addon_only"):
        battery_range = [0]
    else:
        battery_range = [0, 5, 6, 7, 9, 10, 12, 14, 15, 20]

    if ctx["preferred_brand"] != "auto":
        brands = [ctx["preferred_brand"]]
    else:
        brands = list(BRAND_BATTERIES.keys())

    hp_options = [None]
    if ctx["hp_candidate"]:
        heating_wh = ctx.get("heating_existing_heating_demand_wh")
        if heating_wh and heating_wh > 0:
            target_kw = heating_wh / 1000 / 2000
            best_hp = min(HEATPUMP_SIZES_KW, key=lambda x: abs(x - target_kw))
        else:
            best_hp = 10.5
        hp_options = [None, best_hp]

    for modules in module_range:
        kwp = modules * ctx["module_wp"] / 1000
        for battery_kwh in battery_range:
            for brand in brands:
                if battery_kwh > 0 and battery_kwh not in BRAND_BATTERIES[brand]:
                    continue
                if battery_kwh == 0 and modules == 0:
                    continue

                wallbox = ctx["has_ev"] and not ctx["has_wallbox"]

                for hp_kw in hp_options:
                    candidates.append({
                        "modules": modules,
                        "kwp": kwp,
                        "battery_kwh": battery_kwh,
                        "brand": brand,
                        "wallbox": wallbox,
                        "heatpump_kw": hp_kw,
                    })

    return candidates


# ──────────────────────────────────────────────────────────────────────
# Step 3 — Physics + Economics Simulator
# ──────────────────────────────────────────────────────────────────────

_SC_TABLE = [
    (0.0, 1.00),
    (0.2, 0.95),
    (0.4, 0.80),
    (0.6, 0.60),
    (0.8, 0.45),
    (1.0, 0.33),
    (1.2, 0.28),
    (1.5, 0.24),
    (2.0, 0.20),
    (2.5, 0.17),
    (3.0, 0.15),
]


def _sc_no_battery(R):
    if R <= 0:
        return 1.0
    if R >= _SC_TABLE[-1][0]:
        return _SC_TABLE[-1][1]
    for i in range(len(_SC_TABLE) - 1):
        r0, sc0 = _SC_TABLE[i]
        r1, sc1 = _SC_TABLE[i + 1]
        if R <= r1:
            t = (R - r0) / (r1 - r0)
            return sc0 + t * (sc1 - sc0)
    return _SC_TABLE[-1][1]


def self_consumption_rate(production_kwh, demand_kwh, battery_kwh):
    if production_kwh <= 0 or demand_kwh <= 0:
        return 0.0

    R = production_kwh / demand_kwh
    sc0 = _sc_no_battery(R)

    if battery_kwh <= 0:
        return sc0

    raw_lift = 0.05 * (battery_kwh ** 0.55)
    R_attenuation = 1.0 / max(R ** 0.35, 0.5)
    lift = raw_lift * R_attenuation

    return min(sc0 + lift, 0.85)


def simulate_energy(candidate, ctx):
    production = candidate["kwp"] * ctx["specific_yield"]
    demand = ctx["effective_demand_kwh"]

    if candidate.get("heatpump_kw"):
        hp_demand = candidate["heatpump_kw"] * 2000 / 3.0
        demand += hp_demand

    sc = self_consumption_rate(production, demand, candidate["battery_kwh"])

    self_consumed = min(production * sc, demand)
    exported = max(production - self_consumed, 0)
    grid_import = max(demand - self_consumed, 0)
    self_sufficiency = self_consumed / demand if demand > 0 else 0

    return {
        "total_demand_kwh": demand,
        "production_kwh": production,
        "sc_rate": round(sc, 4),
        "self_consumed_kwh": round(self_consumed),
        "exported_kwh": round(exported),
        "grid_import_kwh": round(grid_import),
        "self_sufficiency": round(min(self_sufficiency, 1.0), 4),
    }


def simulate_economics(candidate, ctx, energy):
    price = ctx["energy_price_ct_kwh"] / 100
    escalation = ctx["energy_price_increase_pct"] / 100
    kwp = candidate["kwp"]

    if kwp <= 10:
        fit = FEED_IN_TARIFF_SMALL
    else:
        fit = (10 * FEED_IN_TARIFF_SMALL + (kwp - 10) * FEED_IN_TARIFF_LARGE) / kwp

    year1_savings = energy["self_consumed_kwh"] * price + energy["exported_kwh"] * fit

    # Heat pump displaces gas/oil heating → net savings from fuel switch
    if candidate.get("heatpump_kw"):
        hp_thermal = candidate["heatpump_kw"] * 2000  # kWh thermal output
        cop = 3.0
        hp_elec = hp_thermal / cop  # already in demand via simulate_energy
        old_gas_cost = (hp_thermal / GAS_BOILER_EFFICIENCY) * GAS_COST_PER_KWH
        new_elec_cost = hp_elec * price
        year1_savings += old_gas_cost - new_elec_cost

    brand_factor = BRAND_COST_FACTOR.get(candidate["brand"], 1.0)
    pv_cost = kwp * BASE_PV_COST_PER_KWP
    batt_cost = candidate["battery_kwh"] * BASE_BATTERY_COST_PER_KWH * brand_factor
    wb_cost = WALLBOX_COST if candidate["wallbox"] else 0
    hp_cost = candidate["heatpump_kw"] * HEATPUMP_COST_PER_KW if candidate.get("heatpump_kw") else 0
    svc_cost = SERVICE_COST_WITH_PV if kwp > 0 else SERVICE_COST_WITHOUT_PV
    total_cost = pv_cost + batt_cost + wb_cost + hp_cost + svc_cost

    if ctx.get("budget_cap_eur") and total_cost > ctx["budget_cap_eur"]:
        return None

    payback = total_cost / year1_savings if year1_savings > 0 else 999

    npv = -total_cost
    for t in range(1, 21):
        npv += year1_savings * ((1 + escalation) ** t) / ((1 + DISCOUNT_RATE) ** t)

    return {
        "total_cost_eur": round(total_cost),
        "year1_savings_eur": round(year1_savings),
        "payback_years": round(payback, 1),
        "npv_20yr": round(npv),
    }


def simulate(candidate, ctx):
    energy = simulate_energy(candidate, ctx)
    econ = simulate_economics(candidate, ctx, energy)
    if econ is None:
        return None
    return {**candidate, **energy, **econ}


# ──────────────────────────────────────────────────────────────────────
# Step 4 — Realism Scorer
# ──────────────────────────────────────────────────────────────────────

def realism_score(c, ctx):
    s = 0.0

    if c["kwp"] > 0 and c["battery_kwh"] > 0:
        s += 25
    elif c["kwp"] > 0 and c["battery_kwh"] == 0:
        s += 8
    if ctx["has_solar"] and c["kwp"] == 0 and c["battery_kwh"] > 0:
        s += 30

    if ctx["has_ev"] and c["wallbox"]:
        s += 10

    s += 10 * COMMON_BATTERY_SIZES.get(c["battery_kwh"], 0.1)

    # Demand-proportional battery: real installers pick smaller batteries for low demand
    if c["battery_kwh"] > 0 and ctx["effective_demand_kwh"] > 0:
        demand = ctx["effective_demand_kwh"]
        batt = c["battery_kwh"]
        if demand < 3500:
            ideal = 5
        elif demand < 5500:
            ideal = 7
        else:
            ideal = 10
        diff = abs(batt - ideal)
        if diff <= 1:
            s += 12
        elif diff <= 3:
            s += 6
        else:
            s -= 2

    s += 12 * BRAND_PRIOR.get(c["brand"], 0.1)

    if 7 <= c["kwp"] <= 14:
        s += 15
    elif 5 <= c["kwp"] < 7 or 14 < c["kwp"] <= 18:
        s += 8

    if c["modules"] > 0 and c["battery_kwh"] > 0:
        ratio = c["battery_kwh"] / c["modules"]
        if 0.25 <= ratio <= 0.70:
            s += 10
        elif 0.15 <= ratio <= 1.0:
            s += 5

    # Demand-proportional sizing: penalize oversizing relative to demand
    # Real installers typically size PV at 1.0-1.5× demand ratio
    if c["kwp"] > 0 and ctx["effective_demand_kwh"] > 0:
        R = (c["kwp"] * SPECIFIC_YIELD) / ctx["effective_demand_kwh"]
        if 0.8 <= R <= 1.5:
            s += 15  # sweet spot
        elif 0.6 <= R <= 2.0:
            s += 8
        else:
            s -= 5  # heavily over/undersized

    return max(min(s, 100), 0)


# ──────────────────────────────────────────────────────────────────────
# Step 5 — Option Selector
# ──────────────────────────────────────────────────────────────────────

def _apply_floor(candidates, ctx):
    min_kwp = min(5, ctx["max_kwp"])
    min_batt = 5 if ctx["mode"] in ("full_system", "battery_retrofit") else 0
    max_payback = 25 if ctx.get("hp_candidate") else 20

    return [
        c for c in candidates
        if (c["kwp"] >= min_kwp or ctx["mode"] in ("battery_retrofit", "addon_only"))
        and (c["battery_kwh"] >= min_batt or ctx["mode"] in ("pv_only", "addon_only") or c["battery_kwh"] == 0)
        and c["npv_20yr"] > 0
        and c["payback_years"] < max_payback
    ]


def _normalize(values):
    lo, hi = min(values), max(values)
    if hi == lo:
        return [0.5] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


def _too_similar(a, b):
    return (
        abs(a["modules"] - b["modules"]) <= 2
        and abs(a["battery_kwh"] - b["battery_kwh"]) <= 2
        and a["brand"] == b["brand"]
    )


def _enforce_diversity(picks, labels, pool):
    final = []
    used_labels = []

    for option, label in zip(picks, labels):
        if not any(_too_similar(option, f) for f in final):
            final.append({**option, "option_name": label})
            used_labels.append(label)

    if len(final) < 3:
        by_score = sorted(pool, key=lambda c: c.get("_balanced_score", 0), reverse=True)
        for c in by_score:
            if not any(_too_similar(c, f) for f in final):
                remaining = [l for l in labels if l not in used_labels]
                lbl = remaining[0] if remaining else f"Alternative {len(final) + 1}"
                final.append({**c, "option_name": lbl})
                used_labels.append(lbl)
            if len(final) == 3:
                break

    return final[:3]


def select_options(simulated, ctx):
    valid = _apply_floor(simulated, ctx)
    if not valid:
        return []

    for c in valid:
        c["realism"] = realism_score(c, ctx)

    no_hp = [c for c in valid if not c.get("heatpump_kw")] or valid

    budget = min(no_hp, key=lambda c: (c["total_cost_eur"], -c["npv_20yr"]))

    npvs = _normalize([c["npv_20yr"] for c in no_hp])
    reals = _normalize([c["realism"] for c in no_hp])
    sss = _normalize([c["self_sufficiency"] for c in no_hp])
    for i, c in enumerate(no_hp):
        c["_balanced_score"] = 0.30 * npvs[i] + 0.45 * reals[i] + 0.25 * sss[i]
    balanced = max(no_hp, key=lambda c: c["_balanced_score"])

    def _green_score(c):
        ss = c["self_sufficiency"]
        has_hp = 1 if c.get("heatpump_kw") else 0
        return (has_hp if ctx.get("hp_candidate") else 0, ss, c["npv_20yr"])
    green = max(valid, key=_green_score)

    return _enforce_diversity(
        [budget, balanced, green],
        ["Budget", "Balanced", "Max Independence"],
        valid,
    )


# ──────────────────────────────────────────────────────────────────────
# Step 6 — Product Mapper
# ──────────────────────────────────────────────────────────────────────

def map_products(option, ctx):
    brand = option["brand"]
    return {
        **option,
        "battery_product": BATTERY_CATALOG[brand].get(option["battery_kwh"]) if option["battery_kwh"] > 0 else None,
        "wallbox_product": WALLBOX_CATALOG[brand] if option["wallbox"] else None,
        "heatpump_product": HEATPUMP_CATALOG.get(option.get("heatpump_kw")) if option.get("heatpump_kw") else None,
        "substructure": SUBSTRUCTURE_MAP.get(ctx["roof_type"], "Substructure Concrete Tile Roof"),
        "dc_install": DC_INSTALL_MAP.get(ctx["roof_type"]),
    }


# ──────────────────────────────────────────────────────────────────────
# Step 7 — BOM Assembler
# ──────────────────────────────────────────────────────────────────────

def generate_bom(option, ctx):
    bom = []
    brand = option["brand"]
    rules = BRAND_RULES[brand]

    def add(comp_type, name, brand_val, qty, tech):
        bom.append({
            "component_type": comp_type,
            "component_name": name,
            "component_brand": brand_val,
            "quantity": qty,
            "technology": tech,
        })

    if option["battery_product"]:
        add("BatteryStorage", option["battery_product"], brand, 1, "ses")

    if option["modules"] > 0:
        add("ModuleFrameConstruction", option["substructure"], None, option["modules"], "solar")

    if not rules["inverter_bundled"] and option["kwp"] > 0:
        inv_kw = max(round(option["kwp"]), 5)
        add("Inverter", f"{brand} Hybrid Inverter {inv_kw}kW", brand, 1, "solar")

    if option["wallbox_product"]:
        add("Wallbox", option["wallbox_product"]["name"], brand, 1, "wallbox")

    if option.get("heatpump_product"):
        hp = option["heatpump_product"]
        add("Heatpump", hp["name"], hp["brand"], 1, "heatpump")
        add("AccessoryToHeatpump", "Heat Pump Hydraulic Station", hp["brand"], 1, "heatpump")
        add("AccessoryToHeatpump", "Smart Heating Controller", hp["brand"], 1, "heatpump")
        add("HeatingStorage", "Buffer Storage 200L", None, 1, "heatpump")
        add("WarmwaterStorage", "Hot Water Storage 300L", None, 1, "heatpump")

    for acc in rules["accessories"]:
        qty = option["modules"] if acc.get("qty_rule") == "per_module" else acc["qty"]
        if qty > 0:
            add(acc["type"], acc["name"], brand, qty, "solar")

    for acc in rules.get("conditional_accessories", []):
        if acc["condition"](option):
            qty = option["modules"] if acc.get("qty_rule") == "per_module" else acc["qty"]
            add(acc["type"], acc["name"], brand, qty, "solar")

    if option["modules"] > 0 and option.get("dc_install"):
        add("AccessoryToModule", option["dc_install"], None, 1, "solar")

    add("InstallationFee", "Planning & Consulting", None, 1, "service")
    add("ServiceFee", "Travel & Logistics Flat Rate", None, 1, "service")
    add("ServiceFee", "All-Inclusive Package B", None, 1, "service")

    if option["battery_kwh"] > 0:
        add("InstallationFee", "Install Battery Storage", None, 1, "service")
    if not rules["inverter_bundled"]:
        add("InstallationFee", "Install Inverter", None, 1, "service")
    if option["wallbox"]:
        add("InstallationFee", "Install Wallbox", None, 1, "service")
    if option.get("heatpump_kw"):
        add("InstallationFee", "Heat Pump Installation Compact B", None, 1, "service")

    add("InstallationFee", "Meter Cabinet Repair", None, 1, "service")
    add("InstallationFee", "AC Surge Protection", None, 1, "service")

    return bom


# ──────────────────────────────────────────────────────────────────────
# Step 8 — Validator
# ──────────────────────────────────────────────────────────────────────

def validate(option, bom, ctx):
    errors = []

    if option["modules"] > ctx["max_modules"]:
        errors.append("modules exceed roof capacity")

    if ctx["has_storage"] and option["battery_kwh"] > 0:
        errors.append("new battery despite existing storage")

    types = [b["component_type"] for b in bom]

    if option["battery_kwh"] > 0 and "BatteryStorage" not in types:
        errors.append("missing BatteryStorage in BOM")

    if option["modules"] > 0 and "ModuleFrameConstruction" not in types:
        errors.append("missing substructure in BOM")

    main_brands = set()
    for b in bom:
        if b["component_type"] in ("BatteryStorage", "Wallbox") and b["component_brand"]:
            main_brands.add(b["component_brand"])
    if len(main_brands) > 1:
        errors.append(f"brand mismatch: {main_brands}")

    if option["brand"] == "SolarEdge" and option["modules"] > 0:
        if not any("Optimizer" in b["component_name"] for b in bom):
            errors.append("SolarEdge missing mandatory optimizer")

    if not (5 <= len(bom) <= 22):
        errors.append(f"BOM has {len(bom)} items, expected 5-22")

    if option.get("sc_rate", 0) > 0.90:
        errors.append("self-consumption rate suspiciously high")

    if option.get("self_sufficiency", 0) > 1.0:
        errors.append("self-sufficiency exceeds 100%")

    return errors


# ──────────────────────────────────────────────────────────────────────
# Step 9 — Main Pipeline
# ──────────────────────────────────────────────────────────────────────

def generate_offer(form):
    ctx = build_context(form)
    candidates = generate_candidates(ctx)

    simulated = []
    for c in candidates:
        result = simulate(c, ctx)
        if result is not None:
            simulated.append(result)

    options = select_options(simulated, ctx)

    offers = []
    for option in options:
        mapped = map_products(option, ctx)
        bom = generate_bom(mapped, ctx)
        errs = validate(mapped, bom, ctx)
        if errs:
            continue

        offers.append({
            "option_name": option["option_name"],
            "sizing": {
                "modules": option["modules"],
                "kwp": option["kwp"],
                "battery_kwh": option["battery_kwh"],
                "brand": option["brand"],
                "wallbox": option["wallbox"],
                "heatpump_kw": option.get("heatpump_kw"),
            },
            "metrics": {
                "total_demand_kwh": option["total_demand_kwh"],
                "production_kwh": option["production_kwh"],
                "self_consumption_rate": option["sc_rate"],
                "self_sufficiency_rate": option["self_sufficiency"],
                "total_cost_eur": option["total_cost_eur"],
                "year1_savings_eur": option["year1_savings_eur"],
                "payback_years": option["payback_years"],
                "npv_20yr": option["npv_20yr"],
            },
            "bom": bom,
        })

    return {"project_context": ctx, "offers": offers}
