// src/http-client/types.ts

/**
 * 会话状态枚举
 */
export enum SessionState {
    AVAILABLE,  // 可用
    IN_USE,     // 使用中
    EXPIRED,    // 已过期(待刷新)
    INVALID,    // 已失效(待销毁)
}

/**
 * 会话数据接口
 */
export interface SessionData {
    cookies: Record<string, string>;
    userAgent: string;
}