<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Tectum — AI Solar Planning Platform

> **Big Berlin Hack 2026 · Reonic Challenge**  
> End-to-end AI-powered solar design and offer generation for German solar installers.

---

## What is Tectum?

Tectum lets a solar installer walk through a complete sales workflow in minutes:

1. **Intake** — collect customer data (energy demand, EV, heating, roof geometry) via a guided form.
2. **3D Roof Planning** — load a GLB roof model, auto-detect roof planes, drag real panels onto them, and see live irradiance heat-maps.
3. **AI Offer Generation** — a sub-4 ms Python pipeline produces three fully-costed options (Budget / Balanced / Max Independence) with a complete Bill of Materials and 20-year financial projection.
4. **PDF Report** — one click generates a branded, print-ready offer with a 3D screenshot and an AI-written personalised explanation.

📄 **[Full technical documentation →](DOCS.md)**

---

## Repository Structure

```
tectum/
├── tectum-pro/       # Production installer web app (React 19 + Vite + TypeScript)
├── taim/
│   └── solar-app/   # 3D roof planner (Next.js 15 + Three.js)
├── solar-pipeline/  # Offer-generation engine (Python / FastAPI)
├── extractor/       # Product catalogue enricher (Tavily + pdfplumber)
└── aikido-screenshots/  # Security scan results
```

---

## Quick Start

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 20 LTS |
| Python | ≥ 3.11 |
| npm | ≥ 10 |

### 1 — Solar Pipeline API (Python)

```bash
cd solar-pipeline
python -m venv .venv && source .venv/bin/activate
pip install fastapi uvicorn pydantic anthropic
uvicorn server:app --port 8001 --reload
```

### 2 — Production Web App

```bash
cd tectum-pro
npm install
# Create tectum-pro/.env.local and add: GEMINI_API_KEY=your_key
npm run dev
# → http://localhost:3001
```

### 3 — 3D Roof Planner (prototype)

```bash
cd taim/solar-app
npm install
# Create taim/solar-app/.env.local and add: NEXT_PUBLIC_PIPELINE_URL=http://localhost:8001
npm run dev
# → http://localhost:3000
```

---

## Demo Credentials

| Email | Password |
|---|---|
| `demo@tectum.io` | `tectum` |
| `anna@solarberlin.de` | `solar` |
| `paul@dachwerk.de` | `dach` |

Any unknown email is accepted as a guest installer.

---

## Key Technologies

| Layer | Stack |
|---|---|
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS v4, Framer Motion |
| 3D | Three.js 0.164, `@react-three/fiber`, `@react-three/drei` |
| PDF | `@react-pdf/renderer` |
| Backend | Python 3.11, FastAPI, Pydantic |
| AI | Anthropic Claude (primary), Ollama Llama 3.2 (fallback), Google Gemini |
| Catalogue | Tavily Search API, pdfplumber |

---

## Security

Scanned with **Aikido Security** on 26 April 2026:

- **Top 5%** of all Aikido accounts for code repository security posture.
- **Zero** open issues across all 14 categories (Critical / High / Medium / Low).
- **7/10 OWASP Top 10** categories fully compliant; 3 under monitoring (auth is localStorage-based for hackathon scope).

See [DOCS.md → §13](DOCS.md#13-security--aikido-report) for the full report with screenshots.

---

## Documentation

See **[DOCS.md](DOCS.md)** for:

- Full architecture diagram
- Per-module API reference
- Pipeline step-by-step walkthrough
- All data models
- Environment variable reference
- Installer-configurable parameters
- Complete Aikido / OWASP security report
