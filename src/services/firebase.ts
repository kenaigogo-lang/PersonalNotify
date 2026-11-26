import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore/lite';
import {
  DEFAULT_LINE_USER_ID,
  STARTER_ARTISTS,
  type GamePlatform,
  type GameRankRecord,
  type NotifyConfig,
  type NotifyLogRecord,
  type OwnedGameRecord,
  type TrackedArtist,
  type TrackedEvent,
  type WishlistGameRecord,
} from '../../shared/types';
import { DEFAULT_MONTHLY_LINE_LIMIT, getCurrentMonthKey } from '../../shared/quota';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.authDomain
);

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  if (!auth) throw new Error('尚未設定 Firebase 環境變數（請參考 .env.example）');
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
};

export const logout = async () => {
  if (!auth) return;
  await signOut(auth);
};

export const formatFirebaseError = (error: unknown): string => {
  const err = error as { code?: string; message?: string };
  const code = String(err?.code || '');
  const message = String(err?.message || '');
  if (code.includes('permission-denied')) {
    return 'Firestore 權限拒絕。請確認 Firebase Console 的規則允許登入本人讀寫 users/{uid}/{document=**}。';
  }
  if (code.includes('unavailable') || /network|fetch/i.test(message)) {
    return '無法連線到 Firebase，請檢查網路狀態。';
  }
  return message || '未知錯誤';
};

const normalizePlatform = (raw: unknown): GamePlatform => {
  const s = String(raw || '').toUpperCase();
  if (s === 'PS5' || s === 'PS4' || s === 'PS') return 'PS';
  if (s === 'SWITCH' || s === 'NS') return 'SWITCH';
  if (s === 'XBOX') return 'XBOX';
  return 'PC';
};

/** 唯讀載入 GameRank 的已玩紀錄（users/{uid}/backups） */
export const getGameRankPlayedGames = async (uid: string): Promise<GameRankRecord[]> => {
  if (!db) return [];
  const snap = await getDocs(collection(db, 'users', uid, 'backups'));
  return snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
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
    })
    .filter((g) => Boolean(g.title));
};

export const defaultNotifyConfig = (): NotifyConfig => ({
  lineUserId: DEFAULT_LINE_USER_ID,
  steamId: '',
  switchRegions: ['TW', 'JP', 'HK', 'US', 'MX'],
  defaultMinDiscount: 30,
  notifyOnHistoricalLow: true,
  monthlyLineLimit: DEFAULT_MONTHLY_LINE_LIMIT,
  monthlyLineCount: 0,
  monthlyLineMonth: getCurrentMonthKey(),
  psnTokenStatus: 'unset',
});

export const getNotifyConfig = async (uid: string): Promise<NotifyConfig> => {
  const defaults = defaultNotifyConfig();
  if (!db) return defaults;
  const snap = await getDoc(doc(db, 'users', uid, 'notify_config', 'main'));
  if (!snap.exists()) return defaults;
  return { ...defaults, ...(snap.data() as Partial<NotifyConfig>) };
};

export const saveNotifyConfig = async (uid: string, patch: Partial<NotifyConfig>): Promise<void> => {
  if (!db) throw new Error('Firebase 尚未初始化');
  await setDoc(
    doc(db, 'users', uid, 'notify_config', 'main'),
    { ...patch, updatedAt: Date.now() },
    { merge: true }
  );
};

/** ── Owned Games ── */
export const getOwnedGames = async (uid: string): Promise<OwnedGameRecord[]> => {
  if (!db) return [];
  const snap = await getDocs(collection(db, 'users', uid, 'notify_owned'));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<OwnedGameRecord, 'id'>) }))
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
};

export const saveOwnedGame = async (uid: string, game: OwnedGameRecord): Promise<void> => {
  if (!db) throw new Error('Firebase 尚未初始化');
  const { id, ...rest } = game;
  await setDoc(doc(db, 'users', uid, 'notify_owned', id), { ...rest, updatedAt: Date.now() }, { merge: true });
};

export const saveOwnedGamesBatch = async (uid: string, games: OwnedGameRecord[]): Promise<void> => {
  if (!db || games.length === 0) return;
  for (let i = 0; i < games.length; i += 400) {
    const batch = writeBatch(db);
    for (const game of games.slice(i, i + 400)) {
      const { id, ...rest } = game;
      batch.set(doc(db, 'users', uid, 'notify_owned', id), { ...rest, updatedAt: Date.now() }, { merge: true });
    }
    await batch.commit();
  }
};

