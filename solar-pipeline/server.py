"""
Minimal FastAPI wrapper around pipeline.generate_offer().
Run: uvicorn server:app --port 8001 --reload
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional

from pipeline import generate_offer

app = FastAPI(title="Tectum Solar Pipeline", version="1.0")

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


class OfferRequest(BaseModel):
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


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/offer")
def offer(req: OfferRequest):
    if req.preferred_brand not in VALID_BRANDS:
        raise HTTPException(400, f"preferred_brand must be one of {sorted(VALID_BRANDS)}")
    if req.heating_existing_type not in VALID_HEATING:
        raise HTTPException(400, f"heating_existing_type must be one of {sorted(VALID_HEATING)}")
    if req.roof_type not in VALID_ROOFS:
        raise HTTPException(400, f"roof_type must be one of {sorted(VALID_ROOFS)}")

    try:
        result = generate_offer(req.model_dump())
    except Exception as e:
        raise HTTPException(500, f"Pipeline error: {e}")

    return result
