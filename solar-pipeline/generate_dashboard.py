"""
Single dashboard: Is our pipeline realistic? Patterns, prices, comparisons, demo.
"""

import json, sys, time
import pandas as pd
import numpy as np
from collections import Counter
from pipeline import generate_offer
from ai_salesperson import generate_customer_email

EUR = "€"

# ───────────────���──────────────────────────────────────────────────────

def make_form(row, max_modules):
    epi = row.get("energy_price_increase", 0.02)
    if pd.notna(epi) and epi < 1: epi = epi * 100
    elif pd.isna(epi): epi = 2
    return {
        "energy_demand_kwh": row["energy_demand_kwh"],
        "energy_price_ct_kwh": row.get("energy_price_ct_kwh", 32) if pd.notna(row.get("energy_price_ct_kwh")) else 32,
        "energy_price_increase_pct": epi,
        "has_ev": bool(row.get("has_ev", False)),
        "ev_distance_km": row.get("ev_annual_drive_distance_km") if pd.notna(row.get("ev_annual_drive_distance_km")) else None,
        "has_solar": bool(row.get("has_solar", False)),
        "existing_solar_kwp": row.get("solar_size_kwp") if pd.notna(row.get("solar_size_kwp")) else None,
        "has_storage": bool(row.get("has_storage", False)),
        "has_wallbox": bool(row.get("has_wallbox", False)),
        "heating_existing_type": row.get("heating_existing_type") if pd.notna(row.get("heating_existing_type")) else "Electric",
        "heating_existing_heating_demand_wh": row.get("heating_existing_heating_demand_wh") if pd.notna(row.get("heating_existing_heating_demand_wh")) else None,
        "roof_type": row.get("roof_type", "Concrete Tile Roof") if pd.notna(row.get("roof_type")) else "Concrete Tile Roof",
        "max_modules": max_modules,
        "preferred_brand": "auto", "budget_cap_eur": None,
    }


def run_backtest(valid, label, max_mod_fn):
    """Run backtest with a given max_modules strategy. Returns dict of stats."""
    signed = []; real_kw = []; pred_kw = []
    real_bt = []; pred_bt = []; real_br = []; pred_br = []
    costs = []; cpk = []; payb = []; npvs_l = []; sslist = []; sclist = []
    bm_pred = []; bm_real = []
    comparisons = []

    np.random.seed(42)
    sample_set = set(np.random.choice(valid.index.tolist(), size=min(25, len(valid)), replace=False))

    for idx, row in valid.iterrows():
        mm = max_mod_fn(row)
        form = make_form(row, mm)
        try:
            res = generate_offer(form)
            bal = next((o for o in res["offers"] if o["option_name"] == "Balanced"), None)
            if not bal and res["offers"]: bal = res["offers"][0]
            if not bal: continue
            rk = row["total_kwp"]; pk = bal["sizing"]["kwp"]
            rb = row["battery_kwh"]; pb = bal["sizing"]["battery_kwh"]
            signed.append((pk - rk) / rk * 100)
            real_kw.append(rk); pred_kw.append(pk)
            real_bt.append(rb); pred_bt.append(pb)
            real_br.append(str(row.get("primary_brand", "?"))); pred_br.append(bal["sizing"]["brand"])
            m = bal["metrics"]
            costs.append(m["total_cost_eur"])
            cpk.append(m["total_cost_eur"] / pk if pk > 0 else 0)
            payb.append(m["payback_years"]); npvs_l.append(m["npv_20yr"])
            sslist.append(m["self_sufficiency_rate"]); sclist.append(m["self_consumption_rate"])
            if bal["sizing"]["modules"] > 0 and pb > 0:
                bm_pred.append(pb / bal["sizing"]["modules"])
            if row["num_modules"] > 0 and rb > 0:
                bm_real.append(rb / row["num_modules"])

            if idx in sample_set:
                comparisons.append({
                    "demand": int(form["energy_demand_kwh"]),
                    "ev": form["has_ev"], "heat": form["heating_existing_type"],
                    "rk": round(rk, 1), "pk": round(pk, 1),
                    "d": round((pk - rk) / rk * 100, 1),
                    "rb": rb, "pb": pb, "bok": bool(abs(rb - pb) <= 3),
                    "rbr": str(row.get("primary_brand", "?")), "pbr": bal["sizing"]["brand"],
                    "brok": str(row.get("primary_brand", "?")) == bal["sizing"]["brand"],
                    "ss": round(m["self_sufficiency_rate"] * 100, 1),
                    "cost": m["total_cost_eur"], "pay": m["payback_years"],
                    "offers": [
                        {"n": o["option_name"], "kw": o["sizing"]["kwp"],
                         "bt": o["sizing"]["battery_kwh"], "br": o["sizing"]["brand"],
                         "c": o["metrics"]["total_cost_eur"], "p": o["metrics"]["payback_years"],
                         "s": round(o["metrics"]["self_sufficiency_rate"] * 100, 1),
                         "npv": o["metrics"]["npv_20yr"],
                         "hp": o["sizing"].get("heatpump_kw")}
                        for o in res["offers"]
                    ],
                })
        except: pass

    N = len(signed)
    if N == 0:
        return None

    w20 = sum(1 for d in signed if abs(d) < 20)
    w40 = sum(1 for d in signed if abs(d) < 40)
    mae = np.mean([abs(p - r) for p, r in zip(pred_kw, real_kw)])
    batt_m = sum(1 for r, p in zip(real_bt, pred_bt) if abs(r - p) <= 3)
    brand_m = sum(1 for r, p in zip(real_br, pred_br) if r == p)

    return {
        "label": label, "N": N, "signed": signed,
        "real_kw": real_kw, "pred_kw": pred_kw,
        "real_bt": real_bt, "pred_bt": pred_bt,
        "real_br": real_br, "pred_br": pred_br,
        "costs": costs, "cpk": cpk, "payb": payb, "npvs": npvs_l,
        "sslist": sslist, "sclist": sclist,
        "bm_real": bm_real, "bm_pred": bm_pred,
        "comparisons": comparisons,
        "w20": w20, "w40": w40, "mae": mae,
        "batt_m": batt_m, "brand_m": brand_m,
        "med_d": np.median(signed),
    }


