import { useState } from 'react';
import { SWITCH_REGIONS, type NotifyConfig, type SwitchRegion } from '../../shared/types';
import { sendLineTestPush, verifyPsnNpsso } from '../services/api';
import { useUi } from '../theme';

interface SettingsPageProps {
  uid: string;
  config: NotifyConfig;
  onSaveConfig: (patch: Partial<NotifyConfig>) => Promise<void>;
  onConnectPsn: (secret: { refreshToken: string; expiresAt: number }) => Promise<void>;
  onDisconnectPsn: () => Promise<void>;
}

const REGION_ORDER: SwitchRegion[] = ['TW', 'JP', 'HK', 'US', 'MX'];

export function SettingsPage({
  uid,
  config,
  onSaveConfig,
  onConnectPsn,
  onDisconnectPsn,
}: SettingsPageProps) {
  const ui = useUi();
  const [lineUserId, setLineUserId] = useState(config.lineUserId);
  const [steamId, setSteamId] = useState(config.steamId);
  const [defaultMinDiscount, setDefaultMinDiscount] = useState(String(config.defaultMinDiscount));
  const [notifyOnHistoricalLow, setNotifyOnHistoricalLow] = useState(config.notifyOnHistoricalLow);
  const [switchRegions, setSwitchRegions] = useState<SwitchRegion[]>(config.switchRegions);

  // PSN npsso 連結表單（僅作一次交換，不顯示已存 token 明碼）
  const [npssoInput, setNpssoInput] = useState('');
  const [verifyingPsn, setVerifyingPsn] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testingLine, setTestingLine] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [copiedUid, setCopiedUid] = useState(false);

  const toggleRegion = (code: SwitchRegion) => {
    setSwitchRegions((prev) =>
      prev.includes(code) ? prev.filter((r) => r !== code) : [...prev, code]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    try {
      const cleanedLineId = lineUserId.trim().replace(/^\/?chat\//i, '');
      await onSaveConfig({
        lineUserId: cleanedLineId,
        steamId: steamId.trim(),
        defaultMinDiscount: Math.max(5, Math.min(95, Number(defaultMinDiscount) || 30)),
        notifyOnHistoricalLow,
        switchRegions: switchRegions.length > 0 ? switchRegions : ['TW'],
      });
      setLineUserId(cleanedLineId);
      setStatusMsg({ kind: 'ok', text: '設定已儲存至雲端 Firestore！' });
    } catch (err) {
      setStatusMsg({ kind: 'err', text: `儲存失敗：${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleTestLine = async () => {
    setTestingLine(true);
    setStatusMsg(null);
    try {
      await sendLineTestPush(lineUserId.trim().replace(/^\/?chat\//i, ''));
      setStatusMsg({
        kind: 'ok',
        text: 'LINE 測試推播已送出！請檢查你與個人官方帳號的 LINE 聊天室。',
      });
    } catch (err) {
      setStatusMsg({ kind: 'err', text: `LINE 測試推播失敗：${(err as Error).message}` });
    } finally {
      setTestingLine(false);
    }
  };

  const handleConnectPsn = async () => {
    if (!npssoInput.trim()) return;
    setVerifyingPsn(true);
    setStatusMsg(null);
    try {
      const res = await verifyPsnNpsso(npssoInput);
      await onConnectPsn({ refreshToken: res.refreshToken, expiresAt: res.expiresAt });
      setNpssoInput('');
      const days = Math.max(1, Math.round((res.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
      setStatusMsg({
        kind: 'ok',
        text: `✅ PSN 連結成功！憑證有效約 ${days} 天（到期前 5 天會自動發 LINE 提醒），下次排程將自動同步 PS4/PS5 購買庫。`,
      });
    } catch (err) {
      setStatusMsg({ kind: 'err', text: `PSN 驗證失敗：${(err as Error).message}` });
    } finally {
      setVerifyingPsn(false);
    }
  };

  const handleDisconnectPsn = async () => {
    setVerifyingPsn(true);
    setStatusMsg(null);
    try {
      await onDisconnectPsn();
      setStatusMsg({ kind: 'ok', text: '已移除雲端儲存的 PSN 憑證。' });
    } catch (err) {
      setStatusMsg({ kind: 'err', text: `解除連結失敗：${(err as Error).message}` });
    } finally {
      setVerifyingPsn(false);
    }
  };

  const handleCopyUid = async () => {
    try {
      await navigator.clipboard.writeText(uid);
      setCopiedUid(true);
      setTimeout(() => setCopiedUid(false), 2000);
    } catch {
      // 忽略瀏覽器剪貼簿限制
    }
  };

  const psnDaysLeft =
    config.psnTokenExpiresAt && config.psnTokenExpiresAt > Date.now()
      ? Math.ceil((config.psnTokenExpiresAt - Date.now()) / (24 * 60 * 60 * 1000))
      : 0;

  const psnBadge =
    config.psnTokenStatus === 'active'
      ? { cls: 'ok', text: `✅ 已連結（剩約 ${psnDaysLeft} 天）` }
      : config.psnTokenStatus === 'expiring_soon'
        ? { cls: 'warn', text: `⚠️ 即將到期（剩約 ${psnDaysLeft} 天）` }
        : config.psnTokenStatus === 'expired'
          ? { cls: 'hot', text: '❌ 已過期，請重新貼上' }
          : { cls: '', text: '尚未連結' };

  return (
    <form onSubmit={(e) => void handleSave(e)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {statusMsg && (
        <div className={`pn-alert ${statusMsg.kind === 'ok' ? 'ok' : 'err'}`}>{statusMsg.text}</div>
      )}

      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>💬 LINE Messaging API 設定</span>
          <button
            type="button"
            className={ui.btnWarn}
            disabled={testingLine}
            onClick={() => void handleTestLine()}
          >
            {testingLine ? '發送中...' : '🔔 發送 LINE 測試推播'}
          </button>
        </div>

        <div className="pn-field">
          <label htmlFor="set-line-uid">你的 LINE User ID</label>
          <input
            id="set-line-uid"
            className={ui.input}
            value={lineUserId}
            onChange={(e) => setLineUserId(e.target.value)}
            placeholder="LINE Developers Console -> Basic settings 的 Your user ID"
          />
          <p className="pn-hint">
            Channel Access Token 請設定在 Vercel 環境變數與 GitHub Actions Secrets 的{' '}
            <code>LINE_CHANNEL_ACCESS_TOKEN</code>（不寫進網頁前端以保安全）。
          </p>
        </div>
      </section>

      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>🎯 PS5 / PSN 帳號連動（同步已購買數位庫＆已玩實體片）</span>
          <span className={`pn-badge ${psnBadge.cls}`}>{psnBadge.text}</span>
        </div>

        <ol className="pn-hint" style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>
            先在同一個瀏覽器登入{' '}
            <a href="https://www.playstation.com/zh-hant-tw/" target="_blank" rel="noreferrer">
              PlayStation 官網
            </a>
            。
          </li>
          <li>
            打開{' '}
            <a href="https://ca.account.sony.com/api/v1/ssocookie" target="_blank" rel="noreferrer">
              ca.account.sony.com/api/v1/ssocookie
            </a>
            ，直接把畫面上的整段 <code>{'{"npsso":"..."}'}</code>（或中間 64 碼）複製貼到下方。
          </li>
          <li>
            系統會即時換成有效期約 2 個月的 <code>refreshToken</code> 加密存於你本人專屬的 Firestore
            子文件，並在到期前 5 天自動發 LINE 通知你更新。
          </li>
        </ol>

        <div className="pn-row">
          <div className="pn-field" style={{ flex: 2 }}>
            <label htmlFor="set-psn-npsso">貼上 PSN npsso（輸入後即刻交換並清空，不顯示明碼）</label>
            <input
              id="set-psn-npsso"
              type="password"
              className={ui.input}
              value={npssoInput}
              onChange={(e) => setNpssoInput(e.target.value)}
              placeholder='貼上 {"npsso":"..."} 或 64 碼字串'
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            className={ui.btnPrimary}
            disabled={verifyingPsn || !npssoInput.trim()}
            onClick={() => void handleConnectPsn()}
          >
            {verifyingPsn ? '驗證中...' : '🔐 驗證並連結 PSN'}
          </button>
          {config.psnTokenStatus && config.psnTokenStatus !== 'unset' && (
            <button
              type="button"
              className={ui.btnDanger}
              disabled={verifyingPsn}
              onClick={() => void handleDisconnectPsn()}
            >
              解除連結
            </button>
          )}
        </div>
      </section>

      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>🎮 Steam 與特價推播規則</span>
        </div>

        <div className="pn-row">
          <div className="pn-field">
            <label htmlFor="set-steam-id">Steam ID64（選填，僅公開檔案自動同步用）</label>
            <input
              id="set-steam-id"
              className={ui.input}
              value={steamId}
              onChange={(e) => setSteamId(e.target.value)}
              placeholder="若使用私人帳號匯入可留空"
            />
            <p className="pn-hint">
              若希望 Steam 保持「私人」不被好友看到，這裡留空即可，請直接到「擁有庫」點「🔒 Steam 私人帳號匯入」同步！
            </p>
          </div>

          <div className="pn-field" style={{ maxWidth: 200 }}>
            <label htmlFor="set-min-disc">預設最低推播折扣 (%)</label>
            <input
              id="set-min-disc"
              type="number"
              min={5}
              max={95}
              className={ui.input}
              value={defaultMinDiscount}
              onChange={(e) => setDefaultMinDiscount(e.target.value)}
            />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label className={`pn-check-chip ${notifyOnHistoricalLow ? 'on' : ''}`}>
            <input
              type="checkbox"
              checked={notifyOnHistoricalLow}
              onChange={(e) => setNotifyOnHistoricalLow(e.target.checked)}
            />
            只要達到「🔥 歷史最低價（史低）」就自動納入當日特價彙整
          </label>
        </div>
      </section>

      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>🕹️ Switch 跨區比價區域</span>
        </div>
        <p className="pn-hint" style={{ marginBottom: 10 }}>
          每日排程會自動查詢以下勾選區域的任天堂 eShop 價格並換算成台幣，挑出最便宜區域推播（附付款方式提示）：
        </p>
        <div className="pn-row">
          {REGION_ORDER.map((code) => {
            const meta = SWITCH_REGIONS[code];
            const checked = switchRegions.includes(code);
            return (
              <label key={code} className={`pn-check-chip ${checked ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleRegion(code)}
                />
                {meta.label} ({meta.code}) — {meta.paymentHint}
              </label>
            );
          })}
        </div>
      </section>

      <section className={ui.panel}>
        <div className="pn-panel-title">
          <span>🔑 GitHub Actions 連動資訊（共用 GameRank Firebase）</span>
        </div>
        <div className="pn-row">
          <div className="pn-field">
            <label htmlFor="set-fb-uid">你的 Firebase UID（對應 GitHub Secret `TARGET_FIREBASE_UID`）</label>
            <input id="set-fb-uid" className={ui.input} value={uid} readOnly />
          </div>
          <button type="button" className={ui.btn} onClick={() => void handleCopyUid()}>
            {copiedUid ? '✓ 已複製' : '複製 UID'}
          </button>
        </div>
      </section>

      <div className="pn-row">
        <button type="submit" className={ui.btnSuccess} disabled={saving}>
          {saving ? '儲存中...' : '💾 儲存所有設定'}
        </button>
      </div>
    </form>
  );
}
