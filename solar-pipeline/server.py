"""
Minimal FastAPI wrapper around pipeline.generate_offer().
Run: uvicorn server:app --port 8001 --reload
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Dict, List

from pipeline import generate_offer, DEFAULTS

app = FastAPI(title="Tectum Solar Pipeline", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

VALID_BRANDS   = {"auto", "Huawei", "EcoFlow", "Sigenergy", "SAJ", "SolarEdge", "Enphase"}
VALID_HEATING  = {"Gas", "Oil", "Electric", "District"}
VALID_ROOFS    = {
    "Concrete Tile Roof", "Clay Tile Roof", "Concrete Roof", "Clay Roof",
    "Flat Roof", "Metal Roof", "Flat Roof East/West", "Flat Roof South",
    "Trapezoidal Sheet", "Bitumen Roof", "Standing Seam",
}


# ── Request models ───────────────────────────────────────────────────

class PanelSpec(BaseModel):
    id:              str
    brand:           str
    model:           str
    wp:              float   = Field(..., gt=0)
    width_m:         float   = Field(..., gt=0)
    height_m:        float   = Field(..., gt=0)
    efficiency_pct:  float   = Field(..., gt=0, le=50)
    weight_kg:       float   = Field(..., gt=0)
    cost_eur:        float   = Field(..., gt=0)


class Overrides(BaseModel):
    # Panel selection
    selected_panel_id:            Optional[str]   = None
    panel_catalog:                Optional[List[PanelSpec]] = None

    # Yield
    specific_yield:               Optional[float] = None

    # Battery brands
    brand_batteries:              Optional[Dict[str, List[float]]] = None
    brand_cost_factor:            Optional[Dict[str, float]] = None
    brand_prior:                  Optional[Dict[str, float]] = None

    # Cost levers
    base_pv_cost_per_kwp:         Optional[float] = None
    base_battery_cost_per_kwh:    Optional[float] = None
    wallbox_cost:                 Optional[float] = None
    service_cost_with_pv:         Optional[float] = None
    service_cost_without_pv:      Optional[float] = None
    heatpump_cost_per_kw:         Optional[float] = None
    gas_cost_per_kwh:             Optional[float] = None

    # Tariffs
    feed_in_tariff_small:         Optional[float] = None
    feed_in_tariff_large:         Optional[float] = None

    # Selection tuning
    balanced_weight_npv:          Optional[float] = None
    balanced_weight_realism:      Optional[float] = None
    balanced_weight_self_sufficiency: Optional[float] = None
    max_payback_years:            Optional[float] = None
    max_payback_years_hp:         Optional[float] = None
    min_battery_kwh:              Optional[float] = None

    # Heat pump sizes
    heatpump_sizes_kw:            Optional[List[float]] = None


class OfferRequest(BaseModel):
    # Project inputs
    energy_demand_kwh:               float  = Field(..., gt=0)
    energy_price_ct_kwh:             float  = Field(32.0, gt=0)
    energy_price_increase_pct:       float  = Field(2.0)
    has_ev:                          bool   = False
    ev_distance_km:                  Optional[float] = None
    has_solar:                       bool   = False
    existing_solar_kwp:              Optional[float] = None
    has_storage:                     bool   = False
    has_wallbox:                     bool   = False
    heating_existing_type:           str    = "Gas"
    heating_existing_heating_demand_wh: Optional[float] = None
    roof_type:                       str    = "Concrete Tile Roof"
    max_modules:                     int    = Field(..., gt=0)
    preferred_brand:                 str    = "auto"
    budget_cap_eur:                  Optional[float] = None

    # All overridable parameters
    overrides:                       Optional[Overrides] = None


# ── Endpoints ────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/config")
def config():
    """Returns all default parameters and catalogs so the frontend
    can populate dropdowns, sliders, and range constraints."""
    return {
        "panel_catalog": DEFAULTS["panel_catalog"],
        "brand_batteries": DEFAULTS["brand_batteries"],
        "brand_cost_factor": DEFAULTS["brand_cost_factor"],
        "brand_prior": DEFAULTS["brand_prior"],
        "cost_levers": {
            "base_pv_cost_per_kwp":      {"default": DEFAULTS["base_pv_cost_per_kwp"],      "unit": "€/kWp",  "min": 500,  "max": 3000},
            "base_battery_cost_per_kwh": {"default": DEFAULTS["base_battery_cost_per_kwh"], "unit": "€/kWh",  "min": 200,  "max": 1200},
            "wallbox_cost":              {"default": DEFAULTS["wallbox_cost"],              "unit": "€",      "min": 500,  "max": 3000},
            "service_cost_with_pv":      {"default": DEFAULTS["service_cost_with_pv"],      "unit": "€",      "min": 500,  "max": 5000},
            "service_cost_without_pv":   {"default": DEFAULTS["service_cost_without_pv"],   "unit": "€",      "min": 200,  "max": 3000},
            "heatpump_cost_per_kw":      {"default": DEFAULTS["heatpump_cost_per_kw"],      "unit": "€/kW",   "min": 800,  "max": 3500},
            "gas_cost_per_kwh":          {"default": DEFAULTS["gas_cost_per_kwh"],          "unit": "€/kWh",  "min": 0.05, "max": 0.30},
        },
        "tariffs": {
            "feed_in_tariff_small":      {"default": DEFAULTS["feed_in_tariff_small"],      "unit": "€/kWh",  "min": 0.0,  "max": 0.20},
            "feed_in_tariff_large":      {"default": DEFAULTS["feed_in_tariff_large"],      "unit": "€/kWh",  "min": 0.0,  "max": 0.20},
        },
        "selection_tuning": {
            "balanced_weight_npv":            {"default": 0.30, "min": 0.10, "max": 0.50},
            "balanced_weight_realism":        {"default": 0.45, "min": 0.20, "max": 0.60},
            "balanced_weight_self_sufficiency":{"default": 0.25, "min": 0.10, "max": 0.40},
            "max_payback_years":              {"default": 20,   "min": 10,   "max": 30},
            "max_payback_years_hp":           {"default": 25,   "min": 15,   "max": 35},
            "min_battery_kwh":                {"default": 5,    "min": 0,    "max": 15},
        },
        "specific_yield":  {"default": DEFAULTS["specific_yield"], "unit": "kWh/kWp/yr", "min": 700, "max": 1400},
        "heatpump_sizes_kw": DEFAULTS["heatpump_sizes_kw"],
        "valid_roof_types": sorted(VALID_ROOFS),
        "valid_heating_types": sorted(VALID_HEATING),
        "valid_brands": sorted(VALID_BRANDS - {"auto"}),
    }


@app.post("/api/offer")
def offer(req: OfferRequest):
    if req.preferred_brand not in VALID_BRANDS:
        raise HTTPException(400, f"preferred_brand must be one of {sorted(VALID_BRANDS)}")
    if req.heating_existing_type not in VALID_HEATING:
        raise HTTPException(400, f"heating_existing_type must be one of {sorted(VALID_HEATING)}")
    if req.roof_type not in VALID_ROOFS:
        raise HTTPException(400, f"roof_type must be one of {sorted(VALID_ROOFS)}")

    # Build overrides dict from the request (only non-None values)
    overrides = {}
    if req.overrides:
        for k, v in req.overrides.model_dump(exclude_none=True).items():
            if k == "panel_catalog" and v is not None:
                overrides[k] = [p if isinstance(p, dict) else p.model_dump() for p in v]
            else:
                overrides[k] = v

    form = req.model_dump(exclude={"overrides"})

    try:
        result = generate_offer(form, overrides=overrides if overrides else None)
    except Exception as e:
        raise HTTPException(500, f"Pipeline error: {e}")

    return result