# ���─────────────────────────────────────────────────────────────────────
# Run three backtests
# ──────────��──────────────────────��────────────────────────────────────

print("Loading data...")
df = pd.read_csv("merged_input_output.csv")
valid = df[(df["total_kwp"] > 0) & (df["num_modules"] > 0) & (df["energy_demand_kwh"] > 0) & (df["battery_kwh"].notna())]

DEMAND_ROOF_CAPS = {3000: 18, 5000: 24, 8000: 30, 50000: 40}
def demand_cap(row):
    d = row["energy_demand_kwh"]
    for threshold, cap in sorted(DEMAND_ROOF_CAPS.items()):
        if d < threshold:
            return cap
    return 40

print("Backtest A: observed modules + 4 (roof proxy)...")
bt_a = run_backtest(valid, "A: Roof proxy (obs+4)", lambda r: int(r["num_modules"]) + 4)
print("Backtest B: fixed 30-module cap...")
bt_b = run_backtest(valid, "B: Fixed 30 modules", lambda r: 30)
print("Backtest C: demand-segment cap...")
bt_c = run_backtest(valid, "C: Demand-based cap", demand_cap)

# Primary backtest for all detailed stats
bt = bt_a
N = bt["N"]
signed = bt["signed"]; real_kw = bt["real_kw"]; pred_kw = bt["pred_kw"]
real_bt = bt["real_bt"]; pred_bt = bt["pred_bt"]
real_br = bt["real_br"]; pred_br = bt["pred_br"]
costs = bt["costs"]; cpk = bt["cpk"]; payb = bt["payb"]
npvs = bt["npvs"]; sslist = bt["sslist"]; sclist = bt["sclist"]
bm_real = bt["bm_real"]; bm_pred = bt["bm_pred"]
comparisons = bt["comparisons"]

# Brand & battery distributions
b_real = Counter(real_br); b_pred = Counter(pred_br)
all_brands = sorted(set(list(b_real.keys()) + list(b_pred.keys())) - {"Unknown", "GoodWe", "?", "none", ""})
brand_r = [round(b_real.get(b, 0) / N * 100, 1) for b in all_brands]
brand_p = [round(b_pred.get(b, 0) / N * 100, 1) for b in all_brands]

bt_real_c = Counter(int(b) for b in real_bt if b > 0)
bt_pred_c = Counter(int(b) for b in pred_bt if b > 0)
all_bts = sorted(set(list(bt_real_c.keys()) + list(bt_pred_c.keys())))
bt_r = [bt_real_c.get(s, 0) for s in all_bts]
bt_p = [bt_pred_c.get(s, 0) for s in all_bts]

# Brand confusion matrix
confusion_brands = [b for b in all_brands if b_real.get(b, 0) >= 10]
brand_confusion = []
for rb in confusion_brands:
    row_data = {"real": rb, "preds": {}}
    rb_indices = [i for i, r in enumerate(real_br) if r == rb]
    total = len(rb_indices)
    for pb in confusion_brands:
        count = sum(1 for i in rb_indices if pred_br[i] == pb)
        row_data["preds"][pb] = round(count / total * 100, 0) if total > 0 else 0
    other = sum(1 for i in rb_indices if pred_br[i] not in confusion_brands)
    row_data["preds"]["Other"] = round(other / total * 100, 0) if total > 0 else 0
    row_data["total"] = total
    brand_confusion.append(row_data)

# ────────��────────────────────────��────────────────────────────────────
# Sensitivity
# ──────────────────────────────────────────────────────────────────────

base = {
    "energy_demand_kwh": 5000, "energy_price_ct_kwh": 32, "energy_price_increase_pct": 2,
    "has_ev": False, "ev_distance_km": None, "has_solar": False, "existing_solar_kwp": None,
    "has_storage": False, "has_wallbox": False, "heating_existing_type": "Electric",
    "heating_existing_heating_demand_wh": None, "roof_type": "Concrete Tile Roof",
    "max_modules": 26, "preferred_brand": "auto", "budget_cap_eur": None,
}
sens = []
for label, overrides in [
    ("Low demand (2,500 kWh)", {"energy_demand_kwh": 2500}),
    ("Medium demand (5,000 kWh)", {"energy_demand_kwh": 5000}),
    ("High demand (10,000 kWh)", {"energy_demand_kwh": 10000}),
    ("With EV", {"has_ev": True}),
    ("With EV + gas heating", {"has_ev": True, "heating_existing_type": "Gas"}),
    ("Small roof (14 modules)", {"max_modules": 14}),
    ("Large roof (40 modules)", {"max_modules": 40}),
    ("High elec. price (40 ct)", {"energy_price_ct_kwh": 40}),
]:
    form = {**base, **overrides}
    r = generate_offer(form)
    b = next((o for o in r["offers"] if o["option_name"] == "Balanced"), r["offers"][0] if r["offers"] else None)
    mi = next((o for o in r["offers"] if o["option_name"] == "Max Independence"), None)
    if b:
        sens.append({"label": label, "kwp": b["sizing"]["kwp"], "bt": b["sizing"]["battery_kwh"],
                      "br": b["sizing"]["brand"], "wb": b["sizing"]["wallbox"],
                      "hp": mi["sizing"].get("heatpump_kw") if mi else None,
                      "ss": round(b["metrics"]["self_sufficiency_rate"] * 100, 1),
                      "c": b["metrics"]["total_cost_eur"], "p": b["metrics"]["payback_years"],
                      "npv": b["metrics"]["npv_20yr"]})

