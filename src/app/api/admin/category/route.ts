/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// 支持的操作类型
type Action = 'add' | 'disable' | 'enable' | 'delete' | 'sort';

interface BaseBody {
  action?: Action;
}

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const hasRedis = !!(process.env.REDIS_URL || process.env.KV_REST_API_URL);
  const isLocalMode = storageType === 'localstorage' && !hasRedis;

  // 🔐 本地模式（无数据库）：跳过认证，返回成功
  // 安全性说明：仅当没有配置任何数据库时才启用此模式
  if (isLocalMode) {
    return NextResponse.json(
      {
        ok: true,
        storageMode: 'local',
        message: '请在前端保存配置到 localStorage',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const body = (await request.json()) as BaseBody & Record<string, any>;
    const { action } = body;

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    // 基础校验
    const ACTIONS: Action[] = ['add', 'disable', 'enable', 'delete', 'sort'];
    if (!username || !action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    // 获取配置与存储
    const adminConfig = await getConfig();

    // 权限与身份校验
    if (username !== process.env.USERNAME) {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username,
      );
      if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    switch (action) {
      case 'add': {
        const { name, type, query } = body as {
          name?: string;
          type?: 'movie' | 'tv';
          query?: string;
        };
        if (!name || !type || !query) {
          return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
        }
        // 检查是否已存在相同的查询和类型组合
        if (
          adminConfig.CustomCategories.some(
            (c) => c.query === query && c.type === type,
          )
        ) {
          return NextResponse.json({ error: '该分类已存在' }, { status: 400 });
        }
        adminConfig.CustomCategories.push({
          name,
          type,
          query,
          from: 'custom',
          disabled: false,
        });
        break;
      }
      case 'disable': {
        const { query, type } = body as {
          query?: string;
          type?: 'movie' | 'tv';
        };
        if (!query || !type)
          return NextResponse.json(
            { error: '缺少 query 或 type 参数' },
            { status: 400 },
          );
        const entry = adminConfig.CustomCategories.find(
          (c) => c.query === query && c.type === type,
        );
        if (!entry)
          return NextResponse.json({ error: '分类不存在' }, { status: 404 });
        entry.disabled = true;
        break;
      }
      case 'enable': {
        const { query, type } = body as {
          query?: string;
          type?: 'movie' | 'tv';
        };
        if (!query || !type)
          return NextResponse.json(
            { error: '缺少 query 或 type 参数' },
            { status: 400 },
          );
        const entry = adminConfig.CustomCategories.find(
          (c) => c.query === query && c.type === type,
        );
        if (!entry)
          return NextResponse.json({ error: '分类不存在' }, { status: 404 });
        entry.disabled = false;
        break;
      }
      case 'delete': {
        const { query, type } = body as {
          query?: string;
          type?: 'movie' | 'tv';
        };
        if (!query || !type)
          return NextResponse.json(
            { error: '缺少 query 或 type 参数' },
            { status: 400 },
          );
        const idx = adminConfig.CustomCategories.findIndex(
          (c) => c.query === query && c.type === type,
        );
        if (idx === -1)
          return NextResponse.json({ error: '分类不存在' }, { status: 404 });
        const entry = adminConfig.CustomCategories[idx];
        if (entry.from === 'config') {
          return NextResponse.json(
            { error: '该分类不可删除' },
            { status: 400 },
          );
        }
        adminConfig.CustomCategories.splice(idx, 1);
        break;
      }
      case 'sort': {
        const { order } = body as { order?: string[] };
        if (!Array.isArray(order)) {
          return NextResponse.json(
            { error: '排序列表格式错误' },
            { status: 400 },
          );
        }
        const map = new Map(
          adminConfig.CustomCategories.map((c) => [`${c.query}:${c.type}`, c]),
        );
        const newList: typeof adminConfig.CustomCategories = [];
        order.forEach((key) => {
          const item = map.get(key);
          if (item) {
            newList.push(item);
            map.delete(key);
          }
        });
        // 未在 order 中的保持原顺序
        adminConfig.CustomCategories.forEach((item) => {
          if (map.has(`${item.query}:${item.type}`)) newList.push(item);
        });
        adminConfig.CustomCategories = newList;
        break;
      }
      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    // 持久化到存储
    await db.saveAdminConfig(adminConfig);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    console.error('分类管理操作失败:', error);
    return NextResponse.json(
      {
        error: '分类管理操作失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
