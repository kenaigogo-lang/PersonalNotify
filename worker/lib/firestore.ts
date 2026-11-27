import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  DEFAULT_LINE_USER_ID,
  type GamePlatform,
  type GameRankRecord,
  type NotifyConfig,
  type NotifyLogRecord,
  type OwnedGameRecord,
  type TrackedArtist,
  type TrackedEvent,
  type WishlistGameRecord,
} from '../../shared/types.js';
import { DEFAULT_MONTHLY_LINE_LIMIT, getCurrentMonthKey } from '../../shared/quota.js';

let dbInstance: Firestore | null = null;

export const getAdminDb = (): Firestore => {
  if (dbInstance) return dbInstance;
  if (getApps().length === 0) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      throw new Error('缺少環境變數 FIREBASE_SERVICE_ACCOUNT_JSON');
    }
    const parsed = JSON.parse(raw) as Record<string, string>;
    initializeApp({ credential: cert(parsed) });
  }
  dbInstance = getFirestore();
  return dbInstance;
};

const normalizePlatform = (raw: unknown): GamePlatform => {
  const s = String(raw || '').toUpperCase();
  if (s === 'PS5' || s === 'PS4' || s === 'PS') return 'PS';
  if (s === 'SWITCH' || s === 'NS') return 'SWITCH';
  if (s === 'XBOX') return 'XBOX';
  return 'PC';
};

/** 唯讀載入 GameRank 的已玩遊戲紀錄（絕不寫入 backups） */
export const loadGameRankPlayedGames = async (uid: string): Promise<GameRankRecord[]> => {
  const db = getAdminDb();
  const snap = await db.collection('users').doc(uid).collection('backups').get();
  return snap.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      title: String(data.title || ''),
      platform: normalizePlatform(data.platform),
      score: Number(data.score || 0),
      comment: String(data.comment || ''),
      genre: data.genre ? String(data.genre) : undefined,
      ratingDate: data.ratingDate ? String(data.ratingDate) : undefined,
      playtime: typeof data.playtime === 'number' ? data.playtime : undefined,
      imageUrl: data.imageUrl ? String(data.imageUrl) : undefined,
      addedAt: typeof data.addedAt === 'number' ? data.addedAt : undefined,
    };
  });
};

export const loadNotifyConfig = async (uid: string): Promise<NotifyConfig> => {
  const db = getAdminDb();
  const ref = db.collection('users').doc(uid).collection('notify_config').doc('main');
  const snap = await ref.get();
  const month = getCurrentMonthKey();

  const defaults: NotifyConfig = {
    lineUserId: process.env.LINE_USER_ID || DEFAULT_LINE_USER_ID,
    steamId: process.env.STEAM_ID || '',
    switchRegions: ['TW', 'JP', 'HK', 'US', 'MX'],
    defaultMinDiscount: 30,
    notifyOnHistoricalLow: true,
    monthlyLineLimit: DEFAULT_MONTHLY_LINE_LIMIT,
    monthlyLineCount: 0,
    monthlyLineMonth: month,
    psnTokenStatus: 'unset',
  };

  if (!snap.exists) return defaults;
  const data = snap.data() || {};
  return {
    ...defaults,
    ...data,
    lineUserId: String(data.lineUserId || defaults.lineUserId),
    steamId: String(data.steamId || defaults.steamId),
  };
};

export const saveNotifyConfigPatch = async (uid: string, patch: Partial<NotifyConfig>): Promise<void> => {
  const db = getAdminDb();
  const ref = db.collection('users').doc(uid).collection('notify_config').doc('main');
  await ref.set({ ...patch, updatedAt: Date.now() }, { merge: true });
};

export const loadOwnedGames = async (uid: string): Promise<OwnedGameRecord[]> => {
  const db = getAdminDb();
  const snap = await db.collection('users').doc(uid).collection('notify_owned').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OwnedGameRecord, 'id'>) }));
};

