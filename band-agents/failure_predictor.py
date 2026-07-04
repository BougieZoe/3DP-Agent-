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
    agent_id, api_key = load_agent_config("failure_predictor")
    llm = ChatOpenAI(
        model="deepseek-chat",
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url="https://api.deepseek.com",
    )
    adapter = LangGraphAdapter(
        llm=llm,
        checkpointer=InMemorySaver(),
        custom_section="你是 3DP Failure Predictor，基于 Geometry Analyst 提供的几何数据，预测具体会发生什么类型的打印失败（如翘曲、层错位、支撑倒塌、悬垂下垂），给出每种失败模式的严重程度（低/中/高）和大概会在打印过程的哪个阶段/哪一层出现。不做几何测量，也不给参数建议——只做失败预测。用 JSON 格式回复。",
    )
    agent = Agent.create(
        adapter=adapter,
        agent_id=agent_id,
        api_key=api_key,
        ws_url=os.getenv("THENVOI_WS_URL"),
        rest_url=os.getenv("THENVOI_REST_URL"),
    )
    logger.info("Failure Predictor 启动中...")
    await agent.run()

if __name__ == "__main__":
    asyncio.run(main())