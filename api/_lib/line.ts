import { env, fetchWithTimeout, HttpError } from './auth.js';
import type { LineFlexMessage } from '../../shared/line-flex.js';

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

export const normalizeLineUserId = (raw: string): string => raw.trim().replace(/^\/?chat\//i, '');

export const pushLineMessages = async (
  userId: string,
  messages: Array<LineFlexMessage | { type: 'text'; text: string }>
): Promise<void> => {
  const token = env('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new HttpError(500, '伺服器尚未設定 LINE_CHANNEL_ACCESS_TOKEN');

  const to = normalizeLineUserId(userId || env('LINE_USER_ID') || '');
  if (!to || !/^U[0-9a-f]{32}$/i.test(to)) {
    throw new HttpError(400, 'LINE User ID 格式不正確（應為 U 開頭的 33 碼字串）');
  }

  const res = await fetchWithTimeout(LINE_PUSH_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to, messages }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new HttpError(502, `LINE Push 失敗 (${res.status}): ${detail.slice(0, 200)}`);
  }
};
