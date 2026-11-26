export interface SteamOwnedItem {
  appid: number;
  name: string;
  playtimeForever: number;
  imageUrl: string;
}

export interface SteamWishlistItem {
  appid: number;
  priority: number;
  dateAdded: number;
}

export interface SteamPriceQuote {
  appid: number;
  title?: string;
  itadId?: string;
  currentPriceTwd: number;
  regularPriceTwd: number;
  discountPercent: number;
  isHistoricalLow: boolean;
  historicalLowPriceTwd?: number | null;
  storeUrl: string;
  priceTrackerUrl?: string | null;
  imageUrl: string;
}

const STEAM_HEADER_IMG = (appid: number) =>
  `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;

const STEAM_STORE_URL = (appid: number) => `https://store.steampowered.com/app/${appid}/`;

/** 透過 Steam 官方 Web API 抓取玩家所有已擁有遊戲（包含買了但還沒玩的） */
export const fetchSteamOwnedGames = async (
  apiKey: string,
  steamId: string
): Promise<SteamOwnedItem[]> => {
  const url =
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&steamid=${encodeURIComponent(steamId)}` +
    `&include_appinfo=true&include_played_free_games=true&format=json`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`Steam GetOwnedGames 失敗 (HTTP ${res.status})`);
  }
  const data = (await res.json()) as {
    response?: {
      games?: Array<{ appid: number; name?: string; playtime_forever?: number }>;
    };
  };

  return (data.response?.games || [])
    .filter((g) => g.appid && g.name)
    .map((g) => ({
      appid: g.appid,
      name: g.name || `Steam App ${g.appid}`,
      playtimeForever: g.playtime_forever || 0,
      imageUrl: STEAM_HEADER_IMG(g.appid),
    }));
};

/** 透過 Steam 官方 IWishlistService/GetWishlist/v1 抓取公開願望清單 */
export const fetchSteamWishlist = async (
  steamId: string,
  apiKey?: string
): Promise<SteamWishlistItem[]> => {
  const params = new URLSearchParams({ steamid: steamId });
  if (apiKey) params.set('key', apiKey);
  const url = `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?${params.toString()}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`Steam GetWishlist 失敗 (HTTP ${res.status})`);
  }
  const data = (await res.json()) as {
    response?: {
      items?: Array<{ appid: number; priority?: number; date_added?: number }>;
    };
  };

  return (data.response?.items || []).map((item) => ({
    appid: item.appid,
    priority: item.priority || 0,
    dateAdded: item.date_added ? item.date_added * 1000 : Date.now(),
  }));
};

