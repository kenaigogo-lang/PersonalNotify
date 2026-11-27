import type { ExternalGameIds } from './types.js';

/**
 * 從使用者貼上的 PSN ssocookie 整段 JSON 或純 64 碼字串中萃取出乾淨的 npsso token。
 */
export const extractNpssoToken = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { npsso?: unknown };
      if (typeof parsed.npsso === 'string' && parsed.npsso.trim().length >= 32) {
        return parsed.npsso.trim();
      }
    } catch {
      // 忽略 JSON 解析失敗，改走正則擷取
    }
  }

  const jsonMatch = trimmed.match(/"npsso"\s*:\s*"([A-Za-z0-9_-]{32,128})"/);
  if (jsonMatch) return jsonMatch[1];

  const plain = trimmed.replace(/^["']|["']$/g, '').trim();
  if (/^[A-Za-z0-9_-]{32,128}$/.test(plain)) return plain;
  return null;
};

/**
 * 從任天堂 eShop / PS Store / Steam 商店網址或純 ID 自動萃取平台專屬 ID：
 * - Switch：14 碼 NSUID（例如 70010000063714 或 D70010000063714）
 * - PS5：productId（例如 HP0177-PPSA...）或 conceptId（例如 /concept/10008736）
 * - Steam：AppID（例如 /app/1245620/）
 */
export const parseStoreUrlOrId = (input: string): Partial<ExternalGameIds> & { storeUrl?: string } => {
  const trimmed = input.trim();
  if (!trimmed) return {};

  const out: Partial<ExternalGameIds> & { storeUrl?: string } = {};
  if (/^https?:\/\//i.test(trimmed)) {
    out.storeUrl = trimmed;
  }

  // Nintendo Switch 14-digit NSUID (starts with 7001 / 7003 / 7005 / 7007)
  const nsuidMatch = trimmed.match(/(?:D)?(700\d{11})\b/i);
  if (nsuidMatch) {
    out.switchNsuid = nsuidMatch[1];
  }

  // PlayStation Store product URL or product ID
  const psProductMatch = trimmed.match(/\/product\/([A-Z0-9_-]{12,60})/i);
  if (psProductMatch) {
    out.psnProductId = psProductMatch[1];
  }

  // PlayStation Store concept URL
  const psConceptMatch = trimmed.match(/\/concept\/(\d{5,12})/i);
  if (psConceptMatch) {
    out.psnConceptId = psConceptMatch[1];
  }

  // PlayStation Title ID (e.g. PPSA01521_00 or CUSA07408_00)
  const psTitleMatch = trimmed.match(/\b((?:PPSA|CUSA)\d{5}_\d{2})\b/i);
  if (psTitleMatch) {
    out.psnTitleId = psTitleMatch[1].toUpperCase();
  }

  // Steam Store URL
  const steamMatch = trimmed.match(/store\.steampowered\.com\/app\/(\d+)/i);
  if (steamMatch) {
    out.steamAppId = Number(steamMatch[1]);
  }

  return out;
};
