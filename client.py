from contextlib import AsyncExitStack
from typing import Any, Dict, List
import logging
import json
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerHTTP
from pydantic_ai.mcp import MCPServerStdio
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.deepseek import DeepSeekProvider
import asyncio
from pydantic_ai.providers.openai import OpenAIProvider

import os
from dotenv import load_dotenv

# 加载.env文件中的环境变量
load_dotenv()


def load_mcp_servers_from_config(config_path: str = "mcp_server_config.json") -> List[MCPServerStdio]:
    """
    从配置文件加载MCP服务器配置并创建MCPServerStdio或MCPServerHTTP实例

    Args:
        config_path: 配置文件路径

    Returns:
        MCP服务器实例列表
    """
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config_data = json.load(f)

        servers = []
        mcp_servers_config = config_data.get("mcpServers", {})

        for server_name, server_config in mcp_servers_config.items():
            # 处理基于命令行的MCP服务器
            if "command" in server_config:
                command = server_config.get("command")
                args = server_config.get("args", [])
                env = server_config.get("env", {})

                # 创建环境变量字典，合并当前环境变量
                environment = os.environ.copy()
                environment.update(env)

                server = MCPServerStdio(
                    command=command,
                    args=args,
                    env=environment
                )
                servers.append(server)

            # 处理基于HTTP的MCP服务器
            elif "url" in server_config:
                url = server_config.get("url")
                server = MCPServerHTTP(url=url)
                servers.append(server)

        logging.info(f"已从{config_path}加载{len(servers)}个MCP服务器配置")
        return servers
    except FileNotFoundError:
        logging.warning(f"配置文件{config_path}不存在，返回空列表")
        return []
    except json.JSONDecodeError:
        logging.error(f"配置文件{config_path}格式错误，无法解析JSON")
        return []
    except Exception as e:
        logging.error(f"加载MCP服务器配置时发生错误: {str(e)}")
        return []


model = OpenAIModel(
    os.getenv("MCP_LLM_API_MODEL_NAME"),
    provider=OpenAIProvider(
        base_url=os.getenv("MCP_LLM_API_BASE_URL"), api_key=os.getenv("MCP_LLM_API_KEY")
    ),
)
agent = Agent(model)
agent = Agent(model, mcp_servers=load_mcp_servers_from_config(),
              system_prompt="你是一个人工智能助手，擅长使用工具解决问题，请用中文回答用户的问题")


async def main():
    async with agent.run_mcp_servers():
        user_input = input("请输入您的问题: ")
        result = await agent.run(user_input)
    print(result.output)

if __name__ == "__main__":
    asyncio.run(main())
