import { describe, expect, it } from 'vitest';
import {
  buildEventDedupKey,
  evaluateSaleReminder,
  isExcludedByArtistKeywords,
  isNorthernTaiwanLocation,
} from './events.js';

describe('isExcludedByArtistKeywords', () => {
  it('filters out BLACKPINK Lisa articles for Japanese singer LiSA', () => {
    expect(isExcludedByArtistKeywords('BLACKPINK Lisa 來台開見面會', ['BLACKPINK', 'Lalisa'])).toBe(true);
    expect(isExcludedByArtistKeywords('日本搖滾歌姬 LiSA 宣布台北小巨蛋開唱', ['BLACKPINK', 'Lalisa'])).toBe(
      false
    );
  });
});

describe('isNorthernTaiwanLocation', () => {
  it('accepts Northern Taiwan cities and famous Northern venues', () => {
    expect(isNorthernTaiwanLocation('台北市', '台北小巨蛋')).toBe(true);
    expect(isNorthernTaiwanLocation('新北市', 'Zepp New Taipei')).toBe(true);
    expect(isNorthernTaiwanLocation('桃園市', '國立體育大學綜合體育館')).toBe(true);
    expect(isNorthernTaiwanLocation('新竹市')).toBe(true);
    expect(isNorthernTaiwanLocation('基隆市')).toBe(true);
    expect(isNorthernTaiwanLocation('', '臺北流行音樂中心')).toBe(true);
  });

  it('accepts Taiwan TBD city announcements so first announcements are not missed', () => {
    expect(isNorthernTaiwanLocation('台灣（縣市待公布）')).toBe(true);
  });

  it('rejects Southern/Central Taiwan and overseas cities', () => {
    expect(isNorthernTaiwanLocation('高雄市', '高雄巨蛋')).toBe(false);
    expect(isNorthernTaiwanLocation('台中市', 'Legacy Taichung')).toBe(false);
    expect(isNorthernTaiwanLocation('台南市')).toBe(false);
    expect(isNorthernTaiwanLocation('東京', '日本武道館')).toBe(false);
    expect(isNorthernTaiwanLocation('香港', '亞博館')).toBe(false);
  });
});

describe('evaluateSaleReminder', () => {
  const saleIso = '2026-12-10T12:00:00+08:00';
  const saleMs = Date.parse(saleIso);

  it('returns null when more than 25 hours away', () => {
    const now = saleMs - 30 * 60 * 60 * 1000;
    expect(
      evaluateSaleReminder(
        { ticketSaleTime: saleIso, notifiedBefore1d: false, notifiedBefore1h: false },
        now
      )
    ).toBeNull();
  });

  it('returns before_1d when within 24 hours of ticket sale', () => {
    const now = saleMs - 20 * 60 * 60 * 1000;
    expect(
      evaluateSaleReminder(
        { ticketSaleTime: saleIso, notifiedBefore1d: false, notifiedBefore1h: false },
        now
      )
    ).toBe('before_1d');
  });

  it('returns before_1h when within 1 hour of ticket sale', () => {
    const now = saleMs - 55 * 60 * 1000;
    expect(
      evaluateSaleReminder(
        { ticketSaleTime: saleIso, notifiedBefore1d: true, notifiedBefore1h: false },
        now
      )
    ).toBe('before_1h');
  });

  it('returns null if already notified or dismissed or past sale time', () => {
    expect(
      evaluateSaleReminder(
        { ticketSaleTime: saleIso, notifiedBefore1d: true, notifiedBefore1h: true },
        saleMs - 30 * 60 * 1000
      )
    ).toBeNull();
    expect(
      evaluateSaleReminder(
        { ticketSaleTime: saleIso, notifiedBefore1d: false, notifiedBefore1h: false, dismissed: true },
        saleMs - 30 * 60 * 1000
      )
    ).toBeNull();
    expect(
      evaluateSaleReminder(
        { ticketSaleTime: saleIso, notifiedBefore1d: false, notifiedBefore1h: false },
        saleMs + 1000
      )
    ).toBeNull();
  });
});

describe('buildEventDedupKey', () => {
  it('generates identical keys for punctuation variations of same event', () => {
    const a = buildEventDedupKey('art_1', 'Aimer 2026 台北演唱會！', '2026-12-20');
    const b = buildEventDedupKey('art_1', 'Aimer 2026 台北演唱會', '2026-12-20');
    expect(a).toBe(b);
  });
});
