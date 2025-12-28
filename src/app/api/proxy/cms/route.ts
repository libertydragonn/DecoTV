/* eslint-disable no-console */
/**
 * CMS 代理接口 (Node.js Runtime)
 *
 * 用途：解决 Mixed Content Blocking 问题
 * - HTTPS 页面无法直接请求 HTTP 的第三方采集源 API
 * - 通过服务端代理转发请求，绕过浏览器限制
 *
 * 使用方式：
 * GET /api/proxy/cms?url=<encodeURIComponent(targetUrl)>
 *
 * 技术选择：
 * - 使用 Node.js Runtime（非 Edge）以获得更好的网络兼容性
 * - Node.js 对各类老旧 CMS 接口的非标响应处理更宽容
 *
 * 🛡️ 纵深防御策略 (Layer 2):
 * - 拦截对成人源的代理请求，防止 OrionTV 等客户端绕过配置过滤
 */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

// 使用 Node.js Runtime（更好的兼容性）
export const runtime = 'nodejs';

// 禁用缓存
export const fetchCache = 'force-no-store';

// 允许的 API 路径模式（安全白名单）
const ALLOWED_PATTERNS = [
  /\?ac=class/i, // 获取分类
  /\?ac=list/i, // 获取列表
  /\?ac=videolist/i, // 获取视频列表
  /\?ac=detail/i, // 获取详情
  /\/api\.php/i, // 常见 CMS API 路径
  /\/provide\/vod/i, // 苹果 CMS 路径
  /\/api\/vod/i, // 其他常见路径
  /\/index\.php/i, // index.php 入口
];

