import {
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForAccessCode,
  getPurchasedGames,
} from 'psn-api';
import { handle, HttpError, json, requireUser } from './_lib/auth.js';
import { extractNpssoToken } from '../shared/store-urls.js';

/**
 * 驗證使用者剛從 Sony ssocookie 取得的 64 碼 npsso，立即換成可續命 ~2 個月的 refreshToken，
 * 並做一次最小化讀取確認帳號憑證有效。不會在 log 印出任何 token 敏感資訊。
 */
export const POST = handle(async (request) => {
  await requireUser(request);

  const body = (await request.json().catch(() => ({}))) as { npsso?: string };
  const npsso = extractNpssoToken(String(body.npsso || ''));
  if (!npsso) {
    throw new HttpError(
      400,
      '無法識別有效的 npsso token。請確認已登入 playstation.com 後，從 ca.account.sony.com/api/v1/ssocookie 複製整段內容。'
    );
  }

  let authTokens;
  try {
    const accessCode = await exchangeNpssoForAccessCode(npsso);
    authTokens = await exchangeAccessCodeForAuthTokens(accessCode);
  } catch {
    throw new HttpError(
      401,
      'PSN npsso 驗證失敗（可能已過期或尚未完成 playstation.com 登入），請重新登入後再複製一次。'
    );
  }

  if (!authTokens.refreshToken) {
    throw new HttpError(502, 'Sony 未回傳 refreshToken，請稍後再試。');
  }

  // 做一次 1 筆的輕量檢查確認可讀取購買庫
  let purchasedSampleCount = 0;
  try {
    const sample = await getPurchasedGames(
      { accessToken: authTokens.accessToken },
      { platform: ['ps4', 'ps5'], size: 10, start: 0 }
    );
    purchasedSampleCount = sample.data?.purchasedTitlesRetrieve?.games?.length ?? 0;
  } catch {
    // 即使樣本查詢受限，仍回傳已驗證的 refreshToken 供排程使用
  }

  const expiresInSec =
    typeof authTokens.refreshTokenExpiresIn === 'number' && authTokens.refreshTokenExpiresIn > 0
      ? authTokens.refreshTokenExpiresIn
      : 60 * 24 * 60 * 60; // 預設 60 天

  const expiresAt = Date.now() + expiresInSec * 1000;

  return json({
    ok: true,
    refreshToken: authTokens.refreshToken,
    expiresAt,
    purchasedSampleCount,
  });
});
