import type { ExternalGameIds, GamePlatform, GameRankRecord, OwnedGameRecord } from './types.js';

const ROMAN_MAP: Record<string, string> = {
  x: '10',
  ix: '9',
  viii: '8',
  vii: '7',
  vi: '6',
  v: '5',
  iv: '4',
  iii: '3',
  ii: '2',
};

const EDITION_SUFFIXES = [
  'game of the year edition',
  'goty edition',
  'goty',
  'definitive edition',
  'complete edition',
  'deluxe edition',
  'digital deluxe edition',
  'digital deluxe',
  'ultimate edition',
  'collectors edition',
  "collector's edition",
  'standard edition',
  'special edition',
  'anniversary edition',
  'directors cut',
  "director's cut",
  'remastered',
  'remake',
  'hd remaster',
  'ps5 version',
  'ps4 version',
  'ps5 & ps4',
  'ps4 & ps5',
  'ps5',
  'ps4',
  'nintendo switch edition',
  'nintendo switch',
  'switch',
  'pc edition',
  '決定版',
  '完全版',
  '豪華版',
  '數位豪華版',
  '終極版',
  '重製版',
  '年度版',
  '典藏版',
  '中文版',
  '日文版',
  '數位版',
  '一般版',
];

/**
 * 將遊戲名稱正規化，解決跨平台常見的標點、版本副標、羅馬數字差異。
 * 例如 "FINAL FANTASY VII REMAKE (PS5)" 與 "Final Fantasy 7" 會正規化為相同鍵值。
 */
export const normalizeGameTitle = (rawTitle: string): string => {
  if (!rawTitle) return '';
  let s = rawTitle
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[™®©]/g, ' ')
    .replace(/[（(][^）)]*(ps5|ps4|switch|pc|steam|中文版|日文版|豪華版|決定版|重製版|edition|remake|remastered)[^）)]*[）)]/gi, ' ')
    .replace(/[：:·・\-–—_\/\\|!?'"`,.~+[\](){}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 反覆剝除尾端常見版本副標
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of EDITION_SUFFIXES) {
      const pattern = new RegExp(`(?:^|\\s)${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      if (pattern.test(s) && s.length > suffix.length + 1) {
        s = s.replace(pattern, '').trim();
        changed = true;
      }
    }
  }

  // 將獨立的羅馬數字轉成阿拉伯數字（不含單獨的 i，避免誤改英文字）
  s = s.replace(/\b(viii|vii|vi|iv|iii|ii|ix|x|v)\b/g, (match) => ROMAN_MAP[match] ?? match);

  // 移除空白方便中英混合比對
  return s.replace(/\s+/g, '');
};

export interface OwnershipCandidate {
  title: string;
  platform?: GamePlatform;
  externalIds?: ExternalGameIds;
}

export interface OwnershipMatch {
  owned: boolean;
  reason?: 'platform_id' | 'igdb_id' | 'owned_title' | 'gamerank_played';
  matchedTitle?: string;
  matchedSource?: string;
}

/**
 * 三層跨平台去重比對：
 * 1. 平台專屬 ID（Steam AppID / PSN Title ID / Switch NSUID）
 * 2. IGDB ID 跨平台對齊
 * 3. 正規化遊戲名稱比對（同時檢查 notify_owned 與 GameRank 已玩紀錄 backups）
 */
export const isGameOwned = (
  candidate: OwnershipCandidate,
  ownedGames: OwnedGameRecord[],
  gameRankGames: GameRankRecord[]
): OwnershipMatch => {
  const cIds = candidate.externalIds;

  // 第一層：平台專屬 ID
  if (cIds) {
    for (const owned of ownedGames) {
      const oIds = owned.externalIds;
      if (!oIds) continue;
      if (cIds.steamAppId && oIds.steamAppId && cIds.steamAppId === oIds.steamAppId) {
        return { owned: true, reason: 'platform_id', matchedTitle: owned.title, matchedSource: owned.source };
      }
      if (cIds.psnTitleId && oIds.psnTitleId && cIds.psnTitleId === oIds.psnTitleId) {
        return { owned: true, reason: 'platform_id', matchedTitle: owned.title, matchedSource: owned.source };
      }
      if (cIds.psnConceptId && oIds.psnConceptId && cIds.psnConceptId === oIds.psnConceptId) {
        return { owned: true, reason: 'platform_id', matchedTitle: owned.title, matchedSource: owned.source };
      }
      if (cIds.psnProductId && oIds.psnProductId && cIds.psnProductId === oIds.psnProductId) {
        return { owned: true, reason: 'platform_id', matchedTitle: owned.title, matchedSource: owned.source };
      }
      if (cIds.switchNsuid && oIds.switchNsuid && cIds.switchNsuid === oIds.switchNsuid) {
        return { owned: true, reason: 'platform_id', matchedTitle: owned.title, matchedSource: owned.source };
      }
    }
  }

  // 第二層：IGDB ID 跨平台比對
  if (cIds?.igdbId) {
    for (const owned of ownedGames) {
      if (owned.externalIds?.igdbId && owned.externalIds.igdbId === cIds.igdbId) {
        return { owned: true, reason: 'igdb_id', matchedTitle: owned.title, matchedSource: owned.source };
      }
    }
  }

  // 第三層：正規化名稱比對（Owned 庫＋GameRank 已玩紀錄）
  const targetNorm = normalizeGameTitle(candidate.title);
  if (!targetNorm) return { owned: false };

  for (const owned of ownedGames) {
    const ownedNorm = owned.normalizedTitle || normalizeGameTitle(owned.title);
    if (ownedNorm && ownedNorm === targetNorm) {
      return { owned: true, reason: 'owned_title', matchedTitle: owned.title, matchedSource: owned.source };
    }
  }

  for (const played of gameRankGames) {
    const playedNorm = normalizeGameTitle(played.title);
    if (playedNorm && playedNorm === targetNorm) {
      return { owned: true, reason: 'gamerank_played', matchedTitle: played.title, matchedSource: 'gamerank' };
    }
  }

  return { owned: false };
};

/** 判斷特價是否值得推播（達標且價格低於上次已推播價格） */
export const shouldNotifyDeal = (params: {
  currentPriceTwd: number;
  discountPercent: number;
  isHistoricalLow: boolean;
  targetPriceTwd?: number | null;
  minDiscountPercent?: number | null;
  defaultMinDiscount: number;
  notifyOnHistoricalLow: boolean;
  lastNotifiedPriceTwd?: number | null;
  muted?: boolean;
}): boolean => {
  if (params.muted) return false;
  if (params.currentPriceTwd <= 0 && params.discountPercent < 100) return false;

  // 若上次推播過相同或更低價格，避免每天重複洗版
  if (
    typeof params.lastNotifiedPriceTwd === 'number' &&
    params.currentPriceTwd >= params.lastNotifiedPriceTwd
  ) {
    return false;
  }

  const hitTargetPrice =
    typeof params.targetPriceTwd === 'number' &&
    params.targetPriceTwd > 0 &&
    params.currentPriceTwd <= params.targetPriceTwd;

  const minDiscount =
    typeof params.minDiscountPercent === 'number' && params.minDiscountPercent > 0
      ? params.minDiscountPercent
      : params.defaultMinDiscount;

  const hitDiscount = params.discountPercent >= minDiscount;
  const hitHistoricalLow = params.notifyOnHistoricalLow && params.isHistoricalLow && params.discountPercent > 0;

  return hitTargetPrice || hitDiscount || hitHistoricalLow;
};
