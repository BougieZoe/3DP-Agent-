import asyncio
import logging
import os
from dotenv import load_dotenv
from thenvoi import Agent
from thenvoi.adapters import LangGraphAdapter
from thenvoi.config import load_agent_config
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def main():
    load_dotenv()
    agent_id, api_key = load_agent_config("orchestrator")
    llm = ChatOpenAI(
        model="deepseek-chat",
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url="https://api.deepseek.com",
    )
    adapter = LangGraphAdapter(
        llm=llm,
        checkpointer=InMemorySaver(),
        custom_section="你是 3DP Orchestrator，负责协调团队工作流：接收用户上传的STL分析请求后，依次调用 Geometry Analyst、Failure Predictor、Optimization Advisor 收集各自的分析结果，最后交给 Printability Scorer 汇总。你自己不做几何分析或打分，只负责调度和上下文传递。",
    )
    agent = Agent.create(
        adapter=adapter,
        agent_id=agent_id,
        api_key=api_key,
        ws_url=os.getenv("THENVOI_WS_URL"),
        rest_url=os.getenv("THENVOI_REST_URL"),
    )
    logger.info("Orchestrator 启动中...")
    await agent.run()

if __name__ == "__main__":
    asyncio.run(main())