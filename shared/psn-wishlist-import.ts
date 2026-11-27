import { normalizeGameTitle } from './dedup.js';
import type { WishlistGameRecord } from './types.js';

export interface ImportedPsnWishlistItem {
  title: string;
  productId?: string;
  conceptId?: string;
  titleId?: string;
  imageUrl?: string;
  currentPriceTwd?: number;
  regularPriceTwd?: number;
  discountPercent?: number;
  storeUrl: string;
}

const parsePriceNum = (raw?: unknown): number | undefined => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw !== 'string') return undefined;
  if (/免費|free/i.test(raw)) return 0;
  const cleaned = raw.replace(/[^\d.]/g, '');
  if (!cleaned) return undefined;
  const val = Number(cleaned);
  return Number.isFinite(val) ? Math.round(val) : undefined;
};

const extractImageUrl = (
  obj: Record<string, unknown>,
  apolloState?: Record<string, unknown>
): string | undefined => {
  const media = obj.media;
  if (Array.isArray(media)) {
    const resolved = media
      .map((m) => {
        if (m && typeof m === 'object' && '__ref' in m && apolloState) {
          return apolloState[String((m as { __ref: string }).__ref)];
        }
        return m;
      })
      .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object'));

    // 優先挑 MASTER / GAMEHUB_COVER_ART / FOUR_BY_THREE_BANNER
    const preferred =
      resolved.find((m) => /MASTER|COVER|BANNER/i.test(String(m.role || m.type || '')) && typeof m.url === 'string') ||
      resolved.find((m) => typeof m.url === 'string' && /^https?:\/\//i.test(String(m.url)));
    if (preferred?.url) return String(preferred.url);
  }
  if (obj.image && typeof obj.image === 'object' && typeof (obj.image as { url?: unknown }).url === 'string') {
    return String((obj.image as { url: string }).url);
  }
  return undefined;
};

const extractPriceInfo = (
  obj: Record<string, unknown>,
  apolloState?: Record<string, unknown>
): { currentPriceTwd?: number; regularPriceTwd?: number; discountPercent?: number } => {
  let priceObj = obj.price as Record<string, unknown> | undefined;
  if (priceObj && '__ref' in priceObj && apolloState) {
    priceObj = apolloState[String(priceObj.__ref)] as Record<string, unknown> | undefined;
  }
  if (!priceObj || typeof priceObj !== 'object') return {};

  const regularPriceTwd = parsePriceNum(priceObj.basePrice);
  const currentPriceTwd = parsePriceNum(priceObj.discountedPrice) ?? regularPriceTwd;
  let discountPercent: number | undefined;
  if (typeof priceObj.discountText === 'string') {
    const m = priceObj.discountText.match(/(\d+)\s*%/);
    if (m) discountPercent = Number(m[1]);
  }
  if (
    discountPercent === undefined &&
    regularPriceTwd !== undefined &&
    currentPriceTwd !== undefined &&
    regularPriceTwd > currentPriceTwd &&
    regularPriceTwd > 0
  ) {
    discountPercent = Math.round(((regularPriceTwd - currentPriceTwd) / regularPriceTwd) * 100);
  }

  return { currentPriceTwd, regularPriceTwd, discountPercent };
};

const buildFromProductOrConcept = (
  obj: Record<string, unknown>,
  apolloState?: Record<string, unknown>
): ImportedPsnWishlistItem | null => {
  const title = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!title || title.length < 2) return null;

  const typename = String(obj.__typename || '');
  const rawId = typeof obj.id === 'string' ? obj.id.trim() : '';

  let productId = typeof obj.productId === 'string' ? obj.productId.trim() : undefined;
  let conceptId = typeof obj.conceptId === 'string' ? obj.conceptId.trim() : undefined;

  if (!productId && (/Product/i.test(typename) || /^[A-Z]{2}\d{4}-/i.test(rawId))) {
    productId = rawId || undefined;
  }
  if (!conceptId && (/Concept/i.test(typename) || /^\d{5,12}$/.test(rawId))) {
    conceptId = rawId || undefined;
  }

  // 若是 Concept 物件，嘗試往下找預設 Product 取得價格與 productId
  let priceSource = obj;
  if (!productId && Array.isArray(obj.products) && obj.products.length > 0) {
    let firstProd = obj.products[0] as Record<string, unknown>;
    if (firstProd && '__ref' in firstProd && apolloState) {
      firstProd = apolloState[String(firstProd.__ref)] as Record<string, unknown>;
    }
    if (firstProd && typeof firstProd === 'object') {
      if (typeof firstProd.id === 'string') productId = firstProd.id;
      if (firstProd.price) priceSource = firstProd;
    }
  }

  const titleIdMatch = (productId || '').match(/\b((?:PPSA|CUSA)\d{5}_\d{2})\b/i);
  const titleId = titleIdMatch ? titleIdMatch[1].toUpperCase() : undefined;

  const storeUrl = productId
    ? `https://store.playstation.com/zh-hant-tw/product/${productId}`
    : conceptId
      ? `https://store.playstation.com/zh-hant-tw/concept/${conceptId}`
      : `https://store.playstation.com/zh-hant-tw/search/${encodeURIComponent(title)}`;

  return {
    title,
    productId,
    conceptId,
    titleId,
    imageUrl: extractImageUrl(obj, apolloState),
    ...extractPriceInfo(priceSource, apolloState),
    storeUrl,
  };
};

/** 遞迴從物件中蒐集所有含 __ref 或 inline 的遊戲節點 */
const collectRefs = (node: unknown, out: Set<string>, depth = 0): void => {
  if (depth > 8 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, out, depth + 1);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec.__ref === 'string' && /^(Product|Concept):/i.test(rec.__ref)) {
    out.add(rec.__ref);
    return;
  }
  for (const val of Object.values(rec)) {
    collectRefs(val, out, depth + 1);
  }
};