/** 單款查詢 Steam 商店詳細資料（補名稱與無 ITAD Key 時的備援價格） */
export const fetchSteamStoreAppDetails = async (
  appid: number
): Promise<{
  title?: string;
  currentPriceTwd?: number;
  regularPriceTwd?: number;
  discountPercent?: number;
} | null> => {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=tw&l=tchinese`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<
    string,
    {
      success?: boolean;
      data?: {
        name?: string;
        price_overview?: {
          initial?: number;
          final?: number;
          discount_percent?: number;
        };
      };
    }
  >;
  const entry = json[String(appid)];
  if (!entry?.success || !entry.data) return null;
  const po = entry.data.price_overview;
  return {
    title: entry.data.name,
    currentPriceTwd: po?.final !== undefined ? Math.round(po.final / 100) : undefined,
    regularPriceTwd: po?.initial !== undefined ? Math.round(po.initial / 100) : undefined,
    discountPercent: po?.discount_percent ?? 0,
  };
};

/** 批次將 Steam AppIDs 轉成 IsThereAnyDeal UUID（Shop ID 61 = Steam） */
const lookupItadIdsBySteamAppIds = async (
  appids: number[],
  itadApiKey: string
): Promise<Map<number, string>> => {
  const map = new Map<number, string>();
  const shopIds = appids.map((id) => `app/${id}`);

  for (let i = 0; i < shopIds.length; i += 100) {
    const chunk = shopIds.slice(i, i + 100);
    const res = await fetch(
      `https://api.isthereanydeal.com/lookup/id/shop/61/v1?key=${encodeURIComponent(itadApiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) continue;
    const data = (await res.json()) as Record<string, string | null>;
    for (const [shopKey, uuid] of Object.entries(data)) {
      if (!uuid) continue;
      const appid = Number(shopKey.replace(/^app\//, ''));
      if (Number.isFinite(appid)) map.set(appid, uuid);
    }
  }
  return map;
};

/**
 * 查詢 Steam 願望清單在台灣的即時價格與歷史最低價。
 * 有設定 ITAD_API_KEY 時走 IsThereAnyDeal API（含精準 Steam 史低價）；
 * 未設定時自動降級走 Steam Store API（仍可正常偵測折扣與自建最低價）。
 */
export const fetchSteamPricesAndLows = async (
  appids: number[],
  itadApiKey?: string
): Promise<Map<number, SteamPriceQuote>> => {
  const quotes = new Map<number, SteamPriceQuote>();
  const uniqueIds = Array.from(new Set(appids.filter((id) => Number.isFinite(id) && id > 0)));
  if (uniqueIds.length === 0) return quotes;

  if (itadApiKey) {
    try {
      const appToItad = await lookupItadIdsBySteamAppIds(uniqueIds, itadApiKey);
      const itadToApp = new Map<string, number>();
      const uuids: string[] = [];
      for (const [appid, uuid] of appToItad.entries()) {
        itadToApp.set(uuid, appid);
        uuids.push(uuid);
      }

      for (let i = 0; i < uuids.length; i += 100) {
        const chunk = uuids.slice(i, i + 100);
        const [pricesRes, lowsRes] = await Promise.all([
          fetch(
            `https://api.isthereanydeal.com/games/prices/v3?key=${encodeURIComponent(itadApiKey)}&country=TW&shops=61`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(chunk),
              signal: AbortSignal.timeout(15_000),
            }
          ),
          fetch(
            `https://api.isthereanydeal.com/games/storelow/v2?key=${encodeURIComponent(itadApiKey)}&country=TW&shops=61`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(chunk),
              signal: AbortSignal.timeout(15_000),
            }
          ),
        ]);

        const lowMap = new Map<string, number>();
        if (lowsRes.ok) {
          const lowsData = (await lowsRes.json()) as Array<{
            id: string;
            lows?: Array<{ price?: { amount?: number } }>;
          }>;
          for (const row of lowsData || []) {
            const amount = row.lows?.[0]?.price?.amount;
            if (typeof amount === 'number') lowMap.set(row.id, Math.round(amount));
          }
        }

        if (pricesRes.ok) {
          const pricesData = (await pricesRes.json()) as Array<{
            id: string;
            deals?: Array<{
              price?: { amount?: number };
              regular?: { amount?: number };
              cut?: number;
              storeLow?: { amount?: number };
              historyLow?: { amount?: number };
              url?: string;
            }>;
          }>;

          for (const row of pricesData || []) {
            const appid = itadToApp.get(row.id);
            const deal = row.deals?.[0];
            if (!appid || !deal || typeof deal.price?.amount !== 'number') continue;

            const currentPriceTwd = Math.round(deal.price.amount);
            const regularPriceTwd =
              typeof deal.regular?.amount === 'number'
                ? Math.round(deal.regular.amount)
                : currentPriceTwd;
            const discountPercent = typeof deal.cut === 'number' ? Math.round(deal.cut) : 0;

            const histCandidate =
              deal.storeLow?.amount ?? deal.historyLow?.amount ?? lowMap.get(row.id) ?? null;
            const historicalLowPriceTwd =
              typeof histCandidate === 'number' ? Math.round(histCandidate) : null;
            const isHistoricalLow =
              historicalLowPriceTwd !== null &&
              discountPercent > 0 &&
              currentPriceTwd <= historicalLowPriceTwd;

            quotes.set(appid, {
              appid,
              itadId: row.id,
              currentPriceTwd,
              regularPriceTwd,
              discountPercent,
              isHistoricalLow,
              historicalLowPriceTwd,
              storeUrl: deal.url || STEAM_STORE_URL(appid),
              priceTrackerUrl: `https://isthereanydeal.com/game/id:${row.id}/history/`,
              imageUrl: STEAM_HEADER_IMG(appid),
            });
          }
        }
      }
    } catch (err) {
      console.warn('[Steam/ITAD] ITAD 查詢失敗，將針對缺少項目改用 Steam Store API:', err);
    }
  }

  // 針對尚未取得價格的項目，使用 Steam Store API 補齊（加小延遲避免限流）
  const missing = uniqueIds.filter((id) => !quotes.has(id));
  for (const appid of missing) {
    const detail = await fetchSteamStoreAppDetails(appid).catch(() => null);
    if (detail && typeof detail.currentPriceTwd === 'number') {
      quotes.set(appid, {
        appid,
        title: detail.title,
        currentPriceTwd: detail.currentPriceTwd,
        regularPriceTwd: detail.regularPriceTwd ?? detail.currentPriceTwd,
        discountPercent: detail.discountPercent ?? 0,
        isHistoricalLow: false,
        historicalLowPriceTwd: null,
        storeUrl: STEAM_STORE_URL(appid),
        priceTrackerUrl: `https://steamdb.info/app/${appid}/`,
        imageUrl: STEAM_HEADER_IMG(appid),
      });
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return quotes;
};
