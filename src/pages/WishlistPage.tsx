import { useMemo, useState } from 'react';
import {
  PLATFORM_LABEL,
  SWITCH_REGIONS,
  type GamePlatform,
  type GameRankRecord,
  type GameSearchResult,
  type OwnedGameRecord,
  type SwitchRegion,
  type WishlistGameRecord,
} from '../../shared/types';
import { isGameOwned, normalizeGameTitle } from '../../shared/dedup';
import { searchGamesOnline } from '../services/api';
import { createDocId } from '../services/firebase';
import { useUi } from '../theme';

interface WishlistPageProps {
  wishlistGames: WishlistGameRecord[];
  ownedGames: OwnedGameRecord[];
  gameRankGames: GameRankRecord[];
  defaultMinDiscount: number;
  onAddOrUpdate: (game: WishlistGameRecord) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onMoveToOwned: (game: WishlistGameRecord) => Promise<void>;
}

export function WishlistPage({
  wishlistGames,
  ownedGames,
  gameRankGames,
  defaultMinDiscount,
  onAddOrUpdate,
  onDelete,
  onMoveToOwned,
}: WishlistPageProps) {
  const ui = useUi();
  const [platformFilter, setPlatformFilter] = useState<'ALL' | GamePlatform>('ALL');
  const [keyword, setKeyword] = useState('');

  // 新增願望清單表單狀態
  const [addPlatform, setAddPlatform] = useState<GamePlatform>('SWITCH');
  const [queryText, setQueryText] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [minDiscount, setMinDiscount] = useState(String(defaultMinDiscount || 30));
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<GameSearchResult[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return wishlistGames.filter((item) => {
      if (platformFilter !== 'ALL' && item.platform !== platformFilter) return false;
      if (q && !item.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [wishlistGames, platformFilter, keyword]);

  const handleSearch = async () => {
    if (queryText.trim().length < 2) return;
    setSearching(true);
    setFeedback(null);
    try {
      const results = await searchGamesOnline(queryText, addPlatform);
      setSearchResults(results);
      if (results.length === 0) {
        setFeedback('查無線上結果，可直接點「手動加入」建立願望清單。');
      }
    } catch (err) {
      setFeedback(`線上搜尋失敗（仍可直接手動加入）：${(err as Error).message}`);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const addWishlistRecord = async (input: {
    title: string;
    platform: GamePlatform;
    imageUrl?: string;
    steamAppId?: number;
    igdbId?: number;
  }) => {
    const cleanTitle = input.title.trim();
    if (!cleanTitle) return;

    const id =
      input.platform === 'PC' && input.steamAppId
        ? `steam_${input.steamAppId}`
        : createDocId(`wish_${input.platform.toLowerCase()}`);

    const rec: WishlistGameRecord = {
      id,
      title: cleanTitle,
      normalizedTitle: normalizeGameTitle(cleanTitle),
      platform: input.platform,
      source: 'manual',
      externalIds: {
        ...(input.steamAppId ? { steamAppId: input.steamAppId } : {}),
        ...(input.igdbId ? { igdbId: input.igdbId } : {}),
      },
      imageUrl: input.imageUrl,
      targetPriceTwd: targetPrice ? Number(targetPrice) : null,
      minDiscountPercent: minDiscount ? Number(minDiscount) : null,
      currentStoreUrl:
        input.steamAppId ? `https://store.steampowered.com/app/${input.steamAppId}/` : null,
      addedAt: Date.now(),
    };

    setBusyId('adding');
    try {
      await onAddOrUpdate(rec);
      setQueryText('');
      setTargetPrice('');
      setSearchResults([]);
      setFeedback(`已加入願望清單：「${cleanTitle}」(${PLATFORM_LABEL[input.platform]})`);
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleMute = async (item: WishlistGameRecord) => {
    setBusyId(item.id);
    try {
      await onAddOrUpdate({ ...item, muted: !item.muted });
    } finally {
      setBusyId(null);
    }
  };

  const handleMove = async (item: WishlistGameRecord) => {
    setBusyId(item.id);
    try {
      await onMoveToOwned(item);
      setFeedback(`「${item.title}」已移至擁有庫，之後將不再推播此遊戲特價！`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>➕ 加入追蹤願望清單（支援 Switch / PS5 / Steam）</span>
        </div>

        <div className="pn-row">
          <div className="pn-field" style={{ maxWidth: 180 }}>
            <label htmlFor="wish-platform">平台</label>
            <div className={ui.selectWrap}>
              <select
                id="wish-platform"
                value={addPlatform}
                onChange={(e) => setAddPlatform(e.target.value as GamePlatform)}
              >
                <option value="SWITCH">Switch</option>
                <option value="PS">PS5 / PSN</option>
                <option value="PC">Steam / PC</option>
              </select>
            </div>
          </div>

          <div className="pn-field" style={{ flex: 2 }}>
            <label htmlFor="wish-query">遊戲名稱</label>
            <input
              id="wish-query"
              className={ui.input}
              placeholder="輸入中文或英文遊戲名稱（例如：薩爾達、Hades、艾爾登法環）"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSearch();
                }
              }}
            />
          </div>

          <div className="pn-field" style={{ maxWidth: 150 }}>
            <label htmlFor="wish-target">目標價 (NT$)</label>
            <input
              id="wish-target"
              type="number"
              min={0}
              className={ui.input}
              placeholder="選填，如 600"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
            />
          </div>

          <div className="pn-field" style={{ maxWidth: 130 }}>
            <label htmlFor="wish-discount">最低折扣 %</label>
            <input
              id="wish-discount"
              type="number"
              min={5}
              max={95}
              className={ui.input}
              value={minDiscount}
              onChange={(e) => setMinDiscount(e.target.value)}
            />
          </div>
        </div>

        <div className="pn-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className={ui.btnPrimary}
            disabled={searching || queryText.trim().length < 2}
            onClick={() => void handleSearch()}
          >
            {searching ? '搜尋中...' : '🔍 線上搜尋補全封面'}
          </button>
          <button
            type="button"
            className={ui.btnSuccess}
            disabled={busyId === 'adding' || !queryText.trim()}
            onClick={() => void addWishlistRecord({ title: queryText, platform: addPlatform })}
          >
            直接手動加入
          </button>
        </div>

        {feedback && (
          <div className="pn-alert ok" style={{ marginTop: 10 }}>
            {feedback}
          </div>
        )}

        {searchResults.length > 0 && (
          <div className="pn-search-drop">
            {searchResults.map((res, idx) => (
              <div key={`${res.title}-${idx}`} className="pn-search-item">
                {res.imageUrl ? (
                  <img src={res.imageUrl} alt={res.title} className="pn-cover" />
                ) : (
                  <div className="pn-cover empty">NO IMG</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pn-card-title">{res.title}</div>
                  <div className="pn-meta">
                    來源：{res.source.toUpperCase()}
                    {res.steamAppId ? ` ・ Steam #${res.steamAppId}` : ''}
                    {res.igdbId ? ` ・ IGDB #${res.igdbId}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className={ui.btnSuccess}
                  disabled={busyId === 'adding'}
                  onClick={() =>
                    void addWishlistRecord({
                      title: res.title,
                      platform: addPlatform,
                      imageUrl: res.imageUrl,
                      steamAppId: res.steamAppId,
                      igdbId: res.igdbId,
                    })
                  }
                >
                  + 追蹤
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>🎯 願望清單與最新特價 ({filtered.length})</span>
          <div className="pn-row">
            {(['ALL', 'PC', 'PS', 'SWITCH'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={platformFilter === p ? ui.btnPrimary : ui.btn}
                onClick={() => setPlatformFilter(p)}
              >
                {p === 'ALL' ? '全部' : PLATFORM_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="pn-row" style={{ marginBottom: 14 }}>
          <input
            className={ui.input}
            placeholder="篩選願望清單名稱..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        {filtered.length === 0 ? (
          <div className="pn-empty">目前沒有符合條件的願望清單項目。</div>
        ) : (
          <div className="pn-grid">
            {filtered.map((item) => {
              const ownership = isGameOwned(
                { title: item.title, platform: item.platform, externalIds: item.externalIds },
                ownedGames,
                gameRankGames
              );
              const regionMeta =
                item.platform === 'SWITCH' &&
                item.currentBestRegion &&
                item.currentBestRegion in SWITCH_REGIONS
                  ? SWITCH_REGIONS[item.currentBestRegion as SwitchRegion]
                  : null;

              return (
                <article key={item.id} className="pn-card">
                  <div className="pn-card-top">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.title} className="pn-cover" />
                    ) : (
                      <div className="pn-cover empty">{item.platform}</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 className="pn-card-title">{item.title}</h3>
                      <div className="pn-badges">
                        <span className="pn-badge pri">{PLATFORM_LABEL[item.platform]}</span>
                        <span className="pn-badge">{item.source === 'steam' ? 'Steam 同步' : '手動'}</span>
                        {item.isHistoricalLow && <span className="pn-badge hot">🔥 史低</span>}
                        {(item.currentDiscountPercent || 0) > 0 && (
                          <span className="pn-badge ok">-{item.currentDiscountPercent}%</span>
                        )}
                        {item.muted && <span className="pn-badge warn">已靜音</span>}
                      </div>
                    </div>
                  </div>

                  {ownership.owned && (
                    <div className="pn-alert">
                      ✓ 已偵測到擁有／玩過（{ownership.matchedSource}：{ownership.matchedTitle}），排程將自動略過推播。
                    </div>
                  )}

                  <div>
                    {typeof item.currentBestPriceTwd === 'number' ? (
                      <div>
                        <span className="pn-price">
                          NT${Math.round(item.currentBestPriceTwd).toLocaleString()}
                        </span>
                        {item.regularPriceTwd && item.regularPriceTwd > item.currentBestPriceTwd && (
                          <span className="pn-price-old">
                            NT${Math.round(item.regularPriceTwd).toLocaleString()}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="pn-meta">等待下次排程查價...</div>
                    )}

                    <div className="pn-meta" style={{ marginTop: 4 }}>
                      {typeof item.historicalLowPriceTwd === 'number' && (
                        <div>史低紀錄：NT${Math.round(item.historicalLowPriceTwd).toLocaleString()}</div>
                      )}
                      {typeof item.lowestSeenPriceTwd === 'number' && !item.historicalLowPriceTwd && (
                        <div>追蹤以來最低：NT${Math.round(item.lowestSeenPriceTwd).toLocaleString()}</div>
                      )}
                      {regionMeta && (
                        <div>
                          最低價區域：{regionMeta.label}（{regionMeta.paymentHint}）
                        </div>
                      )}
                      <div>
                        提醒門檻：
                        {item.targetPriceTwd ? ` ≤ NT$${item.targetPriceTwd} 或` : ''} 折扣 ≥{' '}
                        {item.minDiscountPercent || defaultMinDiscount}%
                      </div>
                    </div>
                  </div>

                  <div className="pn-actions">
                    <button
                      type="button"
                      className={ui.btnSuccess}
                      disabled={busyId === item.id}
                      onClick={() => void handleMove(item)}
                    >
                      ✓ 已入手
                    </button>
                    <button
                      type="button"
                      className={ui.btn}
                      disabled={busyId === item.id}
                      onClick={() => void handleToggleMute(item)}
                    >
                      {item.muted ? '恢復通知' : '靜音'}
                    </button>
                    {item.currentStoreUrl && (
                      <a
                        className={ui.btn}
                        href={item.currentStoreUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ textDecoration: 'none' }}
                      >
                        商店
                      </a>
                    )}
                    {item.priceTrackerUrl && (
                      <a
                        className={ui.btn}
                        href={item.priceTrackerUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ textDecoration: 'none' }}
                      >
                        史低曲線
                      </a>
                    )}
                    <button
                      type="button"
                      className={ui.btnDanger}
                      disabled={busyId === item.id}
                      onClick={() => void onDelete(item.id)}
                    >
                      移除
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
