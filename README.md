# 3DP AGENT
### a place to see, feel, and question a 3D print before it exists

<div align="center">
  <img src="test.gif" alt="3DP Agent demo" width="800">
</div>

**live → [3dp-agent.vercel.app](https://3dp-agent.vercel.app)**  
*open in browser, no install, no cloud*

---

## what it is

a quiet tool for people who work with STL files.  
it reads your model, shows it in space, and talks back — in plain words, not g-code.

- **zero upload** → everything stays in your browser  
- **free analysis** → wall thickness, overhang, volume  
- **two modes** → local rules (fast) / optional AI chat (deeper)  
- **three languages** → EN / 日本語 / 中文

no login. no database. no subscription.

---

## how to use it

drag an STL file onto the viewport.  
rotate / zoom with mouse.  
click **ANALYZE** → get print hints.  
click **AI CHAT** → ask something like *“would this fail with PETG?”*

API keys are optional and stay on your machine.

---

## what it’s made of

react + three.js + tailwind  
wrapped in a static server that fits in one dinner napkin.

---

## why it exists

because 3D printing is still too much guessing.  
this is not an AI oracle — it’s a magnifying glass + a second pair of eyes.

---

## live preview

the fastest way is the link at the top.  
if you want to run it locally:

```bash
git clone https://github.com/BougieZoe/3DP-Agent-.git
cd 3DP-Agent-
pnpm install
pnpm dev
