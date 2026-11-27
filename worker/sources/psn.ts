import {
  exchangeRefreshTokenForAuthTokens,
  getPurchasedGames,
  getUserPlayedGames,
} from 'psn-api';
import type { PsnSecretDoc, WishlistGameRecord } from '../../shared/types.js';

export interface PsnOwnedItem {
  titleId: string;
  conceptId?: string;
  productId?: string;
  name: string;
  imageUrl?: string;
  sourceDetail: 'purchased' | 'played';
}

export interface PsnPriceQuote {
  title?: string;
  productId?: string;
  conceptId?: string;
  currentPriceTwd: number;
  regularPriceTwd: number;
  discountPercent: number;
  storeUrl: string;
  priceTrackerUrl: string;
  imageUrl?: string;
}

export interface PsnWishlistEntry {
  title: string;
  conceptId?: string;
  productId?: string;
  imageUrl?: string;
  currentPriceTwd?: number;
  regularPriceTwd?: number;
  discountPercent?: number;
  storeUrl: string;
}

/** 檢查 refreshToken 狀態並換取最新的 accessToken */
export const refreshPsnAuthorization = async (
  secret: PsnSecretDoc
): Promise<{
  accessToken: string;
  nextSecret: PsnSecretDoc;
}> => {
  const tokens = await exchangeRefreshTokenForAuthTokens(secret.refreshToken);
  const now = Date.now();
  const nextRefresh = tokens.refreshToken || secret.refreshToken;
  const nextExpiresAt =
    typeof tokens.refreshTokenExpiresIn === 'number' && tokens.refreshTokenExpiresIn > 0
      ? now + tokens.refreshTokenExpiresIn * 1000
      : secret.expiresAt;

  return {
    accessToken: tokens.accessToken,
    nextSecret: {
      refreshToken: nextRefresh,
      expiresAt: nextExpiresAt,
      updatedAt: now,
    },
  };
};

/**
 * 同步 PS4/PS5 已購買數位庫（含 PS+ 領取）與近期遊玩清單（連放進主機玩過的實體片也能抓到！）
 * 單次排程保守分頁並加間隔，避免觸發 Sony 限流。
 */
export const fetchPsnOwnedAndPlayed = async (accessToken: string): Promise<PsnOwnedItem[]> => {
  const auth = { accessToken };
  const map = new Map<string, PsnOwnedItem>();

  // 1. 數位已購買與 PS+ 遊戲（分頁最多抓 800 款）
  for (let page = 0; page < 8; page += 1) {
    try {
      const res = await getPurchasedGames(auth, {
        platform: ['ps4', 'ps5'],
        size: 100,
        start: page * 100,
      });
      const games = res.data?.purchasedTitlesRetrieve?.games || [];
      for (const g of games) {
        if (!g.titleId || !g.name) continue;
        map.set(g.titleId, {
          titleId: g.titleId,
          conceptId: g.conceptId || undefined,
          productId: g.productId || undefined,
          name: g.name,
          imageUrl: g.image?.url || undefined,
          sourceDetail: 'purchased',
        });
      }
      if (games.length < 100) break;
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      console.warn(`[PSN] getPurchasedGames 第 ${page + 1} 頁失敗：`, (err as Error).message);
      break;
    }
  }

  // 2. 已遊玩清單（補齊實體光碟遊戲）
  try {
    const played = await getUserPlayedGames(auth, 'me', { limit: 150, offset: 0 });
    for (const title of played.titles || []) {
      const tid = title.titleId;
      if (!tid || !title.name || map.has(tid)) continue;
      map.set(tid, {
        titleId: tid,
        conceptId: title.concept?.id ? String(title.concept.id) : undefined,
        name: title.localizedName || title.name,
        imageUrl: title.localizedImageUrl || title.imageUrl || undefined,
        sourceDetail: 'played',
      });
    }
  } catch (err) {
    console.warn('[PSN] getUserPlayedGames 失敗（不影響已購買庫）：', (err as Error).message);
  }

  return Array.from(map.values());
};

/** 解析 "NT$1,190" / "NT$ 595" / "免費" 為數字 */
export const parseTwdPriceString = (raw?: string | null): number | null => {
  if (!raw) return null;
  if (/免費|free/i.test(raw)) return 0;
  const cleaned = raw.replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const val = Number(cleaned);
  return Number.isFinite(val) ? Math.round(val) : null;
};

/**
 * 嘗試透過 PlayStation Store GraphQL 讀取使用者的台灣區 PSN 願望清單（Best-Effort）。
 * Sony 偶爾會輪換 GraphQL sha256Hash，可透過環境變數 PSN_WISHLIST_SHA256 覆寫，失敗時不中斷主流程。
 */