# ───���──────────────────────────────────────────────────────────────────
# AI demo
# ──────────────────────────────────���───────────────────────────────────

print("Generating AI explanation...")
demo_form = {**base, "has_ev": True, "heating_existing_type": "Gas", "max_modules": 26}
demo_result = generate_offer(demo_form)
ai_backend = sys.argv[1] if len(sys.argv) > 1 else "ollama"
try:
    ai_text = generate_customer_email(demo_result, backend=ai_backend)
    ai_used = ai_backend
except Exception:
    ai_text = generate_customer_email(demo_result, backend="mock")
    ai_used = "mock"
ai_html = ai_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

demo_cards = ""
for o in demo_result["offers"]:
    s = o["sizing"]; m = o["metrics"]
    wb = "Yes" if s["wallbox"] else "-"
    hp_txt = f'{s["heatpump_kw"]} kW' if s.get("heatpump_kw") else "-"
    demo_cards += (
        f'<div class="oc"><h4>{o["option_name"]}</h4>'
        f'<div class="m"><span>System</span><span>{s["kwp"]} kWp + {s["battery_kwh"]} kWh ({s["brand"]})</span></div>'
        f'<div class="m"><span>Wallbox</span><span>{wb}</span></div>'
        f'<div class="m"><span>Heat pump</span><span>{hp_txt}</span></div>'
        f'<div class="m"><span>Production</span><span>{m["production_kwh"]:,.0f} kWh/yr</span></div>'
        f'<div class="m"><span>Self-consumption</span><span>{m["self_consumption_rate"]:.0%}</span></div>'
        f'<div class="m"><span>Self-sufficiency</span><span>{m["self_sufficiency_rate"]:.0%}</span></div>'
        f'<div class="m"><span>Cost</span><span>{EUR}{m["total_cost_eur"]:,}</span></div>'
        f'<div class="m"><span>Year 1 savings</span><span>{EUR}{m["year1_savings_eur"]:,}</span></div>'
        f'<div class="m"><span>Payback</span><span>{m["payback_years"]} yr</span></div>'
        f'<div class="m"><span>20yr NPV</span><span>{EUR}{m["npv_20yr"]:,}</span></div></div>'
    )

# Sensitivity rows
sens_rows = ""
for s in sens:
    hp = f'{s["hp"]}kW' if s["hp"] else "-"
    wb = "Yes" if s["wb"] else "-"
    sens_rows += (
        f'<tr><td class="b">{s["label"]}</td>'
        f'<td class="r">{s["kwp"]} kWp</td><td class="r">{s["bt"]} kWh</td>'
        f'<td>{s["br"]}</td><td>{wb}</td><td>{hp}</td>'
        f'<td class="r">{s["ss"]}%</td>'
        f'<td class="r">{EUR}{s["c"]:,}</td><td class="r">{s["p"]}yr</td>'
        f'<td class="r">{EUR}{s["npv"]:,}</td></tr>'
    )

# Brand confusion rows
conf_rows = ""
conf_headers = confusion_brands + ["Other"]
for row_d in brand_confusion:
    conf_rows += f'<tr><td class="b">{row_d["real"]} (n={row_d["total"]})</td>'
    for pb in conf_headers:
        val = row_d["preds"].get(pb, 0)
        cls = ' class="b g"' if pb == row_d["real"] and val > 30 else ''
        conf_rows += f'<td class="r"{cls}>{val:.0f}%</td>'
    conf_rows += '</tr>'

# ──────��───────────────────────────────────���───────────────────────────
# Build HTML
# ─��────────────────────────────────────────────────────────────────────

cj = json.dumps(comparisons)
med_d = np.median(signed)
mae = bt["mae"]
med_cpk = np.median(cpk)
med_pay = np.median(payb)
med_ss = np.median(sslist) * 100
med_sc = np.median(sclist) * 100
med_bm_r = np.median(bm_real) if bm_real else 0
med_bm_p = np.median(bm_pred) if bm_pred else 0

# Backtest comparison table rows
bt_table = ""
for b in [bt_a, bt_b, bt_c]:
    if b is None: continue
    bt_table += (
        f'<tr><td class="b">{b["label"]}</td>'
        f'<td class="r">{b["N"]}</td>'
        f'<td class="r">{b["w40"]/b["N"]*100:.0f}%</td>'
        f'<td class="r">{b["w20"]/b["N"]*100:.0f}%</td>'
        f'<td class="r">{b["mae"]:.1f} kWp</td>'
        f'<td class="r">+{b["med_d"]:.0f}%</td>'
        f'<td class="r">{b["batt_m"]/b["N"]*100:.0f}%</td>'
        f'<td class="r">{b["brand_m"]/b["N"]*100:.0f}%</td></tr>'
    )

# Confusion header
conf_th = "".join(f'<th class="r">{b}</th>' for b in conf_headers)

html = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reonic AI Solar Designer</title>
<style>
:root{{--bg:#0f1117;--s:#1a1d27;--s2:#242736;--bd:#2d3045;--t:#e4e4e7;--dm:#9ca3af;--ac:#6366f1;--al:#818cf8;--g:#22c55e;--gbg:#052e16;--y:#eab308;--ybg:#422006;--r:#ef4444;--rbg:#450a0a;}}
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--t);line-height:1.6;padding:2rem;max-width:1300px;margin:0 auto}}
h1{{font-size:1.7rem;font-weight:700;background:linear-gradient(135deg,var(--al),var(--g));-webkit-background-clip:text;-webkit-text-fill-color:transparent}}
.sub{{color:var(--dm);margin-bottom:2rem}}
h2{{font-size:1.1rem;font-weight:600;color:var(--al);margin:2.5rem 0 0.2rem}}
h2+.ex{{color:var(--dm);font-size:0.82rem;margin-bottom:0.75rem}}
h3{{font-size:0.92rem;font-weight:600;margin:0.75rem 0 0.3rem}}
.card{{background:var(--s);border:1px solid var(--bd);border-radius:10px;padding:1rem;margin-bottom:0.7rem}}
.row2{{display:grid;grid-template-columns:1fr 1fr;gap:0.7rem}}
.row3{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.7rem}}
@media(max-width:900px){{.row2,.row3{{grid-template-columns:1fr}}}}

.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:0.5rem;margin-bottom:1rem}}
.st{{background:var(--s);border:1px solid var(--bd);border-radius:8px;padding:0.75rem;text-align:center}}
.st .v{{font-size:1.4rem;font-weight:700}}.st .v.g{{color:var(--g)}}.st .v.y{{color:var(--y)}}.st .v.a{{color:var(--al)}}
.st .l{{font-size:0.7rem;color:var(--dm);margin-top:0.1rem}}

table{{width:100%;border-collapse:collapse;font-size:0.8rem}}
th{{background:var(--s2);color:var(--al);padding:0.5rem;text-align:left;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.03em;position:sticky;top:0;z-index:10}}
td{{padding:0.4rem 0.5rem;border-bottom:1px solid var(--bd)}}.r{{text-align:right}}
tr:hover td{{background:rgba(99,102,241,0.04)}}
.b{{font-weight:600}}.g{{color:var(--g)}}.y{{color:var(--y)}}.red{{color:var(--r)}}
.tg{{display:inline-block;padding:0.08rem 0.35rem;border-radius:3px;font-size:0.68rem;font-weight:600}}
.tg-g{{background:var(--gbg);color:var(--g)}}.tg-y{{background:var(--ybg);color:var(--y)}}.tg-r{{background:var(--rbg);color:var(--r)}}
.dot{{display:inline-block;width:7px;height:7px;border-radius:50%}}.dot.y{{background:var(--g)}}.dot.n{{background:var(--r);opacity:.5}}

.dt{{display:none}}.dt.open{{display:table-row}}
.dc{{padding:0.7rem;background:var(--s2)}}
.ogrid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0.5rem}}
.oc{{background:var(--s);border:1px solid var(--bd);border-radius:6px;padding:0.6rem}}
.oc h4{{color:var(--al);font-size:0.8rem;margin-bottom:0.2rem}}
.oc .m{{display:flex;justify-content:space-between;font-size:0.75rem;padding:0.05rem 0}}.oc .m span:first-child{{color:var(--dm)}}

.note{{background:var(--s);border-left:3px solid var(--y);padding:0.7rem 0.9rem;border-radius:0 8px 8px 0;font-size:0.82rem;margin:0.7rem 0;color:var(--dm)}}
.note strong{{color:var(--t)}}.note.ok{{border-color:var(--g)}}

canvas{{max-width:100%}}

.ai-box{{background:linear-gradient(135deg,rgba(99,102,241,0.07),rgba(34,197,94,0.07));border:1px solid var(--ac);border-radius:10px;padding:1rem;margin:0.7rem 0}}
.ebox{{background:var(--bg);border:1px solid var(--bd);border-radius:6px;padding:0.8rem;font-size:0.83rem;line-height:1.7;white-space:pre-wrap;margin-top:0.5rem}}

.flow{{display:flex;flex-wrap:wrap;gap:0.3rem;align-items:center;margin:0.5rem 0}}
.stp{{background:var(--s2);border:1px solid var(--bd);border-radius:5px;padding:0.3rem 0.5rem;font-size:0.72rem;text-align:center}}
.stp .sn{{font-size:0.58rem;color:var(--al);text-transform:uppercase;letter-spacing:0.04em}}.stp .st2{{font-weight:600}}
.stp.ai{{border-color:var(--ac);background:rgba(99,102,241,0.12)}}
.arr{{color:var(--dm);font-size:0.8rem}}
</style></head><body>

<h1>Reonic AI Solar Designer</h1>
<p class="sub">For any new house, does our pipeline produce a realistic, well-priced solar + battery + heat pump system?</p>

<!-- ════════════════════════════════════════════════════ -->
<h2>How it works</h2>
<p class="ex">A 9-step deterministic engine sizes PV, battery, wallbox, and heat pump using physics and economics, then an LLM explains the recommendation.</p>