const parseFromNextData = (nextData: Record<string, unknown>): ImportedPsnWishlistItem[] => {
  const results: ImportedPsnWishlistItem[] = [];
  const seen = new Set<string>();

  const pushItem = (item: ImportedPsnWishlistItem | null) => {
    if (!item) return;
    const key = item.productId || item.conceptId || normalizeGameTitle(item.title);
    if (!key || seen.has(key)) return;
    seen.add(key);
    results.push(item);
  };

  const pageProps = (nextData.props as Record<string, unknown> | undefined)?.pageProps as
    | Record<string, unknown>
    | undefined;
  const apolloState = (pageProps?.apolloState ||
    (nextData as { apolloState?: Record<string, unknown> }).apolloState) as
    | Record<string, unknown>
    | undefined;

  if (apolloState && typeof apolloState === 'object') {
    const rootQuery = apolloState.ROOT_QUERY as Record<string, unknown> | undefined;
    const wishlistRefs = new Set<string>();

    // 1. 優先從 ROOT_QUERY 的 wishlist 相關欄位精準追蹤引用
    if (rootQuery && typeof rootQuery === 'object') {
      for (const [key, val] of Object.entries(rootQuery)) {
        if (/wishlist/i.test(key)) {
          collectRefs(val, wishlistRefs);
        }
      }
    }

    if (wishlistRefs.size > 0) {
      for (const refKey of wishlistRefs) {
        const entry = apolloState[refKey];
        if (entry && typeof entry === 'object') {
          pushItem(buildFromProductOrConcept(entry as Record<string, unknown>, apolloState));
        }
      }
    } else {
      // 2. 若 ROOT_QUERY key 改名，退而掃描 apolloState 中的 Product:* 與 Concept:*
      for (const [key, val] of Object.entries(apolloState)) {
        if (!/^(Product|Concept):/i.test(key) || !val || typeof val !== 'object') continue;
        pushItem(buildFromProductOrConcept(val as Record<string, unknown>, apolloState));
      }
    }
  }

  return results;
};

/**
 * 解析從 https://store.playstation.com/zh-hant-tw/wishlist 複製的網頁原始碼（Ctrl+U）或 __NEXT_DATA__ JSON，
 * 自動萃取出使用者的全部 PSN 願望清單項目。
 */
export const parsePsnWishlistSource = (rawText: string): ImportedPsnWishlistItem[] => {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('請先貼上 PlayStation 願望清單網頁原始碼（Ctrl+U → Ctrl+A → Ctrl+C）。');
  }

  // 1. 嘗試直接解析整段 JSON（例如 __NEXT_DATA__ JSON）
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const items = parseFromNextData(parsed);
      if (items.length > 0) return items;
    } catch {
      // 繼續嘗試 HTML 解析
    }
  }

  // 2. 從完整 HTML 原始碼中擷取 <script id="__NEXT_DATA__">
  const scriptMatch = trimmed.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (scriptMatch) {
    try {
      const parsed = JSON.parse(scriptMatch[1]) as Record<string, unknown>;
      const items = parseFromNextData(parsed);
      if (items.length > 0) return items;
    } catch {
      // 往下走 HTML 連結備援
    }
  }

  // 3. HTML <a> 連結備援解析（若使用者貼的是部分 HTML 或連結清單）
  const fallback: ImportedPsnWishlistItem[] = [];
  const seen = new Set<string>();
  const linkMatches = trimmed.matchAll(
    /href=["']((?:https:\/\/store\.playstation\.com)?\/zh-hant-tw\/(product|concept)\/([A-Za-z0-9_-]+))["'][^>]*?(?:aria-label=["']([^"']+)["']|>([^<]{2,100})<)/gi
  );
  for (const m of linkMatches) {
    const kind = m[2].toLowerCase();
    const id = m[3];
    const title = (m[4] || m[5] || '').trim();
    if (!title || seen.has(id)) continue;
    seen.add(id);
    fallback.push({
      title,
      ...(kind === 'product' ? { productId: id } : { conceptId: id }),
      storeUrl: `https://store.playstation.com/zh-hant-tw/${kind}/${id}`,
    });
  }

  if (fallback.length > 0) return fallback;

  throw new Error(
    '找不到願望清單遊戲資料。請確認已登入 PlayStation 台灣商店並打開 store.playstation.com/zh-hant-tw/wishlist，再按 Ctrl+U 複製完整原始碼！'
  );
};

export const toPsnWishlistRecord = (item: ImportedPsnWishlistItem, now = Date.now()): WishlistGameRecord => {
  const id = item.productId
    ? `psn_${item.productId}`
    : item.conceptId
      ? `psn_c_${item.conceptId}`
      : `psn_t_${normalizeGameTitle(item.title).slice(0, 24)}`;

  return {
    id,
    title: item.title,
    normalizedTitle: normalizeGameTitle(item.title),
    platform: 'PS',
    source: 'psn',
    externalIds: {
      ...(item.productId ? { psnProductId: item.productId } : {}),
      ...(item.conceptId ? { psnConceptId: item.conceptId } : {}),
      ...(item.titleId ? { psnTitleId: item.titleId } : {}),
    },
    imageUrl: item.imageUrl,
    currentBestPriceTwd: item.currentPriceTwd ?? null,
    regularPriceTwd: item.regularPriceTwd ?? null,
    currentDiscountPercent: item.discountPercent ?? null,
    currentBestRegion: 'TW',
    currentStoreUrl: item.storeUrl,
    priceTrackerUrl: `https://platprices.com/search.php?q=${encodeURIComponent(item.title)}`,
    addedAt: now,
  };
};
