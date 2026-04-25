"""
Step 10 — AI Salesperson

Takes the pipeline output and generates a personalized customer-facing
explanation using Claude. This is the AI layer that turns deterministic
engineering calculations into human communication.
"""

import json
import os
import subprocess

try:
    from anthropic import Anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

OLLAMA_MODEL = "llama3.2:3b"

SYSTEM_PROMPT = """\
You are a senior solar energy consultant at Reonic, a German renewable energy company. \
You write a personalized explanation for homeowners about their recommended solar system configuration. \
This is NOT an email — it's an explanation that appears on the offer page, helping the customer understand why this system was designed for them.

Your tone is warm, professional, and confident — like a knowledgeable friend who happens to be an engineer. \
You never oversell or make unrealistic promises. You ground every claim in the specific numbers from the offer.

Rules:
- Write in English
- Address the homeowner directly ("you", "your home")
- Reference their specific situation: energy demand, EV ownership, heating type, roof
- Explain WHY the Balanced option is recommended using their actual numbers
- Mention the other two options briefly so they feel in control
- Include specific savings, payback period, and self-sufficiency percentage
- Never invent numbers — only use what's in the offer data
- Keep it to exactly 3 short paragraphs: (1) your situation, (2) why we recommend this system, (3) your alternatives
- No bullet points, no headers, no markdown — just clean prose paragraphs
- Do NOT include a greeting, sign-off, or subject line — this is inline content, not a letter
"""


def _build_user_prompt(pipeline_output: dict) -> str:
    ctx = pipeline_output["project_context"]
    offers = pipeline_output["offers"]

    context_summary = {
        "energy_demand_kwh": ctx["effective_demand_kwh"],
        "base_demand_kwh": ctx["base_demand_kwh"],
        "ev_demand_kwh": ctx.get("ev_demand_kwh", 0),
        "has_ev": ctx["has_ev"],
        "has_wallbox": ctx.get("has_wallbox", False),
        "heating_type": ctx.get("heating_existing_type", "unknown"),
        "hp_candidate": ctx.get("hp_candidate", False),
        "roof_type": ctx.get("roof_type", "unknown"),
        "max_modules": ctx["max_modules"],
        "energy_price_ct_kwh": ctx["energy_price_ct_kwh"],
    }

    offers_summary = []
    for o in offers:
        offers_summary.append({
            "option_name": o["option_name"],
            "modules": o["sizing"]["modules"],
            "kwp": o["sizing"]["kwp"],
            "battery_kwh": o["sizing"]["battery_kwh"],
            "brand": o["sizing"]["brand"],
            "wallbox": o["sizing"]["wallbox"],
            "heatpump_kw": o["sizing"].get("heatpump_kw"),
            "production_kwh": o["metrics"]["production_kwh"],
            "total_demand_kwh": o["metrics"]["total_demand_kwh"],
            "self_consumption_rate": o["metrics"]["self_consumption_rate"],
            "self_sufficiency_rate": o["metrics"]["self_sufficiency_rate"],
            "total_cost_eur": o["metrics"]["total_cost_eur"],
            "year1_savings_eur": o["metrics"]["year1_savings_eur"],
            "payback_years": o["metrics"]["payback_years"],
            "npv_20yr": o["metrics"]["npv_20yr"],
        })

    return (
        "Generate a personalized 3-paragraph offer email for this homeowner.\n\n"
        f"Customer situation:\n{json.dumps(context_summary, indent=2)}\n\n"
        f"Three offer options:\n{json.dumps(offers_summary, indent=2)}\n\n"
        "Recommend the Balanced option. Explain why it fits their specific situation."
    )


