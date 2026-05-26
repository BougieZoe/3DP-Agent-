
# 3DP AGENT

### a place to see, feel, and question a 3D print before it exists

![3DP Agent](test.gif)

[![live demo](https://img.shields.io/badge/live-demo-00C7B7?style=flat-square&logo=vercel&logoColor=white)](https://3dp-agent.vercel.app) [![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://github.com/BougieZoe/3DP-Agent-/blob/main/LICENSE) [![stars](https://img.shields.io/github/stars/BougieZoe/3DP-Agent-?style=flat-square&color=yellow)](https://github.com/BougieZoe/3DP-Agent-/stargazers) [![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev) [![Three.js](https://img.shields.io/badge/Three.js-r184-000000?style=flat-square&logo=threedotjs)](https://threejs.org)

**live → [3dp-agent.vercel.app](https://3dp-agent.vercel.app)**

---

Upload an STL. Watch it think. Ask it anything.

No account. No cloud. No waiting. Everything runs in your browser.

---

## what it does

**instant — no key needed**

Drop a file. In seconds you get:

| | |
|:--|:--|
| wall thickness | catches regions too thin to survive printing |
| overhang | flags faces beyond 45° — support territory |
| volume & mass | material usage, weight estimate |
| dimensions | exact XYZ in mm |
| watertight check | open mesh detection |
| quick report | settings, material, time — instant |

**multi-agent AI — your key, your choice**

Four specialized agents analyze your model in parallel, then debate their findings:

| agent | what it sees |
|:--|:--|
| Geometry Analyst | mesh topology, wall thickness, overhangs, features |
| Printability Scorer | weighted score across all risk dimensions |
| Failure Predictor | where and why it will fail |
| Optimization Advisor | what to change and how |

They produce a **CONSENSUS SCORE** — not just one AI's opinion, but a structured disagreement resolved into a verdict.

Point it at Claude, OpenAI, or Gemini. Your key stays in your browser. Nothing leaves your machine.

---

## causality

Most tools tell you *what* is wrong. This one tries to tell you *why*.

The **CAUSALITY** tab traces failure chains — from geometry decision to print outcome. It shows manufacturing timelines, counterfactual reasoning ("if you thickened this wall, here's what changes"), and pattern memory across your session.

---

## the visual layer

The 3D viewport isn't just a model viewer. It's an argument made visible.

Overlays animate in real time as analysis runs:

- **Cognitive Scan** — a plane sweeps the model as the AI reads it
- **Risk Animation** — risk markers breathe with severity
- **Thermal Field** — heat distribution across the surface
- **Failure Emergence** — sagging, oscillation, stress pulses appear where failure is predicted
- **Layer Reveal** — watch the print build layer by layer
- **Print Path Preview** — the head traces its actual path

Switch between **dark and light** themes. The entire visual system — Three.js scene, UI tokens, animation constants — reacts.

---

## how it works

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#a3c4f3', 'primaryBorderColor': '#2c5aa6', 'lineColor': '#5a8ddf'}}}%%
flowchart LR
    User[User] -->|drag STL| Browser[Browser App]
    Browser --> STL[STL Loader]
    Browser --> Rules[Rule Engine]
    Rules -->|fast path| Result[Local Analysis]
    Rules -->|needs AI| Orch[Orchestrator]
    Orch --> A1[Geometry Analyst]
    Orch --> A2[Printability Scorer]
    Orch --> A3[Failure Predictor]
    Orch --> A4[Optimization Advisor]
    A1 & A2 & A3 & A4 --> Debate[Agent Debate]
    Debate --> Score[Consensus Score]
    Score --> Causality[Causality Engine]
```

---

## stack

React 19 · TypeScript · Three.js · React Three Fiber
Tailwind v4 · Vite 7 · multi-agent orchestration

---

## run it

```bash
git clone https://github.com/BougieZoe/3DP-Agent-
cd 3DP-Agent-
pnpm install
pnpm dev
```

Add your AI key inside the app. Everything else works out of the box.

---

## who it's for

Designers catching issues before handoff.
Engineers who want a second opinion fast.
Manufacturers reviewing files before they quote.
Anyone who's had a print fail and didn't know why.

---

## roadmap

- [ ] PDF export
- [ ] slicer settings output
- [ ] batch analysis
- [ ] cost estimation by material

---

## license

MIT. If this saves you a failed print, a ⭐ is appreciated.

---

*EN · 日本語 · 中文 · [@BougieZoe](https://github.com/BougieZoe)*
