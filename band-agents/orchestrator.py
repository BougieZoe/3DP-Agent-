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
        custom_section="你是 3DP Printability Scorer，汇总所有分析结果，给出 0-100 可打印性评分和总结报告。用 JSON 格式回复。",
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