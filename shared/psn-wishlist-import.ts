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

/** 給使用者在 store.playstation.com/zh-hant-tw/wishlist 的 Console 一鍵執行的擷取指令（不含任何帳密/Cookie） */
export const PSN_WISHLIST_CONSOLE_SNIPPET =
  `copy(JSON.stringify([...document.querySelectorAll('a[href*="/product/"],a[href*="/concept/"]')].map(a=>{const c=a.closest('li,article,[data-qa*="wishlist"],div');const img=a.querySelector('img')||c?.querySelector('img');return{href:a.href,text:(c?.innerText||a.innerText||'').trim(),linkText:(a.innerText||'').trim(),aria:a.getAttribute('aria-label')||'',img:img?.currentSrc||img?.src||''}})))`;

const parsePriceNum = (raw?: unknown): number | undefined => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw !== 'string') return undefined;
  if (/免費|free/i.test(raw)) return 0;
  const cleaned = raw.replace(/[^\d.]/g, '');
  if (!cleaned) return undefined;
  const val = Number(cleaned);
  return Number.isFinite(val) ? Math.round(val) : undefined;
};

const NOISE_LINE_RE =
  /^(PS5|PS4|PS5\s*[|・/]\s*PS4|PS4\s*[|・/]\s*PS5|遊戲本體|遊戲|同捆包|完整版|追加內容|體驗版|已公布|搶先預購|預購|預訂|特價|限時優惠|折扣|免費|加入購物車|檢視商品|移出收藏清單|移除|收藏清單|PlayStation\s*Plus.*|PS\s*Plus.*|SAVE\s*\d+%?|-\s*\d+\s*%|NT\$\s*[\d,]+|\$[\d,.]+|[\d,]+\s*元)$/i;

/** 從 PS Store 願望清單卡片多行文字中挑出乾淨的遊戲名稱與台幣價格 */
export const extractCardTitleAndPrices = (
  text: string,
  linkText?: string,
  aria?: string
): {
  title: string;
  currentPriceTwd?: number;
  regularPriceTwd?: number;
  discountPercent?: number;
} => {
  const combined = `${text || ''}\n${linkText || ''}`;

  // 擷取所有 NT$ 金額（通常第 1 個是折後現價，第 2 個是原價）
  const priceMatches = Array.from(combined.matchAll(/NT\$\s*([\d,]+)/gi))
    .map((m) => parsePriceNum(m[1]))
    .filter((n): n is number => typeof n === 'number' && n >= 0);

  let currentPriceTwd: number | undefined;
  let regularPriceTwd: number | undefined;
  if (priceMatches.length >= 2) {
    currentPriceTwd = Math.min(priceMatches[0], priceMatches[1]);
    regularPriceTwd = Math.max(priceMatches[0], priceMatches[1]);
  } else if (priceMatches.length === 1) {
    currentPriceTwd = priceMatches[0];
    regularPriceTwd = priceMatches[0];
  }

  const discMatch = combined.match(/-\s*(\d{1,2})\s*%/);
  let discountPercent = discMatch ? Number(discMatch[1]) : undefined;
  if (
    discountPercent === undefined &&
    regularPriceTwd &&
    currentPriceTwd !== undefined &&
    regularPriceTwd > currentPriceTwd
  ) {
    discountPercent = Math.round(((regularPriceTwd - currentPriceTwd) / regularPriceTwd) * 100);
  }

  // 挑選標題：優先從 linkText 或 text 中過濾雜訊行
  const candidateLines = `${linkText || ''}\n${text || ''}\n${aria || ''}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 2 && !NOISE_LINE_RE.test(l) && !/^NT\$/i.test(l));

  const title = candidateLines[0] || '';
  return { title, currentPriceTwd, regularPriceTwd, discountPercent };
};

const parseFromConsoleArray = (arr: unknown[]): ImportedPsnWishlistItem[] => {
  const results: ImportedPsnWishlistItem[] = [];
  const seen = new Set<string>();

  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const href = typeof row.href === 'string' ? row.href.trim() : '';
    if (!href) continue;

    const prodMatch = href.match(/\/product\/([A-Za-z0-9_-]{8,80})/i);
    const conceptMatch = href.match(/\/concept\/(\d{5,12})/i);
    const productId = prodMatch?.[1];
    const conceptId = conceptMatch?.[1];
    if (!productId && !conceptId) continue;

    const { title, currentPriceTwd, regularPriceTwd, discountPercent } = extractCardTitleAndPrices(
      String(row.text || ''),
      String(row.linkText || ''),
      String(row.aria || '')
    );
    if (!title) continue;

    const key = productId || conceptId || normalizeGameTitle(title);
    if (seen.has(key)) continue;
    seen.add(key);

    const titleIdMatch = (productId || '').match(/\b((?:PPSA|CUSA)\d{5}_\d{2})\b/i);
    const imgRaw = typeof row.img === 'string' ? row.img.trim() : '';
    const imageUrl = /^https?:\/\//i.test(imgRaw) && !/default-product-image/i.test(imgRaw) ? imgRaw : undefined;

    results.push({
      title,
      productId,
      conceptId,
      titleId: titleIdMatch ? titleIdMatch[1].toUpperCase() : undefined,
      imageUrl,
      currentPriceTwd,
      regularPriceTwd,
      discountPercent,
      storeUrl: productId
        ? `https://store.playstation.com/zh-hant-tw/product/${productId}`
        : `https://store.playstation.com/zh-hant-tw/concept/${conceptId}`,
    });
  }

  return results;
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
      for (const [key, val] of Object.entries(apolloState)) {
        if (!/^(Product|Concept):/i.test(key) || !val || typeof val !== 'object') continue;
        pushItem(buildFromProductOrConcept(val as Record<string, unknown>, apolloState));
      }
    }
  }

  return results;
};

