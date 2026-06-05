# 3DP Agent × Band — Multi-Agent Manufacturing QA System

A 5-agent collaborative system for 3D print quality analysis, built on [Band](https://app.band.ai) for the Band of Agents Hackathon 2026.

## What it does

Upload an STL file → 5 AI agents collaborate in real-time to analyze printability:

| Agent | Role |
|-------|------|
| 🎯 Orchestrator | Coordinates the team, manages workflow |
| 📐 Geometry Analyst | Analyzes wall thickness, overhangs, mesh topology |
| ⚠️ Failure Predictor | Predicts failure modes with severity and timeline |
| 🔧 Optimization Advisor | Suggests print parameters and geometry fixes |
| 📊 Printability Scorer | Produces final 0-100 score and summary report |

## Demo

Live frontend: [3dp-agent.vercel.app](https://3dp-agent.vercel.app)

## Run your own

### 1. Clone and install

```bash
git clone https://github.com/BougieZoe/3DP-Agent-
cd 3DP-Agent-/band-agents
uv init
uv add "band-sdk[langgraph]" langchain-openai langchain-ollama
```

### 2. Create your agents on Band

Go to [app.band.ai/agents](https://app.band.ai/agents) and create 5 Remote Agents:
- 3DP Orchestrator
- 3DP Geometry Analyst
- 3DP Failure Predictor
- 3DP Optimization Advisor
- 3DP Printability Scorer

### 3. Configure credentials

```bash
cp .env.example .env
```

Edit `.env` with your keys. Edit `agent_config.yaml` with your agent IDs and API keys.

### 4. Start all 5 agents

Open 5 terminals and run one in each:

```bash
uv run python orchestrator.py
uv run python geometry_analyst.py
uv run python failure_predictor.py
uv run python optimization_advisor.py
uv run python printability_scorer.py
```

### 5. Chat with your team

Go to Band, create a chat room, add all 5 agents, then send:
## Stack

- [Band](https://app.band.ai) — multi-agent communication infrastructure
- [thenvoi-sdk](https://github.com/thenvoi/thenvoi-sdk-python) — Band Python SDK
- [LangGraph](https://langchain-ai.github.io/langgraph/) — agent framework
- [DeepSeek](https://platform.deepseek.com) — LLM (or any OpenAI-compatible model)
- Python 3.10+, uv
