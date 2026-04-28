"""
Reonic Challenge — Datasheet URL Finder & Auto-Extractor v5.0 (Discovery Mode)
==============================================================================
Focus: Generate a clean, minimal JSON + Discovery of new products.

What's new in v5.0:
Added the `--discover` flag. When used, the script searches the internet
for the latest industry news for known brands, extracts new model codes,
adds them to the JSON, and automatically searches for their datasheets.
"""

import os
import re
import json
import time
import argparse
import io
import uuid
import socket
import ipaddress
import urllib.parse
import requests
from datetime import datetime
from tavily import TavilyClient
import pdfplumber

# ── SSRF guard ────────────────────────────────────────────────────────────────
# Ranges that must never be contacted: loopback, private, link-local (incl.
# cloud-metadata at 169.254.169.254), and IPv6 equivalents.
_BLOCKED_NETS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),   # link-local / cloud metadata
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]

def _is_safe_url(url: str) -> bool:
    """Return True only for http/https URLs whose hostname resolves to a
    public IP address.  Blocks private, loopback, and link-local targets."""
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    hostname = parsed.hostname
    if not hostname:
        return False
    try:
        addr = ipaddress.ip_address(socket.gethostbyname(hostname))
    except Exception:
        return False
    for net in _BLOCKED_NETS:
        try:
            if addr in net:
                return False
        except TypeError:
            pass  # mixed IPv4/IPv6 comparison
    return True

# Configuration
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "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")
CATALOGUE_FILE = "catalogue.json"
RATE_LIMIT     = 1.0

# Official domains and keywords
OFFICIAL_DOMAINS = [
    "huawei.com", "solar.huawei.com", "ecoflow.com", "saj-electric.com",
    "solaredge.com", "enphase.com", "vaillant.com", "vaillant.de",
    "aira.energy", "aikosolar.com", "trinasolar.com", "fronius.com",
    "sma.de", "mennekes.de", "viessmann.com", "bosch-homecomfort.com"
]

URL_BONUS_WORDS = ["datasheet", "spec", "datenblatt", "brochure", "ds-", "technical-data", "scheda-tecnica"]
URL_PENALTY_WORDS = ["manual", "install", "guide", "user", "betriebsanleitung", "montage", "warranty", "garantie", "shop"]

MODEL_BRAND_MAP = {
    r"^LUNA2000":      "Huawei",
    r"^SUN2000":       "Huawei",
    r"^aroTHERM":      "Vaillant",
    r"^vitoCal":       "Viessmann",
    r"^AMTRON":        "Mennekes",
    r"^IQ\s*Battery":  "Enphase",
    r"^Vertex":        "Trina",
    r"^NEOstar":       "AIKO",
    r"^Fronius":       "Fronius",
}


# =============================================================================
# 1. NEW PRODUCT DISCOVERY LOGIC
# =============================================================================

def discover_latest_releases(client, products):
    """Search for the latest market releases and add new models to the catalogue."""
    current_year = datetime.now().year
    # Set of already-known models (lower-cased for safe deduplication)
    known_models = {p.get("model", "").lower() for p in products}
    
    brands_to_monitor = ["Huawei", "Enphase", "SolarEdge", "Fronius", "Trina", "SMA"]
    new_discoveries = []

    print(f"\n--- STARTING DISCOVERY PHASE ({current_year}) ---")
    
    for brand in brands_to_monitor:
        # Search for announcements, press releases, or news about new products this year
        query = f'"{brand}" new solar product release announcements {current_year}'
        print(f"Scanning web for new releases from {brand}...")
        
        try:
            # Advanced search to get longer text snippets
            res = client.search(query=query, search_depth="advanced", max_results=3)
            time.sleep(RATE_LIMIT)
            
            for result in res.get("results", []):
                content = result.get("content", "")
                
                # REGEX: Look for tokens that look like technical product codes.
                # Starts with 2+ UPPERCASE letters followed by digits and optional hyphens.
                # e.g. "SUN2000", "IQ8-PLUS", "SE10K"
                potential_models = re.findall(r'\b[A-Z]{2,}[0-9]+(?:-[A-Z0-9]+)*\b', content)
                
                for mod in set(potential_models):
                    # Filter common false positives like ISO9001 or year-suffix tokens (Q12026)
                    if len(mod) > 4 and "ISO" not in mod and str(current_year) not in mod:
                        if mod.lower() not in known_models:
                            print(f"  🌟 NEW MODEL DISCOVERED! {brand} {mod}")
                            new_discoveries.append({
                                "id": str(uuid.uuid4())[:8], # Generate a short unique ID
                                "category": "unknown",       # Category to be determined
                                "brand": brand,
                                "model": mod,
                                "sources": [result.get("url")] # Save the news source URL
                            })
                            known_models.add(mod.lower())
                            
        except Exception as e:
            print(f"  Error during discovery for {brand}: {e}")

    # Add the newly discovered models to the product list
    if new_discoveries:
        print(f"Added {len(new_discoveries)} new products to the catalogue for enrichment.")
        products.extend(new_discoveries)
    else:
        print("No new releases detected at this time.")
        
    return products

