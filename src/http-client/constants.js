// src/http-client/constants.ts

import { SessionManagerConfig } from './types.js';

/**
 * 预定义的 User-Agent 列表
 * 模拟不同浏览器和设备,降低被识别为机器人的概率
 */
export const USER_AGENTS = [
    // Chrome on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    
    // Chrome on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    
    // Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    
    // Firefox on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
    
    // Safari on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    
    // Edge on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    
    // Chrome on Linux
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    
    // Mobile Chrome on Android
    'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
];

/**
 * 从环境变量或使用默认值获取配置
 */
const getConfig = (): SessionManagerConfig => {
    return {
        minSize: parseInt(process.env.SESSION_POOL_MIN_SIZE || '2', 10),
        maxSize: parseInt(process.env.SESSION_POOL_MAX_SIZE || '5', 10),
        sessionTTL: parseInt(process.env.SESSION_TTL || String(30 * 60 * 1000), 10),
        maintenanceInterval: parseInt(
            process.env.MAINTENANCE_INTERVAL || String(5 * 60 * 1000),
            10
        ),
        maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
        retryDelay: parseInt(process.env.RETRY_DELAY || '1000', 10),
    };
};

/**
 * 会话池配置常量
 */
export const POOL_CONFIG = getConfig();

/**
 * 验证配置的有效性
 */
export const validateConfig = (config: SessionManagerConfig): boolean => {
    if (config.minSize < 1 || config.minSize > config.maxSize) {
        console.error('[Config] Invalid minSize or maxSize configuration');
        return false;
    }
    
    if (config.sessionTTL < 60000) {
        console.warn('[Config] sessionTTL is less than 1 minute, this may cause frequent refreshes');
    }
    
    if (config.maintenanceInterval < 60000) {
        console.warn('[Config] maintenanceInterval is less than 1 minute');
    }
    
    return true;
};

/**
 * 12306 API 相关常量
 */
export const API_CONSTANTS = {
    BASE_URL: 'https://kyfw.12306.cn',
    INIT_URL: 'https://kyfw.12306.cn/otn/leftTicket/init',
    TIMEOUT: 10000, // 10秒超时
    MAX_CONCURRENT_REQUESTS: 3, // 最大并发请求数
} as const;

/**
 * 会话失效的错误消息模式
 */
export const SESSION_INVALID_PATTERNS = [
    '您还没有登录',
    '请先登录',
    'not logged in',
    'login required',
    'session expired',
] as const;