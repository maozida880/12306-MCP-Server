// 单元测试示例 (可选)
// 如需使用，请安装: npm install --save-dev jest @types/jest ts-jest

// tests/http-client/session.test.ts
import { Session } from '../../src/http-client/session';
import { SessionState } from '../../src/http-client/types';

describe('Session', () => {
    let session: Session;

    beforeEach(() => {
        session = new Session({
            cookies: { test: 'cookie' },
            userAgent: 'TestUA',
        });
    });

    test('should create session with AVAILABLE state', () => {
        expect(session.state).toBe(SessionState.AVAILABLE);
        expect(session.id).toBeDefined();
    });

    test('should transition to IN_USE when used', () => {
        session.use();
        expect(session.state).toBe(SessionState.IN_USE);
    });

    test('should transition back to AVAILABLE when released', () => {
        session.use();
        session.release();
        expect(session.state).toBe(SessionState.AVAILABLE);
    });

    test('should transition to INVALID when invalidated', () => {
        session.invalidate();
        expect(session.state).toBe(SessionState.INVALID);
    });

    test('should detect stale sessions', () => {
        const staleSession = new Session({
            cookies: { test: 'cookie' },
            userAgent: 'TestUA',
        });
        
        // 手动设置创建时间为1小时前
        staleSession.createdAt = Date.now() - 60 * 60 * 1000;
        
        expect(staleSession.isStale(30 * 60 * 1000)).toBe(true);
    });

    test('should return credentials', () => {
        const creds = session.getCredentials();
        expect(creds.cookies).toEqual({ test: 'cookie' });
        expect(creds.userAgent).toBe('TestUA');
    });
});

// tests/http-client/sessionManager.test.ts
import { sessionManager } from '../../src/http-client/sessionManager';
import { SessionState } from '../../src/http-client/types';

describe('SessionManager', () => {
    beforeAll(async () => {
        // 注意：这会发起真实的网络请求
        // 在实际测试中应该mock网络请求
        await sessionManager.initialize();
    });

    afterAll(() => {
        sessionManager.cleanup();
    });

    test('should be singleton', () => {
        const instance1 = sessionManager;
        const instance2 = sessionManager;
        expect(instance1).toBe(instance2);
    });

    test('should get available session', async () => {
        const session = await sessionManager.getSession();
        expect(session).toBeDefined();
        expect(session.state).toBe(SessionState.IN_USE);
        
        // 清理
        sessionManager.releaseSession(session.id);
    });

    test('should release session correctly', async () => {
        const session = await sessionManager.getSession();
        const sessionId = session.id;
        
        sessionManager.releaseSession(sessionId);
        
        const status = sessionManager.getPoolStatus();
        expect(status.available).toBeGreaterThan(0);
    });

    test('should invalidate session correctly', async () => {
        const session = await sessionManager.getSession();
        const sessionId = session.id;
        
        sessionManager.invalidateSession(sessionId);
        
        const status = sessionManager.getPoolStatus();
        expect(status.total).toBeGreaterThan(0);
    });

    test('should throw error when pool is full', async () => {
        // 获取所有可用会话直到池满
        const sessions = [];
        
        try {
            for (let i = 0; i < 10; i++) {
                const session = await sessionManager.getSession();
                sessions.push(session);
            }
            fail('Should have thrown error');
        } catch (error: any) {
            expect(error.message).toContain('Session pool is full');
        }
        
        // 清理
        sessions.forEach(s => sessionManager.releaseSession(s.id));
    });

    test('should get pool status', () => {
        const status = sessionManager.getPoolStatus();
        
        expect(status.total).toBeGreaterThanOrEqual(0);
        expect(status.available).toBeGreaterThanOrEqual(0);
        expect(status.inUse).toBeGreaterThanOrEqual(0);
        expect(status.invalid).toBeGreaterThanOrEqual(0);
        
        expect(
            status.available + status.inUse + status.invalid
        ).toBe(status.total);
    });
});

// tests/integration/apiClient.test.ts
import { apiClient } from '../../src/http-client/apiClient';

describe('ApiClient Integration', () => {
    test('should make successful request', async () => {
        // 测试获取12306首页
        const html = await apiClient.get<string>('https://www.12306.cn/index/');
        
        expect(html).toBeDefined();
        expect(typeof html).toBe('string');
        expect(html.length).toBeGreaterThan(0);
    }, 10000); // 10秒超时

    test('should handle request with params', async () => {
        const params = new URLSearchParams({
            keyword: 'test',
        });
        
        try {
            await apiClient.get(
                'https://search.12306.cn/search/v1/train/search',
                params
            );
        } catch (error) {
            // 即使失败，也应该是业务错误，不是会话管理错误
            expect(error).toBeDefined();
        }
    }, 10000);
});

// jest.config.js (如果使用Jest)
/*
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**\/*.test.ts'],
    collectCoverageFrom: [
        'src/http-client/**\/*.ts',
        '!src/http-client/index.ts',
    ],
    coverageThreshold: {
        global: {
            branches: 70,
            functions: 80,
            lines: 80,
            statements: 80,
        },
    },
};
*/

// package.json 添加测试脚本
/*
{
  "scripts": {
    "test:unit": "jest --coverage",
    "test:watch": "jest --watch",
    "test:integration": "jest tests/integration"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0",
    "ts-jest": "^29.0.0"
  }
}
*/