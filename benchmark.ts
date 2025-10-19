// benchmark.ts - 性能测试脚本
// 运行: npx ts-node benchmark.ts

import { performance } from 'perf_hooks';
import axios from 'axios';

// ============================================
// 配置
// ============================================
const CONFIG = {
    baseUrl: process.env.TEST_BASE_URL || 'http://localhost:8080',
    concurrentUsers: parseInt(process.env.CONCURRENT_USERS || '10', 10),
    requestsPerUser: parseInt(process.env.REQUESTS_PER_USER || '10', 10),
    warmupRequests: parseInt(process.env.WARMUP_REQUESTS || '5', 10),
};

// ============================================
// 测试数据
// ============================================
const TEST_QUERIES = [
    {
        name: '北京到上海高铁',
        params: {
            date: '2025-11-01',
            fromStation: 'BJP',
            toStation: 'SHH',
            trainFilterFlags: 'G',
        },
    },
    {
        name: '成都到重庆动车',
        params: {
            date: '2025-11-01',
            fromStation: 'CDW',
            toStation: 'CQW',
            trainFilterFlags: 'D',
        },
    },
    {
        name: '广州到深圳全部车次',
        params: {
            date: '2025-11-01',
            fromStation: 'GZQ',
            toStation: 'SZQ',
        },
    },
];

// ============================================
// 统计类
// ============================================
class BenchmarkStats {
    private requests: number = 0;
    private successes: number = 0;
    private failures: number = 0;
    private durations: number[] = [];
    private errors: Map<string, number> = new Map();

    recordRequest(duration: number, success: boolean, error?: string) {
        this.requests++;
        this.durations.push(duration);
        
        if (success) {
            this.successes++;
        } else {
            this.failures++;
            if (error) {
                this.errors.set(error, (this.errors.get(error) || 0) + 1);
            }
        }
    }

    getStats() {
        const sorted = this.durations.sort((a, b) => a - b);
        const total = sorted.reduce((a, b) => a + b, 0);
        
        return {
            total: this.requests,
            successes: this.successes,
            failures: this.failures,
            successRate: ((this.successes / this.requests) * 100).toFixed(2) + '%',
            avgDuration: (total / sorted.length).toFixed(2) + 'ms',
            minDuration: sorted[0]?.toFixed(2) + 'ms' || 'N/A',
            maxDuration: sorted[sorted.length - 1]?.toFixed(2) + 'ms' || 'N/A',
            p50: sorted[Math.floor(sorted.length * 0.5)]?.toFixed(2) + 'ms' || 'N/A',
            p90: sorted[Math.floor(sorted.length * 0.9)]?.toFixed(2) + 'ms' || 'N/A',
            p95: sorted[Math.floor(sorted.length * 0.95)]?.toFixed(2) + 'ms' || 'N/A',
            p99: sorted[Math.floor(sorted.length * 0.99)]?.toFixed(2) + 'ms' || 'N/A',
            errors: Object.fromEntries(this.errors),
        };
    }

    printReport() {
        const stats = this.getStats();
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 Performance Test Results');
        console.log('='.repeat(60));
        console.log(`Total Requests:    ${stats.total}`);
        console.log(`Successful:        ${stats.successes} (${stats.successRate})`);
        console.log(`Failed:            ${stats.failures}`);
        console.log('');
        console.log('Response Time:');
        console.log(`  Average:         ${stats.avgDuration}`);
        console.log(`  Min:             ${stats.minDuration}`);
        console.log(`  Max:             ${stats.maxDuration}`);
        console.log(`  P50 (Median):    ${stats.p50}`);
        console.log(`  P90:             ${stats.p90}`);
        console.log(`  P95:             ${stats.p95}`);
        console.log(`  P99:             ${stats.p99}`);
        
        if (Object.keys(stats.errors).length > 0) {
            console.log('');
            console.log('Errors:');
            for (const [error, count] of Object.entries(stats.errors)) {
                console.log(`  ${error}: ${count}`);
            }
        }
        console.log('='.repeat(60) + '\n');
    }
}

// ============================================
// 测试函数
// ============================================
async function makeRequest(query: typeof TEST_QUERIES[0]): Promise<{ duration: number; success: boolean; error?: string }> {
    const start = performance.now();
    
    try {
        const response = await axios.post(
            `${CONFIG.baseUrl}/tools/get-tickets`,
            query.params,
            { timeout: 30000 }
        );
        
        const duration = performance.now() - start;
        return {
            duration,
            success: response.status === 200,
        };
    } catch (error: any) {
        const duration = performance.now() - start;
        return {
            duration,
            success: false,
            error: error.code || error.message || 'Unknown error',
        };
    }
}

async function warmup() {
    console.log(`🔥 Warming up with ${CONFIG.warmupRequests} requests...`);
    
    for (let i = 0; i < CONFIG.warmupRequests; i++) {
        const query = TEST_QUERIES[i % TEST_QUERIES.length];
        await makeRequest(query);
        process.stdout.write('.');
    }
    
    console.log(' Done!\n');
}

