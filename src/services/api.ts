import { auth } from './firebase';
import type { GamePlatform, GameSearchResult } from '../../shared/types';

const authHeaders = async (): Promise<Record<string, string>> => {
  const user = auth?.currentUser;
  if (!user) throw new Error('請先登入 Google 帳號');
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

const parseResponse = async <T>(res: Response): Promise<T> => {
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(data.error || `請求失敗 (HTTP ${res.status})`);
  }
  return data;
};

export const sendLineTestPush = async (lineUserId: string): Promise<{ ok: boolean; sentAt: number }> => {
  const res = await fetch('/api/line-test', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ lineUserId }),
  });
  return parseResponse(res);
};

export const searchGamesOnline = async (
  q: string,
  platform: GamePlatform
): Promise<GameSearchResult[]> => {
  if (q.trim().length < 2) return [];
  const params = new URLSearchParams({ q: q.trim(), platform });
  const res = await fetch(`/api/game-search?${params.toString()}`, {
    method: 'GET',
    headers: await authHeaders(),
  });
  const data = await parseResponse<{ results: GameSearchResult[] }>(res);
  return data.results || [];
};