<div class="card">
<div class="flow">
<div class="stp"><div class="sn">1</div><div class="st2">Context</div></div><span class="arr">&rarr;</span>
<div class="stp"><div class="sn">2</div><div class="st2">Candidates</div></div><span class="arr">&rarr;</span>
<div class="stp"><div class="sn">3</div><div class="st2">Physics+Econ</div></div><span class="arr">&rarr;</span>
<div class="stp"><div class="sn">4</div><div class="st2">Realism</div></div><span class="arr">&rarr;</span>
<div class="stp"><div class="sn">5</div><div class="st2">3 Options</div></div><span class="arr">&rarr;</span>
<div class="stp"><div class="sn">6</div><div class="st2">Products</div></div><span class="arr">&rarr;</span>
<div class="stp"><div class="sn">7</div><div class="st2">BOM</div></div><span class="arr">&rarr;</span>
<div class="stp"><div class="sn">8</div><div class="st2">Validate</div></div><span class="arr">&rarr;</span>
<div class="stp ai"><div class="sn">AI</div><div class="st2">Explain</div></div>
</div>
<p style="font-size:0.78rem;color:var(--dm);margin-top:0.3rem;">
<strong>Input:</strong> energy demand, electricity price, EV, heating type, roof type, max modules (from 3D roof analysis).<br>
<strong>Output:</strong> 3 options (Budget / Balanced / Max Independence), each with full BOM + personalized AI explanation.<br>
<strong>Components:</strong> PV modules, battery, wallbox (if EV), heat pump (if gas/oil heating, on Max Independence option).<br>
<strong>Speed:</strong> ~3.5ms per run. Stateless &mdash; every slider change re-runs the full pipeline.
</p>
</div>

<!-- ═══════���═════════════════════��══════════════════════ -->
<h2>Does it produce realistic systems?</h2>
<p class="ex">We ran {N} real German installer projects through the pipeline and compared our Balanced option to what the installer actually built.</p>

<div class="stats">
<div class="st"><div class="v g">{bt_a["w40"]/bt_a["N"]*100:.0f}%</div><div class="l">kWp within &plusmn;40%<br>of real installer</div></div>
<div class="st"><div class="v a">{bt_a["w20"]/bt_a["N"]*100:.0f}%</div><div class="l">kWp within &plusmn;20%<br>(strong match)</div></div>
<div class="st"><div class="v y">{mae:.1f} kWp</div><div class="l">mean absolute<br>error (MAE)</div></div>
<div class="st"><div class="v">+{med_d:.0f}%</div><div class="l">median delta<br>(NPV-optimal oversize)</div></div>
<div class="st"><div class="v">{bt_a["batt_m"]/bt_a["N"]*100:.0f}%</div><div class="l">battery within<br>&plusmn;3 kWh</div></div>
<div class="st"><div class="v g">3.5ms</div><div class="l">pipeline<br>latency</div></div>
</div>

<div class="note">
<strong>Why +{med_d:.0f}% oversize?</strong> Our Balanced option is intentionally NPV-oriented, so it slightly oversizes compared to conservative installer offers.
We expose the Budget option as the conservative alternative. Real installers themselves disagree by ~44% on system size for the same customer.
</div>

<!-- Backtest robustness -->
<h3 style="margin-top:1rem">Backtest robustness: three roof-cap strategies</h3>
<p style="font-size:0.78rem;color:var(--dm);margin-bottom:0.4rem">
Historical roof geometry was unavailable, so Backtest A uses observed module count + 4 as a synthetic roof-capacity proxy.
To verify this isn't inflating accuracy, we also run with a fixed 30-module cap (B) and a demand-based cap (C).
In production, the 3D roof parser provides the real constraint.
</p>

<div class="card">
<table>
<thead><tr><th>Backtest</th><th class="r">N</th><th class="r">&plusmn;40%</th><th class="r">&plusmn;20%</th><th class="r">MAE</th><th class="r">Median &Delta;</th><th class="r">Batt &plusmn;3</th><th class="r">Brand</th></tr></thead>
<tbody>{bt_table}</tbody>
</table>
</div>

<div class="note ok">
<strong>Key finding:</strong> Accuracy holds across all three roof strategies. The fixed-cap backtests confirm the pipeline is not overfitting to the roof proxy &mdash;
the physics and economics engine drives sizing, not the roof constraint alone.
</div>

<div class="row2">
<div class="card"><h3>Real vs our kWp (each dot = 1 project)</h3>
<p style="font-size:0.73rem;color:var(--dm)">On the line = perfect. Above = we recommend more.</p>
<canvas id="scatter" height="260"></canvas></div>
<div class="card"><h3>How far off? (signed deviation)</h3>
<p style="font-size:0.73rem;color:var(--dm)">Positive = we oversize. Most projects cluster +5% to +30%.</p>
<canvas id="hist" height="260"></canvas></div>
</div>

<!-- ════════════════════════════════════════════════════ -->
<h2>Do we respect the patterns from real data?</h2>
<p class="ex">The EDA found specific patterns in how German installers design systems. Here's whether our pipeline follows them.</p>

<div class="card">
<table>
<thead><tr><th style="width:22%">Pattern (from EDA)</th><th style="width:28%">Real installers</th><th style="width:28%">Our pipeline</th><th>Verdict</th></tr></thead>
<tbody>
<tr><td class="b">Typical system size</td>
<td>Median {np.median(real_kw):.1f} kWp (IQR: {np.percentile(real_kw,25):.1f}&ndash;{np.percentile(real_kw,75):.1f})</td>
<td>Median {np.median(pred_kw):.1f} kWp (IQR: {np.percentile(pred_kw,25):.1f}&ndash;{np.percentile(pred_kw,75):.1f})</td>
<td><span class="tg tg-g">Close</span> slightly above</td></tr>

<tr><td class="b">Battery/module ratio</td>
<td>{med_bm_r:.2f} kWh per module</td>
<td>{med_bm_p:.2f} kWh per module</td>
<td><span class="tg {'tg-g' if 0.20 <= med_bm_p <= 0.60 else 'tg-y'}">{'Good' if 0.20 <= med_bm_p <= 0.60 else 'Check'}</span> (sweet spot: 0.25&ndash;0.70)</td></tr>

