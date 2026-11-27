import { isGameOwned, normalizeGameTitle, shouldNotifyDeal } from '../shared/dedup.js';
import { buildGameDigestFlex } from '../shared/line-flex.js';
import type { DealCardItem, OwnedGameRecord, PriceHistoryPoint, WishlistGameRecord } from '../shared/types.js';
import {
  loadGameRankPlayedGames,
  loadNotifyConfig,
  loadOwnedGames,
  loadWishlistGames,
  saveNotifyConfigPatch,
  upsertOwnedGamesBatch,
  upsertWishlistGamesBatch,
} from './lib/firestore.js';
import { sendLineWithQuota } from './lib/line-push.js';
import {
  fetchSteamOwnedGames,
  fetchSteamPricesAndLows,
  fetchSteamStoreAppDetails,
  fetchSteamWishlist,
} from './sources/steam.js';

const todayTwDate = (): string => {
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return tw.toISOString().slice(0, 10);
};

const appendPriceHistory = (
  existing: PriceHistoryPoint[] | undefined,
  priceTwd: number,
  discountPercent: number,
  region = 'TW'
): PriceHistoryPoint[] => {
  const history = Array.isArray(existing) ? [...existing] : [];
  const last = history[history.length - 1];
  const date = todayTwDate();
  if (!last || last.priceTwd !== priceTwd || last.discountPercent !== discountPercent) {
    history.push({ date, priceTwd, discountPercent, region });
  }
  return history.slice(-60);
};

