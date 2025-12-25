import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { resetConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const isLocalMode = storageType === 'localstorage';

  // 本地模式：返回成功，前端需要清除 localStorage
  if (isLocalMode) {
    return NextResponse.json(
      {
        ok: true,
        storageMode: 'local',
        message: '请在前端清除 localStorage 配置',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  if (username !== process.env.USERNAME) {
    return NextResponse.json({ error: '仅支持站长重置配置' }, { status: 401 });
  }

  try {
    await resetConfig();

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 管理员配置不缓存
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: '重置管理员配置失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
