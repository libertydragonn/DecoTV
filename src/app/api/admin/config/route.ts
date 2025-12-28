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
  const hasRedis = !!(process.env.REDIS_URL || process.env.KV_REST_API_URL);

  // 🔐 本地存储模式（无数据库）：免登录访问
  // 安全性说明：仅当没有配置任何数据库时才启用此模式
  // 这解决了"鸡生蛋"问题：用户需要先进入面板配置系统
  if (storageType === 'localstorage' && !hasRedis) {
    // 尝试获取认证信息（可能为空）
    const authInfo = getAuthInfoFromCookie(request);

    // 本地模式下，即使没有登录也返回配置
    // 角色判断：如果有认证信息且用户名匹配，则为 owner；否则默认 owner（本地模式）
    const isOwner =
      !authInfo?.username || authInfo.username === process.env.USERNAME;

    const localConfig = getLocalModeConfig();
    const result: AdminConfigResultWithMode = {
      Role: isOwner ? 'owner' : 'admin',
      Config: localConfig,
      storageMode: 'local', // 告诉前端当前是本地模式（无数据库）
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