export const upsertOwnedGamesBatch = async (uid: string, games: OwnedGameRecord[]): Promise<void> => {
  if (games.length === 0) return;
  const db = getAdminDb();
  const col = db.collection('users').doc(uid).collection('notify_owned');

  // Firestore batch 上限 500 筆，保守每批 400 筆
  for (let i = 0; i < games.length; i += 400) {
    const batch = db.batch();
    const chunk = games.slice(i, i + 400);
    for (const game of chunk) {
      const { id, ...rest } = game;
      batch.set(col.doc(id), { ...rest, updatedAt: Date.now() }, { merge: true });
    }
    await batch.commit();
  }
};

export const loadWishlistGames = async (uid: string): Promise<WishlistGameRecord[]> => {
  const db = getAdminDb();
  const snap = await db.collection('users').doc(uid).collection('notify_wishlist').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WishlistGameRecord, 'id'>) }));
};

export const upsertWishlistGamesBatch = async (uid: string, games: WishlistGameRecord[]): Promise<void> => {
  if (games.length === 0) return;
  const db = getAdminDb();
  const col = db.collection('users').doc(uid).collection('notify_wishlist');

  for (let i = 0; i < games.length; i += 400) {
    const batch = db.batch();
    const chunk = games.slice(i, i + 400);
    for (const game of chunk) {
      const { id, ...rest } = game;
      batch.set(col.doc(id), { ...rest, updatedAt: Date.now() }, { merge: true });
    }
    await batch.commit();
  }
};

export const appendNotifyLog = async (uid: string, log: Omit<NotifyLogRecord, 'id'>): Promise<void> => {
  const db = getAdminDb();
  await db.collection('users').doc(uid).collection('notify_logs').add(log);
};

export const loadTrackedArtists = async (uid: string): Promise<TrackedArtist[]> => {
  const db = getAdminDb();
  const snap = await db.collection('users').doc(uid).collection('notify_artists').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TrackedArtist, 'id'>) }));
};

export const loadTrackedEvents = async (uid: string): Promise<TrackedEvent[]> => {
  const db = getAdminDb();
  const snap = await db.collection('users').doc(uid).collection('notify_events').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TrackedEvent, 'id'>) }));
};

export const upsertTrackedEvent = async (uid: string, event: TrackedEvent): Promise<void> => {
  const db = getAdminDb();
  const { id, ...rest } = event;
  await db
    .collection('users')
    .doc(uid)
    .collection('notify_events')
    .doc(id)
    .set(rest, { merge: true });
};

/** 儲存已送給 Gemini 審核過的文章雜湊（保留最近 600 筆），避免重複消耗 Gemini 免費額度 */
export const loadSeenArticleHashes = async (uid: string): Promise<Set<string>> => {
  const db = getAdminDb();
  const snap = await db.collection('users').doc(uid).collection('notify_config').doc('seen_articles').get();
  if (!snap.exists) return new Set();
  const list = snap.data()?.hashes;
  return new Set(Array.isArray(list) ? list.map(String) : []);
};

export const saveSeenArticleHashes = async (uid: string, hashes: Set<string>): Promise<void> => {
  const db = getAdminDb();
  const trimmed = Array.from(hashes).slice(-600);
  await db
    .collection('users')
    .doc(uid)
    .collection('notify_config')
    .doc('seen_articles')
    .set({ hashes: trimmed, updatedAt: Date.now() }, { merge: true });
};

export const loadPsnSecret = async (
  uid: string
): Promise<{ refreshToken: string; expiresAt: number; updatedAt: number } | null> => {
  const db = getAdminDb();
  const snap = await db.collection('users').doc(uid).collection('notify_secrets').doc('psn').get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data?.refreshToken) return null;
  return {
    refreshToken: String(data.refreshToken),
    expiresAt: Number(data.expiresAt || 0),
    updatedAt: Number(data.updatedAt || 0),
  };
};

export const savePsnSecret = async (
  uid: string,
  secret: { refreshToken: string; expiresAt: number; updatedAt: number }
): Promise<void> => {
  const db = getAdminDb();
  await db.collection('users').doc(uid).collection('notify_secrets').doc('psn').set(secret, { merge: true });
};