export const deleteOwnedGame = async (uid: string, id: string): Promise<void> => {
  if (!db) throw new Error('Firebase 尚未初始化');
  await deleteDoc(doc(db, 'users', uid, 'notify_owned', id));
};

/** ── Wishlist Games ── */
export const getWishlistGames = async (uid: string): Promise<WishlistGameRecord[]> => {
  if (!db) return [];
  const snap = await getDocs(collection(db, 'users', uid, 'notify_wishlist'));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<WishlistGameRecord, 'id'>) }))
    .sort((a, b) => (b.currentDiscountPercent || 0) - (a.currentDiscountPercent || 0) || (b.addedAt || 0) - (a.addedAt || 0));
};

export const saveWishlistGame = async (uid: string, game: WishlistGameRecord): Promise<void> => {
  if (!db) throw new Error('Firebase 尚未初始化');
  const { id, ...rest } = game;
  await setDoc(
    doc(db, 'users', uid, 'notify_wishlist', id),
    { ...rest, updatedAt: Date.now() },
    { merge: true }
  );
};

export const deleteWishlistGame = async (uid: string, id: string): Promise<void> => {
  if (!db) throw new Error('Firebase 尚未初始化');
  await deleteDoc(doc(db, 'users', uid, 'notify_wishlist', id));
};

/** ── Tracked Artists ── */
export const getTrackedArtists = async (uid: string): Promise<TrackedArtist[]> => {
  if (!db) return [];
  const snap = await getDocs(collection(db, 'users', uid, 'notify_artists'));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<TrackedArtist, 'id'>) }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
};

export const saveTrackedArtist = async (uid: string, artist: TrackedArtist): Promise<void> => {
  if (!db) throw new Error('Firebase 尚未初始化');
  const { id, ...rest } = artist;
  await setDoc(
    doc(db, 'users', uid, 'notify_artists', id),
    { ...rest, updatedAt: Date.now() },
    { merge: true }
  );
};

export const deleteTrackedArtist = async (uid: string, id: string): Promise<void> => {
  if (!db) throw new Error('Firebase 尚未初始化');
  await deleteDoc(doc(db, 'users', uid, 'notify_artists', id));
};

export const seedStarterArtists = async (uid: string): Promise<TrackedArtist[]> => {
  if (!db) throw new Error('Firebase 尚未初始化');
  const now = Date.now();
  const batch = writeBatch(db);
  const created: TrackedArtist[] = STARTER_ARTISTS.map((a, idx) => ({
    ...a,
    id: `starter_${idx}_${a.name.toLowerCase().replace(/[^a-z0-9]/g, '') || idx}`,
    createdAt: now + idx,
  }));
  for (const artist of created) {
    const { id, ...rest } = artist;
    batch.set(doc(db, 'users', uid, 'notify_artists', id), { ...rest, updatedAt: now }, { merge: true });
  }
  await batch.commit();
  return created;
};

/** ── Tracked Events & Notify Logs ── */
export const getTrackedEvents = async (uid: string): Promise<TrackedEvent[]> => {
  if (!db) return [];
  const q = query(collection(db, 'users', uid, 'notify_events'), orderBy('detectedAt', 'desc'), limit(40));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TrackedEvent, 'id'>) }));
};

export const saveTrackedEvent = async (uid: string, event: TrackedEvent): Promise<void> => {
  if (!db) throw new Error('Firebase 尚未初始化');
  const { id, ...rest } = event;
  await setDoc(doc(db, 'users', uid, 'notify_events', id), rest, { merge: true });
};

export const deleteTrackedEvent = async (uid: string, id: string): Promise<void> => {
  if (!db) throw new Error('Firebase 尚未初始化');
  await deleteDoc(doc(db, 'users', uid, 'notify_events', id));
};

export const getNotifyLogs = async (uid: string): Promise<NotifyLogRecord[]> => {
  if (!db) return [];
  const q = query(collection(db, 'users', uid, 'notify_logs'), orderBy('sentAt', 'desc'), limit(30));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotifyLogRecord, 'id'>) }));
};

export const createDocId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
