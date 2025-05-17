FROM ccr.ccs.tencentyun.com/library/ubuntu:22.04

# 设置非交互式前端
ENV DEBIAN_FRONTEND=noninteractive

# 配置使用腾讯云镜像源
RUN sed -i 's/archive.ubuntu.com/mirrors.cloud.tencent.com/g' /etc/apt/sources.list && \
    sed -i 's/security.ubuntu.com/mirrors.cloud.tencent.com/g' /etc/apt/sources.list

# 安装Python和基础工具
RUN apt-get update && apt-get install -y \
    python3.9 \
    python3-pip \
    python3-venv \
    python3-dev \
    curl \
    gnupg \
    wget \
    bash \
    vim \
    sudo \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 创建具有sudo权限的用户
RUN useradd -m -s /bin/bash mcpuser && \
    echo "mcpuser:mcpuser" | chpasswd && \
    adduser mcpuser sudo && \
    echo "mcpuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# 创建Python软链接
RUN ln -s /usr/bin/python3.9 /usr/bin/python

# 安装Node.js和npm (官方源)
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_18.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 安装uv工具 - 极速Python包管理器
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# 安装Playwright所需的系统依赖
RUN apt-get update && apt-get install -y \
    libwoff1 \
    libopus0 \
    libwebpdemux2 \
    libgudev-1.0-0 \
    libsecret-1-0 \
    libhyphen0 \
    libgdk-pixbuf2.0-0 \
    libegl1 \
    libnotify4 \
    libxslt1.1 \
    libevent-2.1-7 \
    libgles2 \
    libxcomposite1 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libepoxy0 \
    libgtk-3-0 \
    libharfbuzz-icu0 \
    libxcb-dri3-0 \
    libdbus-glib-1-2 \
    libdrm2 \
    libxkbcommon0 \
    libxss1 \
    libnss3 \
    libcups2 \
    libatspi2.0-0 \
    libxrandr2 \
    libgbm1 \
    xvfb \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    fonts-liberation \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 安装Playwright
RUN npm init -y \
    && npm install -D playwright \
    && npx playwright install --with-deps chromium \
    && npx playwright install-deps chromium

# 配置pip使用腾讯云镜像源并安装Python依赖
RUN pip3 install fastapi uvicorn python-dotenv pydantic-ai httpx -i https://pypi.tuna.tsinghua.edu.cn/simple

# 添加uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# 设置环境变量
ENV PYTHONUNBUFFERED=1

# 暴露端口
EXPOSE 8000

# 确保python命令可用
RUN which python3 && ls -la /usr/bin/python3
ENV PATH="/usr/bin:${PATH}"

# 设置容器用户为mcpuser
USER mcpuser

# 确保uv在PATH中
ENV PATH="$HOME/.local/bin:/root/.local/bin:$PATH"

# 最后添加命令，确保uvx可以在任何shell中运行
USER root
RUN mkdir -p /usr/local/bin && \
    find /root/.local/bin -name "uv" -exec cp {} /usr/local/bin/ \; 2>/dev/null || true && \
    find /root/.local/bin -name "uvx" -exec cp {} /usr/local/bin/ \; 2>/dev/null || true && \
    find /home/mcpuser/.local/bin -name "uv" -exec cp {} /usr/local/bin/ \; 2>/dev/null || true && \
    find /home/mcpuser/.local/bin -name "uvx" -exec cp {} /usr/local/bin/ \; 2>/dev/null || true && \
    chmod +x /usr/local/bin/uv /usr/local/bin/uvx 2>/dev/null || true

# 切回mcpuser用户并设置环境变量
USER mcpuser
ENV PATH="/usr/local/bin:$PATH"

# 设置容器启动点，但不指定任何具体命令，让docker-compose.yml来指定
CMD ["python3", "web_server.py"]