import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  type GameRankRecord,
  type NotifyConfig,
  type NotifyLogRecord,
  type OwnedGameRecord,
  type TrackedArtist,
  type TrackedEvent,
  type WishlistGameRecord,
} from '../shared/types';
import { normalizeGameTitle } from '../shared/dedup';
import {
  auth,
  createDocId,
  defaultNotifyConfig,
  deleteOwnedGame,
  deletePsnSecret,
  deleteTrackedArtist,
  deleteTrackedEvent,
  deleteWishlistGame,
  formatFirebaseError,
  getGameRankPlayedGames,
  getNotifyConfig,
  getNotifyLogs,
  getOwnedGames,
  getTrackedArtists,
  getTrackedEvents,
  getWishlistGames,
  isFirebaseConfigured,
  logout,
  saveNotifyConfig,
  saveOwnedGame,
  saveOwnedGamesBatch,
  savePsnSecret,
  saveTrackedArtist,
  saveTrackedEvent,
  saveWishlistGame,
  saveWishlistGamesBatch,
  seedStarterArtists,
  signInWithGoogle,
} from './services/firebase';
import { applyTheme, loadTheme, THEME_LABEL, ThemeContext, useUi, type ThemeName } from './theme';
import { DashboardPage } from './pages/DashboardPage';
import { WishlistPage } from './pages/WishlistPage';
import { OwnedLibraryPage } from './pages/OwnedLibraryPage';
import { ArtistsPage } from './pages/ArtistsPage';
import { SettingsPage } from './pages/SettingsPage';

type TabKey = 'dashboard' | 'wishlist' | 'owned' | 'artists' | 'settings';

const NAV_TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'dashboard', label: '總覽' },
  { key: 'wishlist', label: '願望清單＆特價' },
  { key: 'owned', label: '擁有庫（Switch/GameRank）' },
  { key: 'artists', label: '北部藝人活動' },
  { key: 'settings', label: '設定＆LINE測試' },
];

