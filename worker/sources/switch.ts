import { SWITCH_REGIONS, type SwitchRegion, type WishlistGameRecord } from '../../shared/types.js';
import { convertToTwd, type FxRatesFromTwd } from './fx.js';

export interface SwitchRegionQuote {
  region: SwitchRegion;
  currency: string;
  regularRaw: number;
  currentRaw: number;
  regularPriceTwd: number;
  currentPriceTwd: number;
  discountPercent: number;
  paymentHint: string;
  storeUrl: string;
}

export interface SwitchBestPriceResult {
  nsuid: string;
  best: SwitchRegionQuote;
  allRegions: SwitchRegionQuote[];
  priceTrackerUrl: string;
}

interface NintendoPriceItem {
  title_id?: number | string;
  sales_status?: string;
  regular_price?: {
    raw_value?: string;
    currency?: string;
  };
  discount_price?: {
    raw_value?: string;
    currency?: string;
  };
}

const buildEshopUrl = (region: SwitchRegion, nsuid: string): string => {
  if (region === 'JP') return `https://store-jp.nintendo.com/item/software/D${nsuid}`;
  if (region === 'TW') return `https://ec.nintendo.com/TW/zh/titles/${nsuid}`;
  if (region === 'HK') return `https://ec.nintendo.com/HK/zh/titles/${nsuid}`;
  if (region === 'US') return `https://www.nintendo.com/us/search/#q=${nsuid}`;
  return `https://www.nintendo.com/es-mx/search/#q=${nsuid}`;
};

/** 透過任天堂官方日本搜尋 JSON 嘗試以遊戲名自動查找 14 碼 NSUID（當使用者尚未貼上 eShop 網址時） */
export const resolveSwitchNsuidByTitle = async (
  title: string
): Promise<{ nsuid: string; imageUrl?: string } | null> => {
  try {
    const url = `https://search.nintendo.jp/nintendo_soft/search.json?q=${encodeURIComponent(title)}&limit=5`;
    const res = await fetch(url, {
      headers: { 'user-agent': 'PersonalNotifyBot/1.0 (+https://github.com/kenaigogo-lang/PersonalNotify)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: {
        items?: Array<{ nsuid?: string; iurl?: string; title?: string }>;
      };
    };
    const hit = (data.result?.items || []).find((item) => item.nsuid && /^700\d{11}$/.test(item.nsuid));
    if (!hit?.nsuid) return null;
    return {
      nsuid: hit.nsuid,
      imageUrl: hit.iurl ? `https://img-eshop.cdn.nintendo.net/i/${hit.iurl}.jpg` : undefined,
    };
  } catch {
    return null;
  }
};

/** 解析任天堂 api.ec.nintendo.com/v1/price 回應為單區台幣比價物件 */
export const parseNintendoPriceItem = (
  item: NintendoPriceItem,
  region: SwitchRegion,
  fxRates: FxRatesFromTwd
): { nsuid: string; quote: SwitchRegionQuote } | null => {
  const nsuid = String(item.title_id || '').trim();
  if (!nsuid) return null;

  const regRaw = Number(item.regular_price?.raw_value);
  const currency = item.discount_price?.currency || item.regular_price?.currency || SWITCH_REGIONS[region].currency;
  if (!Number.isFinite(regRaw) || regRaw <= 0) return null;

  const discRawVal = item.discount_price?.raw_value !== undefined ? Number(item.discount_price.raw_value) : NaN;
  const currentRaw = Number.isFinite(discRawVal) && discRawVal >= 0 ? discRawVal : regRaw;

  const regularPriceTwd = convertToTwd(regRaw, currency, fxRates);
  const currentPriceTwd = convertToTwd(currentRaw, currency, fxRates);
  const discountPercent =
    regRaw > currentRaw ? Math.round(((regRaw - currentRaw) / regRaw) * 100) : 0;

  return {
    nsuid,
    quote: {
      region,
      currency,
      regularRaw: regRaw,
      currentRaw,
      regularPriceTwd,
      currentPriceTwd,
      discountPercent,
      paymentHint: SWITCH_REGIONS[region].paymentHint,
      storeUrl: buildEshopUrl(region, nsuid),
    },
  };
};

/** 批次查詢單一區域的任天堂 eShop 價格（每批最多 50 筆，含重試機制） */
export const fetchNintendoRegionPrices = async (
  region: SwitchRegion,
  nsuids: string[],
  fxRates: FxRatesFromTwd
): Promise<Map<string, SwitchRegionQuote>> => {
  const out = new Map<string, SwitchRegionQuote>();
  const unique = Array.from(new Set(nsuids.filter((id) => /^700\d{11}$/.test(id))));
  if (unique.length === 0) return out;

  const lang = region === 'JP' ? 'ja' : region === 'US' ? 'en' : region === 'MX' ? 'es' : 'zh';

  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const url = `https://api.ec.nintendo.com/v1/price?country=${region}&lang=${lang}&ids=${chunk.join(',')}`;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(url, {
          headers: { 'user-agent': 'PersonalNotifyBot/1.0' },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        if (!res.ok) break;

        const data = (await res.json()) as { prices?: NintendoPriceItem[] };
        for (const row of data.prices || []) {
          const parsed = parseNintendoPriceItem(row, region, fxRates);
          if (parsed) out.set(parsed.nsuid, parsed.quote);
        }
        break;
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  return out;
};

/** 跨多區比價（依使用者勾選區域如 TW/JP/HK/US/MX），選出換算台幣最便宜的購買區域 */
export const compareSwitchMultiRegionPrices = async (
  items: WishlistGameRecord[],
  regions: SwitchRegion[],
  fxRates: FxRatesFromTwd
): Promise<Map<string, SwitchBestPriceResult>> => {
  const results = new Map<string, SwitchBestPriceResult>();
  const activeRegions: SwitchRegion[] = regions.length > 0 ? regions : ['TW', 'JP'];

  const nsuidToItem = new Map<string, WishlistGameRecord>();
  for (const item of items) {
    const nsuid = item.externalIds?.switchNsuid;
    if (nsuid) nsuidToItem.set(nsuid, item);
  }
  const allNsuids = Array.from(nsuidToItem.keys());
  if (allNsuids.length === 0) return results;

  const regionMaps = await Promise.all(
    activeRegions.map(async (region) => ({
      region,
      prices: await fetchNintendoRegionPrices(region, allNsuids, fxRates),
    }))
  );

  for (const [nsuid, item] of nsuidToItem.entries()) {
    const quotes: SwitchRegionQuote[] = [];
    for (const rm of regionMaps) {
      const q = rm.prices.get(nsuid);
      if (q) quotes.push(q);
    }
    if (quotes.length === 0) continue;

    quotes.sort((a, b) => a.currentPriceTwd - b.currentPriceTwd);
    results.set(nsuid, {
      nsuid,
      best: quotes[0],
      allRegions: quotes,
      priceTrackerUrl: `https://www.dekudeals.com/search?q=${encodeURIComponent(item.title)}`,
    });
  }

  return results;
};