const main = async () => {
  const uid = process.env.TARGET_FIREBASE_UID;
  if (!uid) {
    throw new Error('缺少環境變數 TARGET_FIREBASE_UID');
  }

  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const steamApiKey = process.env.STEAM_API_KEY || '';
  const itadApiKey = process.env.ITAD_API_KEY || '';
  const appBaseUrl = process.env.APP_BASE_URL || undefined;

  console.log(`[run-games] 開始執行 (uid=${uid.slice(0, 6)}..., dryRun=${dryRun})`);

  const [config, gameRankGames, ownedGames, wishlistGames] = await Promise.all([
    loadNotifyConfig(uid),
    loadGameRankPlayedGames(uid),
    loadOwnedGames(uid),
    loadWishlistGames(uid),
  ]);

  console.log(
    `[run-games] 已載入：GameRank=${gameRankGames.length}, Owned=${ownedGames.length}, Wishlist=${wishlistGames.length}`
  );

  const steamId = config.steamId || process.env.STEAM_ID || '';
  const ownedMap = new Map<string, OwnedGameRecord>(ownedGames.map((g) => [g.id, g]));
  const wishlistMap = new Map<string, WishlistGameRecord>(wishlistGames.map((g) => [g.id, g]));

  // 1. 同步 Steam 已擁有遊戲與願望清單
  if (steamApiKey && steamId) {
    try {
      const steamOwned = await fetchSteamOwnedGames(steamApiKey, steamId);
      const ownedUpserts: OwnedGameRecord[] = [];
      for (const item of steamOwned) {
        const docId = `steam_${item.appid}`;
        const existing = ownedMap.get(docId);
        const rec: OwnedGameRecord = {
          id: docId,
          title: item.name,
          normalizedTitle: normalizeGameTitle(item.name),
          platform: 'PC',
          source: 'steam',
          externalIds: { ...existing?.externalIds, steamAppId: item.appid },
          imageUrl: item.imageUrl,
          addedAt: existing?.addedAt ?? Date.now(),
        };
        ownedMap.set(docId, rec);
        ownedUpserts.push(rec);
      }
      if (!dryRun && ownedUpserts.length > 0) {
        await upsertOwnedGamesBatch(uid, ownedUpserts);
      }
      console.log(`[Steam] 已同步擁有遊戲：${ownedUpserts.length} 款`);
    } catch (err) {
      console.error('[Steam] 同步擁有遊戲失敗：', err);
    }

    try {
      const steamWishlist = await fetchSteamWishlist(steamId, steamApiKey);
      let newlyAdded = 0;
      for (const item of steamWishlist) {
        const docId = `steam_${item.appid}`;
        if (wishlistMap.has(docId)) continue;

        const detail = await fetchSteamStoreAppDetails(item.appid).catch(() => null);
        const title = detail?.title || `Steam App ${item.appid}`;
        const rec: WishlistGameRecord = {
          id: docId,
          title,
          normalizedTitle: normalizeGameTitle(title),
          platform: 'PC',
          source: 'steam',
          externalIds: { steamAppId: item.appid },
          imageUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${item.appid}/header.jpg`,
          currentStoreUrl: `https://store.steampowered.com/app/${item.appid}/`,
          addedAt: item.dateAdded,
        };
        wishlistMap.set(docId, rec);
        newlyAdded += 1;
        await new Promise((r) => setTimeout(r, 200));
      }
      console.log(`[Steam] 願望清單掃描完成：總計 ${steamWishlist.length} 款，新增 ${newlyAdded} 款`);
    } catch (err) {
      console.error('[Steam] 同步願望清單失敗：', err);
    }
  } else {
    console.log('[Steam] 尚未設定 STEAM_API_KEY 或 Steam ID，略過自動同步（仍檢查手動加入的項目）。');
  }

  // 2. 查價：先處理所有帶 steamAppId 的 PC 願望清單
  const allOwnedList = Array.from(ownedMap.values());
  const steamWishlistItems = Array.from(wishlistMap.values()).filter(
    (w) => w.platform === 'PC' && w.externalIds?.steamAppId && !w.muted
  );

  const appIdsToCheck = steamWishlistItems
    .map((w) => w.externalIds!.steamAppId!)
    .filter((id) => Number.isFinite(id));

  const quotes = await fetchSteamPricesAndLows(appIdsToCheck, itadApiKey || undefined);

  const wishlistUpserts: WishlistGameRecord[] = [];
  const dealsToNotify: Array<{ card: DealCardItem; wishlistId: string }> = [];

  for (const item of steamWishlistItems) {
    const appid = item.externalIds!.steamAppId!;
    const quote = quotes.get(appid);
    if (!quote) continue;

    // 過濾已擁有或已在 GameRank 玩過的遊戲
    const ownership = isGameOwned(
      { title: item.title, platform: item.platform, externalIds: item.externalIds },
      allOwnedList,
      gameRankGames
    );

    const prevLowest =
      typeof item.lowestSeenPriceTwd === 'number' && item.lowestSeenPriceTwd > 0
        ? item.lowestSeenPriceTwd
        : null;
    const nextLowest =
      prevLowest === null ? quote.currentPriceTwd : Math.min(prevLowest, quote.currentPriceTwd);

    let resolvedTitle = item.title;
    if (resolvedTitle.startsWith('Steam App ')) {
      if (quote.title) {
        resolvedTitle = quote.title;
      } else {
        const detail = await fetchSteamStoreAppDetails(appid).catch(() => null);
        if (detail?.title) resolvedTitle = detail.title;
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const updated: WishlistGameRecord = {
      ...item,
      title: resolvedTitle,
      normalizedTitle: normalizeGameTitle(resolvedTitle),
      externalIds: { ...item.externalIds, ...(quote.itadId ? { itadId: quote.itadId } : {}) },
      imageUrl: item.imageUrl || quote.imageUrl,
      currentBestPriceTwd: quote.currentPriceTwd,
      regularPriceTwd: quote.regularPriceTwd,
      currentDiscountPercent: quote.discountPercent,
      currentBestRegion: 'TW',
      currentStoreUrl: quote.storeUrl,
      isHistoricalLow: quote.isHistoricalLow,
      historicalLowPriceTwd: quote.historicalLowPriceTwd ?? item.historicalLowPriceTwd ?? null,
      lowestSeenPriceTwd: nextLowest,
      priceHistory: appendPriceHistory(item.priceHistory, quote.currentPriceTwd, quote.discountPercent, 'TW'),
      priceTrackerUrl: quote.priceTrackerUrl ?? item.priceTrackerUrl ?? null,
      lastCheckedAt: Date.now(),
    };

    if (ownership.owned) {
      console.log(
        `[Dedup] 略過「${updated.title}」：已擁有/玩過 (${ownership.reason} -> ${ownership.matchedTitle})`
      );
      wishlistUpserts.push(updated);
      continue;
    }

    const trigger = shouldNotifyDeal({
      currentPriceTwd: quote.currentPriceTwd,
      discountPercent: quote.discountPercent,
      isHistoricalLow: quote.isHistoricalLow,
      targetPriceTwd: updated.targetPriceTwd,
      minDiscountPercent: updated.minDiscountPercent,
      defaultMinDiscount: config.defaultMinDiscount,
      notifyOnHistoricalLow: config.notifyOnHistoricalLow,
      lastNotifiedPriceTwd: updated.lastNotifiedPriceTwd,
      muted: updated.muted,
    });

    if (trigger) {
      dealsToNotify.push({
        wishlistId: updated.id,
        card: {
          id: updated.id,
          title: updated.title,
          platform: updated.platform,
          imageUrl: updated.imageUrl,
          currentPriceTwd: quote.currentPriceTwd,
          regularPriceTwd: quote.regularPriceTwd,
          discountPercent: quote.discountPercent,
          isHistoricalLow: quote.isHistoricalLow,
          historicalLowPriceTwd: updated.historicalLowPriceTwd,
          region: 'TW',
          storeUrl: quote.storeUrl,
          priceTrackerUrl: updated.priceTrackerUrl,
        },
      });
    }

    wishlistUpserts.push(updated);
  }

  // 3. 彙整成單一 LINE Flex Carousel 推播（史低優先排序）
  dealsToNotify.sort((a, b) => {
    if (a.card.isHistoricalLow !== b.card.isHistoricalLow) {
      return a.card.isHistoricalLow ? -1 : 1;
    }
    return b.card.discountPercent - a.card.discountPercent;
  });

  if (dealsToNotify.length > 0) {
    const selected = dealsToNotify.slice(0, 10);
    const flexMsg = buildGameDigestFlex(
      selected.map((s) => s.card),
      appBaseUrl
    );
    const summary = `今日特價 ${selected.length} 款：` + selected.map((s) => s.card.title).slice(0, 3).join('、');

    const pushRes = await sendLineWithQuota({
      uid,
      config,
      type: 'game_digest',
      priority: 'normal',
      summary,
      messages: [flexMsg],
      dryRun,
    });

    if (pushRes.sent) {
      const notifiedIds = new Set(selected.map((s) => s.wishlistId));
      const now = Date.now();
      for (const rec of wishlistUpserts) {
        if (notifiedIds.has(rec.id)) {
          rec.lastNotifiedPriceTwd = rec.currentBestPriceTwd ?? null;
          rec.lastNotifiedAt = now;
        }
      }
    }
  } else {
    console.log('[run-games] 本次檢查沒有新的達標特價遊戲。');
  }

  if (!dryRun) {
    if (wishlistUpserts.length > 0) {
      await upsertWishlistGamesBatch(uid, wishlistUpserts);
    }
    await saveNotifyConfigPatch(uid, { lastGameSyncAt: Date.now() });
  }

  console.log(`[run-games] 完成！已更新願望清單 ${wishlistUpserts.length} 筆，達標特價 ${dealsToNotify.length} 筆。`);
};

main().catch((err) => {
  console.error('[run-games] 執行失敗：', err);
  process.exit(1);
});
