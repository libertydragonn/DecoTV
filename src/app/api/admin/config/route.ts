/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfigResult } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, getLocalModeConfig } from '@/lib/config';

export const runtime = 'nodejs';

// 扩展返回类型，支持本地模式标识
interface AdminConfigResultWithMode extends AdminConfigResult {
  storageMode: 'cloud' | 'local'; // 标识当前存储模式
}

export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  // 本地存储模式：返回降级配置而非错误
  if (storageType === 'localstorage') {
    // 仍需验证身份（本地模式下使用环境变量中的用户名）
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 返回本地模式配置，附带 storageMode 标识
    const localConfig = getLocalModeConfig();
    const result: AdminConfigResultWithMode = {
      Role: authInfo.username === process.env.USERNAME ? 'owner' : 'admin',
      Config: localConfig,
      storageMode: 'local', // 告诉前端当前是本地模式
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  try {
    const config = await getConfig();
    const result: AdminConfigResultWithMode = {
      Role: 'owner',
      Config: config,
      storageMode: 'cloud', // 云端模式
    };
    if (username === process.env.USERNAME) {
      result.Role = 'owner';
    } else {
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (user && user.role === 'admin' && !user.banned) {
        result.Role = 'admin';
      } else {
        return NextResponse.json(
          { error: '你是管理员吗你就访问？' },
          { status: 401 },
        );
      }
    }

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store', // 管理员配置不缓存
      },
    });
  } catch (error) {
    console.error('获取管理员配置失败:', error);
    return NextResponse.json(
      {
        error: '获取管理员配置失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
