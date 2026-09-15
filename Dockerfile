FROM debian:bookworm-slim

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

# Copy pre-built Go binary
COPY go-backend/3dp-agent-server /app/go-backend/3dp-agent-server
RUN chmod +x /app/go-backend/3dp-agent-server

# Copy pre-built Node.js frontend
COPY dist /app/dist
COPY package.json /app/package.json

# Copy Python scripts
COPY server/mesh_process.py /app/server/mesh_process.py

# Copy configuration
COPY .cad-bridge/config /app/.cad-bridge/config

# Create necessary directories
RUN mkdir -p /app/.cad-bridge/runs /app/.cad-bridge/metrics

# Set environment
ENV NODE_ENV=production
ENV PYTHONPATH=/app/.venv/lib/python3.11/site-packages

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start both Go backend and Node.js server
CMD ["/bin/bash", "-c", "/app/go-backend/3dp-agent-server --port 8888 & node /app/dist/index.cjs"]