function AppShell({
  theme,
  onToggleTheme,
}: {
  theme: ThemeName;
  onToggleTheme: () => void;
}) {
  const ui = useUi();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [tab, setTab] = useState<TabKey>('dashboard');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [config, setConfig] = useState<NotifyConfig>(defaultNotifyConfig);
  const [gameRankGames, setGameRankGames] = useState<GameRankRecord[]>([]);
  const [ownedGames, setOwnedGames] = useState<OwnedGameRecord[]>([]);
  const [wishlistGames, setWishlistGames] = useState<WishlistGameRecord[]>([]);
  const [artists, setArtists] = useState<TrackedArtist[]>([]);
  const [events, setEvents] = useState<TrackedEvent[]>([]);
  const [logs, setLogs] = useState<NotifyLogRecord[]>([]);

  const loadAll = useCallback(async (uid: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [cfg, gr, owned, wish, art, ev, lg] = await Promise.all([
        getNotifyConfig(uid),
        getGameRankPlayedGames(uid),
        getOwnedGames(uid),
        getWishlistGames(uid),
        getTrackedArtists(uid),
        getTrackedEvents(uid),
        getNotifyLogs(uid),
      ]);
      setConfig(cfg);
      setGameRankGames(gr);
      setOwnedGames(owned);
      setWishlistGames(wish);
      setArtists(art);
      setEvents(ev);
      setLogs(lg);
    } catch (err) {
      setErrorMsg(formatFirebaseError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        void loadAll(u.uid);
      } else {
        setGameRankGames([]);
        setOwnedGames([]);
        setWishlistGames([]);
        setArtists([]);
        setEvents([]);
        setLogs([]);
      }
    });
  }, [loadAll]);

  const handleSignIn = async () => {
    setErrorMsg(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setErrorMsg(formatFirebaseError(err));
    }
  };

  const handleSaveConfig = async (patch: Partial<NotifyConfig>) => {
    if (!user) return;
    await saveNotifyConfig(user.uid, patch);
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const handleSaveWishlist = async (game: WishlistGameRecord) => {
    if (!user) return;
    await saveWishlistGame(user.uid, game);
    setWishlistGames((prev) => {
      const idx = prev.findIndex((g) => g.id === game.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = game;
        return next;
      }
      return [game, ...prev];
    });
  };

  const handleDeleteWishlist = async (id: string) => {
    if (!user) return;
    await deleteWishlistGame(user.uid, id);
    setWishlistGames((prev) => prev.filter((g) => g.id !== id));
  };

  const handleMoveWishlistToOwned = async (game: WishlistGameRecord) => {
    if (!user) return;
    const ownedRec: OwnedGameRecord = {
      id:
        game.externalIds?.steamAppId && game.platform === 'PC'
          ? `steam_${game.externalIds.steamAppId}`
          : createDocId(`own_${game.platform.toLowerCase()}`),
      title: game.title,
      normalizedTitle: game.normalizedTitle || normalizeGameTitle(game.title),
      platform: game.platform,
      source: 'manual',
      externalIds: game.externalIds,
      imageUrl: game.imageUrl,
      addedAt: Date.now(),
    };
    await Promise.all([saveOwnedGame(user.uid, ownedRec), deleteWishlistGame(user.uid, game.id)]);
    setOwnedGames((prev) => [ownedRec, ...prev.filter((g) => g.id !== ownedRec.id)]);
    setWishlistGames((prev) => prev.filter((g) => g.id !== game.id));
  };

  const handleAddOwned = async (game: OwnedGameRecord) => {
    if (!user) return;
    await saveOwnedGame(user.uid, game);
    setOwnedGames((prev) => [game, ...prev.filter((g) => g.id !== game.id)]);
  };

  const handleAddOwnedBatch = async (games: OwnedGameRecord[]) => {
    if (!user) return;
    await saveOwnedGamesBatch(user.uid, games);
    const newIds = new Set(games.map((g) => g.id));
    setOwnedGames((prev) => [...games, ...prev.filter((g) => !newIds.has(g.id))]);
  };

  const handleAddWishlistBatch = async (games: WishlistGameRecord[]) => {
    if (!user) return;
    await saveWishlistGamesBatch(user.uid, games);
    const newIds = new Set(games.map((g) => g.id));
    setWishlistGames((prev) => [...games, ...prev.filter((g) => !newIds.has(g.id))]);
  };

  const handleDeleteOwned = async (id: string) => {
    if (!user) return;
    await deleteOwnedGame(user.uid, id);
    setOwnedGames((prev) => prev.filter((g) => g.id !== id));
  };

  const handleSaveArtist = async (artist: TrackedArtist) => {
    if (!user) return;
    await saveTrackedArtist(user.uid, artist);
    setArtists((prev) => {
      const idx = prev.findIndex((a) => a.id === artist.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = artist;
        return next;
      }
      return [...prev, artist];
    });
  };

  const handleDeleteArtist = async (id: string) => {
    if (!user) return;
    await deleteTrackedArtist(user.uid, id);
    setArtists((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSeedStarterArtists = async () => {
    if (!user) return;
    const created = await seedStarterArtists(user.uid);
    setArtists((prev) => [...prev, ...created]);
  };

  const handleSaveEvent = async (event: TrackedEvent) => {
    if (!user) return;
    await saveTrackedEvent(user.uid, event);
    setEvents((prev) => {
      const idx = prev.findIndex((e) => e.id === event.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = event;
        return next;
      }
      return [event, ...prev];
    });
  };

  const handleDeleteEvent = async (id: string) => {
    if (!user) return;
    await deleteTrackedEvent(user.uid, id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
  };

  return (
    <div className="pn-shell">
      <header className="pn-top">
        <div className="pn-top-inner">
          <div className="pn-util">
            <span>
              {user
                ? `PLAYER 1：${user.displayName || user.email}`
                : isFirebaseConfigured
                  ? '尚未登入（與 GameRank 共用 Google 帳號）'
                  : '尚未設定 VITE_FIREBASE_* 環境變數'}
            </span>
            <div className="pn-util-btns">
              <button type="button" className="pn-link" onClick={onToggleTheme}>
                切換主題：{theme === 'nes' ? THEME_LABEL.arcade : THEME_LABEL.nes}
              </button>
              {user && (
                <>
                  <button
                    type="button"
                    className="pn-link"
                    onClick={() => void loadAll(user.uid)}
                    disabled={loading}
                  >
                    {loading ? '同步中...' : '重新整理'}
                  </button>
                  <button type="button" className="pn-link danger" onClick={() => void logout()}>
                    登出
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="pn-brand">
            <h1>PERSONAL NOTIFY</h1>
            <p>遊戲史低特價 ・ GameRank 智慧去重 ・ 台灣北部藝人活動推播</p>
          </div>

          {user && (
            <nav className="pn-nav" aria-label="主導覽">
              {NAV_TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={tab === item.key ? ui.btnPrimary : ui.btn}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          )}
        </div>
      </header>

      <main className="pn-wrap">
        {errorMsg && <div className="pn-alert err">{errorMsg}</div>}

        {!isFirebaseConfigured ? (
          <section className={ui.panel}>
            <div className="pn-panel-title">
              <span>⚙️ 首次啟動：請先設定 Firebase 環境變數</span>
            </div>
            <p className="pn-hint">
              請複製 <code>.env.example</code> 為 <code>.env.local</code>，並填入與{' '}
              <strong>GameRank</strong> 相同的 <code>VITE_FIREBASE_*</code> 公開設定值，即可共用同一個
              Google 帳號與已玩遊戲紀錄。
            </p>
          </section>
        ) : !authReady ? (
          <section className={ui.panel}>
            <div className="pn-empty">LOADING...</div>
          </section>
        ) : !user ? (
          <section className={ui.panel} style={{ textAlign: 'center', padding: '32px 16px' }}>
            <h2 style={{ marginTop: 0 }}>INSERT COIN TO CONTINUE</h2>
            <p className="pn-hint" style={{ maxWidth: 480, margin: '8px auto 18px' }}>
              使用與 <strong>GameRank</strong> 相同的 Google 帳號登入，即可自動連動你已玩過的遊戲清單避免重複推播，並管理你的
              LINE 通知、願望清單與台灣北部藝人追蹤名單。
            </p>
            <button type="button" className={ui.btnPrimary} onClick={() => void handleSignIn()}>
              使用 Google 帳號登入
            </button>
          </section>
        ) : (
          <>
            {tab === 'dashboard' && (
              <DashboardPage
                config={config}
                gameRankGames={gameRankGames}
                ownedGames={ownedGames}
                wishlistGames={wishlistGames}
                artists={artists}
                events={events}
                logs={logs}
                onNavigate={setTab}
              />
            )}

            {tab === 'wishlist' && (
              <WishlistPage
                wishlistGames={wishlistGames}
                ownedGames={ownedGames}
                gameRankGames={gameRankGames}
                defaultMinDiscount={config.defaultMinDiscount}
                onAddOrUpdate={handleSaveWishlist}
                onDelete={handleDeleteWishlist}
                onMoveToOwned={handleMoveWishlistToOwned}
              />
            )}

            {tab === 'owned' && (
              <OwnedLibraryPage
                ownedGames={ownedGames}
                wishlistGames={wishlistGames}
                gameRankGames={gameRankGames}
                onAddOwned={handleAddOwned}
                onAddOwnedBatch={handleAddOwnedBatch}
                onDeleteOwned={handleDeleteOwned}
                onQuickAddWishlist={handleSaveWishlist}
                onAddWishlistBatch={handleAddWishlistBatch}
              />
            )}

            {tab === 'artists' && (
              <ArtistsPage
                artists={artists}
                events={events}
                lastEventSyncAt={config.lastEventSyncAt}
                onSaveArtist={handleSaveArtist}
                onDeleteArtist={handleDeleteArtist}
                onSeedStarter={handleSeedStarterArtists}
                onSaveEvent={handleSaveEvent}
                onDeleteEvent={handleDeleteEvent}
              />
            )}

            {tab === 'settings' && (
              <SettingsPage
                uid={user.uid}
                config={config}
                onSaveConfig={handleSaveConfig}
                onConnectPsn={async (secret) => {
                  await savePsnSecret(user.uid, secret);
                  await handleSaveConfig({
                    psnTokenStatus: 'active',
                    psnTokenExpiresAt: secret.expiresAt,
                    lastPsnAlertAt: null,
                  });
                }}
                onDisconnectPsn={async () => {
                  await deletePsnSecret(user.uid);
                  await handleSaveConfig({
                    psnTokenStatus: 'unset',
                    psnTokenExpiresAt: null,
                    lastPsnAlertAt: null,
                  });
                }}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const initial = loadTheme();
    applyTheme(initial);
    return initial;
  });

  const handleToggleTheme = () => {
    setTheme((prev) => {
      const next: ThemeName = prev === 'nes' ? 'arcade' : 'nes';
      applyTheme(next);
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={theme}>
      <AppShell theme={theme} onToggleTheme={handleToggleTheme} />
    </ThemeContext.Provider>
  );
}
