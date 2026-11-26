import { buildEventDedupKey, isNorthernTaiwanLocation } from '../shared/events.js';
import { buildEventsNewFlex } from '../shared/line-flex.js';
import type { TrackedEvent } from '../shared/types.js';
import {
  loadNotifyConfig,
  loadSeenArticleHashes,
  loadTrackedArtists,
  loadTrackedEvents,
  saveNotifyConfigPatch,
  saveSeenArticleHashes,
  upsertTrackedEvent,
} from './lib/firestore.js';
import { filterAndExtractNorthernEvents } from './lib/gemini.js';
import { sendLineWithQuota } from './lib/line-push.js';
import { collectArtistCandidates } from './sources/concerts.js';

const main = async () => {
  const uid = process.env.TARGET_FIREBASE_UID;
  if (!uid) throw new Error('缺少環境變數 TARGET_FIREBASE_UID');

  const geminiApiKey = process.env.GEMINI_API_KEY || '';
  if (!geminiApiKey) throw new Error('缺少環境變數 GEMINI_API_KEY（無法進行北部活動語意過濾）');

  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const appBaseUrl = process.env.APP_BASE_URL || undefined;

  console.log(`[run-events] 開始掃描台灣北部藝人活動 (dryRun=${dryRun})`);

  const [config, artists, existingEvents, seenHashes] = await Promise.all([
    loadNotifyConfig(uid),
    loadTrackedArtists(uid),
    loadTrackedEvents(uid),
    loadSeenArticleHashes(uid),
  ]);

  const activeArtists = artists.filter((a) => a.enabled);
  if (activeArtists.length === 0) {
    console.log('[run-events] 目前沒有啟用中的追蹤藝人，結束排程。');
    return;
  }

  const existingIds = new Set(existingEvents.map((e) => e.id));
  const existingUrls = new Set(existingEvents.map((e) => e.sourceUrl));
  const newlyDetected: TrackedEvent[] = [];

  for (const artist of activeArtists) {
    try {
      const candidates = await collectArtistCandidates(artist);
      const freshCandidates = candidates.filter((c) => !seenHashes.has(c.hash));

      console.log(
        `[run-events] ${artist.name}: 蒐集 ${candidates.length} 筆，未審查新文章 ${freshCandidates.length} 筆`
      );

      if (freshCandidates.length === 0) continue;

      const extracted = await filterAndExtractNorthernEvents(artist, freshCandidates, geminiApiKey);

      // 標記已審查過，避免下次排程重複送給 Gemini
      for (const c of freshCandidates) {
        seenHashes.add(c.hash);
      }

      for (const item of extracted) {
        const src = freshCandidates[item.candidateIndex];
        if (!src) continue;

        // 第二道防線：程式碼端再次確認地點屬於台灣北部（或尚未公布縣市之台灣場）
        if (!isNorthernTaiwanLocation(item.city, item.venue)) {
          console.log(`[run-events] 略過非北部活動：${artist.name} - ${item.title} (${item.city})`);
          continue;
        }

        const eventId = buildEventDedupKey(artist.id, item.title, item.eventDate);
        if (existingIds.has(eventId) || existingUrls.has(src.url)) {
          continue;
        }

        const tracked: TrackedEvent = {
          id: eventId,
          artistId: artist.id,
          artistName: artist.name,
          title: item.title,
          eventType: item.eventType,
          city: item.city,
          venue: item.venue,
          eventDate: item.eventDate,
          ticketSaleTime: item.ticketSaleTime,
          ticketPlatform: item.ticketPlatform,
          sourceUrl: src.url,
          summary: item.summary,
          notifiedNew: false,
          notifiedBefore1d: false,
          notifiedBefore1h: false,
          detectedAt: Date.now(),
        };

        existingIds.add(eventId);
        existingUrls.add(src.url);
        newlyDetected.push(tracked);
      }

      // 稍微間隔避免 Gemini RPM 限流
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.error(`[run-events] 處理藝人 ${artist.name} 失敗：`, err);
    }
  }

  if (newlyDetected.length > 0) {
    const flexMsg = buildEventsNewFlex(newlyDetected, appBaseUrl);
    const summary =
      `台灣北部新活動 ${newlyDetected.length} 筆：` +
      newlyDetected
        .slice(0, 3)
        .map((e) => `${e.artistName}「${e.title}」`)
        .join('、');

    const pushRes = await sendLineWithQuota({
      uid,
      config,
      type: 'event_new',
      priority: 'high',
      summary,
      messages: [flexMsg],
      dryRun,
    });

    for (const ev of newlyDetected) {
      if (pushRes.sent) ev.notifiedNew = true;
      if (!dryRun) {
        await upsertTrackedEvent(uid, ev);
      }
    }
  } else {
    console.log('[run-events] 本次未偵測到新的台灣北部活動。');
  }

  if (!dryRun) {
    await saveSeenArticleHashes(uid, seenHashes);
    await saveNotifyConfigPatch(uid, { lastEventSyncAt: Date.now() });
  }

  console.log(`[run-events] 完成！本次新增並通知 ${newlyDetected.length} 筆台灣北部活動。`);
};

main().catch((err) => {
  console.error('[run-events] 執行失敗：', err);
  process.exit(1);
});