/**
 * 支援 3 種貼上來源自動解析 PSN 台灣願望清單：
 * 1. Console 一鍵擷取指令輸出的 JSON 陣列（最準、100% 適用動態渲染頁面）
 * 2. __NEXT_DATA__ JSON（SSR 頁面）
 * 3. 完整渲染後的 DOM HTML（含 <a href=".../product/...">）
 */
export const parsePsnWishlistSource = (rawText: string): ImportedPsnWishlistItem[] => {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('請先執行 Console 擷取指令並貼上結果。');
  }

  // 1. 優先解析 Console 擷取指令產出的 JSON 陣列
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown[];
      if (Array.isArray(parsed)) {
        const items = parseFromConsoleArray(parsed);
        if (items.length > 0) return items;
      }
    } catch {
      // 繼續嘗試其他格式
    }
  }

  // 2. 嘗試解析 __NEXT_DATA__ JSON
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const items = parseFromNextData(parsed);
      if (items.length > 0) return items;
    } catch {
      // 繼續嘗試 HTML 解析
    }
  }

  // 3. 嘗試從 HTML 中擷取 <script id="__NEXT_DATA__">
  const scriptMatch = trimmed.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (scriptMatch) {
    try {
      const parsed = JSON.parse(scriptMatch[1]) as Record<string, unknown>;
      const items = parseFromNextData(parsed);
      if (items.length > 0) return items;
    } catch {
      // 繼續往下走 DOM <a> 解析
    }
  }

  // 4. 渲染後的 DOM HTML <a> 標籤解析（支援巢狀子元素文字）
  const fallback: ImportedPsnWishlistItem[] = [];
  const seen = new Set<string>();
  const anchorMatches = trimmed.matchAll(
    /<a\b[^>]*href=["']((?:https:\/\/store\.playstation\.com)?\/[^"']*\/(product|concept)\/([A-Za-z0-9_-]+))["'][^>]*>([\s\S]*?)<\/a>/gi
  );
  for (const m of anchorMatches) {
    const kind = m[2].toLowerCase();
    const id = m[3];
    const innerText = m[4].replace(/<[^>]+>/g, '\n').trim();
    const { title, currentPriceTwd, regularPriceTwd, discountPercent } =
      extractCardTitleAndPrices(innerText);
    if (!title || seen.has(id)) continue;
    seen.add(id);
    const titleIdMatch = id.match(/\b((?:PPSA|CUSA)\d{5}_\d{2})\b/i);
    fallback.push({
      title,
      ...(kind === 'product' ? { productId: id } : { conceptId: id }),
      titleId: titleIdMatch ? titleIdMatch[1].toUpperCase() : undefined,
      currentPriceTwd,
      regularPriceTwd,
      discountPercent,
      storeUrl: `https://store.playstation.com/zh-hant-tw/${kind}/${id}`,
    });
  }

  if (fallback.length > 0) return fallback;

  throw new Error(
    '找不到願望清單遊戲資料（PlayStation 願望清單是動態渲染的，Ctrl+U 原始碼只含空白外殼）。請改用上方「複製擷取指令」貼到願望清單頁的 F12 → Console 執行即可！'
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
