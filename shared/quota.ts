import type { NotifyConfig } from './types.js';

export const DEFAULT_MONTHLY_LINE_LIMIT = 200;
export const HIGH_PRIORITY_ONLY_THRESHOLD = 170;

export const getCurrentMonthKey = (now = new Date()): string => {
  // 以台灣時區 (UTC+8) 計算月份，與 LINE OA 台灣計費週期一致
  const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = tw.getUTCFullYear();
  const m = String(tw.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

export interface QuotaStatus {
  month: string;
  used: number;
  limit: number;
  remaining: number;
  highPriorityOnly: boolean;
  exhausted: boolean;
}

export const evaluateQuota = (
  config: Pick<NotifyConfig, 'monthlyLineCount' | 'monthlyLineLimit' | 'monthlyLineMonth'>,
  now = new Date()
): QuotaStatus => {
  const month = getCurrentMonthKey(now);
  const limit = config.monthlyLineLimit > 0 ? config.monthlyLineLimit : DEFAULT_MONTHLY_LINE_LIMIT;
  const used = config.monthlyLineMonth === month ? Math.max(0, config.monthlyLineCount || 0) : 0;
  const remaining = Math.max(0, limit - used);
  return {
    month,
    used,
    limit,
    remaining,
    highPriorityOnly: used >= Math.min(HIGH_PRIORITY_ONLY_THRESHOLD, Math.floor(limit * 0.85)),
    exhausted: remaining <= 0,
  };
};

export const canSendPush = (
  status: QuotaStatus,
  priority: 'normal' | 'high',
  messageCount = 1
): boolean => {
  if (status.remaining < messageCount) return false;
  if (priority === 'normal' && status.highPriorityOnly) return false;
  return true;
};
