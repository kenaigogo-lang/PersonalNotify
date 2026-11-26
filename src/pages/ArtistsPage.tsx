import { useState } from 'react';
import type { ArtistCategory, EventType, TrackedArtist, TrackedEvent } from '../../shared/types';
import { createDocId } from '../services/firebase';
import { useUi } from '../theme';

interface ArtistsPageProps {
  artists: TrackedArtist[];
  events: TrackedEvent[];
  lastEventSyncAt?: number | null;
  onSaveArtist: (artist: TrackedArtist) => Promise<void>;
  onDeleteArtist: (id: string) => Promise<void>;
  onSeedStarter: () => Promise<void>;
  onSaveEvent: (event: TrackedEvent) => Promise<void>;
  onDeleteEvent: (id: string) => Promise<void>;
}

const CATEGORY_LABEL: Record<ArtistCategory, string> = {
  singer: '歌手',
  actor: '演員',
  group: '團體',
};

const EVENT_TYPE_LABEL: Record<EventType, string> = {
  concert: '演唱會',
  fanmeeting: '見面會',
  festival: '音樂祭',
  other: '實體活動',
};

const formatDateTime = (iso?: string): string => {
  if (!iso) return '尚未公布';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function ArtistsPage({
  artists,
  events,
  lastEventSyncAt,
  onSaveArtist,
  onDeleteArtist,
  onSeedStarter,
  onSaveEvent,
  onDeleteEvent,
}: ArtistsPageProps) {
  const ui = useUi();

  // 藝人表單（支援新增與編輯）
  const [editingArtistId, setEditingArtistId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ArtistCategory>('singer');
  const [aliasesText, setAliasesText] = useState('');
  const [excludeText, setExcludeText] = useState('');
  const [officialNewsUrl, setOfficialNewsUrl] = useState('');
  const [busy, setBusy] = useState(false);

  // 手動補登活動表單（可設定搶票前 24h / 1h LINE 自動提醒）
  const [showManualEvent, setShowManualEvent] = useState(false);
  const [evArtistName, setEvArtistName] = useState('');
  const [evTitle, setEvTitle] = useState('');
  const [evType, setEvType] = useState<EventType>('concert');
  const [evCity, setEvCity] = useState('台北市');
  const [evVenue, setEvVenue] = useState('');
  const [evDate, setEvDate] = useState('');
  const [evSaleLocal, setEvSaleLocal] = useState(''); // datetime-local
  const [evPlatform, setEvPlatform] = useState('');
  const [evUrl, setEvUrl] = useState('');

  const resetArtistForm = () => {
    setEditingArtistId(null);
    setName('');
    setCategory('singer');
    setAliasesText('');
    setExcludeText('');
    setOfficialNewsUrl('');
  };

  const startEditArtist = (art: TrackedArtist) => {
    setEditingArtistId(art.id);
    setName(art.name);
    setCategory(art.category);
    setAliasesText(art.aliases.join(', '));
    setExcludeText(art.excludeKeywords.join(', '));
    setOfficialNewsUrl(art.officialNewsUrl || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveArtist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const existing = editingArtistId ? artists.find((a) => a.id === editingArtistId) : null;
      const artist: TrackedArtist = {
        id: existing ? existing.id : createDocId('artist'),
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
        enabled: existing ? existing.enabled : true,
        createdAt: existing ? existing.createdAt : Date.now(),
      };
      await onSaveArtist(artist);
      resetArtistForm();
    } finally {
      setBusy(false);
    }
  };

  const handleAddManualEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evArtistName.trim() || !evTitle.trim()) return;
    setBusy(true);
    try {
      const ticketSaleTime = evSaleLocal ? `${evSaleLocal}:00+08:00` : undefined;
      const matchedArtist = artists.find(
        (a) => a.name.toLowerCase() === evArtistName.trim().toLowerCase()
      );
      const record: TrackedEvent = {
        id: createDocId('event_manual'),
        artistId: matchedArtist?.id || 'manual',
        artistName: evArtistName.trim(),
        title: evTitle.trim(),
        eventType: evType,
        city: evCity.trim() || '台北市',
        venue: evVenue.trim() || undefined,
        eventDate: evDate.trim() || undefined,
        ticketSaleTime,
        ticketPlatform: evPlatform.trim() || undefined,
        sourceUrl: evUrl.trim() || 'https://personalnotify.vercel.app/',
        summary: '手動登錄的台灣北部活動，系統將於開賣前 24 小時與前 1 小時自動發送 LINE 搶票提醒。',
        notifiedNew: true,
        notifiedBefore1d: false,
        notifiedBefore1h: false,
        detectedAt: Date.now(),
      };
      await onSaveEvent(record);
      setEvArtistName('');
      setEvTitle('');
      setEvVenue('');
      setEvDate('');
      setEvSaleLocal('');
      setEvPlatform('');
      setEvUrl('');
      setShowManualEvent(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>
            {editingArtistId
              ? '✏️ 編輯追蹤藝人'
              : '🎤 新增追蹤藝人（歌手 / 演員 / 團體 — 台灣北部實體活動）'}
          </span>
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
          GitHub Actions 每天 09:00 / 13:00 / 17:00 / 21:00 自動掃描 Google News RSS、KKTIX 與官方公告頁，並透過
          Gemini 嚴格篩選「台灣北部（台北、新北、桃園、基隆、新竹）」可見本人的實體活動。
          {lastEventSyncAt
            ? `（上次自動掃描：${new Date(lastEventSyncAt).toLocaleString('zh-TW')}）`
            : ''}
        </p>

        <form onSubmit={(e) => void handleSaveArtist(e)}>
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
              {editingArtistId ? '💾 儲存修改' : '+ 新增至追蹤名單'}
            </button>
            {editingArtistId && (
              <button type="button" className={ui.btn} onClick={resetArtistForm}>
                取消編輯
              </button>
            )}
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
                  <button type="button" className={ui.btnPrimary} onClick={() => startEditArtist(art)}>
                    編輯
                  </button>
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
          <span>🎫 台灣北部活動與搶票提醒 ({events.length})</span>
          <button
            type="button"
            className={ui.btnWarn}
            onClick={() => setShowManualEvent((v) => !v)}
          >
            {showManualEvent ? '收起表單' : '⏰ 手動登錄搶票提醒'}
          </button>
        </div>

        {showManualEvent && (
          <form
            onSubmit={(e) => void handleAddManualEvent(e)}
            style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '2px dashed #9ca3af' }}
          >
            <div className="pn-row">
              <div className="pn-field">
                <label htmlFor="ev-artist">藝人名稱 *</label>
                <input
                  id="ev-artist"
                  className={ui.input}
                  value={evArtistName}
                  onChange={(e) => setEvArtistName(e.target.value)}
                  placeholder="例如：Aimer"
                  required
                />
              </div>
              <div className="pn-field" style={{ flex: 2 }}>
                <label htmlFor="ev-title">活動名稱 *</label>
                <input
                  id="ev-title"
                  className={ui.input}
                  value={evTitle}
                  onChange={(e) => setEvTitle(e.target.value)}
                  placeholder="例如：Aimer 台北小巨蛋專場"
                  required
                />
              </div>
              <div className="pn-field" style={{ maxWidth: 150 }}>
                <label htmlFor="ev-type">類型</label>
                <div className={ui.selectWrap}>
                  <select
                    id="ev-type"
                    value={evType}
                    onChange={(e) => setEvType(e.target.value as EventType)}
                  >
                    <option value="concert">演唱會</option>
                    <option value="fanmeeting">見面會</option>
                    <option value="festival">音樂祭</option>
                    <option value="other">實體活動</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pn-row" style={{ marginTop: 10 }}>
              <div className="pn-field" style={{ maxWidth: 150 }}>
                <label htmlFor="ev-city">北部縣市</label>
                <input
                  id="ev-city"
                  className={ui.input}
                  value={evCity}
                  onChange={(e) => setEvCity(e.target.value)}
                />
              </div>
              <div className="pn-field">
                <label htmlFor="ev-venue">場地（選填）</label>
                <input
                  id="ev-venue"
                  className={ui.input}
                  placeholder="台北小巨蛋 / 北流 / Zepp"
                  value={evVenue}
                  onChange={(e) => setEvVenue(e.target.value)}
                />
              </div>
              <div className="pn-field" style={{ maxWidth: 170 }}>
                <label htmlFor="ev-date">活動日期</label>
                <input
                  id="ev-date"
                  type="date"
                  className={ui.input}
                  value={evDate}
                  onChange={(e) => setEvDate(e.target.value)}
                />
              </div>
            </div>

            <div className="pn-row" style={{ marginTop: 10 }}>
              <div className="pn-field">
                <label htmlFor="ev-sale">開賣時間（填寫即啟動前 24h / 1h LINE 提醒）</label>
                <input
                  id="ev-sale"
                  type="datetime-local"
                  className={ui.input}
                  value={evSaleLocal}
                  onChange={(e) => setEvSaleLocal(e.target.value)}
                />
              </div>
              <div className="pn-field">
                <label htmlFor="ev-plat">售票平台</label>
                <input
                  id="ev-plat"
                  className={ui.input}
                  placeholder="拓元 tixCraft / KKTIX / 遠大"
                  value={evPlatform}
                  onChange={(e) => setEvPlatform(e.target.value)}
                />
              </div>
              <div className="pn-field">
                <label htmlFor="ev-url">售票 / 公告連結</label>
                <input
                  id="ev-url"
                  type="url"
                  className={ui.input}
                  placeholder="https://..."
                  value={evUrl}
                  onChange={(e) => setEvUrl(e.target.value)}
                />
              </div>
            </div>

            <div className="pn-row" style={{ marginTop: 12 }}>
              <button type="submit" className={ui.btnSuccess} disabled={busy}>
                💾 儲存活動並排程搶票提醒
              </button>
            </div>
          </form>
        )}

        {events.length === 0 ? (
          <div className="pn-empty">
            目前尚未偵測到新活動。設定好 GitHub Secret `GEMINI_API_KEY` 後，系統將每日定時自動偵測，或也可點右上方手動登錄搶票倒數。
          </div>
        ) : (
          <div className="pn-grid">
            {events.map((ev) => (
              <article key={ev.id} className="pn-card">
                <div>
                  <h3 className="pn-card-title">{ev.title}</h3>
                  <div className="pn-badges">
                    <span className="pn-badge pri">{ev.artistName}</span>
                    <span className="pn-badge">{EVENT_TYPE_LABEL[ev.eventType] || '活動'}</span>
                    <span className="pn-badge ok">{ev.city}</span>
                    {ev.notifiedBefore1d && <span className="pn-badge warn">已提醒前1天</span>}
                    {ev.notifiedBefore1h && <span className="pn-badge hot">已提醒前1小時</span>}
                    {ev.dismissed && <span className="pn-badge">已關閉提醒</span>}
                  </div>
                </div>

                <div className="pn-meta">
                  {ev.venue && <div>場地：{ev.venue}</div>}
                  {ev.eventDate && <div>日期：{ev.eventDate}</div>}
                  <div>
                    開賣時間：<strong>{formatDateTime(ev.ticketSaleTime)}</strong>
                  </div>
                  {ev.ticketPlatform && <div>平台：{ev.ticketPlatform}</div>}
                  {ev.summary && <div style={{ marginTop: 4 }}>{ev.summary}</div>}
                </div>

                <div className="pn-actions">
                  {ev.sourceUrl && (
                    <a
                      className={ui.btnPrimary}
                      href={ev.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: 'none' }}
                    >
                      查看原頁
                    </a>
                  )}
                  <button
                    type="button"
                    className={ui.btn}
                    onClick={() => void onSaveEvent({ ...ev, dismissed: !ev.dismissed })}
                  >
                    {ev.dismissed ? '恢復提醒' : '停止提醒'}
                  </button>
                  <button
                    type="button"
                    className={ui.btnDanger}
                    onClick={() => void onDeleteEvent(ev.id)}
                  >
                    刪除
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
