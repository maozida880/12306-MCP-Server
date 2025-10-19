// src/http-client/apiClient.ts

import axios, { AxiosRequestConfig, AxiosError } from 'axios';
import { sessionManager } from './sessionManager.js';
import { Session } from './session.js';
import { SessionError, ErrorType } from './types.js';
import { SESSION_INVALID_PATTERNS, API_CONSTANTS } from './constants.js';

/**
 * ApiClient 类
 * 统一的 API 请求客户端,替代旧的 make12306Request 函数
 */
class ApiClient {
    private concurrentRequests: number = 0;
    private readonly maxConcurrentRequests = API_CONSTANTS.MAX_CONCURRENT_REQUESTS;

    /**
     * 统一的 GET 方法
     * @param url 请求URL
     * @param params URL查询参数
     * @param config 额外的axios配置
     * @returns 响应数据
     */
    public async get<T>(
        url: string | URL,
        params?: URLSearchParams,
        config?: Partial<AxiosRequestConfig>
    ): Promise<T> {
        // 并发控制
        await this.waitForSlot();
        this.concurrentRequests++;

        try {
            return await this._executeRequest<T>(url, params, config);
        } finally {
            this.concurrentRequests--;
        }
    }

    /**
     * 等待请求槽位
     */
    private async waitForSlot(): Promise<void> {
        while (this.concurrentRequests >= this.maxConcurrentRequests) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    /**
     * 执行实际的HTTP请求
     */
    private async _executeRequest<T>(
        url: string | URL,
        params?: URLSearchParams,
        additionalConfig?: Partial<AxiosRequestConfig>
    ): Promise<T> {
        let session: Session | null = null;
        let lastError: any;

        // 最多重试3次
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                session = await sessionManager.getSession();
                
                const credentials = session.getCredentials();
                const requestConfig: AxiosRequestConfig = {
                    headers: {
                        'Cookie': this.formatCookies(credentials.cookies),
                        'User-Agent': credentials.userAgent,
                        ...additionalConfig?.headers,
                    },
                    params: params,
                    timeout: API_CONSTANTS.TIMEOUT,
                    ...additionalConfig,
                };
                
                const fullUrl = typeof url === 'string' ? url : url.toString();
                console.log(`[ApiClient] GET ${fullUrl} using session ${session.id.slice(0, 8)} (attempt ${attempt})`);
                
                const response = await axios.get<T>(fullUrl, requestConfig);
                
                console.log(`[ApiClient] Request succeeded for session ${session.id.slice(0, 8)}`);
                
                // 成功后重置错误计数
                session.resetErrorCount();
                
                return response.data;
                
            } catch (error) {
                lastError = error;
                console.error(`[ApiClient] Request failed for session ${session?.id.slice(0, 8)} (attempt ${attempt}):`, error);
                
                // 判断错误类型
                const errorType = this.classifyError(error);
                
                if (session) {
                    // 如果是会话失效错误，销毁会话
                    if (errorType === ErrorType.SESSION_INVALID) {
                        console.warn(`[ApiClient] Session ${session.id.slice(0, 8)} is invalid, invalidating...`);
                        sessionManager.invalidateSession(session.id);
                        session = null; // 防止在finally中重复释放
                        
                        // 会话失效，可以重试
                        if (attempt < 3) {
                            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                            continue;
                        }
                    } else if (errorType === ErrorType.NETWORK_ERROR) {
                        // 网络错误，可以重试
                        if (attempt < 3) {
                            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                            continue;
                        }
                    }
                }
                
                // 不是可重试的错误或重试次数用尽，抛出
                if (attempt === 3) {
                    throw this.wrapError(error, errorType);
                }
                
            } finally {
                // 确保会话被释放
                if (session) {
                    sessionManager.releaseSession(session.id);
                }
            }
        }
        
        // 理论上不会到达这里，但为了类型安全
        throw this.wrapError(lastError, ErrorType.UNKNOWN);
    }

    /**
     * 格式化 Cookie 对象为字符串
     */
    private formatCookies(cookies: Record<string, string>): string {
        return Object.entries(cookies)
            .map(([key, value]) => `${key}=${value}`)
            .join('; ');
    }

    /**
     * 分类错误类型
     */
    private classifyError(error: unknown): ErrorType {
        if (!axios.isAxiosError(error)) {
            return ErrorType.UNKNOWN;
        }
        
        const axiosError = error as AxiosError;
        
        // 检查响应体中的错误信息
        if (axiosError.response?.data) {
            const data = axiosError.response.data as any;
            
            if (typeof data === 'object') {
                const messages = String(data.messages || data.message || '');
                const errorMsg = String(data.errorMsg || '');
                const combinedMsg = `${messages} ${errorMsg}`.toLowerCase();
                
                // 检查是否包含会话失效的关键词
                if (SESSION_INVALID_PATTERNS.some(pattern => 
                    combinedMsg.includes(pattern.toLowerCase())
                )) {
                    return ErrorType.SESSION_INVALID;
                }
                
                // 检查HTTP状态码
                if (axiosError.response?.status === 401 || 
                    axiosError.response?.status === 403 ||
                    data.httpstatus === 401) {
                    return ErrorType.SESSION_INVALID;
                }
            }
        }
        
        // 检查是否为网络错误
        if (axiosError.code === 'ECONNABORTED' ||
            axiosError.code === 'ETIMEDOUT' ||
            axiosError.code === 'ENOTFOUND' ||
            axiosError.code === 'ECONNREFUSED') {
            return ErrorType.NETWORK_ERROR;
        }
        
        // 检查是否为限流
        if (axiosError.response?.status === 429) {
            return ErrorType.RATE_LIMIT;
        }
        
        return ErrorType.UNKNOWN;
    }

    /**
     * 包装错误为SessionError
     */
    private wrapError(error: unknown, type: ErrorType): SessionError {
        if (error instanceof SessionError) {
            return error;
        }
        
        let message = 'Request failed';
        if (axios.isAxiosError(error)) {
            message = error.message;
        } else if (error instanceof Error) {
            message = error.message;
        }
        
        return new SessionError(type, message, error);
    }

    /**
     * 判断是否为会话失效错误（向后兼容）
     * @deprecated 使用 classifyError 替代
     */
    private isSessionInvalidError(error: unknown): boolean {
        return this.classifyError(error) === ErrorType.SESSION_INVALID;
    }

    /**
     * 获取当前并发请求数
     */
    public getConcurrentRequests(): number {
        return this.concurrentRequests;
    }

    /**
     * 健康检查
     */
    public async healthCheck(): Promise<boolean> {
        try {
            const response = await axios.get(API_CONSTANTS.BASE_URL, {
                timeout: 5000,
                validateStatus: () => true,
            });
            return response.status < 500;
        } catch (error) {
            console.error('[ApiClient] Health check failed:', error);
            return false;
        }
    }
}

// 导出单例实例
export const apiClient = new ApiClient();