def _ollama_email(pipeline_output: dict, model: str = OLLAMA_MODEL) -> str:
    prompt = SYSTEM_PROMPT + "\n\n" + _build_user_prompt(pipeline_output)
    result = subprocess.run(
        ["ollama", "run", model],
        input=prompt,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Ollama failed: {result.stderr}")
    return result.stdout.strip()


def _mock_email(pipeline_output: dict) -> str:
    ctx = pipeline_output["project_context"]
    offers = pipeline_output["offers"]
    bal = next((o for o in offers if o["option_name"] == "Balanced"), offers[0])
    m = bal["metrics"]
    s = bal["sizing"]

    demand = ctx["effective_demand_kwh"]
    ev_part = f" — including approximately {ctx['ev_demand_kwh']:,.0f} kWh for your electric vehicle" if ctx.get("ev_demand_kwh", 0) > 0 else ""
    heating_part = f" With your current {ctx.get('heating_existing_type', 'gas')} heating system," if ctx.get("heating_existing_type") in ("Gas", "Oil") else ""
    wallbox_part = " We've also included a brand-matched wallbox to charge your EV directly from your roof." if s.get("wallbox") else ""
    hp_part = f" and a heat pump upgrade ({s['heatpump_kw']} kW)" if s.get("heatpump_kw") else ""

    budget = next((o for o in offers if o["option_name"] == "Budget"), None)
    maxind = next((o for o in offers if o["option_name"] == "Max Independence"), None)

    para1 = (
        f"Your household consumes around {demand:,.0f} kWh per year{ev_part}. "
        f"At your current electricity rate of {ctx['energy_price_ct_kwh']} ct/kWh — and with prices "
        f"rising at {ctx['energy_price_increase_pct']}% annually — going solar is not just an environmental "
        f"choice, it's a smart financial one.{heating_part}"
    )

    para2 = (
        f"We recommend the Balanced configuration: a {s['kwp']} kWp solar system ({s['modules']} modules) "
        f"paired with a {s['battery_kwh']} kWh {s['brand']} battery{hp_part}. "
        f"This system will produce {m['production_kwh']:,.0f} kWh annually, covering "
        f"{m['self_sufficiency_rate']:.0%} of your energy needs from your own roof. "
        f"Your estimated savings in the first year are €{m['year1_savings_eur']:,}, "
        f"with the system paying for itself in {m['payback_years']} years. "
        f"Over 20 years, the net present value of your investment reaches €{m['npv_20yr']:,}.{wallbox_part}"
    )

    alt_parts = []
    if budget:
        bm = budget["metrics"]
        alt_parts.append(
            f"the Budget option at €{bm['total_cost_eur']:,} "
            f"(payback in {bm['payback_years']} years, {bm['self_sufficiency_rate']:.0%} self-sufficiency)"
        )
    if maxind:
        mm = maxind["metrics"]
        alt_parts.append(
            f"the Max Independence option at €{mm['total_cost_eur']:,} "
            f"({mm['self_sufficiency_rate']:.0%} self-sufficiency)"
        )
    alt_text = " and ".join(alt_parts) if alt_parts else "alternative configurations"

    para3 = (
        f"You're in control. We've also prepared {alt_text}. "
        f"Each option is designed to fit your {ctx.get('roof_type', 'roof')} and your lifestyle."
    )

    return f"{para1}\n\n{para2}\n\n{para3}"


def generate_customer_email(pipeline_output: dict, api_key: str = None, backend: str = "auto") -> str:
    """
    Generate a personalized customer email explaining the offer.

    Args:
        pipeline_output: The full output from generate_offer()
        api_key: Anthropic API key. Falls back to ANTHROPIC_API_KEY env var.
        backend: "anthropic", "ollama", "mock", or "auto" (tries ollama → anthropic → mock).

    Returns:
        The generated email text.
    """
    if backend == "mock":
        return _mock_email(pipeline_output)

    if backend == "ollama":
        return _ollama_email(pipeline_output)

    if backend == "anthropic":
        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key or not HAS_ANTHROPIC:
            raise ValueError("Anthropic API key and SDK required for anthropic backend")
        client = Anthropic(api_key=key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": _build_user_prompt(pipeline_output)}],
        )
        return message.content[0].text

    # auto: try ollama first (free, local), then anthropic, then mock
    try:
        return _ollama_email(pipeline_output)
    except Exception:
        pass

    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if key and HAS_ANTHROPIC:
        try:
            client = Anthropic(api_key=key)
            message = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": _build_user_prompt(pipeline_output)}],
            )
            return message.content[0].text
        except Exception:
            pass

    return _mock_email(pipeline_output)


def generate_offer_with_email(form: dict, api_key: str = None, backend: str = "auto") -> dict:
    """
    Full pipeline: form → offers + personalized email.
    """
    from pipeline import generate_offer
    result = generate_offer(form)

    if not result["offers"]:
        result["customer_email"] = None
        return result

    result["customer_email"] = generate_customer_email(result, api_key=api_key, backend=backend)
    return result


# ──────────────────────────────────────────────────────────────────────
# Demo
# ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    from pipeline import generate_offer

    form = {
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

    print("Running pipeline...")
    result = generate_offer(form)

    print(f"\nGenerated {len(result['offers'])} offers:")
    for o in result["offers"]:
        m = o["metrics"]
        print(f"  {o['option_name']}: {o['sizing']['kwp']}kWp + {o['sizing']['battery_kwh']}kWh — €{m['total_cost_eur']:,}")

    import sys
    backend = sys.argv[1] if len(sys.argv) > 1 else "auto"
    print(f"\nGenerating personalized email (backend={backend})...")

    email = generate_customer_email(result, backend=backend)
    print("\n" + "=" * 70)
    print("PERSONALIZED CUSTOMER EMAIL")
    print("=" * 70)
    print(email)
