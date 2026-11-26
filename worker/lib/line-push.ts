import type { LineFlexMessage } from '../../shared/line-flex.js';
import type { NotifyConfig, NotifyLogType } from '../../shared/types.js';
import { canSendPush, evaluateQuota } from '../../shared/quota.js';
import { appendNotifyLog, saveNotifyConfigPatch } from './firestore.js';

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

const normalizeUserId = (raw: string): string => raw.trim().replace(/^\/?chat\//i, '');

export interface PushOptions {
  uid: string;
  config: NotifyConfig;
  type: NotifyLogType;
  priority: 'normal' | 'high';
  summary: string;
  messages: Array<LineFlexMessage | { type: 'text'; text: string }>;
  dryRun?: boolean;
}

export interface PushResult {
  sent: boolean;
  status: 'sent' | 'dry_run' | 'skipped_quota' | 'failed';
  reason?: string;
}

export const sendLineWithQuota = async (opts: PushOptions): Promise<PushResult> => {
  const quota = evaluateQuota(opts.config);
  const messageCount = opts.messages.length;

  if (!canSendPush(quota, opts.priority, messageCount)) {
    const reason = `本月 LINE 額度保護已觸發 (${quota.used}/${quota.limit}，priority=${opts.priority})`;
    console.warn(`[LINE] ${reason}`);
    if (!opts.dryRun) {
      await appendNotifyLog(opts.uid, {
        type: opts.type,
        messageCount: 0,
        summary: opts.summary,
        sentAt: Date.now(),
        status: 'skipped_quota',
        errorMessage: reason,
      });
    }
    return { sent: false, status: 'skipped_quota', reason };
  }

  if (opts.dryRun) {
    console.log(`[LINE DRY_RUN] 將推播 ${messageCount} 則訊息：${opts.summary}`);
    return { sent: false, status: 'dry_run' };
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = normalizeUserId(opts.config.lineUserId || process.env.LINE_USER_ID || '');
  if (!token || !to) {
    const reason = '缺少 LINE_CHANNEL_ACCESS_TOKEN 或 lineUserId';
    console.error(`[LINE] ${reason}`);
    await appendNotifyLog(opts.uid, {
      type: opts.type,
      messageCount: 0,
      summary: opts.summary,
      sentAt: Date.now(),
      status: 'failed',
      errorMessage: reason,
    });
    return { sent: false, status: 'failed', reason };
  }

  const res = await fetch(LINE_PUSH_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to, messages: opts.messages }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const reason = `LINE API HTTP ${res.status}: ${detail.slice(0, 200)}`;
    console.error(`[LINE] ${reason}`);
    await appendNotifyLog(opts.uid, {
      type: opts.type,
      messageCount: 0,
      summary: opts.summary,
      sentAt: Date.now(),
      status: 'failed',
      errorMessage: reason,
    });
    return { sent: false, status: 'failed', reason };
  }

  const nextUsed = quota.used + messageCount;
  await saveNotifyConfigPatch(opts.uid, {
    monthlyLineMonth: quota.month,
    monthlyLineCount: nextUsed,
  });

  await appendNotifyLog(opts.uid, {
    type: opts.type,
    messageCount,
    summary: opts.summary,
    sentAt: Date.now(),
    status: 'sent',
  });

  return { sent: true, status: 'sent' };
};
