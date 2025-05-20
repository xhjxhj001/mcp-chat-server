from contextlib import AsyncExitStack
from typing import Dict, List, Optional, Any, Union
import logging
import json
import os
import asyncio
import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerHTTP, MCPServerStdio
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.messages import (
    FinalResultEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartStartEvent,
    TextPartDelta,
    ToolCallPartDelta,
)
from dotenv import load_dotenv
import uuid
from datetime import datetime
import shutil
from pydantic_ai.messages import ModelRequest, UserPromptPart, ModelResponse, TextPart

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 加载环境变量
load_dotenv()

# 创建FastAPI应用
app = FastAPI(title="MCP Agent API", description="使用MCP工具的AI助手API")

# 添加CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 在生产环境中应该限制允许的源
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 模型全局参数设置
model_settings = {
    "temperature": 0.7,
    "max_tokens": 1024,
    "timeout": 120,
}

# MCP服务器配置路径
MCP_CONFIG_PATH = "mcp_server_config.json"

# 全局agent对象
agent = None
mcp_stack = AsyncExitStack()

# 全局变量来存储MCP配置
mcp_config = {}

# 标记需要重启的状态
agent_restart_required = False

# 配置更新状态追踪
config_update_status = {
    "updating": False,
    "last_update_time": None,
    "success": None,
    "message": "",
    "update_id": None
}

# 对话历史存储
conversation_history = {}


class ChatMessage(BaseModel):
    """聊天消息模型"""
    role: str  # "user" 或 "assistant"
    content: str
    timestamp: datetime = datetime.now()


class Conversation(BaseModel):
    """对话模型"""
    id: str
    title: str
    messages: List[ChatMessage] = []
    created_at: datetime = datetime.now()
    updated_at: datetime = datetime.now()


class QueryRequest(BaseModel):
    """查询请求模型"""
    query: str
    conversation_id: Optional[str] = None
    history_turns: int = 5  # 默认引用5轮历史对话
    system_prompt: Optional[str] = None  # 改为可选字段
    use_default_system_prompt: bool = True  # 是否使用配置文件中的默认系统提示符


class QueryResponse(BaseModel):
    """查询响应模型"""
    answer: str
    conversation_id: str
    usage: Optional[Dict] = None


class ConversationListResponse(BaseModel):
    """对话列表响应"""
    conversations: List[Conversation]


class ConversationResponse(BaseModel):
    """单个对话响应"""
    conversation: Conversation


class SuccessResponse(BaseModel):
    """成功响应"""
    success: bool
    message: str


class ConfigUpdateRequest(BaseModel):
    """配置更新请求模型"""
    config: Dict[str, Any]


class ConfigUpdateResponse(BaseModel):
    """配置更新响应模型"""
    success: bool
    message: str
    update_id: Optional[str] = None


def load_mcp_servers_from_config(config_path: str = MCP_CONFIG_PATH) -> List:
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

                # 检查命令是否为绝对路径，如果不是，则在PATH中查找
                if not os.path.isabs(command) and os.path.sep not in command:
                    # 使用shutil.which查找可执行文件的完整路径
                    cmd_path = shutil.which(
                        command, path=environment.get('PATH'))
                    if cmd_path:
                        logger.info(f"命令 '{command}' 在PATH中找到: {cmd_path}")
                        command = cmd_path
                    else:
                        logger.warning(
                            f"命令 '{command}' 不是绝对路径且在PATH中未找到，尝试直接使用")

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

        logger.info(f"已从{config_path}加载{len(servers)}个MCP服务器配置")
        return servers
    except FileNotFoundError:
        logger.warning(f"配置文件{config_path}不存在，返回空列表")
        return []
    except json.JSONDecodeError:
        logger.error(f"配置文件{config_path}格式错误，无法解析JSON")
        return []
    except Exception as e:
        logger.error(f"加载MCP服务器配置时发生错误: {str(e)}")
        return []


