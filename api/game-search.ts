import { env, fetchWithTimeout, handle, json, requireUser } from './_lib/auth.js';
import type { GamePlatform, GameSearchResult } from '../shared/types.js';

let igdbTokenCache: { token: string; expiresAt: number } | null = null;

const getIgdbToken = async (): Promise<{ token: string; clientId: string } | null> => {
  const clientId = env('IGDB_CLIENT_ID');
  const clientSecret = env('IGDB_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;

  if (igdbTokenCache && igdbTokenCache.expiresAt > Date.now() + 60_000) {
    return { token: igdbTokenCache.token, clientId };
  }

  const res = await fetchWithTimeout(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  igdbTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return { token: data.access_token, clientId };
};

const searchSteam = async (query: string): Promise<GameSearchResult[]> => {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=tchinese&cc=TW`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    items?: Array<{ id: number; name: string; tiny_image?: string }>;
  };
  return (data.items || []).slice(0, 8).map((item) => ({
    title: item.name,
    platform: 'PC' as GamePlatform,
    steamAppId: item.id,
    imageUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${item.id}/header.jpg`,
    source: 'steam' as const,
  }));
};

const searchIgdb = async (query: string, preferredPlatform: GamePlatform): Promise<GameSearchResult[]> => {
  const auth = await getIgdbToken();
  if (!auth) return [];
  const escaped = query.replace(/"/g, '\\"');
  const res = await fetchWithTimeout('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': auth.clientId,
      Authorization: `Bearer ${auth.token}`,
      'content-type': 'text/plain',
    },
    body: `search "${escaped}"; fields id,name,cover.image_id; limit 8;`,
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{ id: number; name: string; cover?: { image_id?: string } }>;
  return rows.map((row) => ({
    title: row.name,
    platform: preferredPlatform,
    igdbId: row.id,
    imageUrl: row.cover?.image_id
      ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${row.cover.image_id}.jpg`
      : undefined,
    source: 'igdb' as const,
  }));
};

export const GET = handle(async (request) => {
  await requireUser(request);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const rawPlatform = (url.searchParams.get('platform') || 'PC').toUpperCase();
  const platform: GamePlatform =
    rawPlatform === 'PS' || rawPlatform === 'SWITCH' || rawPlatform === 'XBOX' ? rawPlatform : 'PC';

  if (q.length < 2) return json({ results: [] });

  const [steamRes, igdbRes] = await Promise.allSettled([
    searchSteam(q),
    searchIgdb(q, platform),
  ]);

  const steamItems = steamRes.status === 'fulfilled' ? steamRes.value : [];
  const igdbItems = igdbRes.status === 'fulfilled' ? igdbRes.value : [];

  // 若選擇 PS/SWITCH 優先顯示 IGDB（同時附 Steam 作為跨平台封面參考）
  const combined =
    platform === 'PC'
      ? [...steamItems, ...igdbItems]
      : [...igdbItems, ...steamItems.map((item) => ({ ...item, platform }))];

  const seen = new Set<string>();
  const deduped: GameSearchResult[] = [];
  for (const item of combined) {
    const key = `${item.title.toLowerCase()}|${item.steamAppId ?? ''}|${item.igdbId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= 10) break;
  }

  return json({ results: deduped });
});
