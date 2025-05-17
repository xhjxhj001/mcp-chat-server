#!/bin/bash

# 确保以root权限运行
if [ "$(id -u)" -ne 0 ]; then
    echo "此脚本需要root权限运行，请使用sudo或以root身份运行"
    exit 1
fi

# 打印颜色函数
print_green() {
    echo -e "\033[32m$1\033[0m"
}

print_yellow() {
    echo -e "\033[33m$1\033[0m"
}

print_red() {
    echo -e "\033[31m$1\033[0m"
}

# 显示欢迎信息
print_green "======================================================"
print_green "        MCP-Agent 系统环境一键安装脚本"
print_green "======================================================"
echo ""

# 设置非交互式前端
export DEBIAN_FRONTEND=noninteractive

# 配置使用腾讯云镜像源
print_yellow "正在配置软件源..."
sed -i 's/archive.ubuntu.com/mirrors.cloud.tencent.com/g' /etc/apt/sources.list
sed -i 's/security.ubuntu.com/mirrors.cloud.tencent.com/g' /etc/apt/sources.list

# 更新软件包列表
print_yellow "正在更新软件包列表..."
apt-get update

# 安装Python和基础工具
print_yellow "正在安装Python和基础工具..."
apt-get install -y \
    python3.9 \
    python3-pip \
    python3-venv \
    python3-dev \
    curl \
    gnupg \
    wget \
    bash \
    vim \
    sudo

# 创建Python软链接
print_yellow "正在创建Python软链接..."
ln -sf /usr/bin/python3.9 /usr/bin/python

# 安装Node.js和npm
print_yellow "正在安装Node.js..."
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_18.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y nodejs

# 安装uv工具 - 极速Python包管理器
print_yellow "正在安装uv工具..."
curl -LsSf https://astral.sh/uv/install.sh | sh

# 安装Playwright所需的系统依赖
print_yellow "正在安装Playwright所需的系统依赖..."
apt-get install -y \
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
    fonts-liberation

# 清理apt缓存
print_yellow "正在清理apt缓存..."
apt-get clean
rm -rf /var/lib/apt/lists/*

# 设置工作目录
print_yellow "正在创建工作目录..."
mkdir -p /app
cd /app

# 安装Playwright
print_yellow "正在安装Playwright..."
npm init -y
npm install -D playwright
npx playwright install --with-deps chromium
npx playwright install-deps chromium

# 配置pip使用腾讯云镜像源并安装Python依赖
print_yellow "正在安装Python依赖..."
pip3 install -i https://pypi.tuna.tsinghua.edu.cn/simple pip -U
pip3 install -i https://pypi.tuna.tsinghua.edu.cn/simple fastapi uvicorn python-dotenv pydantic-ai httpx

# 添加uv
print_yellow "正在配置uv..."
curl -LsSf https://astral.sh/uv/install.sh | sh

# 设置环境变量
print_yellow "正在设置环境变量..."
echo 'export PYTHONUNBUFFERED=1' >> /etc/profile
echo 'export PATH="/usr/bin:$PATH"' >> /etc/profile
echo 'export PATH="$HOME/.local/bin:/root/.local/bin:$PATH"' >> /etc/profile
echo 'export PATH="/usr/local/bin:$PATH"' >> /etc/profile

# 确保uvx可以在任何shell中运行
print_yellow "正在配置uvx..."
mkdir -p /usr/local/bin
find /root/.local/bin -name "uv" -exec cp {} /usr/local/bin/ \; 2>/dev/null || true
find /root/.local/bin -name "uvx" -exec cp {} /usr/local/bin/ \; 2>/dev/null || true
find /home/*/.local/bin -name "uv" -exec cp {} /usr/local/bin/ \; 2>/dev/null || true
find /home/*/.local/bin -name "uvx" -exec cp {} /usr/local/bin/ \; 2>/dev/null || true
chmod +x /usr/local/bin/uv /usr/local/bin/uvx 2>/dev/null || true

# 询问是否创建新用户
read -p "是否创建具有sudo权限的新用户? (y/n): " CREATE_USER
if [[ "$CREATE_USER" == "y" || "$CREATE_USER" == "Y" ]]; then
    read -p "请输入用户名: " USERNAME
    read -s -p "请输入密码: " PASSWORD
    echo ""
    
    print_yellow "正在创建用户 $USERNAME..."
    useradd -m -s /bin/bash $USERNAME
    echo "$USERNAME:$PASSWORD" | chpasswd
    adduser $USERNAME sudo
    echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
    print_green "用户 $USERNAME 创建成功!"
fi

# 完成安装
print_green "======================================================"
print_green "        系统环境安装完成!"
print_green "======================================================"
print_yellow "已安装以下组件:"
echo "- Python 3.9"
echo "- Node.js 18.x"
echo "- Playwright 及其依赖"
echo "- uv Python包管理器"
echo "- 各种系统库和工具"
print_yellow "建议执行以下命令使环境变量生效:"
echo "source /etc/profile"
echo ""
print_green "感谢使用MCP-Agent系统环境一键安装脚本!" 