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
import { searchGamesOnline } from '../services/api';
import { createDocId } from '../services/firebase';
import { useUi } from '../theme';

interface OwnedLibraryPageProps {
  ownedGames: OwnedGameRecord[];
  gameRankGames: GameRankRecord[];
  onAddOwned: (game: OwnedGameRecord) => Promise<void>;
  onAddOwnedBatch: (games: OwnedGameRecord[]) => Promise<void>;
  onDeleteOwned: (id: string) => Promise<void>;
  onQuickAddWishlist: (game: WishlistGameRecord) => Promise<void>;
}

type SourceFilter = 'ALL' | 'gamerank' | 'steam' | 'psn' | 'manual';

export function OwnedLibraryPage({
  ownedGames,
  gameRankGames,
  onAddOwned,
  onAddOwnedBatch,
  onDeleteOwned,
  onQuickAddWishlist,
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

  // 批次匯入視窗
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchPlatform, setBatchPlatform] = useState<GamePlatform>('SWITCH');
  const [batchText, setBatchText] = useState('');
  const [savingBatch, setSavingBatch] = useState(false);

  const combinedRows = useMemo(() => {
    const ownedRows = ownedGames.map((g) => ({
      id: g.id,
      title: g.title,
      platform: g.platform,
      source: g.source as SourceFilter,
      imageUrl: g.imageUrl,
      readonly: false,
      meta: g.source === 'steam' ? 'Steam 自動同步' : g.source === 'psn' ? 'PSN 自動同步' : '手動標記',
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

  return (
    <>
      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>✅ 快速標記已擁有遊戲（Switch / 實體片超友善介面）</span>
          <button type="button" className={ui.btnWarn} onClick={() => setBatchOpen(true)}>
            📋 批次貼上匯入清單
          </button>
        </div>

        <p className="pn-hint" style={{ marginBottom: 10 }}>
          Switch 沒有官方 API 可讀遊戲庫；你可以直接在這裡搜尋一鍵標記「已擁有」，或點右上角把整份清單一次貼上匯入。系統也會自動排除你在
          GameRank 評分過的 {gameRankGames.length} 款遊戲！
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
