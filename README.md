# 3DP AGENT

### a place to see, feel, and question a 3D print before it exists

<div align="center">
  <img src="test.gif" alt="3DP Agent demo" width="800">
</div>

<p align="center">
  <a href="https://3dp-agent.vercel.app"><img src="https://img.shields.io/badge/live-demo-00C7B7?style=flat-square&logo=vercel&logoColor=white"></a>
  <a href="https://github.com/BougieZoe/3DP-Agent-/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
  <a href="https://github.com/BougieZoe/3DP-Agent-/stargazers"><img src="https://img.shields.io/github/stars/BougieZoe/3DP-Agent-?style=flat-square&color=yellow"></a>
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react">
  <img src="https://img.shields.io/badge/Three.js-r184-000000?style=flat-square&logo=threedotjs">
</p>

**live → [3dp-agent.vercel.app](https://3dp-agent.vercel.app)**

---

## what it is

Upload an STL. See it move. Ask it questions.

No account. No cloud. No waiting.  
Everything runs in your browser.

---

## how it works

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#a3c4f3', 'primaryBorderColor': '#2c5aa6', 'lineColor': '#5a8ddf'}}}%%
flowchart LR
    User[User] -->|drag STL| Browser[Browser App]
    Browser --> STL[STL Loader]
    Browser --> Rules[Rule Engine]
    Rules -->|fast path| Result[Local Analysis<br/>thickness, overhang, volume]
    Rules -->|needs AI| AI[External AI API]
    AI --> Claude[Claude / GPT-4o / Gemini]
    Result --> Report[Printable Report]
    Claude --> Chat[AI Chat Answer]
```

---

## free analysis

| | |
|---|---|
| wall thickness | catches regions too thin to survive printing |
| overhang | flags faces beyond 45° — support territory |
| volume & mass | material usage, weight estimate |
| dimensions | exact XYZ in mm |
| watertight | open mesh detection |
| quick report | settings, material, time — instant |

---

## AI chat

Point it at Claude, GPT-4o, or Gemini.  
Ask what you actually want to know:

> *"Where will this warp?"*  
> *"Is PETG the right call here?"*  
> *"How do I get rid of most of the support?"*

The AI sees the real geometry — wall thickness, overhang count, volume, dimensions.  
Not just the filename.

Your key stays in your browser. Nothing is sent anywhere else.

---

## stack

```
React 19 · TypeScript · Three.js · React Three Fiber · Tailwind v4 · Vite 7
```

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

## who uses it

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

MIT.  
If this saves you a failed print, a star is appreciated.

---

<sub>EN / 日本語 / 中文 · [@BougieZoe](https://github.com/BougieZoe)</sub>
