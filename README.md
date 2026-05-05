# 3DP Agent — Intelligent 3D Print Analysis Platform

<div align="center">

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-black?logo=react)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-0.184-orange?logo=three.js)](https://threejs.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Web-blueviolet)](https://github.com)

**AI-powered STL analysis tool for 3D printing professionals**

[Features](#-features) • [Architecture](#-architecture) • [Getting Started](#-getting-started) • [Tech Stack](#-tech-stack)

</div>

---

## 🎯 Value Proposition

3DP Agent transforms how engineers, makers, and manufacturers evaluate 3D printability — **instantly, locally, and at scale**.

- **Zero-Cloud Analysis**: Core printability metrics run entirely in-browser. No data leaves the user's machine.
- **Dual-Tier Intelligence**: Free local rules engine for instant feedback; optional AI integration (Claude, GPT-4o, Gemini) for complex engineering questions.
- **Visual-First Design**: Interactive 3D viewport with real-time model inspection and annotation.
- **Production-Ready**: Supports 50+ UI components, three languages (EN/JA/ZH), and modern build tooling.

---

## 🚀 Features

| Feature | Description |
|---------|-------------|
| **STL File Parser** | Supports both ASCII and binary STL formats with robust error handling |
| **Geometry Analysis** | Wall thickness, overhang detection, volume/surface area calculations |
| **Quick Reports** | Local generation of print recommendations (material, layer height, infill) |
| **AI Chat Interface** | Natural language Q&A about print settings, costs, and optimization |
| **Multi-Language** | Full i18n support for English, Japanese, and Chinese |
| **3D Visualization** | Interactive Three.js canvas with orbit controls, auto-rotation, and particle effects |
| **API Key Management** | Secure local storage of user-provided AI API keys (client-side only) |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Pages     │  │ Components  │  │   Lib/      │  │      Contexts      │ │
│  │  • Home     │  │  • 3D View  │  │  • stlLoader│  │  • ThemeProvider    │ │
│  │  • 404      │  │  • Chat     │  │  • apiKeys  │  │                     │ │
│  └─────────────┘  │  • Upload   │  │  • ruleEngine│ │                     │ │
│                   │  • Analysis │  │  • i18n     │  └─────────────────────┘ │
│                   └─────────────┘  └─────────────┘                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                              LIBRARIES                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │Three.js  │ │React     │ │Radix UI  │ │Tailwind  │ │ Wouter Router  │  │
│  │+ Fiber   │ │19        │ │(50+)     │ │CSS 4     │ │                │  │
│  │+ Drei    │ │          │ │          │ │          │ │                │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ HTTP (REST API calls)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL APIs                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │  Anthropic   │  │    OpenAI    │  │   Google     │                      │
│  │   Claude     │  │    GPT-4o    │  │   Gemini     │                      │
│  └──────────────┘  └──────────────┘  └──────────────┘                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           SERVER (Node.js)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  Express Static Server                                                 │ │
│  │  • Serves production build from dist/public                          │ │
│  │  • SPA fallback for client-side routing                               │ │
│  │  • Runs on port 3000 (configurable via PORT env)                     │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
STL Upload → STL Loader → Analysis Engine → Report Generator
                                              ↓
                                    ┌─────────┴─────────┐
                                    │   Decision Tree   │
                                    ├───────────────────┤
                                    │ needsAI = false   │ ──► Local Rules Engine
                                    │ needsAI = true    │ ──► External AI API
                                    └───────────────────┘
```

---

## 📦 Getting Started

### Prerequisites

- **Node.js** 18+ 
- **pnpm** (recommended) or npm/yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/three-dp-agent.git
cd three-dp-agent

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

The app runs at `http://localhost:5173` (Vite dev) or `http://localhost:3000` (production).

### Production Build

```bash
# Build for production
pnpm build

# Start production server
pnpm start
```

---

## 🔧 Tech Stack

### Frontend

| Category | Technology |
|----------|------------|
| Framework | React 19.2 |
| Language | TypeScript 5.6 |
| Build Tool | Vite 7.1 |
| 3D Engine | Three.js 0.184, React-Three-Fiber, Drei |
| UI Components | Radix UI (50+) |
| Styling | Tailwind CSS 4.1 |
| State Management | React Hooks |
| Routing | Wouter 3.3 |
| Forms | React Hook Form + Zod |
| Internationalization | Custom (EN/JA/ZH) |

### Backend

| Category | Technology |
|----------|------------|
| Runtime | Node.js |
| Framework | Express 4.21 |
| Build | esbuild |
| Port | 3000 (default) |

### External Integrations

| Provider | Model | Purpose |
|----------|-------|---------|
| Anthropic | Claude Opus 4-5 | Advanced AI chat |
| OpenAI | GPT-4o | Advanced AI chat |
| Google | Gemini 2.0 Flash | Advanced AI chat |

---

## 📂 Project Structure

```
three-dp-agent/
├── client/                  # React frontend application
│   ├── src/
│   │   ├── components/     # React components (UI + feature)
│   │   │   ├── 3D/         # Three.js scene components
│   │   │   └── ui/         # Radix UI components
│   │   ├── contexts/       # React contexts
│   │   ├── hooks/         # Custom React hooks
│   │   ├── lib/           # Core logic (stlLoader, ruleEngine, apiKeys)
│   │   ├── pages/         # Page components (Home, NotFound)
│   │   └── main.tsx       # App entry point
│   ├── public/            # Static assets
│   └── index.html         # HTML template
├── server/                # Express server
│   └── index.ts           # Server entry point
├── shared/                # Shared constants
│   └── const.ts           # Cookie/session constants
├── package.json          # Root package config
├── vite.config.ts         # Vite configuration
├── tsconfig.json          # TypeScript config
└── pnpm-lock.yaml        # Lock file
```

---

## 🔐 Security Notes

- **API Keys**: Stored in browser `localStorage`. Users provide their own keys; none are stored on external servers.
- **Client-Side Only**: No backend data processing. All analysis runs in the user's browser.
- **Production**: Use environment variables for sensitive configurations.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🤝 Contributing

Contributions welcome! Please read the contributing guidelines before submitting PRs.

---

<div align="center">

**Built with React, Three.js, and Tailwind CSS**

*3DP Agent — Making 3D printing accessible to everyone.*

</div>