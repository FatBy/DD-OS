# DD-OS Docker 镜像
# 包含 Node.js + Python 运行环境，一键启动前后端

FROM node:20-slim

# 安装 Python 和依赖
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 创建 Python 虚拟环境（避免依赖冲突）
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# 安装 Python 依赖
RUN pip install --no-cache-dir \
    pyyaml \
    playwright

# 安装 Playwright 浏览器（可选，用于 browser-automation）
RUN playwright install chromium --with-deps || true

# 设置工作目录
WORKDIR /app

# 复制 package.json 并安装依赖（利用 Docker 缓存）
COPY package*.json ./
RUN npm install

# 复制项目文件
COPY . .

# 构建前端
RUN npm run build

# 创建数据目录
RUN mkdir -p /root/.ddos

# 暴露端口
# 3001 - Python 后端
# 5173 - Vite 开发服务器（可选）
# 4173 - Vite 预览服务器
EXPOSE 3001 5173 4173

# 启动脚本
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
