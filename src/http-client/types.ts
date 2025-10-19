// src/http-client/types.ts

/**
 * 会话状态枚举
 */
export enum SessionState {
    AVAILABLE = 'AVAILABLE',  // 可用
    IN_USE = 'IN_USE',       // 使用中
    EXPIRED = 'EXPIRED',      // 已过期(待刷新)
    INVALID = 'INVALID',      // 已失效(待销毁)
}

/**
 * 会话数据接口
 */
export interface SessionData {
    cookies: Record<string, string>;
    userAgent: string;
}

/**
 * 会话池状态接口
 */
export interface PoolStatus {
    total: number;
    available: number;
    inUse: number;
    invalid: number;
    expired: number;
}

/**
 * 错误类型枚举
 */
export enum ErrorType {
    SESSION_INVALID = 'SESSION_INVALID',
    SESSION_EXPIRED = 'SESSION_EXPIRED',
    NETWORK_ERROR = 'NETWORK_ERROR',
    RATE_LIMIT = 'RATE_LIMIT',
    UNKNOWN = 'UNKNOWN',
}

/**
 * 自定义错误类
 */
export class SessionError extends Error {
    constructor(
        public type: ErrorType,
        message: string,
        public originalError?: any
    ) {
        super(message);
        this.name = 'SessionError';
    }
}

/**
 * 会话管理器配置接口
 */
export interface SessionManagerConfig {
    minSize: number;
    maxSize: number;
    sessionTTL: number;
    maintenanceInterval: number;
    maxRetries: number;
    retryDelay: number;
}