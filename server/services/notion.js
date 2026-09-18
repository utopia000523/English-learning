// Notion 单向同步（本地 → Notion）。阶段 5 实现 sync()
export async function status(settings) {
  if (!settings.notionToken) return { ok: false, detail: '未配置', fix: '在「设置 → Notion 同步」填写 Token', optional: true };
  try {
    const res = await fetch('https://api.notion.com/v1/users/me', {
      headers: { Authorization: `Bearer ${settings.notionToken}`, 'Notion-Version': '2022-06-28' },
      signal: AbortSignal.timeout(4000),
    });
    return res.ok ? { ok: true, detail: '已连接' } : { ok: false, detail: `Token 无效（${res.status}）`, optional: true };
  } catch {
    return { ok: false, detail: '当前无法联网，同步会排队', optional: true };
  }
}
export async function sync() {
  throw Object.assign(new Error('Notion 同步将在阶段 5 实现'), { code: 'NOT_IMPLEMENTED' });
}
