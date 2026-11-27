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
import {
  parsePsnWishlistSource,
  PSN_WISHLIST_CONSOLE_SNIPPET,
  toPsnWishlistRecord,
} from '../../shared/psn-wishlist-import';
import { parseStoreUrlOrId } from '../../shared/store-urls';
import { searchGamesOnline } from '../services/api';
import { createDocId } from '../services/firebase';
import { useUi } from '../theme';

interface WishlistPageProps {
  wishlistGames: WishlistGameRecord[];
  ownedGames: OwnedGameRecord[];
  gameRankGames: GameRankRecord[];
  defaultMinDiscount: number;
  onAddOrUpdate: (game: WishlistGameRecord) => Promise<void>;
  onAddWishlistBatch: (games: WishlistGameRecord[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onMoveToOwned: (game: WishlistGameRecord) => Promise<void>;
}

export function WishlistPage({
  wishlistGames,
  ownedGames,
  gameRankGames,
  defaultMinDiscount,
  onAddOrUpdate,
  onAddWishlistBatch,
  onDelete,
  onMoveToOwned,
}: WishlistPageProps) {
  const ui = useUi();
  const [platformFilter, setPlatformFilter] = useState<'ALL' | GamePlatform>('ALL');
  const [keyword, setKeyword] = useState('');

  // 新增願望清單表單狀態
  const [addPlatform, setAddPlatform] = useState<GamePlatform>('SWITCH');
  const [queryText, setQueryText] = useState('');
  const [storeUrlInput, setStoreUrlInput] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [minDiscount, setMinDiscount] = useState(String(defaultMinDiscount || 30));
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<GameSearchResult[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // PSN 願望清單匯入視窗
  const [psnImportOpen, setPsnImportOpen] = useState(false);
  const [psnRawText, setPsnRawText] = useState('');
  const [importingPsn, setImportingPsn] = useState(false);
  const [copiedPsnSnippet, setCopiedPsnSnippet] = useState(false);

  const psnPreview = useMemo(() => {
    if (!psnRawText.trim()) return null;
    try {
      const items = parsePsnWishlistSource(psnRawText);
      const existingIds = new Set(wishlistGames.map((w) => w.id));
      const records = items.map((item) => toPsnWishlistRecord(item));
      const newRecords = records.filter((rec) => !existingIds.has(rec.id));
      return { error: null as string | null, total: records.length, newRecords };
    } catch (err) {
      return { error: (err as Error).message, total: 0, newRecords: [] as WishlistGameRecord[] };
    }
  }, [psnRawText, wishlistGames]);

  const handlePsnWishlistImport = async () => {
    if (!psnPreview || psnPreview.error || psnPreview.newRecords.length === 0) return;
    setImportingPsn(true);
    try {
      await onAddWishlistBatch(psnPreview.newRecords);
      setPsnRawText('');
      setPsnImportOpen(false);
      setPlatformFilter('PS');
      setFeedback(
        `🎮 成功匯入 ${psnPreview.newRecords.length} 款 PSN 台灣願望清單遊戲！排程每天會自動追蹤這些遊戲的台幣折扣。`
      );
    } finally {
      setImportingPsn(false);
    }
  };

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

    const parsedStore = parseStoreUrlOrId(storeUrlInput);
    const resolvedSteamId = input.steamAppId ?? parsedStore.steamAppId;

    const id =
      input.platform === 'PC' && resolvedSteamId
        ? `steam_${resolvedSteamId}`
        : createDocId(`wish_${input.platform.toLowerCase()}`);

    const rec: WishlistGameRecord = {
      id,
      title: cleanTitle,
      normalizedTitle: normalizeGameTitle(cleanTitle),
      platform: input.platform,
      source: 'manual',
      externalIds: {
        ...(resolvedSteamId ? { steamAppId: resolvedSteamId } : {}),
        ...(input.igdbId ? { igdbId: input.igdbId } : {}),
        ...(parsedStore.switchNsuid ? { switchNsuid: parsedStore.switchNsuid } : {}),
        ...(parsedStore.psnProductId ? { psnProductId: parsedStore.psnProductId } : {}),
        ...(parsedStore.psnConceptId ? { psnConceptId: parsedStore.psnConceptId } : {}),
        ...(parsedStore.psnTitleId ? { psnTitleId: parsedStore.psnTitleId } : {}),
      },
      imageUrl: input.imageUrl,
      targetPriceTwd: targetPrice ? Number(targetPrice) : null,
      minDiscountPercent: minDiscount ? Number(minDiscount) : null,
      currentStoreUrl:
        parsedStore.storeUrl ||
        (resolvedSteamId ? `https://store.steampowered.com/app/${resolvedSteamId}/` : null),
      addedAt: Date.now(),
    };

    setBusyId('adding');
    try {
      await onAddOrUpdate(rec);
      setQueryText('');
      setStoreUrlInput('');
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
          <button
            type="button"
            className={ui.btnPrimary}
            onClick={() => setPsnImportOpen(true)}
          >
            🎮 匯入 PSN 願望清單
          </button>
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
          <div className="pn-field">
            <label htmlFor="wish-store-url">
              商店網址或 Switch 14 碼 NSUID（選填，貼上可讓 PS5 / Switch 跨區查價 100% 精準）
            </label>
            <input
              id="wish-store-url"
              className={ui.input}
              placeholder="例如：https://store-jp.nintendo.com/item/software/D70010000... 或 PS Store 台灣網址"
              value={storeUrlInput}
              onChange={(e) => setStoreUrlInput(e.target.value)}
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
                        <span className="pn-badge">
                          {item.source === 'steam'
                            ? 'Steam 同步'
                            : item.source === 'psn'
                              ? 'PSN 匯入'
                              : '手動'}
                        </span>
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

      {psnImportOpen && (
        <div className="pn-modal-backdrop" onClick={() => setPsnImportOpen(false)}>
          <div className={`${ui.panel} pn-modal`} onClick={(e) => e.stopPropagation()}>
            <div className="pn-panel-title">
              <span>🎮 匯入 PSN 台灣願望清單（一鍵擷取指令）</span>
              <button type="button" className={ui.btn} onClick={() => setPsnImportOpen(false)}>
                關閉
              </button>
            </div>

            <ol className="pn-hint" style={{ paddingLeft: 20, marginBottom: 10 }}>
              <li>
                先打開你的 PlayStation 台灣願望清單並捲動到最底確保所有遊戲都顯示：{' '}
                <a
                  href="https://store.playstation.com/zh-hant-tw/wishlist"
                  target="_blank"
                  rel="noreferrer"
                >
                  store.playstation.com/zh-hant-tw/wishlist
                </a>
              </li>
              <li>
                點下方按鈕複製擷取指令（只讀畫面上已顯示的遊戲名稱、封面與連結，完全不含帳密或 Cookie）：
              </li>
            </ol>

            <div className="pn-row" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className={ui.btnWarn}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(PSN_WISHLIST_CONSOLE_SNIPPET);
                    setCopiedPsnSnippet(true);
                    setTimeout(() => setCopiedPsnSnippet(false), 2500);
                  } catch {
                    // ignore
                  }
                }}
              >
                {copiedPsnSnippet ? '✓ 已複製擷取指令！' : '📋 複製一鍵擷取指令'}
              </button>
            </div>

            <p className="pn-hint" style={{ marginBottom: 10 }}>
              3. 在 PlayStation 願望清單頁按 <code>F12</code> → 切到 <strong>Console（主控台）</strong> → 貼上剛剛複製的指令並按 <code>Enter</code>（Chrome 首次貼上若提示請先輸入 <code>allow pasting</code> 按 Enter）。執行後遊戲清單會<strong>自動複製到剪貼簿</strong>，再直接 <code>Ctrl+V</code> 貼到下方框框即可！
            </p>

            <div className="pn-field">
              <label htmlFor="psn-wishlist-raw">貼上擷取結果（JSON）</label>
              <textarea
                id="psn-wishlist-raw"
                rows={5}
                className={ui.textarea}
                placeholder='執行完指令後直接 Ctrl+V 貼上（[{"href":"https://store.playstation.com/..."}]）'
                value={psnRawText}
                onChange={(e) => setPsnRawText(e.target.value)}
              />
            </div>

            {psnPreview?.error && (
              <div className="pn-alert err" style={{ marginTop: 10 }}>
                {psnPreview.error}
              </div>
            )}

            {psnPreview && !psnPreview.error && (
              <div className="pn-alert ok" style={{ marginTop: 10 }}>
                解析成功！偵測到 <strong>{psnPreview.total}</strong> 款 PSN 願望清單遊戲（將新增{' '}
                <strong>{psnPreview.newRecords.length}</strong> 款，其餘已在清單內）：
                <div className="pn-meta" style={{ marginTop: 4 }}>
                  {psnPreview.newRecords
                    .slice(0, 6)
                    .map((r) => r.title)
                    .join('、')}
                  {psnPreview.newRecords.length > 6 ? ' ...' : ''}
                </div>
              </div>
            )}

            <div className="pn-row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="button" className={ui.btn} onClick={() => setPsnImportOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className={ui.btnSuccess}
                disabled={
                  importingPsn ||
                  !psnPreview ||
                  Boolean(psnPreview.error) ||
                  psnPreview.newRecords.length === 0
                }
                onClick={() => void handlePsnWishlistImport()}
              >
                {importingPsn ? '匯入中...' : '確認匯入至願望清單'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
