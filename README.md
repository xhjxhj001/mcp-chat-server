# MCP Agent Web 工具

这是一个基于Web的MCP Agent工具，支持在浏览器中与集成了多种工具的AI助手进行对话。通过该工具，你可以方便地使用和测试各种MCP服务。

## 功能特点

- 基于FastAPI的后端API服务
- 响应式Web前端界面
- 支持多种MCP工具服务器集成
- 配置文件支持命令行工具和HTTP服务
- 对话历史保存与管理
- 流式输出支持
- 支持Docker一键部署

## 前置条件

- Python 3.8+
- Node.js 与 npm（用于安装 uvx）
- 支持的大语言模型API（如OpenAI、Claude等）
- 网络连接（用于API调用和MCP服务器通信）

## 详细安装说明

### 1. 安装Python依赖

```bash
# 推荐使用虚拟环境
python -m venv venv
source venv/bin/activate  # Windows上使用: venv\Scripts\activate

# 安装所需Python包
pip install fastapi uvicorn python-dotenv pydantic-ai httpx
```

### 2. 安装uvx环境（用于MCP工具）

uvx是Autoblur提供的用于运行MCP服务的命令行工具，需要通过npm安装：

```bash
# 安装Node.js和npm（如果尚未安装）
# 参考: https://nodejs.org/

# 全局安装uvx工具
npm install -g @autoblurlabs/uvx

# 验证安装
uvx --version
```

### 3. 配置环境变量

创建一个`.env`文件在项目根目录，包含以下内容：

```
MCP_LLM_API_MODEL_NAME=gpt-4-turbo  # 或其他支持的模型
MCP_LLM_API_BASE_URL=https://api.openai.com/v1  # 或其他API基础URL
MCP_LLM_API_KEY=your_api_key_here  # 你的API密钥
```

## 配置MCP服务器

### 1. 创建配置文件

将`mcp_server_config.json.example`复制为`mcp_server_config.json`：

```bash
cp mcp_server_config.json.example mcp_server_config.json
```

### 2. 编辑配置文件

根据你的需求编辑`mcp_server_config.json`文件。该文件包含两种类型的MCP服务器配置：

#### 命令行工具类型

用于配置通过命令行启动的MCP服务器：

```json
"服务器名称": {
    "command": "uvx",  // 执行命令，通常是uvx
    "args": [
        "duckduckgo-mcp-server"  // 要加载的MCP服务器名称
    ],
    "env": {  // 可选：环境变量
        "API_KEY": "your_api_key"
    }
}
```

常见的MCP服务器包括：
- `duckduckgo-mcp-server`: 网络搜索
- `weather-mcp-server`: 天气查询
- `toolbelt-mcp-server`: 实用工具集合
- `wolfram-alpha-mcp-server`: 高级数学计算（需要WolframAlpha API密钥）

#### HTTP服务类型

用于配置通过HTTP连接的MCP服务器：

```json
"服务器名称": {
    "url": "https://example.com/mcp-endpoint"  // MCP服务器的HTTP端点
}
```

示例：百度网盘MCP服务器
```json
"baidu-disk-mcp-server": {
    "url": "https://mcp-pan.baidu.com/sse?access_token=你的百度网盘access_token"
}
```

## 运行Web应用

### 1. 启动服务器

```bash
cd agent/mcp-test-tool/testserver
python web_server.py
```

这将启动一个运行在`http://localhost:8000`的服务器。

### 2. 访问Web界面

在浏览器中打开 http://localhost:8000 即可看到聊天界面。

### 3. 配置界面

点击右上角的"配置"标签，可以查看和编辑MCP服务器配置。修改配置后点击"更新配置"按钮，服务器将自动重启并应用新配置。

## Docker部署

本项目支持通过Docker一键部署，无需手动安装依赖。Docker镜像包含了以下组件：

- Python 3.9 环境
- Node.js 和 npm
- uvx 工具（MCP服务）
- Playwright 浏览器自动化工具（包含Chromium浏览器）
- 所有必要的Python依赖

### 1. 构建Docker镜像

在项目根目录下执行：

```bash
cd agent/mcp-test-tool/testserver
docker build -t mcp-agent-web .
```

### 2. 运行Docker容器

```bash
# 创建.env文件
cat > .env << EOF
MCP_LLM_API_MODEL_NAME=你的模型名称
MCP_LLM_API_BASE_URL=你的API基础URL
MCP_LLM_API_KEY=你的API密钥
EOF

# 启动容器
docker run -d \
  --name mcp-agent \
  -p 8000:8000 \
  --env-file .env \
  -v $(pwd)/mcp_server_config.json:/app/mcp_server_config.json \
  mcp-agent-web
```

### 3. 使用docker-compose部署（推荐）

项目提供了`docker-compose.yml`配置文件，可以更简单地进行部署：

```bash
# 创建.env文件
cat > .env << EOF
MCP_LLM_API_MODEL_NAME=你的模型名称
MCP_LLM_API_BASE_URL=你的API基础URL
MCP_LLM_API_KEY=你的API密钥
EOF

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f
```

要停止服务，使用：

```bash
docker-compose down
```

### 4. 访问Web界面

在浏览器中打开 http://localhost:8000 即可使用。

## 使用指南

### 基本使用

1. 在输入框中输入问题并按回车或点击发送按钮
2. 默认启用流式输出，可点击左下角的流式输出开关切换模式
3. 在右上角可以选择历史轮数，决定在当前对话中保留多少轮历史上下文

### 对话管理

- 左侧栏显示所有对话记录
- 点击"新对话"按钮开始新的对话
- 点击对话标题可切换到对应对话
- 通过编辑按钮可修改对话标题
- 通过删除按钮可删除单个对话
- 点击"清空所有对话"可删除所有对话记录

## 故障排除

### 服务器无法启动

- 检查Python依赖是否正确安装
- 确认环境变量配置正确
- 检查端口8000是否被占用，如被占用可在`web_server.py`最后修改端口号

### MCP工具不可用

- 确认uvx正确安装并可在命令行中使用
- 检查`mcp_server_config.json`配置是否正确
- 查看服务器日志中是否有错误信息
- 对于HTTP类型的MCP服务，确认URL和access_token正确

### Docker相关问题

- 确保Docker服务正在运行
- 检查容器日志：`docker logs mcp-agent`
- 如果出现权限问题，确保卷挂载的目录有正确的权限
- 若端口被占用，更改映射端口：`-p 8080:8000`（使用8080替代8000）

### API调用失败

- 确认API密钥配置正确
- 检查网络连接是否正常
- 查看服务器日志中的错误详情

## 开发和扩展

如需添加新的MCP服务器或自定义功能，请参考以下步骤：

1. 通过配置文件添加新的MCP服务器
2. 重启服务器以应用更改
3. 前端代码位于`static/`目录，可以根据需要进行定制

欢迎贡献代码和提交问题报告！

## 项目结构

- `web_server.py` - FastAPI后端服务
- `client.py` - 命令行客户端（单独使用）
- `static/` - 前端静态文件
  - `index.html` - 主页面
  - `styles.css` - 样式文件
  - `script.js` - 前端交互脚本
- `mcp_server_config.json` - MCP服务器配置
- `Dockerfile` - Docker部署配置（集成Playwright环境）
- `docker-compose.yml` - Docker Compose配置文件
- `.dockerignore` - Docker构建排除文件列表

## 使用方法

1. 启动Web服务器
2. 打开浏览器访问 http://localhost:8000
3. 在输入框中输入问题并发送
4. 系统会调用配置的MCP工具服务并返回结果 