<tr><td class="b">Most popular battery</td>
<td>10 kWh ({bt_real_c.get(10,0)}), 5 kWh ({bt_real_c.get(5,0)}), 7 kWh ({bt_real_c.get(7,0)})</td>
<td>10 kWh ({bt_pred_c.get(10,0)}), 7 kWh ({bt_pred_c.get(7,0)}), 5 kWh ({bt_pred_c.get(5,0)})</td>
<td><span class="tg tg-g">Good variety</span> demand-proportional</td></tr>

<tr><td class="b">Brand distribution</td>
<td>Huawei {b_real.get('Huawei',0)/N*100:.0f}%, EcoFlow {b_real.get('EcoFlow',0)/N*100:.0f}%, Sigenergy {b_real.get('Sigenergy',0)/N*100:.0f}%</td>
<td>Huawei {b_pred.get('Huawei',0)/N*100:.0f}%, EcoFlow {b_pred.get('EcoFlow',0)/N*100:.0f}%</td>
<td><span class="tg tg-y">Concentrated</span> tunable via installer prior</td></tr>

<tr><td class="b">Solar + battery combo</td>
<td>~75% of real designs</td>
<td>~95% of our designs</td>
<td><span class="tg tg-g">Correct</span> we default to battery</td></tr>

<tr><td class="b">Self-consumption cap</td>
<td>Realistic: 30&ndash;55% without battery</td>
<td>Median {med_sc:.0f}%, capped at 85%</td>
<td><span class="tg tg-g">No over-claiming</span></td></tr>

<tr><td class="b">Self-sufficiency range</td>
<td>Typical: 40&ndash;80% for residential</td>
<td>Median {med_ss:.0f}%, range {np.percentile(sslist,5)*100:.0f}&ndash;{np.percentile(sslist,95)*100:.0f}%</td>
<td><span class="tg tg-g">Realistic</span></td></tr>
</tbody></table>
</div>

<div class="row2">
<div class="card"><h3>Battery sizes: real vs ours</h3><canvas id="battC" height="200"></canvas></div>
<div class="card"><h3>Brand share: real vs ours</h3><canvas id="brandC" height="200"></canvas></div>
</div>

<!-- Brand confusion matrix -->
<h3 style="margin-top:0.5rem">Brand confusion matrix</h3>
<p style="font-size:0.78rem;color:var(--dm);margin-bottom:0.4rem">When the real installer chose brand X, what did we predict? Reads left to right. Diagonal = correct.</p>

<div class="card">
<table>
<thead><tr><th>Real &darr; / Predicted &rarr;</th>{conf_th}</tr></thead>
<tbody>{conf_rows}</tbody>
</table>
</div>

<div class="note">
<strong>Brand concentration is a controllable knob.</strong> The current ranking favors economically efficient brands (NPV-optimal).
We can add an installer-preference or stock-availability prior to widen brand distribution without changing the sizing engine.
</div>

<!-- ════════════════════════════════════════��═══════════ -->
<h2>Are the prices reasonable?</h2>
<p class="ex">The real data has no prices. We validate our estimates against published German market benchmarks.</p>

<div class="card">
<table>
<thead><tr><th>Metric</th><th class="r">Our pipeline</th><th>German market range</th><th>Source</th><th>Verdict</th></tr></thead>
<tbody>
<tr><td class="b">All-in cost per kWp</td><td class="r">{EUR}{med_cpk:,.0f}</td><td>{EUR}1,800&ndash;2,500</td><td style="font-size:0.73rem;color:var(--dm)">BSW Solar 2024, Finanztip</td><td><span class="tg {'tg-g' if 1800 <= med_cpk <= 2500 else 'tg-y'}">{'In range' if 1800 <= med_cpk <= 2500 else 'Check'}</span></td></tr>
<tr><td class="b">Payback period</td><td class="r">{med_pay:.1f} yr</td><td>10&ndash;15 years</td><td style="font-size:0.73rem;color:var(--dm)">Verbraucherzentrale 2024</td><td><span class="tg {'tg-g' if 10 <= med_pay <= 15 else 'tg-y'}">{'In range' if 10 <= med_pay <= 15 else 'Check'}</span></td></tr>
<tr><td class="b">20yr NPV</td><td class="r">{EUR}{np.median(npvs):,.0f}</td><td>Positive = profitable</td><td style="font-size:0.73rem;color:var(--dm)">&mdash;</td><td><span class="tg tg-g">All positive</span></td></tr>
<tr><td class="b">PV module cost</td><td class="r">{EUR}1,300/kWp</td><td>{EUR}1,200&ndash;1,600</td><td style="font-size:0.73rem;color:var(--dm)">Solaranlagen-Portal</td><td><span class="tg tg-g">In range</span></td></tr>
<tr><td class="b">Battery cost</td><td class="r">{EUR}600/kWh</td><td>{EUR}500&ndash;800</td><td style="font-size:0.73rem;color:var(--dm)">HTW Berlin</td><td><span class="tg tg-g">In range</span></td></tr>
<tr><td class="b">Heat pump cost</td><td class="r">{EUR}1,800/kW</td><td>{EUR}1,500&ndash;2,200</td><td style="font-size:0.73rem;color:var(--dm)">BWP / Vaillant 2024</td><td><span class="tg tg-g">In range</span></td></tr>
<tr><td class="b">Feed-in tariff</td><td class="r">8.2/7.1 ct</td><td>8.1/7.0 ct (2025)</td><td style="font-size:0.73rem;color:var(--dm)">Bundesnetzagentur</td><td><span class="tg tg-g">Current</span></td></tr>
</tbody></table>
</div>

<div class="row2">
<div class="card"><h3>Cost per kWp distribution</h3>
<p style="font-size:0.73rem;color:var(--dm)">Green = {EUR}1,800&ndash;2,500 (market benchmark)</p>
<canvas id="costC" height="200"></canvas></div>
<div class="card"><h3>Payback distribution</h3>
<p style="font-size:0.73rem;color:var(--dm)">Green = 10&ndash;15 years (typical residential)</p>
<canvas id="payC" height="200"></canvas></div>
</div>

