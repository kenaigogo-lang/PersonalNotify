import type {
  GameRankRecord,
  NotifyConfig,
  NotifyLogRecord,
  OwnedGameRecord,
  TrackedArtist,
  TrackedEvent,
  WishlistGameRecord,
} from '../../shared/types';
import { evaluateQuota } from '../../shared/quota';
import { useUi } from '../theme';

interface DashboardPageProps {
  config: NotifyConfig;
  gameRankGames: GameRankRecord[];
  ownedGames: OwnedGameRecord[];
  wishlistGames: WishlistGameRecord[];
  artists: TrackedArtist[];
  events: TrackedEvent[];
  logs: NotifyLogRecord[];
  onNavigate: (tab: 'dashboard' | 'wishlist' | 'owned' | 'artists' | 'settings') => void;
}

const LOG_TYPE_LABEL: Record<NotifyLogRecord['type'], string> = {
  game_digest: '遊戲特價彙整',
  event_new: '北部新活動',
  event_reminder: '搶票倒數提醒',
  system_alert: '系統警報',
  line_test: 'LINE 連線測試',
};

const formatTime = (ms?: number | null): string => {
  if (!ms) return '尚未執行';
  return new Date(ms).toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function DashboardPage({
  config,
  gameRankGames,
  ownedGames,
  wishlistGames,
  artists,
  events,
  logs,
  onNavigate,
}: DashboardPageProps) {
  const ui = useUi();
  const quota = evaluateQuota(config);
  const quotaPct = Math.min(100, Math.round((quota.used / quota.limit) * 100));
  const quotaBarClass =
    quotaPct >= 85 ? 'pn-bar-fill danger' : quotaPct >= 65 ? 'pn-bar-fill warn' : 'pn-bar-fill';

  const onSaleCount = wishlistGames.filter((w) => (w.currentDiscountPercent || 0) > 0 && !w.muted).length;
  const histLowCount = wishlistGames.filter((w) => w.isHistoricalLow && !w.muted).length;
  const activeArtists = artists.filter((a) => a.enabled).length;

  return (
    <>
      <div className="pn-stats">
        <div className="pn-stat">
          <span className="pn-stat-label">LINE 本月額度 ({quota.month})</span>
          <span className="pn-stat-val">
            {quota.used}/{quota.limit}
          </span>
          <div className="pn-bar" aria-label="LINE 免費額度進度">
            <div className={quotaBarClass} style={{ width: `${quotaPct}%` }} />
          </div>
          <span className="pn-stat-sub">
            {quota.highPriorityOnly ? '⚠️ 已進入高優先保護模式' : `剩餘 ${quota.remaining} 則免費 Push`}
          </span>
        </div>

        <div className="pn-stat">
          <span className="pn-stat-label">GameRank 連動去重</span>
          <span className="pn-stat-val">{gameRankGames.length}</span>
          <span className="pn-stat-sub">款已玩紀錄（唯讀自動排除）</span>
        </div>

        <div className="pn-stat">
          <span className="pn-stat-label">統一擁有庫</span>
          <span className="pn-stat-val">{ownedGames.length}</span>
          <span className="pn-stat-sub">
            Steam {ownedGames.filter((g) => g.source === 'steam').length} ・ PSN{' '}
            {ownedGames.filter((g) => g.source === 'psn').length} ・ 手動/Switch{' '}
            {ownedGames.filter((g) => g.source === 'manual').length}
          </span>
        </div>

        <div className="pn-stat">
          <span className="pn-stat-label">願望清單追蹤</span>
          <span className="pn-stat-val">{wishlistGames.length}</span>
          <span className="pn-stat-sub">
            特價中 {onSaleCount} 款 {histLowCount > 0 ? `（🔥 史低 ${histLowCount}）` : ''}
          </span>
        </div>
      </div>

      {(config.psnTokenStatus === 'expiring_soon' || config.psnTokenStatus === 'expired') && (
        <div className={`pn-alert ${config.psnTokenStatus === 'expired' ? 'err' : ''}`}>
          {config.psnTokenStatus === 'expired'
            ? '❌ 你的 PSN 授權憑證已過期，請前往「設定＆LINE測試」重新貼上新的 npsso。'
            : '⚠️ 你的 PSN 授權憑證即將到期，請記得前往「設定＆LINE測試」更新 npsso。'}
        </div>
      )}

      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>⚡ 系統狀態與快速入口</span>
          <span className="pn-meta">上次遊戲排程同步：{formatTime(config.lastGameSyncAt)}</span>
        </div>
        <div className="pn-row">
          <button type="button" className={ui.btnPrimary} onClick={() => onNavigate('wishlist')}>
            管理願望清單 ({wishlistGames.length})
          </button>
          <button type="button" className={ui.btnSuccess} onClick={() => onNavigate('owned')}>
            標記 Switch / 已擁有遊戲
          </button>
          <button type="button" className={ui.btnWarn} onClick={() => onNavigate('artists')}>
            北部藝人追蹤 ({activeArtists})
          </button>
          <button type="button" className={ui.btn} onClick={() => onNavigate('settings')}>
            LINE 測試與帳號設定
          </button>
        </div>
      </section>

      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>🎤 近期偵測到的台灣北部活動</span>
          <span className="pn-meta">上次活動掃描：{formatTime(config.lastEventSyncAt)}</span>
        </div>
        {events.length === 0 ? (
          <div className="pn-empty">
            目前尚未有偵測紀錄。可先到「藝人活動」頁面建立或載入 LiSA / Aimer / milet / 陳忻玥清單。
          </div>
        ) : (
          <table className="pn-table">
            <thead>
              <tr>
                <th>藝人</th>
                <th>活動</th>
                <th>地點</th>
                <th>開賣時間</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 6).map((ev) => (
                <tr key={ev.id}>
                  <td>{ev.artistName}</td>
                  <td>
                    <a href={ev.sourceUrl} target="_blank" rel="noreferrer">
                      {ev.title}
                    </a>
                  </td>
                  <td>{ev.city}</td>
                  <td>{ev.ticketSaleTime || '待公布'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>📨 最近 LINE 推播紀錄</span>
        </div>
        {logs.length === 0 ? (
          <div className="pn-empty">尚無推播紀錄。可前往「設定」發送一則 LINE 測試推播卡片！</div>
        ) : (
          <table className="pn-table">
            <thead>
              <tr>
                <th>時間</th>
                <th>類型</th>
                <th>內容摘要</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatTime(log.sentAt)}</td>
                  <td>{LOG_TYPE_LABEL[log.type] || log.type}</td>
                  <td>{log.summary}</td>
                  <td>
                    <span
                      className={`pn-badge ${
                        log.status === 'sent'
                          ? 'ok'
                          : log.status === 'failed'
                            ? 'hot'
                            : 'warn'
                      }`}
                    >
                      {log.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
