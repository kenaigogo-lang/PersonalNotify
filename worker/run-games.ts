import {
  isGameOwned,
  normalizeGameTitle,
  resolveLastNotifiedPriceAfterCheck,
  shouldNotifyDeal,
} from '../shared/dedup.js';
import { buildGameDigestFlex, buildSystemAlertFlex } from '../shared/line-flex.js';
import type {
  DealCardItem,
  OwnedGameRecord,
  PriceHistoryPoint,
  WishlistGameRecord,
} from '../shared/types.js';
import {
  loadGameRankPlayedGames,
  loadNotifyConfig,
  loadOwnedGames,
  loadPsnSecret,
  loadWishlistGames,
  saveNotifyConfigPatch,
  savePsnSecret,
  upsertOwnedGamesBatch,
  upsertWishlistGamesBatch,
} from './lib/firestore.js';
import { sendLineWithQuota } from './lib/line-push.js';
import { fetchTwdFxRates } from './sources/fx.js';
import {
  fetchPsnOwnedAndPlayed,
  fetchPsnWishlistBestEffort,
  fetchPsStoreTwPrice,
  refreshPsnAuthorization,
} from './sources/psn.js';
import {
  fetchSteamOwnedGames,
  fetchSteamPricesAndLows,
  fetchSteamStoreAppDetails,
  fetchSteamWishlist,
} from './sources/steam.js';
import { compareSwitchMultiRegionPrices, resolveSwitchNsuidByTitle } from './sources/switch.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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
  if (!last || last.priceTwd !== priceTwd || last.discountPercent !== discountPercent || last.region !== region) {
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
  const now = Date.now();

  console.log(`[run-games] 開始執行三平台同步與特價檢查 (uid=${uid.slice(0, 6)}..., dryRun=${dryRun})`);

  const [config, gameRankGames, ownedGames, wishlistGames, psnSecret] = await Promise.all([
    loadNotifyConfig(uid),
    loadGameRankPlayedGames(uid),
    loadOwnedGames(uid),
    loadWishlistGames(uid),
    loadPsnSecret(uid),
  ]);

  console.log(
    `[run-games] 已載入：GameRank=${gameRankGames.length}, Owned=${ownedGames.length}, Wishlist=${wishlistGames.length}, PSN=${psnSecret ? '已設定' : '未設定'}`
  );

  const steamId = config.steamId || process.env.STEAM_ID || '';
  const ownedMap = new Map<string, OwnedGameRecord>(ownedGames.map((g) => [g.id, g]));
  const wishlistMap = new Map<string, WishlistGameRecord>(wishlistGames.map((g) => [g.id, g]));
  const newOwnedUpserts: OwnedGameRecord[] = [];

  // ── 1. Steam 公開同步（若維持私人檔案，這裡會安全略過並改查私人匯入的願望清單）──
  if (steamApiKey && steamId) {
    try {
      const steamOwned = await fetchSteamOwnedGames(steamApiKey, steamId);
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
          addedAt: existing?.addedAt ?? now,
        };
        ownedMap.set(docId, rec);
        newOwnedUpserts.push(rec);
      }
      if (steamOwned.length > 0) {
        console.log(`[Steam] 已同步擁有遊戲：${steamOwned.length} 款`);
      }
    } catch (err) {
      console.warn('[Steam] 公開擁有遊戲同步略過：', (err as Error).message);
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
      if (steamWishlist.length > 0) {
        console.log(`[Steam] 願望清單掃描完成：總計 ${steamWishlist.length} 款，新增 ${newlyAdded} 款`);
      }
    } catch (err) {
      console.warn('[Steam] 公開願望清單同步略過：', (err as Error).message);
    }
  }

  // ── 2. PS5 / PSN 同步（已購買數位庫 + 已遊玩實體片 + 2 個月到期前 5 天 LINE 提醒）──
  const psnConfigPatch: Partial<typeof config> = {};
  if (psnSecret) {
    const canSendPsnAlert = !config.lastPsnAlertAt || now - config.lastPsnAlertAt >= 3 * DAY_MS;

    try {
      const { accessToken, nextSecret } = await refreshPsnAuthorization(psnSecret);
      if (!dryRun) {
        await savePsnSecret(uid, nextSecret);
      }

      const daysLeft = Math.ceil((nextSecret.expiresAt - now) / DAY_MS);
      psnConfigPatch.psnTokenExpiresAt = nextSecret.expiresAt;
      psnConfigPatch.psnTokenStatus = daysLeft <= 5 ? 'expiring_soon' : 'active';

      if (daysLeft <= 5 && canSendPsnAlert) {
        const alertFlex = buildSystemAlertFlex(
          'PSN 登入憑證即將到期',
          `你的 PS5 / PSN 授權憑證約剩 ${Math.max(1, daysLeft)} 天過期，請前往 PersonalNotify 設定頁重新貼上新的 npsso token 以維持自動同步。`,
          appBaseUrl
        );
        const alertRes = await sendLineWithQuota({
          uid,
          config,
          type: 'system_alert',
          priority: 'high',
          summary: `PSN 憑證剩約 ${Math.max(1, daysLeft)} 天過期提醒`,
          messages: [alertFlex],
          dryRun,
        });
        if (alertRes.sent) {
          psnConfigPatch.lastPsnAlertAt = now;
          config.monthlyLineCount = (config.monthlyLineCount || 0) + 1;
        }
      }

      // 同步 PSN 已購買 + 已遊玩清單
      const psnOwned = await fetchPsnOwnedAndPlayed(accessToken);
      for (const item of psnOwned) {
        const docId = `psn_${item.titleId}`;
        const existing = ownedMap.get(docId);
        const rec: OwnedGameRecord = {
          id: docId,
          title: item.name,
          normalizedTitle: normalizeGameTitle(item.name),
          platform: 'PS',
          source: 'psn',
          externalIds: {
            ...existing?.externalIds,
            psnTitleId: item.titleId,
            ...(item.conceptId ? { psnConceptId: item.conceptId } : {}),
            ...(item.productId ? { psnProductId: item.productId } : {}),
          },
          imageUrl: item.imageUrl || existing?.imageUrl,
          addedAt: existing?.addedAt ?? now,
        };
        ownedMap.set(docId, rec);
        newOwnedUpserts.push(rec);
      }
      console.log(`[PSN] 已同步 PS4/PS5 擁有與遊玩清單：${psnOwned.length} 款（憑證剩約 ${daysLeft} 天）`);

      // 嘗試同步 PSN 願望清單（Best-Effort GraphQL）
      const psnWishRes = await fetchPsnWishlistBestEffort(accessToken);
      if (psnWishRes.ok) {
        let addedPsnWish = 0;
        for (const w of psnWishRes.items) {
          const docId = w.productId
            ? `psn_${w.productId}`
            : w.conceptId
              ? `psn_c_${w.conceptId}`
              : `psn_t_${normalizeGameTitle(w.title).slice(0, 24)}`;
          const existing = wishlistMap.get(docId);
          const rec: WishlistGameRecord = {
            ...(existing || {}),
            id: docId,
            title: w.title,
            normalizedTitle: normalizeGameTitle(w.title),
            platform: 'PS',
            source: existing?.source || 'psn',
            externalIds: {
              ...existing?.externalIds,
              ...(w.conceptId ? { psnConceptId: w.conceptId } : {}),
              ...(w.productId ? { psnProductId: w.productId } : {}),
            },
            imageUrl: w.imageUrl || existing?.imageUrl,
            currentStoreUrl: w.storeUrl,
            ...(typeof w.currentPriceTwd === 'number' ? { currentBestPriceTwd: w.currentPriceTwd } : {}),
            ...(typeof w.regularPriceTwd === 'number' ? { regularPriceTwd: w.regularPriceTwd } : {}),
            ...(typeof w.discountPercent === 'number' ? { currentDiscountPercent: w.discountPercent } : {}),
            addedAt: existing?.addedAt ?? now,
          };
          wishlistMap.set(docId, rec);
          if (!existing) addedPsnWish += 1;
        }
        console.log(`[PSN] 願望清單 GraphQL 同步成功：${psnWishRes.items.length} 款（新增 ${addedPsnWish}）`);
      } else {
        console.log('[PSN] GraphQL 願望清單目前未回傳（將照常檢查手動加入的 PS5 願望清單）。');
      }
    } catch (err) {
      console.error('[PSN] Token 刷新失敗（可能已過期）：', (err as Error).message);
      psnConfigPatch.psnTokenStatus = 'expired';
      if (canSendPsnAlert) {
        const expiredFlex = buildSystemAlertFlex(
          'PSN 授權憑證已過期',
          'PSN refreshToken 已失效，無法自動同步 PS5 遊戲庫。請前往 PersonalNotify 設定頁重新貼上新的 64 碼 npsso。',
          appBaseUrl
        );
        const alertRes = await sendLineWithQuota({
          uid,
          config,
          type: 'system_alert',
          priority: 'high',
          summary: 'PSN 授權憑證已過期提醒',
          messages: [expiredFlex],
          dryRun,
        });
        if (alertRes.sent) {
          psnConfigPatch.lastPsnAlertAt = now;
          config.monthlyLineCount = (config.monthlyLineCount || 0) + 1;
        }
      }
    }
  }

  if (!dryRun && newOwnedUpserts.length > 0) {
    await upsertOwnedGamesBatch(uid, newOwnedUpserts);
  }

  // ── 3. 三平台願望清單查價＋統一三層去重 ──
  const allOwnedList = Array.from(ownedMap.values());
  const allWishlistList = Array.from(wishlistMap.values());
  const wishlistUpserts: WishlistGameRecord[] = [];
  const dealsToNotify: Array<{ card: DealCardItem; wishlistId: string }> = [];

  // 3A. Steam 願望清單查價（ITAD 史低 + Steam Store 備援）
  const steamWishItems = allWishlistList.filter(
    (w) => w.platform === 'PC' && w.externalIds?.steamAppId && !w.muted
  );
  const steamQuotes = await fetchSteamPricesAndLows(
    steamWishItems.map((w) => w.externalIds!.steamAppId!),
    itadApiKey || undefined
  );

  for (const item of steamWishItems) {
    const appid = item.externalIds!.steamAppId!;
    const quote = steamQuotes.get(appid);
    if (!quote) continue;

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

    const ownership = isGameOwned(
      { title: resolvedTitle, platform: item.platform, externalIds: item.externalIds },
      allOwnedList,
      gameRankGames
    );

    const prevLowest =
      typeof item.lowestSeenPriceTwd === 'number' && item.lowestSeenPriceTwd > 0
        ? item.lowestSeenPriceTwd
        : null;
    const nextLowest =
      prevLowest === null ? quote.currentPriceTwd : Math.min(prevLowest, quote.currentPriceTwd);

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
      lastNotifiedPriceTwd: resolveLastNotifiedPriceAfterCheck({
        lastNotifiedPriceTwd: item.lastNotifiedPriceTwd,
        currentPriceTwd: quote.currentPriceTwd,
        discountPercent: quote.discountPercent,
      }),
      lastCheckedAt: now,
    };

    wishlistUpserts.push(updated);
    if (ownership.owned) {
      console.log(`[Dedup] 略過 Steam「${updated.title}」(${ownership.reason} -> ${ownership.matchedTitle})`);
      continue;
    }

    if (
      shouldNotifyDeal({
        currentPriceTwd: quote.currentPriceTwd,
        discountPercent: quote.discountPercent,
        isHistoricalLow: quote.isHistoricalLow,
        targetPriceTwd: updated.targetPriceTwd,
        minDiscountPercent: updated.minDiscountPercent,
        defaultMinDiscount: config.defaultMinDiscount,
        notifyOnHistoricalLow: config.notifyOnHistoricalLow,
        lastNotifiedPriceTwd: updated.lastNotifiedPriceTwd,
        muted: updated.muted,
      })
    ) {
      dealsToNotify.push({
        wishlistId: updated.id,
        card: {
          id: updated.id,
          title: updated.title,
          platform: 'PC',
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
  }

  // 3B. PS5 / PSN 願望清單查價（台灣 PS Store）
  const psWishItems = allWishlistList.filter((w) => w.platform === 'PS' && !w.muted);
  for (const item of psWishItems) {
    const ownership = isGameOwned(
      { title: item.title, platform: 'PS', externalIds: item.externalIds },
      allOwnedList,
      gameRankGames
    );

    const quote = await fetchPsStoreTwPrice(item);
    const currentPrice = quote?.currentPriceTwd ?? item.currentBestPriceTwd ?? null;
    const regularPrice = quote?.regularPriceTwd ?? item.regularPriceTwd ?? currentPrice;
    const discountPercent = quote?.discountPercent ?? item.currentDiscountPercent ?? 0;

    if (currentPrice === null) continue;

    const prevLowest =
      typeof item.lowestSeenPriceTwd === 'number' && item.lowestSeenPriceTwd > 0
        ? item.lowestSeenPriceTwd
        : null;
    const nextLowest = prevLowest === null ? currentPrice : Math.min(prevLowest, currentPrice);
    const isNewTrackedLow =
      discountPercent > 0 && prevLowest !== null && currentPrice <= prevLowest;

    const updated: WishlistGameRecord = {
      ...item,
      externalIds: {
        ...item.externalIds,
        ...(quote?.productId ? { psnProductId: quote.productId } : {}),
      },
      currentBestPriceTwd: currentPrice,
      regularPriceTwd: regularPrice,
      currentDiscountPercent: discountPercent,
      currentBestRegion: 'TW',
      currentStoreUrl: quote?.storeUrl || item.currentStoreUrl || null,
      isHistoricalLow: isNewTrackedLow,
      lowestSeenPriceTwd: nextLowest,
      priceHistory: appendPriceHistory(item.priceHistory, currentPrice, discountPercent, 'TW'),
      priceTrackerUrl:
        quote?.priceTrackerUrl ||
        item.priceTrackerUrl ||
        `https://platprices.com/search.php?q=${encodeURIComponent(item.title)}`,
      lastNotifiedPriceTwd: resolveLastNotifiedPriceAfterCheck({
        lastNotifiedPriceTwd: item.lastNotifiedPriceTwd,
        currentPriceTwd: currentPrice,
        discountPercent,
      }),
      lastCheckedAt: now,
    };

    wishlistUpserts.push(updated);
    if (ownership.owned) {
      console.log(`[Dedup] 略過 PS5「${updated.title}」(${ownership.reason} -> ${ownership.matchedTitle})`);
      continue;
    }

    if (
      shouldNotifyDeal({
        currentPriceTwd: currentPrice,
        discountPercent,
        isHistoricalLow: isNewTrackedLow,
        targetPriceTwd: updated.targetPriceTwd,
        minDiscountPercent: updated.minDiscountPercent,
        defaultMinDiscount: config.defaultMinDiscount,
        notifyOnHistoricalLow: config.notifyOnHistoricalLow,
        lastNotifiedPriceTwd: updated.lastNotifiedPriceTwd,
        muted: updated.muted,
      })
    ) {
      dealsToNotify.push({
        wishlistId: updated.id,
        card: {
          id: updated.id,
          title: updated.title,
          platform: 'PS',
          imageUrl: updated.imageUrl,
          currentPriceTwd: currentPrice,
          regularPriceTwd: regularPrice,
          discountPercent,
          isHistoricalLow: isNewTrackedLow,
          historicalLowPriceTwd: updated.lowestSeenPriceTwd,
          region: 'TW',
          storeUrl:
            updated.currentStoreUrl ||
            `https://store.playstation.com/zh-hant-tw/search/${encodeURIComponent(updated.title)}`,
          priceTrackerUrl: updated.priceTrackerUrl,
        },
      });
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  // 3C. Switch 願望清單多區比價（TW / JP / HK / US / MX）
  const switchWishItems = allWishlistList.filter((w) => w.platform === 'SWITCH' && !w.muted);
  if (switchWishItems.length > 0) {
    const fxRates = await fetchTwdFxRates();

    // 若使用者未填 14 碼 NSUID，嘗試用任天堂搜尋補齊
    for (const item of switchWishItems) {
      if (!item.externalIds?.switchNsuid) {
        const resolved = await resolveSwitchNsuidByTitle(item.title);
        if (resolved) {
          item.externalIds = { ...item.externalIds, switchNsuid: resolved.nsuid };
          if (!item.imageUrl && resolved.imageUrl) item.imageUrl = resolved.imageUrl;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    const switchResults = await compareSwitchMultiRegionPrices(
      switchWishItems,
      config.switchRegions,
      fxRates
    );

    for (const item of switchWishItems) {
      const nsuid = item.externalIds?.switchNsuid;
      if (!nsuid) continue;
      const res = switchResults.get(nsuid);
      if (!res) continue;

      const ownership = isGameOwned(
        { title: item.title, platform: 'SWITCH', externalIds: item.externalIds },
        allOwnedList,
        gameRankGames
      );

      const best = res.best;
      const prevLowest =
        typeof item.lowestSeenPriceTwd === 'number' && item.lowestSeenPriceTwd > 0
          ? item.lowestSeenPriceTwd
          : null;
      const nextLowest =
        prevLowest === null ? best.currentPriceTwd : Math.min(prevLowest, best.currentPriceTwd);
      const isNewTrackedLow =
        best.discountPercent > 0 && prevLowest !== null && best.currentPriceTwd <= prevLowest;

      const updated: WishlistGameRecord = {
        ...item,
        currentBestPriceTwd: best.currentPriceTwd,
        regularPriceTwd: best.regularPriceTwd,
        currentDiscountPercent: best.discountPercent,
        currentBestRegion: best.region,
        currentStoreUrl: best.storeUrl,
        isHistoricalLow: isNewTrackedLow,
        lowestSeenPriceTwd: nextLowest,
        priceHistory: appendPriceHistory(
          item.priceHistory,
          best.currentPriceTwd,
          best.discountPercent,
          best.region
        ),
        priceTrackerUrl: res.priceTrackerUrl,
        lastNotifiedPriceTwd: resolveLastNotifiedPriceAfterCheck({
          lastNotifiedPriceTwd: item.lastNotifiedPriceTwd,
          currentPriceTwd: best.currentPriceTwd,
          discountPercent: best.discountPercent,
        }),
        lastCheckedAt: now,
      };

      wishlistUpserts.push(updated);
      if (ownership.owned) {
        console.log(
          `[Dedup] 略過 Switch「${updated.title}」(${ownership.reason} -> ${ownership.matchedTitle})`
        );
        continue;
      }

      if (
        shouldNotifyDeal({
          currentPriceTwd: best.currentPriceTwd,
          discountPercent: best.discountPercent,
          isHistoricalLow: isNewTrackedLow,
          targetPriceTwd: updated.targetPriceTwd,
          minDiscountPercent: updated.minDiscountPercent,
          defaultMinDiscount: config.defaultMinDiscount,
          notifyOnHistoricalLow: config.notifyOnHistoricalLow,
          lastNotifiedPriceTwd: updated.lastNotifiedPriceTwd,
          muted: updated.muted,
        })
      ) {
        dealsToNotify.push({
          wishlistId: updated.id,
          card: {
            id: updated.id,
            title: updated.title,
            platform: 'SWITCH',
            imageUrl: updated.imageUrl,
            currentPriceTwd: best.currentPriceTwd,
            regularPriceTwd: best.regularPriceTwd,
            discountPercent: best.discountPercent,
            isHistoricalLow: isNewTrackedLow,
            historicalLowPriceTwd: updated.lowestSeenPriceTwd,
            region: best.region,
            paymentHint: best.paymentHint,
            storeUrl: best.storeUrl,
            priceTrackerUrl: res.priceTrackerUrl,
          },
        });
      }
    }
  }

  // ── 4. 彙整三平台特價成單一 LINE Flex Carousel 推播（只耗 1 則額度）──
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
    const summary =
      `今日特價 ${selected.length} 款：` +
      selected
        .map((s) => s.card.title)
        .slice(0, 3)
        .join('、');

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
      for (const rec of wishlistUpserts) {
        if (notifiedIds.has(rec.id)) {
          rec.lastNotifiedPriceTwd = rec.currentBestPriceTwd ?? null;
          rec.lastNotifiedAt = now;
        }
      }
    }
  } else {
    console.log('[run-games] 本次檢查三平台皆無新的達標特價遊戲。');
  }

  if (!dryRun) {
    if (wishlistUpserts.length > 0) {
      await upsertWishlistGamesBatch(uid, wishlistUpserts);
    }
    await saveNotifyConfigPatch(uid, { ...psnConfigPatch, lastGameSyncAt: now });
  }

  console.log(
    `[run-games] 完成！已更新願望清單 ${wishlistUpserts.length} 筆，達標特價 ${dealsToNotify.length} 筆。`
  );
};

main().catch((err) => {
  console.error('[run-games] 執行失敗：', err);
  process.exit(1);
});
