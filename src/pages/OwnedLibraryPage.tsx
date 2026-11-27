import { useMemo, useState } from 'react';
import {
  PLATFORM_LABEL,
  type GamePlatform,
  type GameRankRecord,
  type GameSearchResult,
  type OwnedGameRecord,
  type WishlistGameRecord,
} from '../../shared/types';
import { isGameOwned, normalizeGameTitle } from '../../shared/dedup';
import { parseSteamUserdataJson } from '../../shared/steam-userdata';
import { resolveSteamAppTitles, searchGamesOnline } from '../services/api';
import { createDocId } from '../services/firebase';
import { useUi } from '../theme';

interface OwnedLibraryPageProps {
  ownedGames: OwnedGameRecord[];
  wishlistGames: WishlistGameRecord[];
  gameRankGames: GameRankRecord[];
  onAddOwned: (game: OwnedGameRecord) => Promise<void>;
  onAddOwnedBatch: (games: OwnedGameRecord[]) => Promise<void>;
  onDeleteOwned: (id: string) => Promise<void>;
  onQuickAddWishlist: (game: WishlistGameRecord) => Promise<void>;
  onAddWishlistBatch: (games: WishlistGameRecord[]) => Promise<void>;
}

type SourceFilter = 'ALL' | 'gamerank' | 'steam' | 'psn' | 'manual';