async def initialize_agent():
    """初始化Agent和MCP服务器"""
    global agent, mcp_stack, model_settings, mcp_config

    # 创建模型
    model = OpenAIModel(
        os.getenv("MCP_LLM_API_MODEL_NAME"),
        provider=OpenAIProvider(
            base_url=os.getenv("MCP_LLM_API_BASE_URL"),
            api_key=os.getenv("MCP_LLM_API_KEY")
        ),
    )

    # 加载MCP服务器
    mcp_servers = load_mcp_servers_from_config()

    # 从配置文件加载系统提示符
    try:
        with open(MCP_CONFIG_PATH, "r", encoding="utf-8") as f:
            mcp_config = json.load(f)
            system_prompt = mcp_config.get("defaultSystemPrompt", """你是一个人工智能助手，擅长使用工具解决问题，请用中文回答用户的问题。
    
你的回答将被渲染为Markdown格式，因此你可以：
- 使用**加粗**或*斜体*等Markdown语法来强调重要内容
- 使用`代码块`展示代码，并指定语言来启用语法高亮，例如：
```python
def hello():
    print("Hello, world!")
```
- 使用表格、列表、标题等各种Markdown元素来组织信息
- 插入超链接：[链接文本](URL)

请充分利用这些格式来提供清晰、结构化的回答。
""")
    except Exception as e:
        logger.warning(f"读取配置文件中的系统提示符时出错: {str(e)}，使用默认提示符")
        system_prompt = """你是一个人工智能助手，擅长使用工具解决问题，请用中文回答用户的问题。
    
你的回答将被渲染为Markdown格式，因此你可以：
- 使用**加粗**或*斜体*等Markdown语法来强调重要内容
- 使用`代码块`展示代码，并指定语言来启用语法高亮，例如：
```python
def hello():
    print("Hello, world!")
```
- 使用表格、列表、标题等各种Markdown元素来组织信息
- 插入超链接：[链接文本](URL)

请充分利用这些格式来提供清晰、结构化的回答。
"""

    # 创建Agent
    agent = Agent(model, mcp_servers=mcp_servers,
                  system_prompt=system_prompt, model_settings=model_settings)

    # 启动MCP服务器
    await mcp_stack.enter_async_context(agent.run_mcp_servers())
    logger.info("Agent和MCP服务器已初始化")


@app.on_event("startup")
async def startup_event():
    """应用启动时的事件处理"""
    await initialize_agent()


@app.on_event("shutdown")
async def shutdown_event():
    """应用关闭时的事件处理"""
    await mcp_stack.aclose()
    logger.info("已关闭所有MCP服务器")


