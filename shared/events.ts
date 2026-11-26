import type { TrackedEvent } from './types.js';

const NORTHERN_TAIWAN_PATTERNS = [
  /台[北北]/,
  /臺[北北]/,
  /新北/,
  /桃園/,
  /基隆/,
  /新竹/,
  /雙北/,
  /大台[北北]/,
  /taipei/i,
  /new taipei/i,
  /taoyuan/i,
  /keelung/i,
  /hsinchu/i,
  /小巨蛋/,
  /大巨蛋/,
  /北流/,
  /臺北流行音樂中心/,
  /台北流行音樂中心/,
  /林口體育館/,
  /國立體育大學/,
  /zepp\s*new\s*taipei/i,
  /legacy\s*taipei/i,
  /legacy\s*tera/i,
  /tico|ticc/i,
  /南港展覽館/,
  /新莊體育館/,
  /桃園會展中心/,
];

const NON_NORTHERN_EXCLUSIONS = [
  /高雄/,
  /台中|臺中/,
  /台南|臺南/,
  /嘉義/,
  /彰化/,
  /屏東/,
  /花蓮/,
  /台東|臺東/,
  /宜蘭/,
  /kaohsiung/i,
  /taichung/i,
  /tainan/i,
  /東京|大阪|名古屋|福岡|札幌|橫濱|埼玉|神戶|沖繩/,
  /tokyo|osaka|nagoya|fukuoka|hong kong|macau|singapore|seoul|bangkok/i,
  /香港|澳門|新加坡|首爾|曼谷|上海|北京|廣州/,
];

/** 快速關鍵字排除（在呼叫 Gemini 前先過濾撞名雜訊，如 BLACKPINK Lisa） */
export const isExcludedByArtistKeywords = (text: string, excludeKeywords: string[]): boolean => {
  if (!text || excludeKeywords.length === 0) return false;
  const lower = text.toLowerCase();
  return excludeKeywords.some((kw) => {
    const clean = kw.trim().toLowerCase();
    return clean.length > 0 && lower.includes(clean);
  });
};

/**
 * 檢查活動地點是否屬於台灣北部（台北／新北／桃園／基隆／新竹），
 * 或「確定來台灣但尚未公布縣市」（如 city 為「台灣（縣市待公布）」）以免漏接首波官宣。
 */
export const isNorthernTaiwanLocation = (city?: string, venue?: string): boolean => {
  const combined = `${city || ''} ${venue || ''}`.trim();
  if (!combined) return false;

  if (NORTHERN_TAIWAN_PATTERNS.some((re) => re.test(combined))) {
    return true;
  }

  // 若明確寫出非北部或海外城市則排除
  if (NON_NORTHERN_EXCLUSIONS.some((re) => re.test(combined))) {
    return false;
  }

  // 僅寫「台灣 / 臺灣 / Taiwan / 來台」尚未公布縣市時先放行提醒
  return /台灣|臺灣|taiwan|待公布/i.test(combined);
};

/** 判斷是否進入「開賣前 24 小時」或「開賣前 1 小時」搶票提醒視窗 */
export const evaluateSaleReminder = (
  event: Pick<TrackedEvent, 'ticketSaleTime' | 'notifiedBefore1d' | 'notifiedBefore1h' | 'dismissed'>,
  nowMs = Date.now()
): 'before_1h' | 'before_1d' | null => {
  if (event.dismissed || !event.ticketSaleTime) return null;
  const saleMs = Date.parse(event.ticketSaleTime);
  if (!Number.isFinite(saleMs)) return null;

  const diffMs = saleMs - nowMs;
  if (diffMs <= 0) return null; // 已過開賣時間

  const HOUR = 60 * 60 * 1000;

  // 開賣前 1.5 小時內（配合每小時排程，確保開賣前約 1 小時必觸發）
  if (diffMs <= 1.5 * HOUR) {
    return event.notifiedBefore1h ? null : 'before_1h';
  }

  // 開賣前 25 小時內（前一天提醒）
  if (diffMs <= 25 * HOUR) {
    return event.notifiedBefore1d ? null : 'before_1d';
  }

  return null;
};

/** 產生穩定的簡短雜湊鍵（用於文章去重與事件 ID） */
export const simpleStableHash = (input: string): string => {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

export const buildEventDedupKey = (artistId: string, title: string, eventDate?: string): string => {
  const normTitle = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, 36);
  const datePart = (eventDate || '').trim().slice(0, 10);
  return `${artistId}_${simpleStableHash(`${normTitle}|${datePart}`)}`;
};
