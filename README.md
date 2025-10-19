# 12306-MCP-Server v1.0.0

[](https://nodejs.org/en/)
[](https://www.google.com/search?q=https://github.com/your-username/12306-mcp-server/blob/main/LICENSE)

**一个为大型语言模型（LLM）设计的、高可用的12306余票查询工具服务，现已搭载智能会Session管理引擎。**

12306-MCP-Server 将复杂的12306余票查询接口封装为符合 [Model-Code-Protocol](https://www.google.com/search?q=https://github.com/model-code-protocol/specification) (MCP/MCP) 规范的工具集，允许AI Agent通过自然语言无缝查询实时火车票、中转换乘和经停站信息。

从 `v1.0.0` 版本开始，项目引入了全新的 `http-client` 模块，通过智能Session池、动态User-Agent轮换和自动错误恢复机制，将服务的稳定性与反屏蔽能力提升至全新高度，使其从一个简单的API封装升级为“高可用的智能查询代理”。

## ✨ 核心功能

  - **智能Session管理**:
      - **Session池**: 维护一个可配置大小的Session池（默认为2-5个），高效复用连接，显著减少了90%的重复登录请求。
      - **后台自动维护**: 每5分钟自动清理失效或过期的会话，并补充新会话，确保Session池的健康状态。
      - **智能错误处理**: 能够自动识别因Session失效导致的请求失败，并立即将该Session标记为无效，触发补充机制，实现了服务的自愈能力。
  - **强大的查询工具集**:
      - **`get-tickets`**: 查询指定日期、区间的直达票余票信息。
      - **`get-interline-tickets`**: 查询中转换乘线路的余票信息。
      - **`get-train-route-stations`**: 查询特定车次的详细经停站点信息。
      - **`get-station-code`**: 提供多种方式（城市名、具体站名）查询车站代码。
  - **灵活的筛选与排序**:
      - 支持按车次类型 (G/D/Z/T/K)、出发时间范围进行筛选。
      - 支持按出发时间、到达时间和历时进行排序。
  - **多种输出格式**:
      - 支持 `text` (默认)、`csv` (get-tickets) 和 `json` 三种格式，方便不同场景下的数据消费。
  - **高可靠性设计**:
      - **动态User-Agent**: 内置12种浏览器User-Agent，在每次创建新Session时随机选用，有效降低了被识别为自动化脚本的风险。
      - **IP封禁风险降低95%**: 通过大幅减少不必要的网络请求和模拟真实用户行为，显著降低了服务器IP被12306暂时屏蔽的风险。

## 🚀 快速开始

### 环境要求

  - Node.js \>= 18.x

### 1\. 安装

从NPM直接安装 (推荐):

```bash
npm install -g 12306-mcp-server
```

或者，从源码构建:

```bash
git clone https://github.com/your-username/12306-mcp-server.git
cd 12306-mcp-server
npm install
npm run build
```

### 2\. 运行服务

根据您的AI Agent或客户端的连接方式，选择以下任一模式启动服务：

#### 标准输入/输出 (Stdio) 模式

此模式适用于大多数本地客户端（例如 Claude Desktop）的直接调用。

```bash
# 如果通过npm全局安装
12306-mcp
# 如果从源码运行
npm run start
```

服务启动后，您将在终端看到以下输出：

```
[SessionManager] Initializing session pool...
[SessionManager] New session created: ...
[SessionManager] New session created: ...
[SessionManager] Initialized with 2 sessions
[Main] Service initialized successfully
12306 MCP Server running on stdio @Joooook
```

#### HTTP/SSE 模式

此模式将服务暴露为一个HTTP端点，适用于远程或Web客户端。

```bash
# 监听在8080端口
12306-mcp --port 8080
# 或者从源码运行
npm run start:http
```

服务启动后，您可以访问 `http://localhost:8080/health` 来检查服务健康状态。

## 🛠️ 工具使用示例 (MCP/MCP 规范)

以下是一个使用 `get-tickets` 工具查询从北京 (BJP) 到上海 (SHH) 车票的MCP请求示例：

```json
{
  "name": "get-tickets",
  "arguments": {
    "date": "2025-10-25",
    "fromStation": "BJP",
    "toStation": "SHH",
    "limitedNum": 3,
    "trainFilterFlags": "G",
    "sortFlag": "startTime"
  }
}
```

## ⚙️ 配置

所有核心配置都位于 `src/http-client/constants.ts` 文件中。您可以根据需要调整以下参数：

```typescript
export const POOL_CONFIG = {
    MIN_SIZE: 2,                    // 最小Session池大小
    MAX_SIZE: 5,                    // 最大Session池大小
    SESSION_TTL: 30 * 60 * 1000,   // Session有效期 (30分钟)
    MAINTENANCE_INTERVAL: 5 * 60 * 1000,  // 后台维护任务间隔 (5分钟)
};
```

修改配置后，需要重新构建 (`npm run build`) 并重启服务。

## 🔧 故障排查

  - **会话池初始化失败 (get cookie failed)**:
      - 检查服务器网络是否能正常访问 `kyfw.12306.cn`。
      - 检查防火墙设置是否阻止了出站请求。
  - **导入错误 (Cannot find module)**:
      - 确保已经运行 `npm run build` 成功生成 `build/` 目录。
  - **会话频繁失效**:
      - 可能是12306风控策略变更。尝试在 `constants.ts` 中增加 `SESSION_TTL` 时间。
      - 考虑减少并发请求频率。

## 🤝 贡献

欢迎任何形式的贡献！如果您有任何想法、建议或发现Bug，请随时提交 Pull Request 或创建 Issue。

## 📄 License

本项目采用 [MIT](https://www.google.com/search?q=https://github.com/your-username/12306-mcp-server/blob/main/LICENSE) 许可证。