async function runConcurrentTest() {
    const stats = new BenchmarkStats();
    
    console.log(`🚀 Starting concurrent test:`);
    console.log(`   Concurrent users:    ${CONFIG.concurrentUsers}`);
    console.log(`   Requests per user:   ${CONFIG.requestsPerUser}`);
    console.log(`   Total requests:      ${CONFIG.concurrentUsers * CONFIG.requestsPerUser}\n`);
    
    const startTime = performance.now();
    
    // 创建并发用户
    const userPromises = Array.from({ length: CONFIG.concurrentUsers }, async (_, userId) => {
        for (let i = 0; i < CONFIG.requestsPerUser; i++) {
            const query = TEST_QUERIES[(userId + i) % TEST_QUERIES.length];
            const result = await makeRequest(query);
            stats.recordRequest(result.duration, result.success, result.error);
            
            // 显示进度
            if ((userId === 0 && i % 5 === 0) || i === CONFIG.requestsPerUser - 1) {
                process.stdout.write('.');
            }
        }
    });
    
    // 等待所有请求完成
    await Promise.all(userPromises);
    
    const totalTime = performance.now() - startTime;
    const totalRequests = CONFIG.concurrentUsers * CONFIG.requestsPerUser;
    
    console.log('\n\n✅ Test completed!\n');
    console.log(`Total time:        ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`Throughput:        ${(totalRequests / (totalTime / 1000)).toFixed(2)} req/s`);
    
    stats.printReport();
    
    return stats;
}

async function runSequentialTest() {
    const stats = new BenchmarkStats();
    
    console.log(`🔄 Starting sequential test...`);
    console.log(`   Total requests:      ${CONFIG.requestsPerUser}\n`);
    
    const startTime = performance.now();
    
    for (let i = 0; i < CONFIG.requestsPerUser; i++) {
        const query = TEST_QUERIES[i % TEST_QUERIES.length];
        const result = await makeRequest(query);
        stats.recordRequest(result.duration, result.success, result.error);
        process.stdout.write('.');
    }
    
    const totalTime = performance.now() - startTime;
    
    console.log('\n\n✅ Test completed!\n');
    console.log(`Total time:        ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`Throughput:        ${(CONFIG.requestsPerUser / (totalTime / 1000)).toFixed(2)} req/s`);
    
    stats.printReport();
    
    return stats;
}

async function testHealthEndpoint() {
    console.log('🏥 Testing health endpoint...');
    
    try {
        const start = performance.now();
        const response = await axios.get(`${CONFIG.baseUrl}/health`, { timeout: 5000 });
        const duration = performance.now() - start;
        
        console.log(`✅ Health check passed (${duration.toFixed(2)}ms)`);
        console.log(`   Status: ${response.status}`);
        console.log(`   Data: ${JSON.stringify(response.data)}\n`);
        return true;
    } catch (error: any) {
        console.log(`❌ Health check failed: ${error.message}\n`);
        return false;
    }
}

async function comparePerformance() {
    console.log('\n' + '='.repeat(60));
    console.log('🔬 Performance Comparison');
    console.log('='.repeat(60) + '\n');
    
    // 顺序测试
    console.log('--- Sequential Execution ---\n');
    const seqStats = await runSequentialTest();
    await new Promise(resolve => setTimeout(resolve, 2000)); // 冷却
    
    // 并发测试
    console.log('\n--- Concurrent Execution ---\n');
    const concStats = await runConcurrentTest();
    
    // 比较
    console.log('\n' + '='.repeat(60));
    console.log('📈 Comparison Summary');
    console.log('='.repeat(60));
    
    const seqData = seqStats.getStats();
    const concData = concStats.getStats();
    
    console.log('\nSequential vs Concurrent:');
    console.log(`  Success Rate:    ${seqData.successRate} vs ${concData.successRate}`);
    console.log(`  Avg Duration:    ${seqData.avgDuration} vs ${concData.avgDuration}`);
    console.log(`  P95:             ${seqData.p95} vs ${concData.p95}`);
    console.log(`  P99:             ${seqData.p99} vs ${concData.p99}`);
    console.log('='.repeat(60) + '\n');
}

// ============================================
// 主函数
// ============================================
async function main() {
    console.clear();
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║       12306-MCP-Server Performance Benchmark Tool          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    // 健康检查
    const healthy = await testHealthEndpoint();
    if (!healthy) {
        console.log('⚠️  Server is not healthy. Aborting tests.');
        process.exit(1);
    }
    
    // 预热
    await warmup();
    
    // 运行测试
    const mode = process.env.TEST_MODE || 'concurrent';
    
    if (mode === 'compare') {
        await comparePerformance();
    } else if (mode === 'sequential') {
        await runSequentialTest();
    } else {
        await runConcurrentTest();
    }
    
    console.log('🎉 Benchmark completed successfully!\n');
}

// 运行
main().catch(error => {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
});

// ============================================
// 使用说明
// ============================================
/*

# 基础运行
npx ts-node benchmark.ts

# 配置参数
CONCURRENT_USERS=20 REQUESTS_PER_USER=10 npx ts-node benchmark.ts

# 顺序测试
TEST_MODE=sequential npx ts-node benchmark.ts

# 比较测试
TEST_MODE=compare npx ts-node benchmark.ts

# 自定义服务器地址
TEST_BASE_URL=http://production-server:8080 npx ts-node benchmark.ts

# 完整配置示例
CONCURRENT_USERS=50 \
REQUESTS_PER_USER=20 \
WARMUP_REQUESTS=10 \
TEST_BASE_URL=http://localhost:8080 \
TEST_MODE=concurrent \
npx ts-node benchmark.ts

*/