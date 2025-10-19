// src/http-client/session.ts

import { SessionState, SessionData } from './types.js';
import { randomUUID } from 'crypto';

/**
 * Session 类 - 会话状态机
 * 封装会话的所有信息和行为
 */
export class Session {
    public readonly id: string = randomUUID();
    public state: SessionState = SessionState.AVAILABLE;
    public createdAt: number = Date.now();
    public lastUsedAt: number = Date.now();
    private data: SessionData;

    constructor(sessionData: SessionData) {
        this.data = sessionData;
    }

    /**
     * 获取会话凭证(Cookie和User-Agent)
     */
    public getCredentials(): SessionData {
        return this.data;
    }

    /**
     * 标记会话为使用中
     */
    public use(): void {
        this.state = SessionState.IN_USE;
        this.lastUsedAt = Date.now();
    }

    /**
     * 释放会话,恢复为可用状态
     */
    public release(): void {
        this.state = SessionState.AVAILABLE;
    }

    /**
     * 标记会话为无效,等待销毁
     */
    public invalidate(): void {
        this.state = SessionState.INVALID;
    }

    /**
     * 检查会话是否过期
     * @param ttl 存活时间(毫秒),默认30分钟
     * @returns 是否过期
     */
    public isStale(ttl: number = 30 * 60 * 1000): boolean {
        return Date.now() - this.createdAt > ttl;
    }
}