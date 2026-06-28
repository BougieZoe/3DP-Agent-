# AGENTS.md — Project Bible for 3DP Agent (XPRIZE Edition)

**Last Updated**: 2026-06-22  
**Project**: 3DP Agent — 3D Printing Pre-flight Intelligence & Manufacturing Visualizer  
**Competition**: Build with Gemini XPRIZE 2026 — **Small Business Services**

## Project Overview
Browser-native multi-agent 3D print analysis tool that helps small 3D printing businesses, studios, and manufacturers catch failures before printing. Built with React 19 + TypeScript (strict) + Three.js r184 + React Three Fiber.

**Core Value**: Reduce print failure rate, material waste, and time for small businesses.

## XPRIZE Goals
- Transform demo into real SaaS with real paying users (arms-length)
- Excel in Business Viability, AI-Native Operations, and Category Impact
- Heavy usage of Gemini, Antigravity, Firebase, Google Cloud

## Architecture & Key Conventions

### Playback System
- `PrintPlaybackContext.tsx` + `progressRef` is the Single Source of Truth.
- All animation components must use `usePrintPlayback()` hook.
- Prefer `progressRef.current` over independent clocks.

### Visual Language (Strict)
- All styles must come from `visualLanguage.ts`
- 3D overlays: AdditiveBlending only, never modify base STL mesh
- Aesthetic: Apple polish + Industrial AI + Scientific Visualization

### Core Engines
- causalityEngine.ts
- topologyPatternEngine.ts
- counterfactualEngine.ts

### Folder Structure
- `src/components/3D/` — 3D components
- `src/components/causality/` — panels
- `src/lib/` — engines and utilities

## Agent Rules
- Always respect visualLanguage.ts
- Output Implementation Plan before major code changes
- Maintain 60fps performance
- Strict TypeScript

## Known Issues
- RiskAnimation independent clock
- Sonner import build error