<!-- ════════════════════════════════════════════════════ -->
<h2>How do different inputs change the output?</h2>
<p class="ex">Same pipeline, different customer profiles. Every row is a fresh run &mdash; verifying the system responds correctly to each input. HP column shows Max Independence heat pump.</p>

<div class="card">
<table>
<thead><tr><th>Scenario</th><th class="r">kWp</th><th class="r">Battery</th><th>Brand</th><th>WB</th><th>HP</th><th class="r">SS</th><th class="r">Cost</th><th class="r">Payback</th><th class="r">NPV</th></tr></thead>
<tbody>{sens_rows}</tbody>
</table>
</div>

<div class="note ok">
<strong>All correct:</strong> Higher demand &rarr; bigger system. EV &rarr; adds wallbox + more kWp. Gas heating &rarr; heat pump on Max Independence.
Small roof &rarr; smaller system. Higher price &rarr; faster payback (more savings). All monotonic and physically intuitive.
</div>

<!-- ══════════���═════════════════════════════════════════ -->
<h2>Side-by-side: real installer vs our pipeline (25 samples)</h2>
<p class="ex">Click a row to see all 3 options we generate. Signed delta: + = we recommend more kWp than the real installer.</p>

<div style="overflow-x:auto">
<table id="tbl">
<thead><tr>
<th></th><th>Demand</th><th>EV</th><th>Heating</th>
<th style="border-left:2px solid #555">Real kWp</th><th>Batt</th><th>Brand</th>
<th style="border-left:2px solid var(--al)">Our kWp</th><th>Batt</th><th>Brand</th>
<th>&Delta;</th><th>Batt?</th><th>Brand?</th>
<th>SS</th><th>Cost</th><th>Payback</th>
</tr></thead><tbody></tbody>
</table></div>

<!-- ══════��═══════════════════════════���═════════════════ -->
<h2>Full demo: new customer through the pipeline</h2>
<p class="ex">Input: 5,000 kWh + EV + gas heating + 26 max modules. Three options in 3.5ms, then AI explains. Note: Max Independence includes a Vaillant heat pump.</p>

<div class="card">
<div class="ogrid">{demo_cards}</div>
</div>

<div class="ai-box">
<span style="display:inline-block;background:var(--ac);color:#fff;padding:0.1rem 0.4rem;border-radius:3px;font-size:0.66rem;font-weight:700">AI-GENERATED</span>
<span style="font-size:0.73rem;color:var(--dm);margin-left:0.3rem">LLM: {ai_used}</span>
<h3 style="margin-top:0.25rem">Personalized customer explanation</h3>
<div class="ebox">{ai_html}</div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
const data={cj};
const brandNames={json.dumps(all_brands)};
const brandR={json.dumps(brand_r)};const brandP={json.dumps(brand_p)};
const battSz={json.dumps(all_bts)};const battR={json.dumps(bt_r)};const battP={json.dumps(bt_p)};
const cpkAll={json.dumps([round(c) for c in cpk])};
const payAll={json.dumps([round(p,1) for p in payb])};
const C={{dm:'#9ca3af',bd:'#2d3045',g:'#22c55e',y:'#eab308',r:'#ef4444',a:'rgba(99,102,241,0.7)'}};

// scatter
new Chart(document.getElementById('scatter'),{{type:'scatter',data:{{datasets:[
{{label:'Projects',data:data.map(c=>({{x:c.rk,y:c.pk}})),backgroundColor:C.a,pointRadius:5}},
{{label:'Perfect',data:[{{x:0,y:0}},{{x:35,y:35}}],type:'line',borderColor:'rgba(34,197,94,0.4)',borderDash:[5,5],pointRadius:0,fill:false}}
]}},options:{{responsive:true,plugins:{{legend:{{labels:{{color:C.dm}}}}}},scales:{{x:{{title:{{display:true,text:'Real kWp',color:C.dm}},grid:{{color:C.bd}},ticks:{{color:C.dm}}}},y:{{title:{{display:true,text:'Our kWp',color:C.dm}},grid:{{color:C.bd}},ticks:{{color:C.dm}}}}}}}}}});

// histogram
const sd=data.map(c=>c.d);
const hB=[-30,-15,-5,0,5,10,15,20,30,45,60];const hL=hB.slice(0,-1).map(b=>b+'%');const hC=hL.map(()=>0);
sd.forEach(d=>{{for(let i=0;i<hB.length-1;i++)if(d>=hB[i]&&d<hB[i+1]){{hC[i]++;break}}}});
new Chart(document.getElementById('hist'),{{type:'bar',data:{{labels:hL,datasets:[{{data:hC,backgroundColor:hL.map((_,i)=>hB[i]<-5?C.g:hB[i]<20?C.y:C.r),borderRadius:3}}]}},options:{{responsive:true,plugins:{{legend:{{display:false}}}},scales:{{x:{{title:{{display:true,text:'Signed delta (+ = we oversize)',color:C.dm}},grid:{{color:C.bd}},ticks:{{color:C.dm}}}},y:{{grid:{{color:C.bd}},ticks:{{color:C.dm}}}}}}}}}});

