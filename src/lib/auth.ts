import { NextRequest } from 'next/server';

// 单例缓存，避免重复打印警告
let cachedSecret: string | null | undefined;
let warnedMissingSecret = false;

// 统一获取鉴权密钥，Docker/开发环境缺失时给出警告，并在非生产环境提供安全性有限的后备值
export function getAuthSecret(): string | null {
  if (cachedSecret !== undefined) return cachedSecret;

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    const isProd = process.env.NODE_ENV === 'production';
    if (!warnedMissingSecret) {
      // eslint-disable-next-line no-console
      console.warn(
        'WARNING: NEXTAUTH_SECRET/AUTH_SECRET is missing. Docker 部署请通过 -e AUTH_SECRET=... 注入，生成命令: openssl rand -base64 32',
      );
      warnedMissingSecret = true;
    }
    // 仅非生产环境提供后备，防止本地/Docker 开发直接 401
    cachedSecret = isProd ? null : 'dev-fallback-secret-do-not-use-in-prod';
    return cachedSecret;
  }

  cachedSecret = secret;
  return secret;
}

// 从cookie获取认证信息 (服务端使用)
export function getAuthInfoFromCookie(request: NextRequest): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
} | null {
  const authCookie = request.cookies.get('auth');

  if (!authCookie) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(authCookie.value);
    const authData = JSON.parse(decoded);
    return authData;
  } catch {
    return null;
  }
}

// 从cookie获取认证信息 (客户端使用)
export function getAuthInfoFromBrowserCookie(): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
  role?: 'owner' | 'admin' | 'user';
} | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // 解析 document.cookie
    const cookies = document.cookie.split(';').reduce(
      (acc, cookie) => {
        const trimmed = cookie.trim();
        const firstEqualIndex = trimmed.indexOf('=');

        if (firstEqualIndex > 0) {
          const key = trimmed.substring(0, firstEqualIndex);
          const value = trimmed.substring(firstEqualIndex + 1);
          if (key && value) {
            acc[key] = value;
          }
        }

        return acc;
      },
      {} as Record<string, string>,
    );

    const authCookie = cookies['auth'];
    if (!authCookie) {
      return null;
    }

    // 处理可能的双重编码
    let decoded = decodeURIComponent(authCookie);

    // 如果解码后仍然包含 %，说明是双重编码，需要再次解码
    if (decoded.includes('%')) {
      decoded = decodeURIComponent(decoded);
    }

    const authData = JSON.parse(decoded);
    return authData;
  } catch {
    return null;
  }
}