# 后台重启Agent任务，带有状态更新
async def restart_agent_task_with_status(update_id: str):
    """在后台重启Agent和MCP服务器的任务，并更新状态"""
    global agent, mcp_stack, agent_restart_required, model_settings, mcp_config, config_update_status

    try:
        # 重置标志
        agent_restart_required = False

        # 更新状态到"正在关闭旧服务"
        if config_update_status.get("update_id") == update_id:
            config_update_status = {
                "updating": True,
                "last_update_time": datetime.now(),
                "success": None,
                "message": "正在关闭现有MCP服务器...",
                "update_id": update_id
            }

        # 先保存旧的stack引用，然后创建新的stack
        old_stack = mcp_stack
        mcp_stack = AsyncExitStack()

        # 先安全地关闭旧的stack
        try:
            logger.info("开始关闭旧的MCP服务器...")
            await old_stack.aclose()
            logger.info("旧的MCP服务器已成功关闭")
        except Exception as e:
            logger.warning(f"关闭旧MCP服务器时出错(可以忽略): {str(e)}")
            # 等待一段时间，确保资源被释放
            await asyncio.sleep(2)

        # 更新状态为"正在创建新服务"
        if config_update_status.get("update_id") == update_id:
            config_update_status = {
                "updating": True,
                "last_update_time": datetime.now(),
                "success": None,
                "message": "正在创建新的MCP服务器...",
                "update_id": update_id
            }

        # 创建新Agent实例
        try:
            # 创建模型
            model = OpenAIModel(
                os.getenv("MCP_LLM_API_MODEL_NAME"),
                provider=OpenAIProvider(
                    base_url=os.getenv("MCP_LLM_API_BASE_URL"),
                    api_key=os.getenv("MCP_LLM_API_KEY")
                ),
            )

            # 从配置文件加载系统提示符
            try:
                with open(MCP_CONFIG_PATH, "r", encoding="utf-8") as f:
                    mcp_config = json.load(f)
                    system_prompt = mcp_config.get("defaultSystemPrompt", """你是一个人工智能助手，擅长使用工具解决问题，请用中文回答用户的问题。
            
你的回答将被渲染为Markdown格式，因此你可以：
- 使用**加粗**或*斜体*等Markdown语法来强调重要内容
- 使用`代码块`展示代码，并指定语言来启用语法高亮，例如：
```python
def hello():
    print("Hello, world!")
```
- 使用表格、列表、标题等各种Markdown元素来组织信息
- 插入超链接：[链接文本](URL)

请充分利用这些格式来提供清晰、结构化的回答。
""")
            except Exception as e:
                logger.warning(f"读取配置文件中的系统提示符时出错: {str(e)}，使用默认提示符")
                system_prompt = """你是一个人工智能助手，擅长使用工具解决问题，请用中文回答用户的问题。
            
你的回答将被渲染为Markdown格式，因此你可以：
- 使用**加粗**或*斜体*等Markdown语法来强调重要内容
- 使用`代码块`展示代码，并指定语言来启用语法高亮，例如：
```python
def hello():
    print("Hello, world!")
```
- 使用表格、列表、标题等各种Markdown元素来组织信息
- 插入超链接：[链接文本](URL)

请充分利用这些格式来提供清晰、结构化的回答。
"""

            # 更新状态为"正在加载MCP服务器"
            if config_update_status.get("update_id") == update_id:
                config_update_status = {
                    "updating": True,
                    "last_update_time": datetime.now(),
                    "success": None,
                    "message": "正在加载MCP服务器...",
                    "update_id": update_id
                }

            # 加载MCP服务器
            mcp_servers = load_mcp_servers_from_config()
            logger.info(f"已加载 {len(mcp_servers)} 个MCP服务器配置")

            # 更新状态为"正在启动服务"
            if config_update_status.get("update_id") == update_id:
                config_update_status = {
                    "updating": True,
                    "last_update_time": datetime.now(),
                    "success": None,
                    "message": "正在启动服务器...",
                    "update_id": update_id
                }

            # 创建新Agent
            new_agent = Agent(model, mcp_servers=mcp_servers,
                              system_prompt=system_prompt, model_settings=model_settings)

            # 启动新的MCP服务器
            await mcp_stack.enter_async_context(new_agent.run_mcp_servers())

            # 等待一段时间，确保服务器完全启动
            await asyncio.sleep(2)

            # 更新全局agent引用
            agent = new_agent
            logger.info("已重启Agent和MCP服务器")

            # 更新成功状态，确保只在updateID匹配时更新状态
            if config_update_status.get("update_id") == update_id:
                config_update_status = {
                    "updating": False,
                    "last_update_time": datetime.now(),
                    "success": True,
                    "message": "配置更新并重启成功",
                    "update_id": update_id
                }

        except Exception as e:
            logger.error(f"创建新Agent时发生错误: {str(e)}")
            agent_restart_required = True  # 标记需要再次尝试重启

            # 更新失败状态，确保只在updateID匹配时更新状态
            if config_update_status.get("update_id") == update_id:
                config_update_status = {
                    "updating": False,
                    "last_update_time": datetime.now(),
                    "success": False,
                    "message": f"创建新Agent时发生错误: {str(e)}",
                    "update_id": update_id
                }

    except Exception as e:
        logger.error(f"重启Agent时发生错误: {str(e)}")
        agent_restart_required = True  # 标记需要再次尝试重启

        # 更新失败状态，确保只在updateID匹配时更新状态
        if config_update_status.get("update_id") == update_id:
            config_update_status = {
                "updating": False,
                "last_update_time": datetime.now(),
                "success": False,
                "message": f"重启Agent时发生错误: {str(e)}",
                "update_id": update_id
            }


# 为了向前兼容保留的函数
async def restart_agent_task():
    """向前兼容的Agent重启函数"""
    global config_update_status
    # 生成一个临时ID并调用带状态的重启函数
    temp_id = str(uuid.uuid4())
    await restart_agent_task_with_status(temp_id)