# =============================================================================
# 2. AUTOMATIC EXTRACTION LOGIC (REGEX)
# =============================================================================

def auto_extract_power_capacity(model_name):
    match_kwh = re.search(r'(\d+(?:[\.,]\d+)?)\s*kwh', model_name, re.IGNORECASE)
    if match_kwh: return "capacity_kwh", float(match_kwh.group(1).replace(',', '.'))
    
    match_kw = re.search(r'(\d+(?:[\.,]\d+)?)\s*kw', model_name, re.IGNORECASE)
    if match_kw: return "power_kw", float(match_kw.group(1).replace(',', '.'))
    return None, None

def extract_text_from_pdf_stream(url):
    if not _is_safe_url(url):
        return ""
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    try:
        resp = requests.get(url, timeout=20, headers=headers, allow_redirects=False)
        if resp.status_code != 200: return ""
        text = ""
        with pdfplumber.open(io.BytesIO(resp.content)) as pdf:
            for page in pdf.pages:
                content = page.extract_text()
                if content: text += content + "\n"
        return text
    except: return ""

def auto_extract_dimensions(text):
    pattern = r'(\d+(?:[\.,]\d+)?\s*(?:x|×|\*)\s*\d+(?:[\.,]\d+)?\s*(?:x|×|\*)\s*\d+(?:[\.,]\d+)?)\s*(?:mm|cm|m)?'
    match = re.search(pattern, text, re.IGNORECASE)
    if match:
        val = match.group(0).strip()
        if not val.lower().endswith("m"): val += " mm"
        return val
    return None

def auto_extract_weight(text):
    pattern = r'(?:weight|peso|gewicht|mass)[^\d]{0,15}(\d+(?:[\.,]\d+)?)\s*kg'
    match = re.search(pattern, text, re.IGNORECASE)
    if match: return float(match.group(1).replace(',', '.'))
    return None


# =============================================================================
# 2b. ESTRAZIONE AVANZATA DA TESTO PDF (per categoria)
# =============================================================================

def infer_modules(model_name):
    """LUNA2000-10kWh -> 2 modules of 5 kWh."""
    m = re.search(r'(\d+[\.,]?\d*)\s*kwh', model_name, re.IGNORECASE)
    if m:
        kwh = float(m.group(1).replace(',', '.'))
        return max(1, round(kwh / 5))
    return 1


def extract_middledot_nth(text, label_pattern, unit_pattern, n):
    """
    Extract the n-th value from lines using the · separator (Huawei middledot format).
    e.g. "Battery usable energy · 5 kWh · 10 kWh · 15 kWh" with n=2 -> 10.0
    """
    pattern = rf"{label_pattern}[^\n·]*·(.+)"
    m = re.search(pattern, text, re.IGNORECASE)
    if not m or m.group(1) is None:
        return None
    parts = [p.strip() for p in m.group(1).split("·")]
    vals = []
    for part in parts:
        vm = re.search(unit_pattern, part, re.IGNORECASE)
        if vm:
            try:
                vals.append(float(vm.group(1).replace(",", ".")))
            except Exception:
                vals.append(vm.group(1))
    if not vals:
        return None
    return vals[min(n - 1, len(vals) - 1)]


