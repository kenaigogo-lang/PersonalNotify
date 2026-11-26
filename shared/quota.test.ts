import { describe, expect, it } from 'vitest';
import { canSendPush, evaluateQuota, getCurrentMonthKey } from './quota.js';

describe('quota helpers', () => {
  it('computes Taiwan timezone month key', () => {
    // 2026-01-31T17:00:00Z is 2026-02-01 01:00 in Asia/Taipei (UTC+8)
    const key = getCurrentMonthKey(new Date('2026-01-31T17:00:00Z'));
    expect(key).toBe('2026-02');
  });

  it('resets monthly usage automatically on new month', () => {
    const status = evaluateQuota(
      { monthlyLineCount: 195, monthlyLineLimit: 200, monthlyLineMonth: '2026-01' },
      new Date('2026-02-02T00:00:00Z')
    );
    expect(status.used).toBe(0);
    expect(status.remaining).toBe(200);
    expect(status.highPriorityOnly).toBe(false);
  });

  it('throttles normal pushes when reaching safety valve (170/200) while allowing high priority', () => {
    const status = evaluateQuota(
      { monthlyLineCount: 175, monthlyLineLimit: 200, monthlyLineMonth: '2026-03' },
      new Date('2026-03-10T04:00:00Z')
    );
    expect(status.highPriorityOnly).toBe(true);
    expect(canSendPush(status, 'normal', 1)).toBe(false);
    expect(canSendPush(status, 'high', 1)).toBe(true);
  });
});
