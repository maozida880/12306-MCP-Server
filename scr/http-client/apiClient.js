// src/http-client/apiClient.ts

import axios, { AxiosRequestConfig, AxiosError } from 'axios';
import { sessionManager } from './sessionManager.js';

/**
 * ApiClient 类
 * 统一的 API 请求客户端,替代旧的 make12306Request 函数
 */
class ApiClient {
    /**
     * 统一的 GET 方法
     * @param url 请求URL
     * @param params URL查询参数
     * @returns 响应数据
     */
    public async get<T>(
        url: string | URL,
        params?: URLSearchParams
    ): Promise<T> {
        const session = await sessionManager.getSession();
        
        try {
            const credentials = session.getCredentials();
            const config: AxiosRequestConfig = {
                headers: {
                    'Cookie': this.formatCookies(credentials.cookies),
                    'User-Agent': credentials.userAgent,
                },
                params: params,
            };
            
            const fullUrl = typeof url === 'string' ? url : url.toString();
            console.log(`[ApiClient] GET ${fullUrl} using session ${session.id}`);
            
            const response = await axios.get<T>(fullUrl, config);
            
            console.log(`[ApiClient] Request succeeded for session ${session.id}`);
            return response.data;
            
        } catch (error) {
            console.error(`[ApiClient] Request failed for session ${session.id}:`, error);
            
            // 判断是否为会话失效错误
            if (this.isSessionInvalidError(error)) {
                console.warn(`[ApiClient] Session ${session.id} is invalid, invalidating...`);
                sessionManager.invalidateSession(session.id);
            }
            
            throw error; // 向上层抛出,让业务逻辑决定如何处理
            
        } finally {
            // 确保会话被释放
            sessionManager.releaseSession(session.id);
        }
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
     * 判断是否为会话失效错误
     * 根据12306返回的实际错误信息来判断
     */
    private isSessionInvalidError(error: unknown): boolean {
        if (!axios.isAxiosError(error)) {
            return false;
        }
        
        const axiosError = error as AxiosError;
        
        // 检查响应体中是否包含登录相关的错误信息
        if (axiosError.response?.data) {
            const data = axiosError.response.data as any;
            
            // 检查常见的会话失效标志
            if (typeof data === 'object') {
                const messages = data.messages || data.message || '';
                const errorMsg = data.errorMsg || '';
                
                return (
                    messages.includes('您还没有登录') ||
                    messages.includes('请先登录') ||
                    errorMsg.includes('您还没有登录') ||
                    errorMsg.includes('请先登录') ||
                    data.httpstatus === 401
                );
            }
        }
        
        // 检查 HTTP 状态码
        if (axiosError.response?.status === 401 || axiosError.response?.status === 403) {
            return true;
        }
        
        return false;
    }
}

// 导出单例实例
export const apiClient = new ApiClient();