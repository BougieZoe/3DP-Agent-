# 3DP Agent Backend Migration: TypeScript → Go (Hybrid)

## Overview

Replace the Node.js/Express API server with a Go backend for HTTP routing, concurrency, and I/O-bound operations. Keep Python as a subprocess for heavy computation (trimesh, build123d, OpenCASCADE).

---

## Phase 1: Go Slicer Service (Week 1)

**Goal:** Standalone Go service that can slice STL files concurrently.

### Files to create:

```
go-backend/
├── main.go              # Entry point, HTTP server on :8080
├── go.mod
├── go.sum
├── slicer/
│   ├── bridge.go        # Slicer CLI adapter (dropStlToBed, discoverSlicer)
│   ├── router.go        # HTTP handlers: POST /api/slice, GET /api/slice/health
│   ├── profiles.go      # Printer profiles (static data)
│   └── gcode.go         # G-code parser (parseGCodeMetadata, parseLayers)
├── mesh/
│   ├── router.go        # HTTP handler: POST /api/mesh/process
│   └── process.go       # Python subprocess wrapper (calls mesh_process.py)
├── step/
│   ├── router.go        # HTTP handler: POST /api/step
│   └── parser.go        # Python subprocess wrapper (calls STEP CLI)
├── cad/
│   ├── router.go        # HTTP handlers: POST /api/cad/generate, /edit, GET /:id/step
│   ├── bridge.go        # LLM calling logic + Python subprocess for build123d
│   ├── sandbox.go       # Source safety scanning, resource limits
│   └── repair.go        # Pattern-based auto-repair (regex)
├── llm/
│   ├── client.go        # OpenAI-compatible HTTP client with failover
│   └── keys.go          # YAML key management with hot-reload
├── auth/
│   ├── bridge.go        # BRIDGE_TOKEN validation
│   └── loopback.go      # Loopback detection for dev mode
└── config/
    └── config.go        # Environment variable parsing
```

### What Go replaces directly:

| Node.js Module | Go Equivalent | Notes |
|----------------|---------------|-------|
| `express` router | `chi` or `gorilla/mux` | |
| `child_process.execFile` | `os/exec` | Same pattern |
| `fs/promises` temp dirs | `os.MkdirTemp` | |
| `ws` WebSocket | `gorilla/websocket` | Real-time collab |
| `express.json({limit:'30mb'})` | `http.MaxBytesReader` | |
| In-memory rate limiter | `sync.Map` + goroutine | |
| `crypto.randomUUID` | `crypto/rand` | |

### What Python subprocess handles (unchanged):

- `mesh_process.py` — trimesh + pymeshfix for mesh repair/decimation
- `scripts/step/` — OpenCASCADE for STEP parsing
- `build123d` — CAD generation from LLM-authored Python

---

## Phase 2: Mesh & STEP Services (Week 2)

**Goal:** Go service handles mesh processing and STEP parsing via Python subprocess.

### Key design:

```
Go HTTP → Receive STL/STEP (base64) → Write temp file → Call Python subprocess → Parse JSON result → Return response
```

Python subprocesses run with:
- Resource limits (ulimit: 2GB RAM, 120s CPU, 100MB output)
- Stripped environment (SANDBOX_ENV)
- SIGKILL timeout
- JSON sidecar for diagnostics (avoids stdout pollution)

---

## Phase 3: CAD Bridge + LLM (Week 3)

**Goal:** Go service handles LLM calling, code generation, and CAD execution.

### Key design:

```
Go HTTP → LLM call (with failover) → Extract Python source → Scan safety → Execute build123d → Return STL/STEP
```

LLM client features:
- Circuit breaker per provider
- Retry with exponential backoff
- 8 providers: OpenAI, Claude, Gemini, DeepSeek, Kimi, Fireworks, Zhipu, AMD
- YAML key management with hot-reload

---

## Phase 4: Real-time Collaboration (Week 4)

**Goal:** Go WebSocket server for multi-user sessions.

### Key design:

```
Browser ←→ Go WebSocket Server ←→ Session State (in-memory)
```

Features:
- Session management (join/leave)
- Presence broadcasting (cursor positions)
- Comment relay
- Activity feed

---

## Phase 5: Integration & Deployment (Week 5)

### Changes to frontend:

1. Update API base URL to point to Go service
2. Replace Vite proxy config to forward to `localhost:8080`
3. Keep TypeScript types shared between frontend and Go (generate from Go structs)

### Docker:

```dockerfile
FROM golang:1.22 AS builder
WORKDIR /app
COPY go-backend/ .
RUN go build -o server .

FROM debian:bookworm-slim
# Install Python, trimesh, pymeshfix, build123d, PrusaSlicer
COPY --from=builder /app/server /usr/local/bin/server
CMD ["server"]
```

### Deployment targets:

- **Local dev:** `go run .` on :8080 + Vite on :3000
- **Docker:** Single container with Go + Python + slicer CLI
- **Cloud:** Fly.io or Railway (supports long-running processes, unlike Vercel)

---

## Effort Estimate

| Phase | Time | Risk |
|-------|------|------|
| Phase 1: Go Slicer | 1 week | Low |
| Phase 2: Mesh & STEP | 1 week | Medium (Python subprocess integration) |
| Phase 3: CAD + LLM | 1 week | Medium (LLM failover complexity) |
| Phase 4: WebSocket | 3 days | Low |
| Phase 5: Integration | 3 days | Medium (testing, deployment) |
| **Total** | **~5 weeks** | |

---

## Risk Mitigation

1. **Go service doesn't replace TypeScript server initially** — both run side by side. Go handles bridge routes, TypeScript handles LLM relay + frontend.
2. **Python subprocess stays** — no attempt to rewrite trimesh/build123d in Go. Just call them as subprocesses with proper sandboxing.
3. **Feature flags** — Frontend can switch between old (TypeScript) and new (Go) backends via env var.
4. **Fallback** — If Go service crashes, frontend falls back to TypeScript server.

---

## Prerequisites

- [ ] Install Go 1.22+ (`brew install go`)
- [ ] Create `go-backend/` directory in the 3DP-Agent- repo
- [ ] Initialize Go module (`go mod init github.com/BougieZoe/3dp-agent-go`)
- [ ] Create `feat/go-backend` branch
