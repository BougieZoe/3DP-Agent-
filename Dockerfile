# ---- Stage 1: Build Go backend ----
FROM golang:1.23-bookworm AS go-builder

WORKDIR /app/go-backend

COPY go-backend/go.mod go-backend/go.sum ./
ENV GOTOOLCHAIN=auto
RUN go mod download

COPY go-backend/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /go-backend/3dp-agent-server .

# ---- Stage 2: Build Node.js frontend ----
FROM node:20-slim AS node-builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build

# ---- Stage 3: Production ----
FROM debian:bookworm-slim AS production

WORKDIR /app

# Install Python and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create Python virtual environment and install dependencies
RUN python3 -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Copy Go binary
COPY --from=go-builder /go-backend/3dp-agent-server /app/go-backend/3dp-agent-server
RUN chmod +x /app/go-backend/3dp-agent-server

# Copy Node.js build
COPY --from=node-builder /app/dist /app/dist
COPY --from=node-builder /app/package.json /app/package.json
COPY --from=node-builder /app/pnpm-lock.yaml /app/pnpm-lock.yaml

# Copy Node.js binary and modules
COPY --from=node-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=node-builder /usr/local/lib/node_modules /usr/local/lib/node_modules

# Copy Python scripts
COPY server/mesh_process.py /app/server/mesh_process.py

# Copy configuration
COPY .cad-bridge/config /app/.cad-bridge/config

# Create necessary directories
RUN mkdir -p /app/.cad-bridge/runs /app/.cad-bridge/metrics

# Set environment
ENV NODE_ENV=production
ENV PYTHONPATH=/app/.venv/lib/python3.11/site-packages
ENV PATH="/app/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
ENV NODE_PATH="/usr/local/lib/node_modules"
ENV CAD_BRIDGE_DIR="/app/.cad-bridge"
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start both Go backend and Node.js server
CMD ["/bin/bash", "-c", "/app/go-backend/3dp-agent-server --port 8888 & /usr/local/bin/node /app/dist/index.cjs"]