export const fetchPsnWishlistBestEffort = async (
  accessToken: string
): Promise<{ items: PsnWishlistEntry[]; ok: boolean }> => {
  const sha256Hash =
    process.env.PSN_WISHLIST_SHA256 ||
    '9a76a0b609362221560b4750f340e12726259a28d882124208062c6f18e0f384';

  const extensions = JSON.stringify({
    persistedQuery: { version: 1, sha256Hash },
  });
  const variables = JSON.stringify({
    pageArgs: { size: 100, offset: 0 },
  });

  const url =
    `https://web.np.playstation.com/api/graphql/v1/op?operationName=wishlistItemsRetrieve` +
    `&variables=${encodeURIComponent(variables)}&extensions=${encodeURIComponent(extensions)}`;

  try {
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'apollographql-client-name': 'PlayStationApp-Android',
        'x-psn-store-locale-override': 'zh-Hant-TW',
        'accept-language': 'zh-Hant-TW,zh-TW;q=0.9',
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      return { items: [], ok: false };
    }

    const json = (await res.json()) as {
      data?: {
        wishlistItemsRetrieve?: {
          items?: Array<{
            id?: string;
            productId?: string;
            conceptId?: string;
            name?: string;
            media?: Array<{ url?: string; role?: string }>;
            price?: {
              basePrice?: string;
              discountedPrice?: string;
              discountText?: string;
            };
          }>;
        };
      };
      errors?: unknown[];
    };

    if (json.errors && !json.data?.wishlistItemsRetrieve?.items) {
      return { items: [], ok: false };
    }

    const rawItems = json.data?.wishlistItemsRetrieve?.items || [];
    const items: PsnWishlistEntry[] = [];
    for (const row of rawItems) {
      if (!row.name) continue;
      const regular = parseTwdPriceString(row.price?.basePrice);
      const current = parseTwdPriceString(row.price?.discountedPrice) ?? regular;
      const discText = row.price?.discountText || '';
      const discMatch = discText.match(/(\d+)\s*%/);
      const discountPercent = discMatch
        ? Number(discMatch[1])
        : regular && current !== null && regular > current
          ? Math.round(((regular - current) / regular) * 100)
          : 0;

      const storeUrl = row.productId
        ? `https://store.playstation.com/zh-hant-tw/product/${row.productId}`
        : row.conceptId
          ? `https://store.playstation.com/zh-hant-tw/concept/${row.conceptId}`
          : `https://store.playstation.com/zh-hant-tw/search/${encodeURIComponent(row.name)}`;

      items.push({
        title: row.name,
        conceptId: row.conceptId,
        productId: row.productId,
        imageUrl: row.media?.[0]?.url,
        currentPriceTwd: current ?? undefined,
        regularPriceTwd: regular ?? undefined,
        discountPercent,
        storeUrl,
      });
    }
    return { items, ok: true };
  } catch {
    return { items: [], ok: false };
  }
};

/** 從 PlayStation Store 台灣頁面的 __NEXT_DATA__ 解析商品價格與折扣 */
export const parsePsStoreNextDataPrice = (
  html: string,
  fallbackStoreUrl: string,
  titleForTracker: string
): PsnPriceQuote | null => {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match) return null;

  try {
    const nextData = JSON.parse(match[1]) as Record<string, unknown>;
    const rawStr = JSON.stringify(nextData);

    // 尋找第一個含 basePrice 與 discountedPrice 的標準 PS Store Price 物件
    const priceMatch = rawStr.match(
      /"basePrice"\s*:\s*"([^"]+)"[^}]*?"discountedPrice"\s*:\s*"([^"]+)"/
    );
    if (!priceMatch) return null;

    const regularPriceTwd = parseTwdPriceString(priceMatch[1]);
    const currentPriceTwd = parseTwdPriceString(priceMatch[2]);
    if (regularPriceTwd === null || currentPriceTwd === null) return null;

    const discountPercent =
      regularPriceTwd > currentPriceTwd && regularPriceTwd > 0
        ? Math.round(((regularPriceTwd - currentPriceTwd) / regularPriceTwd) * 100)
        : 0;

    const productIdMatch = rawStr.match(/"productId"\s*:\s*"([A-Z0-9_-]{12,60})"/);
    const productId = productIdMatch?.[1];
    const storeUrl = productId
      ? `https://store.playstation.com/zh-hant-tw/product/${productId}`
      : fallbackStoreUrl;

    return {
      productId,
      currentPriceTwd,
      regularPriceTwd,
      discountPercent,
      storeUrl,
      priceTrackerUrl: `https://platprices.com/search.php?q=${encodeURIComponent(titleForTracker)}`,
    };
  } catch {
    return null;
  }
};

/** 查詢單款 PS5 願望清單遊戲在台灣 PlayStation Store 的即時售價 */
export const fetchPsStoreTwPrice = async (
  item: Pick<WishlistGameRecord, 'title' | 'externalIds' | 'currentStoreUrl'>
): Promise<PsnPriceQuote | null> => {
  const targetUrl = item.externalIds?.psnProductId
    ? `https://store.playstation.com/zh-hant-tw/product/${item.externalIds.psnProductId}`
    : item.externalIds?.psnConceptId
      ? `https://store.playstation.com/zh-hant-tw/concept/${item.externalIds.psnConceptId}`
      : item.currentStoreUrl && /store\.playstation\.com/i.test(item.currentStoreUrl)
        ? item.currentStoreUrl
        : `https://store.playstation.com/zh-hant-tw/search/${encodeURIComponent(item.title)}`;

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return parsePsStoreNextDataPrice(html, targetUrl, item.title);
  } catch {
    return null;
  }
};
