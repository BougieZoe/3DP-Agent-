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
    agent_id, api_key = load_agent_config("optimization_advisor")
    llm = ChatOpenAI(
        model="deepseek-chat",
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url="https://api.deepseek.com",
    )
    adapter = LangGraphAdapter(
        llm=llm,
        checkpointer=InMemorySaver(),
        custom_section="你是 3DP Optimization Advisor，基于 Geometry Analyst 的测量数据和 Failure Predictor 的失败预测，给出具体可执行的修复建议：推荐的层高、支撑密度、打印方向、材料选择，以及几何本身该如何修改（例如壁厚建议从1.2mm加到2mm）。不做几何测量，也不做失败预测——只给解决方案。用 JSON 格式回复。",
    )
    agent = Agent.create(
        adapter=adapter,
        agent_id=agent_id,
        api_key=api_key,
        ws_url=os.getenv("THENVOI_WS_URL"),
        rest_url=os.getenv("THENVOI_REST_URL"),
    )
    logger.info("Optimization Advisor 启动中...")
    await agent.run()

if __name__ == "__main__":
    asyncio.run(main())