def extract_specs_from_text(text, category, model_name=""):
    """
    Extract all technical specifications from raw PDF text.
    Handles 4 categories: battery, heatpump, inverter, panel.
    """
    specs = {}
    t = text.lower()
    SEP = r"[:\s·|\-≥>]+"   # separatori comuni nei datasheet

    # ── BATTERY ──────────────────────────────────────────────────────────────
    if category == "battery":
        n_mod = infer_modules(model_name)

        # Middledot format (Huawei S0 series)
        for field, label, unit in [
            ("usable_capacity_kwh",    r"battery usable energy",   r"([\d\.]+)\s*kwh"),
            ("max_discharge_power_kw", r"max\.?\s*output power", r"([\d\.]+)\s*kw"),
            ("weight_kg",              r"weight.*?floor",          r"([\d\.]+)\s*kg"),
            ("efficiency_pct",         r"round.trip efficiency",   r"([\d\.]+)\s*%"),
            ("cycles_warranty",        r"cycle life",              r"(\d{3,5})"),
            ("warranty_years",         r"^warranty",               r"(\d+)\s*year"),
        ]:
            v = extract_middledot_nth(text, label, unit, n_mod)
            if v is not None:
                specs[field] = v

        # Fallback colon/standard format (EcoFlow, SAJ, SolarEdge)
        if "usable_capacity_kwh" not in specs:
            m = re.search(rf"usable\s*(?:capacity|energy){SEP}([\d\.]+)\s*kwh", t)
            if m: specs["usable_capacity_kwh"] = float(m.group(1))

        if "max_discharge_power_kw" not in specs:
            m = re.search(rf"max\.?\s*(?:output|discharge)\s*power{SEP}([\d\.]+)\s*kw", t)
            if m:
                specs["max_discharge_power_kw"] = float(m.group(1))
                specs["max_charge_power_kw"]    = float(m.group(1))

        if "cycles_warranty" not in specs:
            m = re.search(rf"cycle\s*life{SEP}[>≥]?\s*(\d{{3,5}})", t)
            if m: specs["cycles_warranty"] = int(m.group(1))

        if "efficiency_pct" not in specs:
            m = re.search(rf"round.trip\s*efficiency{SEP}[≥>]?\s*([\d]+)", t)
            if m: specs["efficiency_pct"] = float(m.group(1))

        if "warranty_years" not in specs:
            m = re.search(rf"warranty{SEP}(\d+)\s*year", t)
            if m: specs["warranty_years"] = int(m.group(1))

        # Chemistry
        if re.search(r"lifepo4|lithium.iron|lfp", t):
            specs["chemistry"] = "LFP"
        elif re.search(r"\bnmc\b", t):
            specs["chemistry"] = "NMC"

        # usable = capacity for LFP (100% DoD)
        if "usable_capacity_kwh" in specs and "capacity_kwh" not in specs:
            specs["capacity_kwh"] = specs["usable_capacity_kwh"]

    # ── HEATPUMP ─────────────────────────────────────────────────────────────
    elif category == "heatpump":
        m = re.search(rf"rated\s*heat\s*output[^:\n]{{0,20}}:{SEP}([\d\.]+)\s*kw", t)
        if m: specs["rated_power_kw"] = float(m.group(1))

        m = re.search(rf"cop\s*a7[/\s]w35{SEP}([\d\.]+)", t)
        if m: specs["cop_a7w35"] = float(m.group(1))

        m = re.search(rf"cop\s*a2[/\s]w35{SEP}([\d\.]+)", t)
        if m: specs["cop_a2w35"] = float(m.group(1))

        m = re.search(rf"(?:sound|noise)\s*(?:power\s*)?level{SEP}([\d\.]+)\s*db", t)
        if m: specs["noise_db"] = float(m.group(1))

        m = re.search(r"refrigerant{SEP}(r\d+\w*)", t)
        if m: specs["refrigerant"] = m.group(1).upper()

        m = re.search(r"(r290|r32|r410a|r454b|r134a)", t)
        if m and "refrigerant" not in specs:
            specs["refrigerant"] = m.group(1).upper()

        m = re.search(rf"warranty{SEP}(\d+)\s*year", t)
        if m: specs["warranty_years"] = int(m.group(1))

        m = re.search(r"(single|three)[\s-]phase", t)
        if m: specs["phases"] = 1 if m.group(1) == "single" else 3

    # ── INVERTER ─────────────────────────────────────────────────────────────
    elif category == "inverter":
        m = re.search(rf"max\.?\s*output\s*power{SEP}([\d\.]+)\s*kw", t)
        if m: specs["rated_power_kw"] = float(m.group(1))

        m = re.search(rf"max\.?\s*efficiency{SEP}([\d\.]+)\s*%", t)
        if m: specs["efficiency_pct"] = float(m.group(1))

        m = re.search(rf"(?:number\s*of\s*)?mpp\s*trackers{SEP}(\d+)", t)
        if m: specs["mppt_trackers"] = int(m.group(1))

        m = re.search(r"(single|three)[\s-]phase", t)
        if m: specs["phases"] = 1 if m.group(1) == "single" else 3

        m = re.search(rf"warranty{SEP}(\d+)\s*year", t)
        if m: specs["warranty_years"] = int(m.group(1))

    # ── PANEL ─────────────────────────────────────────────────────────────────
    elif category == "panel":
        m = re.search(rf"(?:maximum|rated)\s*power[^:\n]{{0,10}}:{SEP}(\d{{3,4}})\s*wp", t)
        if m: specs["watt_peak_wp"] = int(m.group(1))

        m = re.search(rf"module\s*efficiency{SEP}([\d\.]+)\s*%", t)
        if m: specs["efficiency_pct"] = float(m.group(1))

        m = re.search(rf"open\s*circuit\s*voltage[^:\n]{{0,10}}:{SEP}([\d\.]+)\s*v", t)
        if m: specs["voc_v"] = float(m.group(1))

        m = re.search(rf"short\s*circuit\s*current[^:\n]{{0,10}}:{SEP}([\d\.]+)\s*a", t)
        if m: specs["isc_a"] = float(m.group(1))

        m = re.search(r"temperature\s*coefficient.*?pmax[^:\n]{{0,5}}:\s*(-[\d\.]+)\s*%", t)
        if m: specs["temperature_coefficient_pct_c"] = float(m.group(1))

        m = re.search(rf"product\s*warranty{SEP}(\d+)\s*year", t)
        if m: specs["warranty_years_product"] = int(m.group(1))

        m = re.search(rf"(?:linear\s*)?(?:power\s*output\s*)?warranty{SEP}(\d+)\s*year", t)
        if m: specs["warranty_years_performance"] = int(m.group(1))

    # ── UNIVERSAL ─────────────────────────────────────────────────────────────
    if "weight_kg" not in specs:
        # Strict: requires the word "weight" before the number
        m = re.search(rf"(?<!floor\s)weight[^:\d]{{0,20}}([\d\.]+)\s*kg", t)
        if m:
            v = float(m.group(1))
            if v > 5:  # filter out "3 kg power module" noise
                specs["weight_kg"] = v

    return specs

