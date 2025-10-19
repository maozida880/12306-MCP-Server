// src/http-client/session.ts

import { SessionState, SessionData } from './types.js';
import { randomUUID } from 'crypto';

/**
 * Session 类 - 会话状态机
 * 封装会话的所有信息和行为
 */
export class Session {
    public readonly id: string = randomUUID();
    private _state: SessionState = SessionState.AVAILABLE;
    public readonly createdAt: number = Date.now();
    public lastUsedAt: number = Date.now();
    public useCount: number = 0; // 使用次数统计
    public errorCount: number = 0; // 错误次数统计
    private readonly data: SessionData;

    constructor(sessionData: SessionData) {
        this.data = sessionData;
    }

    /**
     * 获取会话状态
     */
    public get state(): SessionState {
        return this._state;
    }

    /**
     * 设置会话状态
     */
    public set state(newState: SessionState) {
        const oldState = this._state;
        this._state = newState;
        console.log(`[Session ${this.id.slice(0, 8)}] State transition: ${oldState} -> ${newState}`);
    }

    /**
     * 获取会话凭证(Cookie和User-Agent)
     */
    public getCredentials(): Readonly<SessionData> {
        return Object.freeze({ ...this.data });
    }

    /**
     * 标记会话为使用中
     */
    public use(): void {
        if (this._state !== SessionState.AVAILABLE) {
            console.warn(`[Session ${this.id.slice(0, 8)}] Attempting to use non-available session (state: ${this._state})`);
        }
        this.state = SessionState.IN_USE;
        this.lastUsedAt = Date.now();
        this.useCount++;
    }

    /**
     * 释放会话,恢复为可用状态
     */
    public release(): void {
        if (this._state === SessionState.IN_USE) {
            this.state = SessionState.AVAILABLE;
        } else {
            console.warn(`[Session ${this.id.slice(0, 8)}] Attempting to release non-in-use session (state: ${this._state})`);
        }
    }

    /**
     * 标记会话为无效,等待销毁
     */
    public invalidate(): void {
        this.state = SessionState.INVALID;
        this.errorCount++;
    }

    /**
     * 标记会话为过期
     */
    public markExpired(): void {
        this.state = SessionState.EXPIRED;
    }

    /**
     * 检查会话是否过期
     * @param ttl 存活时间(毫秒),默认30分钟
     * @returns 是否过期
     */
    public isStale(ttl: number = 30 * 60 * 1000): boolean {
        return Date.now() - this.createdAt > ttl;
    }

    /**
     * 检查会话是否健康
     * 基于错误率判断
     */
    public isHealthy(): boolean {
        if (this.useCount === 0) return true;
        const errorRate = this.errorCount / this.useCount;
        return errorRate < 0.3; // 错误率低于30%视为健康
    }

    /**
     * 获取会话年龄（毫秒）
     */
    public getAge(): number {
        return Date.now() - this.createdAt;
    }

    /**
     * 获取会话统计信息
     */
    public getStats(): {
        id: string;
        age: number;
        useCount: number;
        errorCount: number;
        errorRate: number;
        state: SessionState;
    } {
        return {
            id: this.id.slice(0, 8),
            age: this.getAge(),
            useCount: this.useCount,
            errorCount: this.errorCount,
            errorRate: this.useCount > 0 ? this.errorCount / this.useCount : 0,
            state: this._state,
        };
    }

    /**
     * 重置错误计数
     * 在会话成功使用后可以调用
     */
    public resetErrorCount(): void {
        if (this.errorCount > 0) {
            console.log(`[Session ${this.id.slice(0, 8)}] Resetting error count from ${this.errorCount} to 0`);
            this.errorCount = 0;
        }
    }
}