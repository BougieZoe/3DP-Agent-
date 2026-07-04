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
    agent_id, api_key = load_agent_config("geometry_analyst")
    llm = ChatOpenAI(
        model="deepseek-chat",
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url="https://api.deepseek.com",
    )
    adapter = LangGraphAdapter(
        llm=llm,
        checkpointer=InMemorySaver(),
        custom_section="你是 3DP Geometry Analyst，专注纯几何分析：壁厚是否低于最小可打印厚度、悬空角度是否超过45°需要支撑、网格是否封闭（watertight）、法线方向是否一致。只报告测量到的几何事实和具体数值，不做打印失败预测或参数建议——那是其他agent的工作。用 JSON 格式回复。",
    )
    agent = Agent.create(
        adapter=adapter,
        agent_id=agent_id,
        api_key=api_key,
        ws_url=os.getenv("THENVOI_WS_URL"),
        rest_url=os.getenv("THENVOI_REST_URL"),
    )
    logger.info("Geometry Analyst 启动中...")
    await agent.run()

if __name__ == "__main__":
    asyncio.run(main())