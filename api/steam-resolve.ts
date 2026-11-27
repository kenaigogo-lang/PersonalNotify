import { fetchWithTimeout, handle, json, requireUser } from './_lib/auth.js';

const fetchTitle = async (appid: number): Promise<[number, string] | null> => {
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=tw&l=tchinese&filters=basic`;
    const res = await fetchWithTimeout(url, {}, 5000);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { success?: boolean; data?: { name?: string } }>;
    const name = data[String(appid)]?.data?.name;
    return name ? [appid, name] : null;
  } catch {
    return null;
  }
};

/** 批次將 Steam AppIDs 轉換為繁體中文遊戲名稱（供私人 JSON 匯入使用，單次最多 40 筆） */
export const POST = handle(async (request) => {
  await requireUser(request);

  const body = (await request.json().catch(() => ({}))) as { appIds?: unknown };
  const rawList = Array.isArray(body.appIds) ? body.appIds : [];
  const appIds = Array.from(
    new Set(rawList.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))
  ).slice(0, 40);

  const titles: Record<string, string> = {};
  // 分小批並發避免 Steam Store 限流
  for (let i = 0; i < appIds.length; i += 8) {
    const batch = appIds.slice(i, i + 8);
    const settled = await Promise.all(batch.map((id) => fetchTitle(id)));
    for (const pair of settled) {
      if (pair) titles[String(pair[0])] = pair[1];
    }
  }

  return json({ titles });
});