const STEAM_HEADER_IMG = (appid: number) =>
  `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;

export function OwnedLibraryPage({
  ownedGames,
  wishlistGames,
  gameRankGames,
  onAddOwned,
  onAddOwnedBatch,
  onDeleteOwned,
  onQuickAddWishlist,
  onAddWishlistBatch,
}: OwnedLibraryPageProps) {
  const ui = useUi();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('ALL');
  const [keyword, setKeyword] = useState('');

  // 快速標記列（預設 Switch，回應友善標記已擁有需求）
  const [quickPlatform, setQuickPlatform] = useState<GamePlatform>('SWITCH');
  const [quickInput, setQuickInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GameSearchResult[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // 批次文字匯入視窗
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchPlatform, setBatchPlatform] = useState<GamePlatform>('SWITCH');
  const [batchText, setBatchText] = useState('');
  const [savingBatch, setSavingBatch] = useState(false);

  // Steam 私人 JSON 匯入視窗（全程不需公開個人檔案！）
  const [steamImportOpen, setSteamImportOpen] = useState(false);
  const [steamJsonText, setSteamJsonText] = useState('');
  const [importSteamOwned, setImportSteamOwned] = useState(true);
  const [importSteamWishlist, setImportSteamWishlist] = useState(true);
  const [importingSteam, setImportingSteam] = useState(false);
  const [steamError, setSteamError] = useState<string | null>(null);

  const combinedRows = useMemo(() => {
    const ownedRows = ownedGames.map((g) => ({
      id: g.id,
      title: g.title,
      platform: g.platform,
      source: g.source as SourceFilter,
      imageUrl: g.imageUrl,
      readonly: false,
      meta: g.source === 'steam' ? 'Steam 同步/匯入' : g.source === 'psn' ? 'PSN 自動同步' : '手動標記',
    }));

    const grRows = gameRankGames.map((g) => ({
      id: `gr_${g.id}`,
      title: g.title,
      platform: g.platform,
      source: 'gamerank' as SourceFilter,
      imageUrl: g.imageUrl,
      readonly: true,
      meta: `GameRank 已玩（評分 ${g.score}）`,
    }));

    const all = [...ownedRows, ...grRows];
    const q = keyword.trim().toLowerCase();
    return all.filter((row) => {
      if (sourceFilter !== 'ALL' && row.source !== sourceFilter) return false;
      if (q && !row.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [ownedGames, gameRankGames, sourceFilter, keyword]);

  const handleSearch = async () => {
    if (quickInput.trim().length < 2) return;
    setSearching(true);
    setNotice(null);
    try {
      const list = await searchGamesOnline(quickInput, quickPlatform);
      setResults(list);
      if (list.length === 0) {
        setNotice('查無線上項目，可直接按「✓ 直接標記已擁有」。');
      }
    } catch (err) {
      setNotice(`線上搜尋暫不可用（仍可直接標記）：${(err as Error).message}`);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const markOwned = async (input: {
    title: string;
    platform: GamePlatform;
    imageUrl?: string;
    steamAppId?: number;
    igdbId?: number;
  }) => {
    const title = input.title.trim();
    if (!title) return;

    const existing = isGameOwned(
      {
        title,
        platform: input.platform,
        externalIds: { steamAppId: input.steamAppId, igdbId: input.igdbId },
      },
      ownedGames,
      gameRankGames
    );
    if (existing.owned) {
      setNotice(`「${title}」已經在清單中（${existing.matchedSource}：${existing.matchedTitle}），無需重複新增。`);
      return;
    }

    const record: OwnedGameRecord = {
      id: createDocId(`own_${input.platform.toLowerCase()}`),
      title,
      normalizedTitle: normalizeGameTitle(title),
      platform: input.platform,
      source: 'manual',
      externalIds: {
        ...(input.steamAppId ? { steamAppId: input.steamAppId } : {}),
        ...(input.igdbId ? { igdbId: input.igdbId } : {}),
      },
      imageUrl: input.imageUrl,
      addedAt: Date.now(),
    };

    await onAddOwned(record);
    setQuickInput('');
    setResults([]);
    setNotice(`✓ 已標記為已擁有：「${title}」（${PLATFORM_LABEL[input.platform]}），之後將自動排除特價推播。`);
  };

  const addToWishlist = async (res: GameSearchResult) => {
    const rec: WishlistGameRecord = {
      id:
        quickPlatform === 'PC' && res.steamAppId
          ? `steam_${res.steamAppId}`
          : createDocId(`wish_${quickPlatform.toLowerCase()}`),
      title: res.title,
      normalizedTitle: normalizeGameTitle(res.title),
      platform: quickPlatform,
      source: 'manual',
      externalIds: {
        ...(res.steamAppId ? { steamAppId: res.steamAppId } : {}),
        ...(res.igdbId ? { igdbId: res.igdbId } : {}),
      },
      imageUrl: res.imageUrl,
      addedAt: Date.now(),
    };
    await onQuickAddWishlist(rec);
    setNotice(`已加入願望清單：「${res.title}」`);
  };

  const batchPreview = useMemo(() => {
    const lines = batchText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const uniqueLines: string[] = [];
    for (const line of lines) {
      const norm = normalizeGameTitle(line);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      uniqueLines.push(line);
    }

    return uniqueLines.map((title) => {
      const match = isGameOwned({ title, platform: batchPlatform }, ownedGames, gameRankGames);
      return { title, alreadyOwned: match.owned, matchedSource: match.matchedSource };
    });
  }, [batchText, batchPlatform, ownedGames, gameRankGames]);

  const handleBatchSave = async () => {
    const newItems = batchPreview.filter((p) => !p.alreadyOwned);
    if (newItems.length === 0) {
      setBatchOpen(false);
      return;
    }
    setSavingBatch(true);
    try {
      const now = Date.now();
      const records: OwnedGameRecord[] = newItems.map((item, idx) => ({
        id: createDocId(`own_${batchPlatform.toLowerCase()}_${idx}`),
        title: item.title,
        normalizedTitle: normalizeGameTitle(item.title),
        platform: batchPlatform,
        source: 'manual',
        addedAt: now + idx,
      }));
      await onAddOwnedBatch(records);
      setBatchText('');
      setBatchOpen(false);
      setNotice(`批次匯入完成！新增 ${records.length} 款 ${PLATFORM_LABEL[batchPlatform]} 已擁有遊戲。`);
    } finally {
      setSavingBatch(false);
    }
  };

  // Steam 私人 JSON 即時解析預覽
  const steamPreview = useMemo(() => {
    if (!steamJsonText.trim()) return null;
    try {
      const parsed = parseSteamUserdataJson(steamJsonText);
      const existingOwnedIds = new Set(
        ownedGames.map((g) => g.externalIds?.steamAppId).filter((n): n is number => Boolean(n))
      );
      const existingWishIds = new Set(
        wishlistGames.map((g) => g.externalIds?.steamAppId).filter((n): n is number => Boolean(n))
      );
      const ownedSet = new Set(parsed.ownedAppIds);

      const newOwnedIds = parsed.ownedAppIds.filter((id) => !existingOwnedIds.has(id));
      const newWishlistIds = parsed.wishlistAppIds.filter(
        (id) => !existingWishIds.has(id) && !ownedSet.has(id) && !existingOwnedIds.has(id)
      );

      return {
        error: null as string | null,
        totalOwned: parsed.ownedAppIds.length,
        totalWishlist: parsed.wishlistAppIds.length,
        newOwnedIds,
        newWishlistIds,
      };
    } catch (err) {
      return {
        error: (err as Error).message,
        totalOwned: 0,
        totalWishlist: 0,
        newOwnedIds: [] as number[],
        newWishlistIds: [] as number[],
      };
    }
  }, [steamJsonText, ownedGames, wishlistGames]);

  const handleSteamPrivateImport = async () => {
    if (!steamPreview || steamPreview.error) return;
    setImportingSteam(true);
    setSteamError(null);
    try {
      const ownedToCreate = importSteamOwned ? steamPreview.newOwnedIds : [];
      const wishToCreate = importSteamWishlist ? steamPreview.newWishlistIds : [];

      // 優先解析願望清單（與前幾筆擁有庫）的繁中名稱；超過 40 筆的會由每日排程自動補齊
      const idsToResolve = [...wishToCreate, ...ownedToCreate].slice(0, 40);
      const titleMap = await resolveSteamAppTitles(idsToResolve).catch(() => ({} as Record<string, string>));
      const now = Date.now();

      const ownedRecords: OwnedGameRecord[] = ownedToCreate.map((appid, idx) => {
        const title = titleMap[String(appid)] || `Steam App ${appid}`;
        return {
          id: `steam_${appid}`,
          title,
          normalizedTitle: normalizeGameTitle(title),
          platform: 'PC',
          source: 'steam',
          externalIds: { steamAppId: appid },
          imageUrl: STEAM_HEADER_IMG(appid),
          addedAt: now + idx,
        };
      });

      const wishRecords: WishlistGameRecord[] = wishToCreate.map((appid, idx) => {
        const title = titleMap[String(appid)] || `Steam App ${appid}`;
        return {
          id: `steam_${appid}`,
          title,
          normalizedTitle: normalizeGameTitle(title),
          platform: 'PC',
          source: 'steam',
          externalIds: { steamAppId: appid },
          imageUrl: STEAM_HEADER_IMG(appid),
          currentStoreUrl: `https://store.steampowered.com/app/${appid}/`,
          addedAt: now + idx,
        };
      });

      await Promise.all([
        ownedRecords.length > 0 ? onAddOwnedBatch(ownedRecords) : Promise.resolve(),
        wishRecords.length > 0 ? onAddWishlistBatch(wishRecords) : Promise.resolve(),
      ]);

      setSteamJsonText('');
      setSteamImportOpen(false);
      setNotice(
        `🔒 Steam 私人匯入完成！新增 ${ownedRecords.length} 款已擁有遊戲、${wishRecords.length} 款願望清單（你的 Steam 檔案全程維持私人，排程將自動查價與補齊名稱）。`
      );
    } catch (err) {
      setSteamError((err as Error).message);
    } finally {
      setImportingSteam(false);
    }
  };

  return (
    <>
      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>✅ 快速標記已擁有遊戲（Switch / Steam 私人 / 實體片）</span>
          <div className="pn-row">
            <button
              type="button"
              className={ui.btnPrimary}
              onClick={() => {
                setSteamError(null);
                setSteamImportOpen(true);
              }}
            >
              🔒 Steam 私人帳號匯入
            </button>
            <button type="button" className={ui.btnWarn} onClick={() => setBatchOpen(true)}>
              📋 批次貼上匯入清單
            </button>
          </div>
        </div>

        <p className="pn-hint" style={{ marginBottom: 10 }}>
          Switch 可直接搜尋標記或批次貼上匯入；Steam 若想維持「私人」不被好友看到，點上方「🔒 Steam 私人帳號匯入」即可同步！系統亦自動排除你在
          GameRank 評分過的 {gameRankGames.length} 款遊戲。
        </p>

        <div className="pn-row">
          <div className="pn-field" style={{ maxWidth: 180 }}>
            <label htmlFor="own-platform">平台</label>
            <div className={ui.selectWrap}>
              <select
                id="own-platform"
                value={quickPlatform}
                onChange={(e) => setQuickPlatform(e.target.value as GamePlatform)}
              >
                <option value="SWITCH">Switch</option>
                <option value="PS">PS5 / PSN</option>
                <option value="PC">Steam / PC</option>
              </select>
            </div>
          </div>

          <div className="pn-field" style={{ flex: 2 }}>
            <label htmlFor="own-input">遊戲名稱</label>
            <input
              id="own-input"
              className={ui.input}
              placeholder="輸入遊戲名（按 Enter 搜尋或直接標記已擁有）"
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSearch();
                }
              }}
            />
          </div>
        </div>

        <div className="pn-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className={ui.btnPrimary}
            disabled={searching || quickInput.trim().length < 2}
            onClick={() => void handleSearch()}
          >
            {searching ? '搜尋中...' : '🔍 搜尋遊戲封面'}
          </button>
          <button
            type="button"
            className={ui.btnSuccess}
            disabled={!quickInput.trim()}
            onClick={() => void markOwned({ title: quickInput, platform: quickPlatform })}
          >
            ✓ 直接標記已擁有
          </button>
        </div>

        {notice && (
          <div className="pn-alert ok" style={{ marginTop: 10 }}>
            {notice}
          </div>
        )}

        {results.length > 0 && (
          <div className="pn-search-drop">
            {results.map((res, idx) => (
              <div key={`${res.title}-${idx}`} className="pn-search-item">
                {res.imageUrl ? (
                  <img src={res.imageUrl} alt={res.title} className="pn-cover" />
                ) : (
                  <div className="pn-cover empty">NO IMG</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pn-card-title">{res.title}</div>
                  <div className="pn-meta">{res.source.toUpperCase()}</div>
                </div>
                <div className="pn-row">
                  <button
                    type="button"
                    className={ui.btnSuccess}
                    onClick={() =>
                      void markOwned({
                        title: res.title,
                        platform: quickPlatform,
                        imageUrl: res.imageUrl,
                        steamAppId: res.steamAppId,
                        igdbId: res.igdbId,
                      })
                    }
                  >
                    ✓ 已擁有
                  </button>
                  <button
                    type="button"
                    className={ui.btnPrimary}
                    onClick={() => void addToWishlist(res)}
                  >
                    + 願望
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>📚 已擁有與 GameRank 排除總表 ({combinedRows.length})</span>
          <div className="pn-row">
            {(
              [
                ['ALL', '全部'],
                ['gamerank', `GameRank (${gameRankGames.length})`],
                ['steam', `Steam (${ownedGames.filter((g) => g.source === 'steam').length})`],
                ['psn', `PSN (${ownedGames.filter((g) => g.source === 'psn').length})`],
                ['manual', `Switch/手動 (${ownedGames.filter((g) => g.source === 'manual').length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={sourceFilter === key ? ui.btnPrimary : ui.btn}
                onClick={() => setSourceFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="pn-row" style={{ marginBottom: 14 }}>
          <input
            className={ui.input}
            placeholder="搜尋已擁有或 GameRank 遊戲..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        {combinedRows.length === 0 ? (
          <div className="pn-empty">此分類目前沒有遊戲紀錄。</div>
        ) : (
          <div className="pn-grid">
            {combinedRows.slice(0, 120).map((row) => (
              <article key={row.id} className="pn-card">
                <div className="pn-card-top">
                  {row.imageUrl ? (
                    <img src={row.imageUrl} alt={row.title} className="pn-cover" />
                  ) : (
                    <div className="pn-cover empty">{row.platform}</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 className="pn-card-title">{row.title}</h3>
                    <div className="pn-badges">
                      <span className="pn-badge pri">{PLATFORM_LABEL[row.platform]}</span>
                      <span className={`pn-badge ${row.readonly ? 'ok' : ''}`}>{row.meta}</span>
                    </div>
                  </div>
                </div>
                {!row.readonly && (
                  <div className="pn-actions">
                    <button
                      type="button"
                      className={ui.btnDanger}
                      onClick={() => void onDeleteOwned(row.id)}
                    >
                      移除標記
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {steamImportOpen && (
        <div className="pn-modal-backdrop" onClick={() => setSteamImportOpen(false)}>
          <div className={`${ui.panel} pn-modal`} onClick={(e) => e.stopPropagation()}>
            <div className="pn-panel-title">
              <span>🔒 Steam 私人帳號一鍵匯入（免公開檔案）</span>
              <button type="button" className={ui.btn} onClick={() => setSteamImportOpen(false)}>
                關閉
              </button>
            </div>

            <ol className="pn-hint" style={{ paddingLeft: 20, marginBottom: 12 }}>
              <li>
                先在這個瀏覽器登入{' '}
                <a href="https://store.steampowered.com/login/" target="_blank" rel="noreferrer">
                  Steam 商店網頁
                </a>
                （你的隱私設定全程維持「私人」完全不用改）。
              </li>
              <li>
                打開官方私人資料網址：{' '}
                <a
                  href="https://store.steampowered.com/dynamicstore/userdata/"
                  target="_blank"
                  rel="noreferrer"
                >
                  store.steampowered.com/dynamicstore/userdata/
                </a>
              </li>
              <li>
                在打開的頁面上按 <code>Ctrl+A</code> 全選 → <code>Ctrl+C</code> 複製 → 貼到下方框框即可！
              </li>
            </ol>

            <div className="pn-field">
              <label htmlFor="steam-json-input">貼上 Steam userdata JSON</label>
              <textarea
                id="steam-json-input"
                rows={6}
                className={ui.textarea}
                placeholder='{"rgWishlist":[...],"rgOwnedApps":[...],...}'
                value={steamJsonText}
                onChange={(e) => setSteamJsonText(e.target.value)}
              />
            </div>

            {steamPreview?.error && (
              <div className="pn-alert err" style={{ marginTop: 10 }}>
                {steamPreview.error}
              </div>
            )}

            {steamError && (
              <div className="pn-alert err" style={{ marginTop: 10 }}>
                {steamError}
              </div>
            )}

            {steamPreview && !steamPreview.error && (
              <div style={{ marginTop: 10 }}>
                <div className="pn-alert ok" style={{ marginBottom: 10 }}>
                  解析成功！共偵測到已擁有 <strong>{steamPreview.totalOwned}</strong> 款、願望清單{' '}
                  <strong>{steamPreview.totalWishlist}</strong> 款（將新增{' '}
                  <strong>{steamPreview.newOwnedIds.length}</strong> 款已擁有、{' '}
                  <strong>{steamPreview.newWishlistIds.length}</strong> 款願望清單）。
                </div>
                <div className="pn-row">
                  <label className={`pn-check-chip ${importSteamOwned ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={importSteamOwned}
                      onChange={(e) => setImportSteamOwned(e.target.checked)}
                    />
                    匯入已擁有遊戲（+{steamPreview.newOwnedIds.length}）
                  </label>
                  <label className={`pn-check-chip ${importSteamWishlist ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={importSteamWishlist}
                      onChange={(e) => setImportSteamWishlist(e.target.checked)}
                    />
                    匯入願望清單（+{steamPreview.newWishlistIds.length}）
                  </label>
                </div>
              </div>
            )}

            <div className="pn-row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="button" className={ui.btn} onClick={() => setSteamImportOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className={ui.btnSuccess}
                disabled={
                  importingSteam ||
                  !steamPreview ||
                  Boolean(steamPreview.error) ||
                  ((!importSteamOwned || steamPreview.newOwnedIds.length === 0) &&
                    (!importSteamWishlist || steamPreview.newWishlistIds.length === 0))
                }
                onClick={() => void handleSteamPrivateImport()}
              >
                {importingSteam ? '解析名稱並匯入中...' : '確認匯入至雲端'}
              </button>
            </div>
          </div>
        </div>
      )}

      {batchOpen && (
        <div className="pn-modal-backdrop" onClick={() => setBatchOpen(false)}>
          <div className={`${ui.panel} pn-modal`} onClick={(e) => e.stopPropagation()}>
            <div className="pn-panel-title">
              <span>📋 批次貼上匯入已擁有遊戲</span>
              <button type="button" className={ui.btn} onClick={() => setBatchOpen(false)}>
                關閉
              </button>
            </div>
            <div className="pn-field" style={{ marginBottom: 10 }}>
              <label htmlFor="batch-platform">目標平台</label>
              <div className={ui.selectWrap}>
                <select
                  id="batch-platform"
                  value={batchPlatform}
                  onChange={(e) => setBatchPlatform(e.target.value as GamePlatform)}
                >
                  <option value="SWITCH">Switch</option>
                  <option value="PS">PS5 / PSN</option>
                  <option value="PC">Steam / PC</option>
                </select>
              </div>
            </div>
            <div className="pn-field">
              <label htmlFor="batch-textarea">每行貼上一款遊戲名稱（自動與既有清單去重）</label>
              <textarea
                id="batch-textarea"
                rows={7}
                className={ui.textarea}
                placeholder={'薩爾達傳說 王國之淚\n聖火降魔錄 Engage\n空洞騎士\n...'}
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
              />
            </div>

            {batchPreview.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <p className="pn-hint">
                  共解析 {batchPreview.length} 款：將新增{' '}
                  <strong>{batchPreview.filter((p) => !p.alreadyOwned).length}</strong> 款，已存在略過{' '}
                  {batchPreview.filter((p) => p.alreadyOwned).length} 款。
                </p>
              </div>
            )}

            <div className="pn-row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="button" className={ui.btn} onClick={() => setBatchOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className={ui.btnSuccess}
                disabled={savingBatch || batchPreview.filter((p) => !p.alreadyOwned).length === 0}
                onClick={() => void handleBatchSave()}
              >
                {savingBatch ? '匯入中...' : '確認批次匯入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