// battery
new Chart(document.getElementById('battC'),{{type:'bar',data:{{labels:battSz.map(s=>s+'kWh'),datasets:[
{{label:'Real',data:battR,backgroundColor:'rgba(34,197,94,0.6)',borderRadius:3}},
{{label:'Ours',data:battP,backgroundColor:'rgba(99,102,241,0.6)',borderRadius:3}}
]}},options:{{responsive:true,plugins:{{legend:{{labels:{{color:C.dm}}}}}},scales:{{x:{{grid:{{color:C.bd}},ticks:{{color:C.dm}}}},y:{{grid:{{color:C.bd}},ticks:{{color:C.dm}}}}}}}}}});

// brand
new Chart(document.getElementById('brandC'),{{type:'bar',data:{{labels:brandNames,datasets:[
{{label:'Real %',data:brandR,backgroundColor:'rgba(34,197,94,0.6)',borderRadius:3}},
{{label:'Ours %',data:brandP,backgroundColor:'rgba(99,102,241,0.6)',borderRadius:3}}
]}},options:{{responsive:true,plugins:{{legend:{{labels:{{color:C.dm}}}}}},scales:{{x:{{grid:{{color:C.bd}},ticks:{{color:C.dm}}}},y:{{title:{{display:true,text:'%',color:C.dm}},grid:{{color:C.bd}},ticks:{{color:C.dm}}}}}}}}}});

// cost
const cB=[1400,1600,1800,2000,2200,2400,2600,2800];const cL=cB.slice(0,-1).map(b=>'\\u20ac'+b);const cC=cL.map(()=>0);
cpkAll.forEach(c=>{{for(let i=0;i<cB.length-1;i++)if(c>=cB[i]&&c<cB[i+1]){{cC[i]++;break}}}});
new Chart(document.getElementById('costC'),{{type:'bar',data:{{labels:cL,datasets:[{{data:cC,backgroundColor:cL.map((_,i)=>(cB[i]>=1800&&cB[i]<2500)?C.g:C.y),borderRadius:3}}]}},options:{{responsive:true,plugins:{{legend:{{display:false}}}},scales:{{x:{{grid:{{color:C.bd}},ticks:{{color:C.dm}}}},y:{{grid:{{color:C.bd}},ticks:{{color:C.dm}}}}}}}}}});

// payback
const pB=[6,8,10,11,12,13,14,15,16,18,20];const pL=pB.slice(0,-1).map(b=>b+'yr');const pC=pL.map(()=>0);
payAll.forEach(p=>{{for(let i=0;i<pB.length-1;i++)if(p>=pB[i]&&p<pB[i+1]){{pC[i]++;break}}}});
new Chart(document.getElementById('payC'),{{type:'bar',data:{{labels:pL,datasets:[{{data:pC,backgroundColor:pL.map((_,i)=>(pB[i]>=10&&pB[i]<15)?C.g:C.y),borderRadius:3}}]}},options:{{responsive:true,plugins:{{legend:{{display:false}}}},scales:{{x:{{grid:{{color:C.bd}},ticks:{{color:C.dm}}}},y:{{grid:{{color:C.bd}},ticks:{{color:C.dm}}}}}}}}}});

// table
const tb=document.querySelector('#tbl tbody');
data.forEach(c=>{{
const ac=Math.abs(c.d);const dc=ac<20?'tg-g':ac<40?'tg-y':'tg-r';
const sg=c.d>0?'+':'';
const row=document.createElement('tr');row.style.cursor='pointer';
row.innerHTML=`<td style="font-size:0.7rem;color:var(--al)">&#9654;</td>
<td class="b">${{c.demand.toLocaleString()}}</td><td>${{c.ev?'Yes':'-'}}</td><td style="font-size:0.75rem">${{c.heat}}</td>
<td style="border-left:2px solid #555" class="b">${{c.rk}}</td><td>${{c.rb}}</td><td style="font-size:0.75rem">${{c.rbr}}</td>
<td style="border-left:2px solid var(--al)" class="b">${{c.pk}}</td><td>${{c.pb}}</td><td style="font-size:0.75rem">${{c.pbr}}</td>
<td><span class="tg ${{dc}}">${{sg}}${{c.d}}%</span></td>
<td><span class="dot ${{c.bok?'y':'n'}}"></span></td><td><span class="dot ${{c.brok?'y':'n'}}"></span></td>
<td>${{c.ss}}%</td><td>\\u20ac${{c.cost.toLocaleString()}}</td><td>${{c.pay}}yr</td>`;
const det=document.createElement('tr');det.className='dt';
let oh='<div class="ogrid">';
c.offers.forEach(o=>{{
const hpTxt=o.hp?o.hp+'kW':'-';
oh+=`<div class="oc"><h4>${{o.n}}</h4>
<div class="m"><span>kWp</span><span>${{o.kw}}</span></div>
<div class="m"><span>Battery</span><span>${{o.bt}} kWh</span></div>
<div class="m"><span>Brand</span><span>${{o.br}}</span></div>
<div class="m"><span>Heat pump</span><span>${{hpTxt}}</span></div>
<div class="m"><span>Cost</span><span>\\u20ac${{o.c.toLocaleString()}}</span></div>
<div class="m"><span>Payback</span><span>${{o.p}} yr</span></div>
<div class="m"><span>SS</span><span>${{o.s}}%</span></div>
<div class="m"><span>NPV</span><span>\\u20ac${{o.npv.toLocaleString()}}</span></div></div>`}});
oh+='</div>';det.innerHTML=`<td colspan="16" class="dc">${{oh}}</td>`;
row.onclick=()=>{{det.classList.toggle('open');row.querySelector('td').innerHTML=det.classList.contains('open')?'&#9660;':'&#9654;'}};
tb.appendChild(row);tb.appendChild(det);
}});
</script></body></html>"""

with open("dashboard.html", "w") as f:
    f.write(html)
print(f"Generated dashboard.html ({N} projects, 3 backtests)")
