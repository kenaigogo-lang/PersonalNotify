export interface ParsedSteamUserdata {
  ownedAppIds: number[];
  wishlistAppIds: number[];
}

const toUniquePositiveInts = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) return [];
  const set = new Set<number>();
  for (const v of raw) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) set.add(n);
  }
  return Array.from(set);
};

/**
 * 解析 Steam 官方私人端點 https://store.steampowered.com/dynamicstore/userdata/ 回傳的 JSON。
 * 不需將 Steam 個人檔案設公開即可安全取得本人已擁有遊戲 (rgOwnedApps) 與願望清單 (rgWishlist)。
 */
export const parseSteamUserdataJson = (rawText: string): ParsedSteamUserdata => {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('請先貼上從 Steam 網址複製的 JSON 內容。');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    throw new Error('JSON 格式無法解析，請確認已用 Ctrl+A 完整複製整個網頁內容。');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('內容格式不符，請確認來源為 store.steampowered.com/dynamicstore/userdata/。');
  }

  const ownedAppIds = toUniquePositiveInts(parsed.rgOwnedApps);
  const wishlistAppIds = toUniquePositiveInts(parsed.rgWishlist);

  if (ownedAppIds.length === 0 && wishlistAppIds.length === 0) {
    throw new Error(
      '未偵測到任何遊戲（rgOwnedApps 與 rgWishlist 皆為空）。請先在同一個瀏覽器登入 Steam 商店後，重新整理該網址再複製！'
    );
  }

  return { ownedAppIds, wishlistAppIds };
};