// 伪装 Headers（模拟真实浏览器）
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, application/xml, text/xml, text/html, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
  Connection: 'keep-alive',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

  // 参数验证
  if (!targetUrl) {
    return NextResponse.json(
      { error: '缺少 url 参数', code: 'MISSING_URL' },
      { status: 400 },
    );
  }

  // 解码 URL
  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(targetUrl);
  } catch (e) {
    return NextResponse.json(
      { error: 'URL 解码失败', code: 'DECODE_ERROR', details: String(e) },
      { status: 400 },
    );
  }

  // 安全检查：验证是否为合法的 CMS API 请求
  const isAllowed = ALLOWED_PATTERNS.some((pattern) =>
    pattern.test(decodedUrl),
  );
  if (!isAllowed) {
    console.warn('[CMS Proxy] ⛔ Blocked:', decodedUrl);
    return NextResponse.json(
      { error: '不允许代理此 URL', code: 'BLOCKED', target: decodedUrl },
      { status: 403 },
    );
  }

  // ========================================
  // 🛡️ 纵深防御 Layer 2: 成人源拦截
  // 即使客户端试图直接请求成人源，也会被拦截
  // ========================================
  const filterParam = searchParams.get('filter');
  const isAdultModeEnabled = filterParam === 'off'; // 只有显式 filter=off 才允许成人内容

  if (!isAdultModeEnabled) {
    try {
      // 获取配置中的所有源
      const cfg = await getConfig();
      const allSources = cfg.SourceConfig || [];

      // 检查请求的 URL 是否属于成人源
      const targetOrigin = new URL(decodedUrl).origin.toLowerCase();

      const matchedAdultSource = allSources.find((source) => {
        if (source.is_adult !== true) return false;
        try {
          const sourceOrigin = new URL(source.api).origin.toLowerCase();
          return (
            targetOrigin === sourceOrigin ||
            decodedUrl.toLowerCase().includes(sourceOrigin)
          );
        } catch {
          // 如果源 API 不是有效 URL，尝试字符串包含匹配
          return decodedUrl.toLowerCase().includes(source.api.toLowerCase());
        }
      });

      if (matchedAdultSource) {
        console.log(
          `[CMS Proxy] 🚫 拦截未授权的成人源请求: ${matchedAdultSource.key} (${matchedAdultSource.name})`,
        );
        console.log(`[CMS Proxy] 🚫 被拦截的 URL: ${decodedUrl}`);

        // 返回空数据，而不是 403，避免客户端报错
        return NextResponse.json(
          {
            code: 1,
            msg: 'access denied',
            list: [],
            class: [],
            total: 0,
            page: 1,
            pagecount: 0,
          },
          {
            status: 200,
            headers: corsHeaders(),
          },
        );
      }
    } catch (err) {
      // 配置获取失败不应阻止正常请求，记录警告并继续
      console.warn('[CMS Proxy] ⚠️ 无法检查成人源配置:', err);
    }
  }

  console.log('[CMS Proxy] 🚀 Fetching:', decodedUrl);

  try {
    // 解析目标 URL 获取 origin 用于 Referer
    let origin = '';
    try {
      origin = new URL(decodedUrl).origin;
    } catch {
      // URL 解析失败，不设置 Referer
    }

    // 构建请求 Headers
    const headers: Record<string, string> = {
      ...BROWSER_HEADERS,
    };
    if (origin) {
      headers['Referer'] = origin + '/';
      headers['Origin'] = origin;
    }

    // 创建 AbortController 用于超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20秒超时

    try {
      // 发起服务端请求（Node.js Runtime，不受 Mixed Content 限制）
      const response = await fetch(decodedUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);

      console.log(
        '[CMS Proxy] 📡 Response:',
        response.status,
        response.statusText,
      );

      // 检查响应状态
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(
          '[CMS Proxy] ❌ Upstream error:',
          response.status,
          errorText.substring(0, 200),
        );
        return NextResponse.json(
          {
            error: `上游服务器返回 ${response.status}`,
            code: 'UPSTREAM_ERROR',
            status: response.status,
            target: decodedUrl,
          },
          {
            status: 502,
            headers: corsHeaders(),
          },
        );
      }

      // 获取响应内容
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();

      console.log(
        '[CMS Proxy] 📦 Content-Type:',
        contentType,
        'Length:',
        text.length,
      );

      // 尝试解析为 JSON
      let data;
      try {
        // 某些源返回的 JSON 前面可能有 BOM 或空白字符
        const cleanText = text.trim().replace(/^\uFEFF/, '');
        data = JSON.parse(cleanText);
      } catch {
        // 如果不是 JSON，可能是 XML 或其他格式，返回原始文本
        console.log('[CMS Proxy] ⚠️ Not JSON, returning raw text');
        return new NextResponse(text, {
          status: 200,
          headers: {
            'Content-Type': contentType || 'text/plain; charset=utf-8',
            ...corsHeaders(),
            'X-Proxy-Time': `${Date.now() - startTime}ms`,
          },
        });
      }

      const elapsed = Date.now() - startTime;
      console.log(
        '[CMS Proxy] ✅ Success in',
        elapsed,
        'ms, keys:',
        Object.keys(data),
      );

      // 返回 JSON 响应
      return NextResponse.json(data, {
        headers: {
          ...corsHeaders(),
          'X-Proxy-Time': `${elapsed}ms`,
        },
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error('[CMS Proxy] 💥 Error after', elapsed, 'ms:', error);

    // 详细的错误分类
    let errorCode = 'UNKNOWN_ERROR';
    let errorMessage = '代理请求失败';
    let statusCode = 502; // Bad Gateway

    if (error instanceof Error) {
      const errName = error.name;
      const errMsg = error.message;

      if (errName === 'AbortError' || errMsg.includes('aborted')) {
        errorCode = 'TIMEOUT';
        errorMessage = '请求超时（20秒）';
        statusCode = 504; // Gateway Timeout
      } else if (
        errMsg.includes('ENOTFOUND') ||
        errMsg.includes('getaddrinfo')
      ) {
        errorCode = 'DNS_ERROR';
        errorMessage = '无法解析目标域名';
      } else if (errMsg.includes('ECONNREFUSED')) {
        errorCode = 'CONNECTION_REFUSED';
        errorMessage = '目标服务器拒绝连接';
      } else if (
        errMsg.includes('ECONNRESET') ||
        errMsg.includes('socket hang up')
      ) {
        errorCode = 'CONNECTION_RESET';
        errorMessage = '连接被重置';
      } else if (errMsg.includes('ETIMEDOUT')) {
        errorCode = 'CONNECT_TIMEOUT';
        errorMessage = '连接超时';
        statusCode = 504;
      } else if (
        errMsg.includes('certificate') ||
        errMsg.includes('SSL') ||
        errMsg.includes('TLS')
      ) {
        errorCode = 'SSL_ERROR';
        errorMessage = 'SSL/TLS 证书错误';
      } else if (errMsg.includes('EHOSTUNREACH')) {
        errorCode = 'HOST_UNREACHABLE';
        errorMessage = '无法访问目标主机';
      } else {
        errorMessage = errMsg;
      }
    }

    return NextResponse.json(
      {
        error: errorMessage,
        code: errorCode,
        target: decodedUrl,
        elapsed: `${elapsed}ms`,
        details: error instanceof Error ? error.message : String(error),
      },
      {
        status: statusCode,
        headers: corsHeaders(),
      },
    );
  }
}

// 处理 CORS 预检请求
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders(),
      'Access-Control-Max-Age': '86400',
    },
  });
}

// CORS Headers 辅助函数
function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
  };
}
