/** 每 1 TWD 等於多少外幣（例：1 TWD ≈ 4.7 JPY，故 1 JPY ≈ 1 / 4.7 TWD） */
export type FxRatesFromTwd = Record<string, number>;

const FALLBACK_RATES_FROM_TWD: FxRatesFromTwd = {
  TWD: 1,
  JPY: 4.75,
  HKD: 0.24,
  USD: 0.031,
  MXN: 0.62,
  EUR: 0.029,
};

/** 抓取免費即時匯率（open.er-api.com，無需 API Key），失敗時自動退回保守參考匯率 */
export const fetchTwdFxRates = async (): Promise<FxRatesFromTwd> => {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/TWD', {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ...FALLBACK_RATES_FROM_TWD };
    const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (data.result === 'success' && data.rates) {
      return { ...FALLBACK_RATES_FROM_TWD, ...data.rates, TWD: 1 };
    }
    return { ...FALLBACK_RATES_FROM_TWD };
  } catch {
    return { ...FALLBACK_RATES_FROM_TWD };
  }
};

/** 將指定幣別金額換算為新台幣（四捨五入至整數） */
export const convertToTwd = (amount: number, currency: string, rates: FxRatesFromTwd): number => {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const code = currency.toUpperCase().trim();
  if (code === 'TWD' || code === 'NTD') return Math.round(amount);
  const perTwd = rates[code] || FALLBACK_RATES_FROM_TWD[code];
  if (!perTwd || perTwd <= 0) return Math.round(amount);
  return Math.round(amount / perTwd);
};
