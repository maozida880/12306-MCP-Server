// src/http-client/sessionManager.ts

import { Session } from './session.js';
import { SessionState } from './types.js';
import { USER_AGENTS, POOL_CONFIG } from './constants.js';
import axios from 'axios';

/**
 * SessionManager 单例类
 * 负责维护会话池,管理所有会话的生命周期
 */
class SessionManager {
    private static instance: SessionManager;
    private pool: Map<string, Session> = new Map();
    private readonly minPoolSize: number = POOL_CONFIG.MIN_SIZE;
    private readonly maxPoolSize: number = POOL_CONFIG.MAX_SIZE;
    private maintenanceInterval?: NodeJS.Timeout;
    private isInitialized: boolean = false;

    private constructor() {
        // 私有构造函数,防止外部实例化
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

        console.log('[SessionManager] Initializing session pool...');
        
        // 预热会话池
        await this.initializePool();
        
        // 启动后台维护任务
        this.maintenanceInterval = setInterval(
            () => this.maintainPool(),
            POOL_CONFIG.MAINTENANCE_INTERVAL
        );
        
        this.isInitialized = true;
        console.log(`[SessionManager] Initialized with ${this.pool.size} sessions`);
    }

    /**
     * 清理资源
     */
    public cleanup(): void {
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
            this.maintenanceInterval = undefined;
        }
        this.pool.clear();
        this.isInitialized = false;
        console.log('[SessionManager] Cleanup completed');
    }

    /**
     * 初始化/预热会话池
     */
    private async initializePool(): Promise<void> {
        const promises: Promise<void>[] = [];
        
        for (let i = 0; i < this.minPoolSize; i++) {
            promises.push(this.addNewSession().catch(err => {
                console.error('[SessionManager] Failed to add initial session:', err);
            }));
        }
        
        await Promise.all(promises);
    }

    /**
     * 【核心】获取一个可用会话
     */
    public async getSession(): Promise<Session> {
        // 1. 寻找一个可用的 session
        for (const session of this.pool.values()) {
            if (session.state === SessionState.AVAILABLE) {
                session.use();
                return session;
            }
        }

        // 2. 如果池未满,则创建新的
        if (this.pool.size < this.maxPoolSize) {
            const newSession = await this.addNewSession();
            newSession.use();
            return newSession;
        }

        // 3. 如果池已满,则抛出异常
        throw new Error(
            'Session pool is full. Please try again later.'
        );
    }

    /**
     * 归还一个会话
     */
    public releaseSession(sessionId: string): void {
        const session = this.pool.get(sessionId);
        if (session) {
            session.release();
            console.log(`[SessionManager] Session ${sessionId} released`);
        }
    }

    /**
     * 销毁一个无效会话
     */
    public invalidateSession(sessionId: string): void {
        const session = this.pool.get(sessionId);
        if (session) {
            session.invalidate();
            this.pool.delete(sessionId);
            console.log(`[SessionManager] Session ${sessionId} invalidated`);
            
            // 触发补充
            this.maintainPool().catch(err => {
                console.error('[SessionManager] Failed to maintain pool after invalidation:', err);
            });
        }
    }

    /**
     * 后台维护任务
     * 移除失效会话,刷新过期会话,补充到最小数量
     */
    private async maintainPool(): Promise<void> {
        console.log('[SessionManager] Running maintenance task...');
        
        // 移除所有标记为 INVALID 的
        for (const [id, session] of this.pool.entries()) {
            if (session.state === SessionState.INVALID) {
                this.pool.delete(id);
                console.log(`[SessionManager] Removed invalid session ${id}`);
            }
        }

        // 检查并刷新过期的
        const staleSessionIds: string[] = [];
        for (const session of this.pool.values()) {
            if (session.isStale(POOL_CONFIG.SESSION_TTL)) {
                staleSessionIds.push(session.id);
            }
        }
        
        for (const id of staleSessionIds) {
            this.invalidateSession(id);
            console.log(`[SessionManager] Removed stale session ${id}`);
        }

        // 补充到最小数量
        while (this.pool.size < this.minPoolSize) {
            try {
                await this.addNewSession();
            } catch (error) {
                console.error('[SessionManager] Failed to add new session during maintenance:', error);
                break; // 避免无限循环
            }
        }
        
        console.log(`[SessionManager] Maintenance completed. Pool size: ${this.pool.size}`);
    }

    /**
     * 创建并添加一个新会话
     */
    private async addNewSession(): Promise<Session> {
        const cookies = await this._fetchNewCookies();
        const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        
        const session = new Session({ cookies, userAgent });
        this.pool.set(session.id, session);
        
        console.log(`[SessionManager] New session created: ${session.id}`);
        return session;
    }

    /**
     * 获取新的 Cookie
     * 迁移自原 getCookie() 函数
     */
    private async _fetchNewCookies(): Promise<Record<string, string>> {
        const url = 'https://kyfw.12306.cn/otn/leftTicket/init';
        
        try {
            const response = await axios.get(url, {
                validateStatus: () => true, // 接受所有状态码
            });
            
            const setCookieHeader = response.headers['set-cookie'];
            if (setCookieHeader && Array.isArray(setCookieHeader)) {
                return this._parseCookies(setCookieHeader);
            }
            
            throw new Error('No cookies received from server');
        } catch (error) {
            console.error('[SessionManager] Error fetching new cookies:', error);
            throw error;
        }
    }

    /**
     * 解析 Cookie 字符串数组
     */
    private _parseCookies(cookies: string[]): Record<string, string> {
        const cookieRecord: Record<string, string> = {};
        
        cookies.forEach((cookie) => {
            const keyValuePart = cookie.split(';')[0];
            const [key, value] = keyValuePart.split('=');
            
            if (key && value) {
                cookieRecord[key.trim()] = value.trim();
            }
        });
        
        return cookieRecord;
    }

    /**
     * 获取池状态(用于调试)
     */
    public getPoolStatus(): {
        total: number;
        available: number;
        inUse: number;
        invalid: number;
    } {
        const status = {
            total: this.pool.size,
            available: 0,
            inUse: 0,
            invalid: 0,
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
            }
        }
        
        return status;
    }
}

// 导出单例实例
export const sessionManager = SessionManager.getInstance();