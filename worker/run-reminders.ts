import { evaluateSaleReminder } from '../shared/events.js';
import { buildEventReminderFlex } from '../shared/line-flex.js';
import { loadNotifyConfig, loadTrackedEvents, upsertTrackedEvent } from './lib/firestore.js';
import { sendLineWithQuota } from './lib/line-push.js';

const main = async () => {
  const uid = process.env.TARGET_FIREBASE_UID;
  if (!uid) throw new Error('缺少環境變數 TARGET_FIREBASE_UID');

  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const appBaseUrl = process.env.APP_BASE_URL || undefined;
  const nowMs = Date.now();

  const [config, events] = await Promise.all([loadNotifyConfig(uid), loadTrackedEvents(uid)]);

  let sentCount = 0;

  for (const ev of events) {
    const reminderKind = evaluateSaleReminder(ev, nowMs);
    if (!reminderKind) continue;

    const flex = buildEventReminderFlex(ev, reminderKind, appBaseUrl);
    const label = reminderKind === 'before_1h' ? '開賣前 1 小時警報' : '開賣前 1 天提醒';
    const summary = `${label}：【${ev.artistName}】${ev.title}`;

    const res = await sendLineWithQuota({
      uid,
      config,
      type: 'event_reminder',
      priority: 'high',
      summary,
      messages: [flex],
      dryRun,
    });

    if (res.sent) {
      sentCount += 1;
      // 同步更新本地 config 計數避免同輪多筆提醒時額度判斷落後
      config.monthlyLineCount = (config.monthlyLineCount || 0) + 1;

      const updated = {
        ...ev,
        notifiedBefore1d: reminderKind === 'before_1d' ? true : ev.notifiedBefore1d,
        notifiedBefore1h: reminderKind === 'before_1h' ? true : ev.notifiedBefore1h,
      };
      await upsertTrackedEvent(uid, updated);
    }
  }

  console.log(`[run-reminders] 檢查 ${events.length} 筆活動完成，本次送出 ${sentCount} 則搶票提醒。`);
};

main().catch((err) => {
  console.error('[run-reminders] 執行失敗：', err);
  process.exit(1);
});
