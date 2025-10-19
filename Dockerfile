# ============================================
# 12306-MCP-Server Dockerfile
# ============================================
# 多阶段构建，优化镜像大小

# ============================================
# Stage 1: Build
# ============================================
FROM node:18-alpine AS builder

# 设置工作目录
WORKDIR /app

# 安装构建依赖
RUN apk add --no-cache python3 make g++

# 复制依赖文件
COPY package*.json ./
COPY tsconfig.json ./

# 安装依赖（包括开发依赖）
RUN npm ci

# 复制源代码
COPY src ./src

# 构建项目
RUN npm run build

# 移除开发依赖
RUN npm prune --production

# ============================================
# Stage 2: Runtime
# ============================================
FROM node:18-alpine

# 设置环境变量
ENV NODE_ENV=production \
    SESSION_POOL_MIN_SIZE=3 \
    SESSION_POOL_MAX_SIZE=8 \
    LOG_LEVEL=info

# 创建非root用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 设置工作目录
WORKDIR /app

# 从builder阶段复制构建产物
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/build ./build
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# 创建日志目录
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app/logs

# 切换到非root用户
USER nodejs

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 暴露端口
EXPOSE 8080

# 启动命令
CMD ["node", "build/index.js"]

# ============================================
# 构建命令示例
# ============================================
# docker build -t 12306-mcp-server:latest .
# docker build -t 12306-mcp-server:v1.0.0 .

# ============================================
# 运行命令示例
# ============================================
# Stdio模式:
# docker run --rm 12306-mcp-server:latest

# HTTP模式:
# docker run -d -p 8080:8080 \
#   -e SESSION_POOL_MAX_SIZE=10 \
#   -e LOG_LEVEL=debug \
#   --name 12306-mcp \
#   12306-mcp-server:latest

# 使用环境变量文件:
# docker run -d -p 8080:8080 \
#   --env-file .env.production \
#   --name 12306-mcp \
#   12306-mcp-server:latest

# 挂载日志卷:
# docker run -d -p 8080:8080 \
#   -v $(pwd)/logs:/app/logs \
#   --name 12306-mcp \
#   12306-mcp-server:latest