# =============================================================================
# 3. URL SEARCH LOGIC
# =============================================================================

def is_url_reachable(url):
    if not _is_safe_url(url):
        return False
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        # allow_redirects=False prevents redirect-based SSRF bypass
        resp = requests.get(url, stream=True, timeout=10, headers=headers, allow_redirects=False)
        return resp.status_code < 400
    except: return False

def score_url(url, brand, model):
    score = 0
    url_lower = url.lower()
    clean_model = re.sub(r'[^a-z0-9]', '', model.lower())
    
    if any(d in url_lower for d in OFFICIAL_DOMAINS) or brand.lower() in url_lower: score += 20
    if clean_model and clean_model in url_lower.replace('-', '').replace('_', ''): score += 15
    for word in URL_BONUS_WORDS:
        if word in url_lower: score += 10
    for word in URL_PENALTY_WORDS:
        if word in url_lower: score -= 30
    return score

def detect_brand(model, sources=[]):
    for pattern, brand in MODEL_BRAND_MAP.items():
        if re.search(pattern, model, re.IGNORECASE): return brand
    for url in sources:
        for brand_name in ["Huawei", "Vaillant", "Viessmann", "Fronius", "SMA", "Trina", "Enphase"]:
            if brand_name.lower() in url.lower(): return brand_name
    return "Unknown"