@app.post("/api/query", response_model=QueryResponse)
async def query(request: QueryRequest) -> QueryResponse:
    """
    处理用户查询

    Args:
        request: 包含查询内容的请求

    Returns:
        查询结果
    """
    global agent, agent_restart_required, model_settings, conversation_history, mcp_config, config_update_status

    # 检查是否正在更新配置
    if config_update_status.get("updating"):
        raise HTTPException(
            status_code=503,
            detail="服务器正在更新配置并重启中，请稍后再试"
        )

    # 检查是否需要重启
    if agent_restart_required:
        await restart_agent_task_with_status(config_update_status.get("update_id"))
        if agent_restart_required:  # 如果重启失败
            raise HTTPException(status_code=503, detail="系统正在重启中，请稍后再试")

    if not agent:
        raise HTTPException(status_code=500, detail="Agent未初始化")

    # 处理会话ID
    conversation_id = request.conversation_id
    if not conversation_id or conversation_id not in conversation_history:
        # 如果没有提供ID或ID无效，创建新会话
        now = datetime.now()
        conversation_id = str(uuid.uuid4())
        conversation = Conversation(
            id=conversation_id,
            title=f"新对话 {now.strftime('%Y-%m-%d %H:%M')}"
        )
        conversation_history[conversation_id] = conversation

    # 获取历史消息
    message_history = []
    if request.history_turns > 0:
        # 复制最近N轮对话（每轮包含用户和助手的消息）
        messages = conversation_history[conversation_id].messages
        turns_count = min(request.history_turns, len(
            messages) // 2)  # 每轮包含用户和助手两条消息
        if turns_count > 0:
            # 获取最近的N轮对话
            recent_messages = messages[-turns_count*2:]
            for msg in recent_messages:
                # 转换为PydanticAI消息格式
                if msg.role == "user":
                    message_history.append(ModelRequest(
                        parts=[UserPromptPart(msg.content)]))
                elif msg.role == "assistant":
                    message_history.append(ModelResponse(
                        parts=[TextPart(msg.content)]))

    # 处理系统提示符
    system_prompt = None
    if request.use_default_system_prompt:
        # 从配置文件中获取系统提示符
        try:
            if not mcp_config:
                with open(MCP_CONFIG_PATH, "r", encoding="utf-8") as f:
                    mcp_config = json.load(f)
            system_prompt = mcp_config.get("defaultSystemPrompt")
        except Exception as e:
            logger.warning(f"读取配置文件中的系统提示符时出错: {str(e)}，使用默认提示符")

    # 如果配置文件中没有系统提示符或出错，使用请求中的系统提示符
    if not system_prompt:
        system_prompt = request.system_prompt

    try:
        # 执行查询，添加系统提示符
        run_kwargs = {
            "model_settings": model_settings,
            "message_history": message_history if message_history else None
        }

        # 如果有系统提示符，添加到参数中
        if system_prompt:
            run_kwargs["system_prompt"] = system_prompt

        result = await agent.run(
            request.query,
            **run_kwargs
        )

        # 添加用户消息到历史
        conversation_history[conversation_id].messages.append(
            ChatMessage(role="user", content=request.query)
        )

        # 添加助手回复到历史
        conversation_history[conversation_id].messages.append(
            ChatMessage(role="assistant", content=result.output)
        )

        # 更新对话的最后修改时间
        conversation_history[conversation_id].updated_at = datetime.now()

        # 如果还没有设置标题，使用第一个用户问题作为标题
        if conversation_history[conversation_id].title.startswith("新对话") and len(conversation_history[conversation_id].messages) == 2:
            # 截断标题，保持在合理长度
            title = request.query[:30] + \
                "..." if len(request.query) > 30 else request.query
            conversation_history[conversation_id].title = title

        print(result.output)
        print(result.usage())
        # 返回结果
        usage_data = None
        if hasattr(result, "usage"):
            try:
                usage_obj = result.usage()
                if hasattr(usage_obj, "dict"):
                    usage_data = usage_obj.dict()
                elif hasattr(usage_obj, "__dict__"):
                    usage_data = usage_obj.__dict__
                else:
                    usage_data = dict(usage_obj)
            except Exception as e:
                logger.warning(f"处理usage数据时出错: {str(e)}")

        return QueryResponse(
            answer=result.output,
            conversation_id=conversation_id,
            usage=usage_data
        )
    except Exception as e:
        logger.error(f"处理查询时发生错误: {str(e)}")
        raise HTTPException(status_code=500, detail=f"处理查询时发生错误: {str(e)}")


@app.post("/api/stream")
async def query_stream(request: QueryRequest):
    """
    处理用户查询并以流式方式返回结果

    Args:
        request: 包含查询内容的请求

    Returns:
        流式响应
    """
    global agent, agent_restart_required, model_settings, conversation_history, mcp_config, config_update_status

    # 检查是否正在更新配置
    if config_update_status.get("updating"):
        raise HTTPException(
            status_code=503,
            detail="服务器正在更新配置并重启中，请稍后再试"
        )

    # 检查是否需要重启
    if agent_restart_required:
        await restart_agent_task_with_status(config_update_status.get("update_id"))
        if agent_restart_required:  # 如果重启失败
            raise HTTPException(status_code=503, detail="系统正在重启中，请稍后再试")

    if not agent:
        raise HTTPException(status_code=500, detail="Agent未初始化")

    # 处理会话ID
    conversation_id = request.conversation_id
    if not conversation_id or conversation_id not in conversation_history:
        # 如果没有提供ID或ID无效，创建新会话
        now = datetime.now()
        conversation_id = str(uuid.uuid4())
        conversation = Conversation(
            id=conversation_id,
            title=f"新对话 {now.strftime('%Y-%m-%d %H:%M')}"
        )
        conversation_history[conversation_id] = conversation

    # 添加用户消息到历史
    conversation_history[conversation_id].messages.append(
        ChatMessage(role="user", content=request.query)
    )

    # 获取历史消息
    message_history = []
    if request.history_turns > 0:
        # 复制最近N轮对话（不包括刚添加的用户消息）
        # 排除最新的用户消息
        messages = conversation_history[conversation_id].messages[:-1]
        turns_count = min(request.history_turns, len(
            messages) // 2)  # 每轮包含用户和助手两条消息
        if turns_count > 0:
            # 获取最近的N轮对话
            recent_messages = messages[-turns_count*2:]
            for msg in recent_messages:
                # 转换为PydanticAI消息格式
                if msg.role == "user":
                    message_history.append(ModelRequest(
                        parts=[UserPromptPart(msg.content)]))
                elif msg.role == "assistant":
                    message_history.append(ModelResponse(
                        parts=[TextPart(msg.content)]))

    # 处理系统提示符
    system_prompt = None
    if request.use_default_system_prompt:
        # 从配置文件中获取系统提示符
        try:
            if not mcp_config:
                with open(MCP_CONFIG_PATH, "r", encoding="utf-8") as f:
                    mcp_config = json.load(f)
            system_prompt = mcp_config.get("defaultSystemPrompt")
        except Exception as e:
            logger.warning(f"读取配置文件中的系统提示符时出错: {str(e)}，使用默认提示符")

    # 如果配置文件中没有系统提示符或出错，使用请求中的系统提示符
    if not system_prompt:
        system_prompt = request.system_prompt

    # 完整响应内容
    full_response = ""

    # 定义流式生成器
    async def generate_stream():
        nonlocal full_response

        try:
            # 使用run_stream方法进行流式生成
            logger.info(f"开始流式生成回复，查询: {request.query}")

            # 发送开始标记和会话ID
            yield json.dumps({"type": "start", "conversation_id": conversation_id}) + "\n"

            # 准备运行参数
            run_kwargs = {
                "model_settings": model_settings,
                "message_history": message_history if message_history else None
            }

            # 如果有系统提示符，添加到参数中
            if system_prompt:
                run_kwargs["system_prompt"] = system_prompt

            # 使用iter方法和节点迭代器模式进行流式输出
            logger.info(f"消息历史: {message_history}")  # 记录消息历史以便调试
            async with agent.iter(request.query, **run_kwargs) as run:
                async for node in run:
                    logger.info(f"处理节点类型: {type(node).__name__}")
                    try:
                        if agent.is_model_request_node(node):
                            # 对于模型请求节点，我们可以流式输出模型生成的消息
                            logger.info(f"处理模型请求节点: {node}")
                            async with node.stream(run.ctx) as request_stream:
                                async for event in request_stream:
                                    if hasattr(event, 'delta') and hasattr(event.delta, 'content_delta'):
                                        content = event.delta.content_delta
                                        if content:
                                            full_response += content
                                            yield json.dumps({"type": "content", "content": content}) + "\n"
                        elif agent.is_call_tools_node:
                            logger.info(f"处理工具调用节点: {node}")
                            async with node.stream(run.ctx) as handle_stream:
                                async for event in handle_stream:
                                    if isinstance(event, FunctionToolCallEvent):
                                        yield json.dumps({
                                            "type": "tool_call",
                                            "tool_name": event.part.tool_name,
                                            "args": event.part.args,
                                            "tool_call_id": event.part.tool_call_id
                                        }) + "\n"
                                    elif isinstance(event, FunctionToolResultEvent):
                                        yield json.dumps({
                                            "type": "tool_result",
                                            "tool_call_id": event.tool_call_id,
                                            "result": event.result.content
                                        }) + "\n"
                        elif agent.is_end_node(node):
                            # 当到达结束节点时，我们可以获取最终结果
                            logger.info(f"处理结束节点: {node}")
                            final_result = run.result.output if hasattr(
                                run, 'result') and hasattr(run.result, 'output') else ""
                            if final_result and final_result != full_response:
                                full_response = final_result
                                yield json.dumps({"type": "final", "content": final_result}) + "\n"
                        else:
                            # 记录其他类型的节点
                            logger.info(
                                f"未处理的节点类型: {type(node).__name__}, 内容: {node}")
                    except Exception as inner_e:
                        logger.error(
                            f"处理节点时发生错误: {str(inner_e)}, 节点类型: {type(node).__name__}, 节点内容: {node}")
                        # 继续处理下一个节点，不中断整个流程
                        continue

            # 发送完成标记
            yield json.dumps({"type": "end"}) + "\n"

        except Exception as e:
            import traceback
            logger.error(f"流式生成过程中发生错误: {str(e)}")
            logger.error(f"错误详情: {traceback.format_exc()}")
            # 发送错误信息
            yield json.dumps({"type": "error", "error": str(e)}) + "\n"
        finally:
            # 无论成功还是失败，都确保更新会话历史
            try:
                # 如果响应不为空，则添加到会话历史
                if full_response:
                    # 将完整的响应添加到对话历史
                    conversation_history[conversation_id].messages.append(
                        ChatMessage(role="assistant", content=full_response)
                    )

                    # 更新对话的最后修改时间
                    conversation_history[conversation_id].updated_at = datetime.now(
                    )

                    # 如果还没有设置标题，使用第一个用户问题作为标题
                    if conversation_history[conversation_id].title.startswith("新对话") and len(conversation_history[conversation_id].messages) == 2:
                        # 截断标题，保持在合理长度
                        title = request.query[:30] + \
                            "..." if len(request.query) > 30 else request.query
                        conversation_history[conversation_id].title = title
            except Exception as hist_error:
                logger.error(f"更新会话历史时出错: {str(hist_error)}")

            logger.info("流式生成回复完成或中断")

    # 返回流式响应
    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream"
    )


@app.post("/api/config/update", response_model=ConfigUpdateResponse)
async def update_config(request: ConfigUpdateRequest, background_tasks: BackgroundTasks) -> ConfigUpdateResponse:
    """
    更新MCP服务器配置

    Args:
        request: 包含新配置的请求
        background_tasks: 后台任务管理器

    Returns:
        更新结果
    """
    global mcp_config, agent_restart_required, config_update_status

    try:
        # 验证配置格式
        if "mcpServers" not in request.config:
            return ConfigUpdateResponse(
                success=False,
                message="配置格式错误：缺少mcpServers字段"
            )

        # 设置更新状态
        update_id = str(uuid.uuid4())
        config_update_status = {
            "updating": True,
            "last_update_time": datetime.now(),
            "success": None,
            "message": "配置更新进行中...",
            "update_id": update_id
        }

        # 保存配置到文件
        with open(MCP_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(request.config, f, ensure_ascii=False, indent=4)

        # 更新全局配置
        mcp_config = request.config

        # 标记需要重启
        agent_restart_required = True

        # 在后台重启agent
        background_tasks.add_task(restart_agent_task_with_status, update_id)

        return ConfigUpdateResponse(
            success=True,
            message="配置已更新，MCP服务器正在后台重启",
            update_id=update_id
        )
    except Exception as e:
        logger.error(f"更新配置时发生错误: {str(e)}")
        # 更新失败状态
        config_update_status = {
            "updating": False,
            "last_update_time": datetime.now(),
            "success": False,
            "message": f"更新配置时发生错误: {str(e)}",
            "update_id": config_update_status.get("update_id")
        }
        return ConfigUpdateResponse(
            success=False,
            message=f"更新配置时发生错误: {str(e)}"
        )


@app.get("/api/config")
async def get_config():
    """
    获取当前MCP服务器配置

    Returns:
        当前配置
    """
    try:
        # 如果全局配置为空，则从文件加载
        global mcp_config
        if not mcp_config:
            try:
                with open(MCP_CONFIG_PATH, "r", encoding="utf-8") as f:
                    mcp_config = json.load(f)
            except FileNotFoundError:
                mcp_config = {"mcpServers": {}}

        return mcp_config
    except Exception as e:
        logger.error(f"获取配置时发生错误: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取配置时发生错误: {str(e)}")


@app.get("/api/config/status")
async def get_config_update_status():
    """
    获取配置更新状态

    Returns:
        当前配置更新状态
    """
    global config_update_status
    return config_update_status


# 对话管理相关端点
@app.get("/api/conversations", response_model=ConversationListResponse)
async def get_conversations():
    """获取所有对话列表"""
    global conversation_history

    # 按更新时间排序
    sorted_conversations = sorted(
        conversation_history.values(),
        key=lambda x: x.updated_at,
        reverse=True
    )

    return ConversationListResponse(conversations=sorted_conversations)


@app.get("/api/conversations/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(conversation_id: str):
    """获取特定对话"""
    global conversation_history

    if conversation_id not in conversation_history:
        raise HTTPException(status_code=404, detail="对话不存在")

    return ConversationResponse(conversation=conversation_history[conversation_id])


@app.delete("/api/conversations/{conversation_id}", response_model=SuccessResponse)
async def delete_conversation(conversation_id: str):
    """删除特定对话"""
    global conversation_history

    if conversation_id not in conversation_history:
        raise HTTPException(status_code=404, detail="对话不存在")

    del conversation_history[conversation_id]

    return SuccessResponse(success=True, message="对话已删除")


@app.delete("/api/conversations", response_model=SuccessResponse)
async def delete_all_conversations():
    """删除所有对话"""
    global conversation_history

    conversation_history = {}

    return SuccessResponse(success=True, message="所有对话已删除")


@app.post("/api/conversations", response_model=ConversationResponse)
async def create_conversation():
    """创建新对话"""
    global conversation_history

    # 生成唯一ID
    conversation_id = str(uuid.uuid4())

    # 创建新对话
    now = datetime.now()
    conversation = Conversation(
        id=conversation_id,
        title=f"新对话 {now.strftime('%Y-%m-%d %H:%M')}",
        created_at=now,
        updated_at=now
    )

    # 保存到历史记录
    conversation_history[conversation_id] = conversation

    return ConversationResponse(conversation=conversation)


@app.put("/api/conversations/{conversation_id}/title", response_model=ConversationResponse)
async def update_conversation_title(conversation_id: str, request: dict):
    """更新对话标题"""
    global conversation_history

    if conversation_id not in conversation_history:
        raise HTTPException(status_code=404, detail="对话不存在")

    title = request.get("title", "新对话")
    conversation_history[conversation_id].title = title
    conversation_history[conversation_id].updated_at = datetime.now()

    return ConversationResponse(conversation=conversation_history[conversation_id])

# 挂载静态文件
app.mount("/", StaticFiles(directory="static", html=True), name="static")


if __name__ == "__main__":
    # 默认运行在8000端口
    uvicorn.run("web_server:app", host="0.0.0.0", port=8000,
                reload=True, timeout_keep_alive=60)
