// src/http-client/sessionManager.ts

import { Session } from './session.js';
import { SessionState, PoolStatus, SessionError, ErrorType } from './types.js';
import { USER_AGENTS, POOL_CONFIG, validateConfig, API_CONSTANTS } from './constants.js';
import axios from 'axios';

/**
 * SessionManager 单例类
 * 负责维护会话池,管理所有会话的生命周期
 */
class SessionManager {
    private static instance: SessionManager;
    private pool: Map<string, Session> = new Map();
    private readonly config = POOL_CONFIG;
    private maintenanceInterval?: NodeJS.Timeout;
    private isInitialized: boolean = false;
    private initializationPromise?: Promise<void>;
    private pendingRequests: Array<{
        resolve: (session: Session) => void;
        reject: (error: Error) => void;
    }> = [];

    private constructor() {
        // 验证配置
        if (!validateConfig(this.config)) {
            throw new Error('Invalid session manager configuration');
        }
    }

    /**
     * 获取 SessionManager 单例实例
     */
    public static getInstance(): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }

    /**
     * 初始化会话池
     * 预热会话池到最小数量,并启动后台维护任务
     */
    public async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        // 如果正在初始化，返回初始化Promise
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = this._doInitialize();
        return this.initializationPromise;
    }

    private async _doInitialize(): Promise<void> {
        console.log('[SessionManager] Initializing session pool...');
        
        try {
            // 预热会话池
            await this.initializePool();
            
            // 启动后台维护任务
            this.maintenanceInterval = setInterval(
                () => this.maintainPool(),
                this.config.maintenanceInterval
            );
            
            this.isInitialized = true;
            console.log(`[SessionManager] Initialized with ${this.pool.size} sessions`);
            this.logPoolStatus();
        } catch (error) {
            console.error('[SessionManager] Initialization failed:', error);
            throw new SessionError(
                ErrorType.UNKNOWN,
                'Failed to initialize session manager',
                error
            );
        }
    }

    /**
     * 清理资源
     */
    public cleanup(): void {
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
            this.maintenanceInterval = undefined;
        }
        
        // 拒绝所有待处理的请求
        this.pendingRequests.forEach(({ reject }) => {
            reject(new SessionError(
                ErrorType.UNKNOWN,
                'SessionManager is shutting down'
            ));
        });
        this.pendingRequests = [];
        
        this.pool.clear();
        this.isInitialized = false;
        this.initializationPromise = undefined;
        console.log('[SessionManager] Cleanup completed');
    }

    /**
     * 初始化/预热会话池
     */
    private async initializePool(): Promise<void> {
        const promises: Promise<void>[] = [];
        
        for (let i = 0; i < this.config.minSize; i++) {
            promises.push(
                this.addNewSession().then(() => {}).catch(err => {
                    console.error(`[SessionManager] Failed to add initial session ${i + 1}:`, err);
                })
            );
        }
        
        await Promise.all(promises);
        
        // 确保至少有一个会话创建成功
        if (this.pool.size === 0) {
            throw new Error('Failed to create any sessions during initialization');
        }
    }

    /**
     * 【核心】获取一个可用会话
     */
    public async getSession(): Promise<Session> {
        // 1. 查找可用的session
        const availableSession = this.findAvailableSession();
        if (availableSession) {
            availableSession.use();
            return availableSession;
        }

        // 2. 如果池未满,创建新的
        if (this.pool.size < this.config.maxSize) {
            try {
                const newSession = await this.addNewSession();
                newSession.use();
                return newSession;
            } catch (error) {
                console.error('[SessionManager] Failed to create new session:', error);
                // 继续尝试等待可用session
            }
        }

        // 3. 池已满，等待可用session
        console.warn('[SessionManager] Pool is full, waiting for available session...');
        return this.waitForAvailableSession();
    }

    /**
     * 查找可用的会话（优先选择最健康的）
     */
    private findAvailableSession(): Session | null {
        const availableSessions = Array.from(this.pool.values())
            .filter(s => s.state === SessionState.AVAILABLE && !s.isStale(this.config.sessionTTL));
        
        if (availableSessions.length === 0) {
            return null;
        }

        // 按健康度和使用次数排序，优先使用健康且使用少的session
        availableSessions.sort((a, b) => {
            if (a.isHealthy() !== b.isHealthy()) {
                return a.isHealthy() ? -1 : 1;
            }
            return a.useCount - b.useCount;
        });

        return availableSessions[0] ?? null;
    }

    /**
     * 等待可用会话
     */
    private waitForAvailableSession(): Promise<Session> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const index = this.pendingRequests.findIndex(
                    req => req.resolve === resolve
                );
                if (index !== -1) {
                    this.pendingRequests.splice(index, 1);
                }
                reject(new SessionError(
                    ErrorType.RATE_LIMIT,
                    'Timeout waiting for available session. Pool is saturated.'
                ));
            }, 30000); // 30秒超时

            this.pendingRequests.push({
                resolve: (session: Session) => {
                    clearTimeout(timeout);
                    resolve(session);
                },
                reject: (error: Error) => {
                    clearTimeout(timeout);
                    reject(error);
                }
            });
        });
    }

    /**
     * 归还一个会话
     */
    public releaseSession(sessionId: string): void {
        const session = this.pool.get(sessionId);
        if (!session) {
            console.warn(`[SessionManager] Attempting to release unknown session ${sessionId.slice(0, 8)}`);
            return;
        }

        session.release();
        console.log(`[SessionManager] Session ${sessionId.slice(0, 8)} released`);

        // 处理待处理的请求
        if (this.pendingRequests.length > 0) {
            const request = this.pendingRequests.shift();
            if (request) {
                session.use();
                request.resolve(session);
                console.log(`[SessionManager] Assigned session ${sessionId.slice(0, 8)} to pending request`);
            }
        }
    }

    /**
     * 销毁一个无效会话
     */
    public invalidateSession(sessionId: string): void {
        const session = this.pool.get(sessionId);
        if (!session) {
            console.warn(`[SessionManager] Attempting to invalidate unknown session ${sessionId.slice(0, 8)}`);
            return;
        }

        session.invalidate();
        this.pool.delete(sessionId);
        console.log(`[SessionManager] Session ${sessionId.slice(0, 8)} invalidated and removed`);
        
        // 立即补充会话
        this.ensureMinPoolSize().catch(err => {
            console.error('[SessionManager] Failed to replenish pool after invalidation:', err);
        });
    }

    /**
     * 确保池中有最小数量的会话
     */
    private async ensureMinPoolSize(): Promise<void> {
        const availableCount = Array.from(this.pool.values())
            .filter(s => s.state === SessionState.AVAILABLE).length;

        if (availableCount < this.config.minSize) {
            const needed = this.config.minSize - this.pool.size;
            console.log(`[SessionManager] Pool below minimum, adding ${needed} sessions`);
            
            const promises: Promise<void>[] = [];
            for (let i = 0; i < needed; i++) {
                promises.push(
                    this.addNewSession().then(() => {}).catch(err => {
                        console.error('[SessionManager] Failed to add session:', err);
                    })
                );
            }
            await Promise.all(promises);
        }
    }

    /**
     * 后台维护任务
     */
    private async maintainPool(): Promise<void> {
        console.log('[SessionManager] Running maintenance task...');
        
        const before = this.getPoolStatus();
        
        // 1. 移除无效会话
        for (const [id, session] of this.pool.entries()) {
            if (session.state === SessionState.INVALID) {
                this.pool.delete(id);
                console.log(`[SessionManager] Removed invalid session ${id.slice(0, 8)}`);
            }
        }

        // 2. 标记过期会话
        for (const session of this.pool.values()) {
            if (session.isStale(this.config.sessionTTL) && 
                session.state === SessionState.AVAILABLE) {
                session.markExpired();
                console.log(`[SessionManager] Marked session ${session.id.slice(0, 8)} as expired`);
            }
        }

        // 3. 移除不健康的会话
        for (const [id, session] of this.pool.entries()) {
            if (!session.isHealthy() && session.state === SessionState.AVAILABLE) {
                this.pool.delete(id);
                console.log(`[SessionManager] Removed unhealthy session ${id.slice(0, 8)} (error rate: ${(session.errorCount / session.useCount * 100).toFixed(1)}%)`);
            }
        }

        // 4. 补充到最小数量
        await this.ensureMinPoolSize();
        
        const after = this.getPoolStatus();
        console.log(`[SessionManager] Maintenance completed. Before: ${JSON.stringify(before)}, After: ${JSON.stringify(after)}`);
    }

    /**
     * 创建并添加一个新会话
     */
    private async addNewSession(): Promise<Session> {
        try {
            const cookies = await this._fetchNewCookies();
            const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
            
            const session = new Session({ cookies, userAgent: userAgent ?? USER_AGENTS[0] });
            this.pool.set(session.id, session);
            
            console.log(`[SessionManager] New session created: ${session.id.slice(0, 8)}`);
            return session;
        } catch (error) {
            console.error('[SessionManager] Failed to create session:', error);
            throw new SessionError(
                ErrorType.NETWORK_ERROR,
                'Failed to create new session',
                error
            );
        }
    }

    /**
     * 获取新的 Cookie (带重试机制)
     */
    private async _fetchNewCookies(): Promise<Record<string, string>> {
        let lastError: any;
        
        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            try {
                const response = await axios.get(API_CONSTANTS.INIT_URL, {
                    timeout: API_CONSTANTS.TIMEOUT,
                    validateStatus: () => true,
                });
                
                const setCookieHeader = response.headers['set-cookie'];
                if (setCookieHeader && Array.isArray(setCookieHeader)) {
                    const cookies = this._parseCookies(setCookieHeader);
                    if (Object.keys(cookies).length > 0) {
                        return cookies;
                    }
                }
                
                throw new Error('No valid cookies received from server');
            } catch (error) {
                lastError = error;
                console.warn(`[SessionManager] Attempt ${attempt}/${this.config.maxRetries} failed:`, error);
                
                if (attempt < this.config.maxRetries) {
                    await new Promise(resolve => 
                        setTimeout(resolve, this.config.retryDelay * attempt)
                    );
                }
            }
        }
        
        throw new SessionError(
            ErrorType.NETWORK_ERROR,
            `Failed to fetch cookies after ${this.config.maxRetries} attempts`,
            lastError
        );
    }

    /**
     * 解析 Cookie 字符串数组
     */
    private _parseCookies(cookies: string[]): Record<string, string> {
        const cookieRecord: Record<string, string> = {};
        
        cookies.forEach((cookie) => {
            const keyValuePart = cookie.split(';')[0];
            
            if (keyValuePart) {
                const [key, value] = keyValuePart.split('=');
                
                if (key && value) {
                    cookieRecord[key.trim()] = value.trim();
                }
            }
        });
        
        return cookieRecord;
    }

    /**
     * 获取池状态
     */
    public getPoolStatus(): PoolStatus {
        const status: PoolStatus = {
            total: this.pool.size,
            available: 0,
            inUse: 0,
            invalid: 0,
            expired: 0,
        };
        
        for (const session of this.pool.values()) {
            switch (session.state) {
                case SessionState.AVAILABLE:
                    status.available++;
                    break;
                case SessionState.IN_USE:
                    status.inUse++;
                    break;
                case SessionState.INVALID:
                    status.invalid++;
                    break;
                case SessionState.EXPIRED:
                    status.expired++;
                    break;
            }
        }
        
        return status;
    }

    /**
     * 记录池状态和统计信息
     */
    private logPoolStatus(): void {
        const status = this.getPoolStatus();
        const sessions = Array.from(this.pool.values()).map(s => s.getStats());
        
        console.log('[SessionManager] Pool Status:', JSON.stringify(status, null, 2));
        console.log('[SessionManager] Session Details:', JSON.stringify(sessions, null, 2));
    }

    /**
     * 获取详细的健康状态
     */
    public getHealthStatus(): {
        isHealthy: boolean;
        poolStatus: PoolStatus;
        pendingRequests: number;
        sessionDetails: Array<ReturnType<Session['getStats']>>;
    } {
        const status = this.getPoolStatus();
        const isHealthy = 
            this.isInitialized && 
            status.available > 0 &&
            this.pendingRequests.length < this.config.maxSize;
        
        return {
            isHealthy,
            poolStatus: status,
            pendingRequests: this.pendingRequests.length,
            sessionDetails: Array.from(this.pool.values()).map(s => s.getStats()),
        };
    }
}

// 导出单例实例
export const sessionManager = SessionManager.getInstance();