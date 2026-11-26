import { useState } from 'react';
import type { ArtistCategory, TrackedArtist, TrackedEvent } from '../../shared/types';
import { createDocId } from '../services/firebase';
import { useUi } from '../theme';

interface ArtistsPageProps {
  artists: TrackedArtist[];
  events: TrackedEvent[];
  onSaveArtist: (artist: TrackedArtist) => Promise<void>;
  onDeleteArtist: (id: string) => Promise<void>;
  onSeedStarter: () => Promise<void>;
}

const CATEGORY_LABEL: Record<ArtistCategory, string> = {
  singer: '歌手',
  actor: '演員',
  group: '團體',
};

export function ArtistsPage({
  artists,
  events,
  onSaveArtist,
  onDeleteArtist,
  onSeedStarter,
}: ArtistsPageProps) {
  const ui = useUi();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ArtistCategory>('singer');
  const [aliasesText, setAliasesText] = useState('');
  const [excludeText, setExcludeText] = useState('');
  const [officialNewsUrl, setOfficialNewsUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const artist: TrackedArtist = {
        id: createDocId('artist'),
        name: name.trim(),
        category,
        aliases: aliasesText
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        excludeKeywords: excludeText
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        officialNewsUrl: officialNewsUrl.trim() || undefined,
        enabled: true,
        createdAt: Date.now(),
      };
      await onSaveArtist(artist);
      setName('');
      setAliasesText('');
      setExcludeText('');
      setOfficialNewsUrl('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>🎤 新增追蹤藝人（歌手 / 演員 / 團體 — 台灣北部實體活動）</span>
          {artists.length === 0 && (
            <button
              type="button"
              className={ui.btnWarn}
              disabled={busy}
              onClick={() => void onSeedStarter()}
            >
              ⚡ 一鍵載入 LiSA / Aimer / milet / 陳忻玥
            </button>
          )}
        </div>
        <p className="pn-hint" style={{ marginBottom: 12 }}>
          系統將針對以下名單偵測台灣北部（台北、新北、桃園、基隆、新竹）的演唱會、見面會、簽唱會與音樂祭售票資訊（Phase 2 背景排程接上後即自動運作）。
        </p>

        <form onSubmit={(e) => void handleAdd(e)}>
          <div className="pn-row">
            <div className="pn-field">
              <label htmlFor="art-name">藝人名稱 *</label>
              <input
                id="art-name"
                className={ui.input}
                placeholder="例如：LiSA、陳忻玥、佐藤健"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="pn-field" style={{ maxWidth: 160 }}>
              <label htmlFor="art-cat">類型</label>
              <div className={ui.selectWrap}>
                <select
                  id="art-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ArtistCategory)}
                >
                  <option value="singer">歌手</option>
                  <option value="actor">演員</option>
                  <option value="group">團體</option>
                </select>
              </div>
            </div>

            <div className="pn-field">
              <label htmlFor="art-alias">別名 / 英文或日文名（逗號分隔）</label>
              <input
                id="art-alias"
                className={ui.input}
                placeholder="例如：Vicky Chen, 織部里沙"
                value={aliasesText}
                onChange={(e) => setAliasesText(e.target.value)}
              />
            </div>
          </div>

          <div className="pn-row" style={{ marginTop: 10 }}>
            <div className="pn-field">
              <label htmlFor="art-exclude">排除關鍵字（防撞名，逗號分隔）</label>
              <input
                id="art-exclude"
                className={ui.input}
                placeholder="例如：BLACKPINK, Lalisa"
                value={excludeText}
                onChange={(e) => setExcludeText(e.target.value)}
              />
            </div>

            <div className="pn-field">
              <label htmlFor="art-url">官方最新消息網址（選填）</label>
              <input
                id="art-url"
                type="url"
                className={ui.input}
                placeholder="https://..."
                value={officialNewsUrl}
                onChange={(e) => setOfficialNewsUrl(e.target.value)}
              />
            </div>
          </div>

          <div className="pn-row" style={{ marginTop: 12 }}>
            <button type="submit" className={ui.btnSuccess} disabled={busy || !name.trim()}>
              + 新增至追蹤名單
            </button>
          </div>
        </form>
      </section>

      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>⭐ 目前追蹤名單 ({artists.length})</span>
        </div>

        {artists.length === 0 ? (
          <div className="pn-empty">尚未加入任何藝人，點上方按鈕即可一鍵載入預設名單！</div>
        ) : (
          <div className="pn-grid">
            {artists.map((art) => (
              <article key={art.id} className="pn-card">
                <div className="pn-card-top">
                  <div style={{ flex: 1 }}>
                    <h3 className="pn-card-title">{art.name}</h3>
                    <div className="pn-badges">
                      <span className="pn-badge pri">{CATEGORY_LABEL[art.category]}</span>
                      <span className={`pn-badge ${art.enabled ? 'ok' : 'warn'}`}>
                        {art.enabled ? '追蹤中' : '已暫停'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pn-meta">
                  {art.aliases.length > 0 && <div>別名：{art.aliases.join('、')}</div>}
                  {art.excludeKeywords.length > 0 && (
                    <div>排除詞：{art.excludeKeywords.join('、')}</div>
                  )}
                  {art.officialNewsUrl && (
                    <div>
                      官網：
                      <a href={art.officialNewsUrl} target="_blank" rel="noreferrer">
                        {art.officialNewsUrl}
                      </a>
                    </div>
                  )}
                </div>

                <div className="pn-actions">
                  <button
                    type="button"
                    className={ui.btn}
                    onClick={() => void onSaveArtist({ ...art, enabled: !art.enabled })}
                  >
                    {art.enabled ? '暫停' : '啟用'}
                  </button>
                  <button
                    type="button"
                    className={ui.btnDanger}
                    onClick={() => void onDeleteArtist(art.id)}
                  >
                    刪除
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>🎫 已偵測到的台灣北部活動 ({events.length})</span>
        </div>
        {events.length === 0 ? (
          <div className="pn-empty">尚未偵測到新活動（Phase 2 上線 Google News RSS + Gemini 排程後自動更新）。</div>
        ) : (
          <table className="pn-table">
            <thead>
              <tr>
                <th>藝人</th>
                <th>活動標題</th>
                <th>縣市 / 場地</th>
                <th>開賣時間</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td>{ev.artistName}</td>
                  <td>
                    <a href={ev.sourceUrl} target="_blank" rel="noreferrer">
                      {ev.title}
                    </a>
                  </td>
                  <td>
                    {ev.city} {ev.venue ? `・ ${ev.venue}` : ''}
                  </td>
                  <td>{ev.ticketSaleTime || '待公布'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