def find_best_datasheet(client, product):
    brand = product.get("brand", "Unknown")
    model = product.get("model", "")
    sources = product.get("sources", [])

    if brand == "Unknown":
        brand = detect_brand(model, sources)

    for url in sources:
        if url.lower().endswith(".pdf") and "manual" not in url.lower():
            if is_url_reachable(url): return url, "PDF"

    search_model = re.sub(r'[- ]\d+kwh|[- ]\d+kw|[- ]\d+w', '', model, flags=re.IGNORECASE).strip()
    if not search_model: search_model = model
        
    query = f"{brand} {search_model} datasheet technical specifications filetype:pdf"
    try:
        results = client.search(query=query, search_depth="basic", max_results=5)
        time.sleep(RATE_LIMIT)
        candidates = []
        for r in results.get("results", []):
            url = r.get("url", "")
            if url: candidates.append((score_url(url, brand, search_model), url))
            
        candidates.sort(key=lambda x: x[0], reverse=True)
        for score, url in candidates:
            if score > 0 and is_url_reachable(url):
                return url, "PDF" if url.lower().endswith(".pdf") else "HTML"
    except: pass
    return None, None

# =============================================================================
# MAIN EXECUTION AND CLEAN JSON GENERATION
# =============================================================================

def process_product(client, product):
    brand = product.get('brand', 'Unknown')
    model = product.get('model', '')
    if brand == "Unknown": brand = detect_brand(model, product.get("sources", []))

    print(f"Processing: {brand} {model}")
    url, stype = find_best_datasheet(client, product)
    
    clean_product = {
        "id": product.get("id"),
        "category": product.get("category", "unknown"),
        "brand": brand,
        "model": model,
        "datasheet_url": url,
        "specs": {}
    }

    power_key, power_val = auto_extract_power_capacity(model)
    if power_key:
        clean_product["specs"][power_key] = power_val
        print(f"      ⚡ Extracted ({power_key}): {power_val}")

    if url:
        print(f"      ✅ Verified URL: {url[:60]}...")
        pdf_text = extract_text_from_pdf_stream(url) if stype == "PDF" else ""
        if pdf_text:
            # Advanced extraction for all fields by category
            category = clean_product.get("category", "unknown")
            extracted = extract_specs_from_text(pdf_text, category, model)
            if extracted:
                clean_product["specs"].update(extracted)
                print(f"      📊 Extracted {len(extracted)} specs: {list(extracted.keys())}")

            # Legacy extractors for dimensions/weight fallback
            if "dimensions" not in clean_product["specs"]:
                dims = auto_extract_dimensions(pdf_text)
                if dims:
                    clean_product["specs"]["dimensions"] = dims
                    print(f"      📏 Dimensions: {dims}")
            if "weight_kg" not in clean_product["specs"]:
                weight = auto_extract_weight(pdf_text)
                if weight:
                    clean_product["specs"]["weight_kg"] = weight
                    print(f"      ⚖️ Weight: {weight} kg")
        else:
            print(f"      ⚠️  PDF not readable (image-based or protected) — saving URL for manual review")
    else:
        print(f"      ❌ No datasheet found — manual review required")

    clean_product["_enriched_at"] = datetime.now().isoformat()
    clean_product["_needs_manual"] = [
        f for f in ["weight_kg", "warranty_years", "efficiency_pct"]
        if f not in clean_product["specs"]
    ]
    return clean_product

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test",    action="store_true", help="Test on a single item")
    parser.add_argument("--all",     action="store_true", help="Re-check all products")
    parser.add_argument("--discover",action="store_true", help="Search for new models on the web")
    parser.add_argument("--rerun",   action="store_true",
                        help="Re-run extraction on all verified=true products to find additional specs")
    args = parser.parse_args()

    client = TavilyClient(api_key=TAVILY_API_KEY)

    if args.test:
        # TEST LOGIC
        file_to_test = "test_output.json" if os.path.exists("test_output.json") else CATALOGUE_FILE
        if not os.path.exists(file_to_test): return
        with open(file_to_test, "r") as f: data = json.load(f)
        product = data[0] if isinstance(data, list) else data.get("products", [data])[0] if "products" in data else data
        
        print("=== TEST MODE ===")
        cleaned_product = process_product(client, product)
        with open("test_enriched.json", "w") as f: json.dump(cleaned_product, f, indent=2, ensure_ascii=False)
        print("\nResult saved to test_enriched.json!")
        return

    # STANDARD LOGIC
    if not os.path.exists(CATALOGUE_FILE):
        catalogue = {"products": []}
    else:
        with open(CATALOGUE_FILE, "r") as f:
            catalogue = json.load(f)

    products = catalogue.get("products", [])

    # ── RERUN: re-extract specs on verified products ──────────────────────────
    if args.rerun:
        targets = [p for p in products if p.get("verified") is True or p.get("datasheet_url")]
        if not targets:
            print("No verified products found for rerun.")
        else:
            print(f"\n=== RERUN: {len(targets)} verified products ===\n")
            for i, p in enumerate(targets):
                print(f"[{i+1}/{len(targets)}] ", end="")
                updated = process_product(client, p)
                # Merge new specs without overwriting existing verified ones
                existing_specs = p.get("specs", {})
                new_specs      = updated.get("specs", {})
                merged = {**new_specs, **existing_specs}  # existing wins on conflict
                updated["specs"] = merged
                for j, orig in enumerate(products):
                    if orig.get("id") == updated.get("id"):
                        products[j] = updated
                        break
            with open(CATALOGUE_FILE, "w") as f:
                json.dump({"products": products}, f, indent=2, ensure_ascii=False)
            added = sum(1 for p in products if len(p.get("specs", {})) > 2)
            print(f"\nRerun complete. {added} products with updated specs.")
        return

    # 1. Optional Phase: Discovery
    if args.discover:
        products = discover_latest_releases(client, products)

    # 2. Enrichment Phase
    targets = [p for p in products if "datasheet_url" not in p] if not args.all else products
    
    if not targets:
        print("\nAll products in the catalogue have already been enriched.")
        # Save anyway in case discovery added items that previously failed
        with open(CATALOGUE_FILE, "w") as f: json.dump({"products": products}, f, indent=2, ensure_ascii=False)
        return

    print(f"\nStarting enrichment of {len(targets)} components...\n")
    for i, p in enumerate(targets):
        print(f"[{i+1}/{len(targets)}] ", end="")
        updated_clean_product = process_product(client, p)
        
        # Update the list whether this was a new or existing product
        found = False
        for j, orig in enumerate(products):
            if orig.get("id") == updated_clean_product.get("id"):
                products[j] = updated_clean_product
                found = True
                break
        if not found:
            products.append(updated_clean_product)

    with open(CATALOGUE_FILE, "w") as f:
        json.dump({"products": products}, f, indent=2, ensure_ascii=False)

    ok = sum(1 for p in products if p.get("datasheet_url"))
    print(f"\n--- FINAL REPORT ---")
    print(f"Verified datasheets and clean JSON: {ok}/{len(products)}")

if __name__ == "__main__":
    main()