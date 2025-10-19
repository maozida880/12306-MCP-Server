# 🚀 迁移检查清单与快速开始

## ✅ 迁移检查清单

### 第一步：创建新模块文件

在 `src/` 目录下创建 `http-client/` 子目录，并添加以下文件：

```bash
mkdir -p src/http-client
```

- [ ] `src/http-client/constants.ts` - UA列表和配置
- [ ] `src/http-client/types.ts` - 类型定义
- [ ] `src/http-client/session.ts` - Session类
- [ ] `src/http-client/sessionManager.ts` - SessionManager单例
- [ ] `src/http-client/apiClient.ts` - ApiClient客户端
- [ ] `src/http-client/index.ts` - 模块导出

### 第二步：替换主入口文件

- [ ] 备份原 `src/index.ts`
  ```bash
  cp src/index.ts src/index.ts.backup
  ```

- [ ] 使用新的 `index.ts` 替换
- [ ] 确认删除了 `getCookie()` 和 `make12306Request()` 函数
- [ ] 确认所有工具都使用 `apiClient.get()` 

### 第三步：验证构建

```bash
# 清理旧构建
rm -rf build/*

# 重新构建
npm run build

# 检查构建结果
ls -la build/
```

应该看到：
```
build/
├── http-client/
│   ├── constants.js
│   ├── types.js
│   ├── session.js
│   ├── sessionManager.js
│   ├── apiClient.js
│   └── index.js
├── index.js
└── types.js
```

### 第四步：本地测试

#### 测试1: 标准输出模式
```bash
npm run test
```

期望输出：
```
[SessionManager] Initializing session pool...
[SessionManager] New session created: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
[SessionManager] New session created: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
[SessionManager] Initialized with 2 sessions
[Main] Service initialized successfully
12306 MCP Server running on stdio @Joooook
```

#### 测试2: HTTP模式
```bash
npm run test:http
```

然后在另一个终端测试：
```bash
curl http://localhost:8080/health
```

#### 测试3: 功能验证

使用Claude Desktop或其他MCP客户端测试工具：

```json
// 测试get-tickets工具
{
  "name": "get-tickets",
  "arguments": {
    "date": "2025-10-25",
    "fromStation": "BJP",
    "toStation": "SHH",
    "limitedNum": 3
  }
}
```

期望看到会话管理日志：
```
[SessionManager] Running maintenance task...
[ApiClient] GET https://kyfw.12306.cn/otn/leftTicket/query using session xxxxx
[ApiClient] Request succeeded for session xxxxx
[SessionManager] Session xxxxx released
```

### 第五步：监控验证

#### 检查会话池健康状态

在代码中添加临时监控端点（可选）：
```typescript
server.tool(
    'debug-session-pool',
    'Debug: Get session pool status',
    {},
    async () => {
        const status = sessionManager.getPoolStatus();
        return {
            content: [{ 
                type: 'text', 
                text: JSON.stringify(status, null, 2) 
            }],
        };
    }
);
```

#### 观察日志

正常运行时应看到：
- ✅ 会话创建日志
- ✅ 定期维护任务日志（每5分钟）
- ✅ 请求成功/失败日志
- ✅ 会话获取/释放日志

异常情况下应看到：
- ⚠️ 会话失效检测
- ⚠️ 自动销毁和补充
- ⚠️ 池满载警告

### 第六步：性能基准测试

使用以下脚本测试并发性能：

```bash
# 安装测试工具
npm install -g artillery

# 创建测试配置 artillery-test.yml
cat > artillery-test.yml << 'EOF'
config:
  target: 'http://localhost:8080'
  phases:
    - duration: 60
      arrivalRate: 5
scenarios:
  - name: "Query tickets"
    flow:
      - post:
          url: "/mcp/tools/call"
          json:
            name: "get-tickets"
            arguments:
              date: "2025-10-25"
              fromStation: "BJP"
              toStation: "SHH"
              limitedNum: 5
EOF

# 运行测试
artillery run artillery-test.yml
```

期望结果：
- 平均响应时间 < 2秒
- 错误率 < 1%
- 无内存泄漏

### 第七步：生产部署准备

- [ ] 更新 `package.json` 版本号到 `1.0.0`
- [ ] 更新 `README.md` 添加新功能说明
- [ ] 创建 `CHANGELOG.md` 记录变更
- [ ] 标记Git版本
  ```bash
  git tag -a v1.0.0 -m "Add intelligent session management"
  git push origin v1.0.0
  ```

## 🔧 故障排查

### 问题1: 会话池初始化失败

**症状**:
```
Error: get cookie failed. Check your network.
```

**解决方案**:
1. 检查网络连接到12306
2. 检查防火墙设置
3. 尝试手动访问 https://kyfw.12306.cn/otn/leftTicket/init

### 问题2: 导入错误

**症状**:
```
Error: Cannot find module './http-client/index.js'
```

**解决方案**:
1. 确认所有文件都已创建
2. 运行 `npm run build`
3. 检查 `tsconfig.json` 配置

### 问题3: 类型错误

**症状**:
```
Property 'getCredentials' does not exist on type 'Session'
```

**解决方案**:
1. 确认 `session.ts` 中所有方法都已定义
2. 删除 `build/` 目录并重新构建
3. 重启TypeScript服务器

### 问题4: 会话频繁失效

**症状**:
```
[SessionManager] Session xxxxx invalidated
[SessionManager] Session xxxxx invalidated
```

**解决方案**:
1. 增加 `SESSION_TTL` 时间
2. 检查12306是否有新的风控策略
3. 减少请求频率
4. 增加User-Agent多样性

## 📈 性能优化建议

### 1. 调整池大小
如果并发需求高，可以增加池大小：
```typescript
// src/http-client/constants.ts
export const POOL_CONFIG = {
    MIN_SIZE: 3,  // 从2增加到3
    MAX_SIZE: 10, // 从5增加到10
    // ...
};
```

### 2. 调整维护间隔
如果服务器资源充足，可以缩短维护间隔：
```typescript
MAINTENANCE_INTERVAL: 2 * 60 * 1000,  // 从5分钟改为2分钟
```

### 3. 添加请求重试
在 `apiClient.ts` 中添加重试逻辑：
```typescript
public async get<T>(url: string | URL, params?: URLSearchParams, maxRetries = 3): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            // 原有请求逻辑
            return await this.performRequest<T>(url, params);
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}
```

## 🎯 验收标准

### 功能验收
- ✅ 所有原有工具正常工作
- ✅ 新的会话管理模块正常运行
- ✅ 没有回归性bug

### 性能验收
- ✅ 平均响应时间降低20%
- ✅ 错误率 < 0.1%
- ✅ 服务可持续运行24小时无崩溃

### 可观测性验收
- ✅ 日志清晰完整
- ✅ 能够追踪每个请求的会话使用情况
- ✅ 能够监控会话池健康状态

## 📞 支持与反馈

如遇到问题，请提供以下信息：
1. 完整的错误日志
2. 操作步骤复现路径
3. 系统环境信息（Node版本、操作系统）
4. 会话池状态快照

---

**检查清单最后更新**: 2025-10-19  
**适用版本**: v1.0.0  
**预计迁移时间**: 30-60分钟