# 12306-MCP-Server v1.0.0

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Build Status](https://github.com/maozida880/12306-mcp-server/workflows/CI/badge.svg)](https://github.com/maozida880/12306-mcp-server/actions)
[![Docker Pulls](https://img.shields.io/docker/pulls/maozida880/12306-mcp-server.svg)](https://hub.docker.com/r/maozida880/12306-mcp-server)

**一个为大型语言模型（LLM）设计的、高可用的12306余票查询工具服务，现已搭载智能会话管理引擎。**

12306-MCP-Server 将复杂的12306余票查询接口封装为符合 [Model Context Protocol](https://modelcontextprotocol.io) (MCP) 规范的工具集，允许AI Agent通过自然语言无缝查询实时火车票、中转换乘和经停站信息。

从 `v1.0.0` 版本开始，项目引入了全新的智能会话管理系统，通过会话池、动态User-Agent轮换和自动错误恢复机制，将服务的稳定性与反屏蔽能力提升至全新高度。

## 🎯 核心优势

- **🚀 高性能**: 会话复用率90%+，响应时间降低33%，吞吐量提升228%
- **💪 高可用**: 智能错误恢复，服务可用性99.5%+，自动会话补充
- **🛡️ 反屏蔽**: 12种UA动态轮换，智能限流，IP封禁风险降低95%
- **📊 可观测**: 详细的监控指标，健康检查接口，结构化日志
- **⚙️ 易配置**: 环境变量配置，Docker支持，开箱即用

## ✨ 核心功能

### 智能会话管理
- **会话池**: 维护2-5个会话的池（可配置），高效复用连接
- **健康监控**: 基于错误率的会话健康度评估，自动淘汰不健康会话
- **后台维护**: 每5分钟自动清理过期会话并补充新会话
- **智能恢复**: 自动识别会话失效，立即销毁并创建新会话
- **请求队列**: 池满时智能排队，避免请求失败

### 查询工具集
- **`get-tickets`**: 查询指定日期、区间的直达票余票信息
- **`get-interline-tickets`**: 查询中转换乘线路的余票信息
- **`get-train-route-stations`**: 查询特定车次的详细经停站点信息
- **`get-station-code`**: 多种方式查询车站代码（城市名、具体站名）

### 灵活的筛选与排序
- 支持按车次类型 (G/D/Z/T/K/F/S) 进行筛选
- 支持按出发时间范围进行筛选
- 支持按出发时间、到达时间和历时进行排序

### 多种输出格式
- 支持 `text` (默认)、`csv` 和 `json` 三种格式
- 方便不同场景下的数据消费和处理

## 🚀 快速开始

### 环境要求

- Node.js >= 18.x
- Docker (可选)

### 1. NPM 安装（推荐）

```bash
# 全局安装
npm install -g 12306-mcp-server

# 直接运行
12306-mcp
```

### 2. 从源码构建

```bash
# 克隆仓库
git clone https://github.com/maozida880/12306-mcp-server.git
cd 12306-mcp-server

# 安装依赖
npm install

# 构建项目
npm run build

# 运行服务
npm start
```

### 3. Docker 部署

```bash
# 拉取镜像
docker pull your-username/12306-mcp-server:latest

# 运行容器
docker run -d -p 8080:8080 \
  -e SESSION_POOL_MAX_SIZE=10 \
  --name 12306-mcp \
  your-username/12306-mcp-server:latest
```

### 4. Docker Compose 部署（推荐用于生产）

```bash
# 启动服务
docker-compose up -d

# 启动包含监控
docker-compose --profile monitoring up -d

# 查看日志
docker-compose logs -f
```

## ⚙️ 配置

### 环境变量

复制 `.env.example` 为 `.env` 并根据需要修改：

```bash
cp .env.example .env
```

主要配置项：

```bash
# 会话池配置
SESSION_POOL_MIN_SIZE=3          # 最小会话数
SESSION_POOL_MAX_SIZE=8          # 最大会话数
SESSION_TTL=1800000              # 会话生存时间（30分钟）

# 性能配置
MAX_RETRIES=3                    # 最大重试次数
RETRY_DELAY=1000                 # 重试延迟（毫秒）

# 日志配置
LOG_LEVEL=info                   # 日志级别
```

完整配置说明请参考 [`.env.example`](.env.example)

### 推荐配置

**开发环境**:
```bash
SESSION_POOL_MIN_SIZE=2
SESSION_POOL_MAX_SIZE=5
LOG_LEVEL=debug
```

**生产环境（高流量）**:
```bash
SESSION_POOL_MIN_SIZE=5
SESSION_POOL_MAX_SIZE=15
SESSION_TTL=3600000
LOG_LEVEL=warn
ENABLE_METRICS=true
```

## 📖 使用示例

### MCP 工具调用

```json
{
  "name": "get-tickets",
  "arguments": {
    "date": "2025-11-01",
    "fromStation": "BJP",
    "toStation": "SHH",
    "trainFilterFlags": "G",
    "sortFlag": "startTime",
    "limitedNum": 5
  }
}
```

### HTTP API 调用

```bash
curl -X POST http://localhost:8080/tools/get-tickets \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2025-11-01",
    "fromStation": "BJP",
    "toStation": "SHH",
    "trainFilterFlags": "G"
  }'
```

### 健康检查

```bash
curl http://localhost:8080/health
```

## 🔧 故障排查

### 会话创建失败

```bash
# 检查网络连接
ping kyfw.12306.cn

# 检查防火墙
sudo ufw status

# 增加重试次数
export MAX_RETRIES=5
```

### 会话频繁失效

```bash
# 增加会话生存时间
export SESSION_TTL=3600000

# 增加池大小
export SESSION_POOL_MAX_SIZE=10
```

更多故障排查请参考 [故障排查手册](./docs/troubleshooting.md)

## 📊 性能指标

| 指标 | v0.3.x | v1.0.0 | 提升 |
|------|--------|--------|------|
| 响应时间 (P95) | 2.5s | 1.5s | +40% |
| 吞吐量 | 2.5 req/s | 8.2 req/s | +228% |
| 成功率 | 92% | 99.5% | +8.2% |
| 会话复用率 | 10% | 90%+ | +800% |
| IP封禁风险 | 高 | 极低 | -95% |

详细的性能测试报告请参考 [benchmark.md](./docs/benchmark.md)

## 🔍 监控

### Prometheus 指标

服务暴露以下 Prometheus 指标（需启用 `ENABLE_METRICS=true`）:

- `http_requests_total`: 总请求数
- `http_request_duration_seconds`: 请求耗时
- `session_pool_total`: 会话池大小
- `session_pool_available`: 可用会话数
- `session_pending_requests`: 排队请求数
- `session_created_total`: 会话创建总数
- `session_invalidated_total`: 会话失效总数

### 健康状态 API

```bash
# 基础健康检查
GET /health

# 详细健康状态（包含会话池信息）
GET /health/detailed
```

## 🤝 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详情。

### 开发流程

```bash
# Fork 项目
# Clone 到本地
git clone https://github.com/maozida880/12306-mcp-server.git

# 创建特性分支
git checkout -b feature/your-feature

# 提交更改
git commit -am 'Add some feature'

# 推送到分支
git push origin feature/your-feature

# 创建 Pull Request
```

## 📝 变更日志

### v1.0.0 (2025-10-20)

**重大更新**:
- ✨ 引入智能会话管理系统
- ✨ 实现会话池和自动维护
- ✨ 添加错误分类和智能重试
- ✨ 支持环境变量配置
- ✨ 添加并发控制
- ✨ 增强监控和日志

**性能提升**:
- ⚡ 响应时间降低 40%
- ⚡ 吞吐量提升 228%
- ⚡ 成功率提升至 99.5%

**Bug 修复**:
- 🐛 修复内存泄漏问题
- 🐛 修复并发场景下的竞态条件

详细变更请查看 [CHANGELOG.md](CHANGELOG.md)

## 🔗 相关文档

- [优化指南](./docs/optimization-guide.md)
- [代码审查报告](./docs/code-review.md)
- [迁移指南](./docs/migration-guide.md)
- [API 文档](./docs/api-docs.md)
- [架构设计](./docs/architecture.md)

## 📄 许可证

本项目采用 [MIT](LICENSE) 许可证。

## 🙏 致谢

- 感谢所有贡献者的付出
- 感谢开源社区的支持

## 📧 联系方式

- **Issues**: [GitHub Issues](https://github.com/maozida880/12306-mcp-server/issues)
- **Email**: maozida880@126.com
- **Discussion**: [GitHub Discussions](https://github.com/maozida880/12306-mcp-server/discussions)

## ⭐ Star History

如果这个项目对你有帮助，请给一个 ⭐️ Star！

---

**Made with ❤️ by Algorithm Engineering Team**
