import { describe, expect, it } from 'vitest';
import {
  isGameOwned,
  normalizeGameTitle,
  resolveLastNotifiedPriceAfterCheck,
  shouldNotifyDeal,
} from './dedup.js';
import type { GameRankRecord, OwnedGameRecord } from './types.js';

describe('normalizeGameTitle', () => {
  it('normalizes case, punctuation, edition suffixes, and roman numerals', () => {
    expect(normalizeGameTitle('FINAL FANTASY VII REMAKE (PS5)')).toBe('finalfantasy7');
    expect(normalizeGameTitle('Final Fantasy 7')).toBe('finalfantasy7');
    expect(normalizeGameTitle('Elden Ring: Deluxe Edition')).toBe('eldenring');
    expect(normalizeGameTitle('薩爾達傳說：王國之淚（中文版）')).toBe('薩爾達傳說王國之淚');
    expect(normalizeGameTitle('女神異聞錄5 皇家版 決定版')).toBe('女神異聞錄5皇家版');
  });
});

describe('isGameOwned', () => {
  const ownedGames: OwnedGameRecord[] = [
    {
      id: 'steam_1245620',
      title: 'ELDEN RING',
      normalizedTitle: 'eldenring',
      platform: 'PC',
      source: 'steam',
      externalIds: { steamAppId: 1245620, igdbId: 119133 },
      addedAt: 1,
    },
    {
      id: 'own_switch_1',
      title: 'Hollow Knight',
      normalizedTitle: 'hollowknight',
      platform: 'SWITCH',
      source: 'manual',
      addedAt: 2,
    },
  ];

  const gameRankGames: GameRankRecord[] = [
    {
      id: 'gr_1',
      title: '薩爾達傳說：王國之淚',
      platform: 'SWITCH',
      score: 10,
      comment: '#神作',
    },
    {
      id: 'gr_2',
      title: 'Persona 5 Royal',
      platform: 'PS',
      score: 9.5,
      comment: '#音樂好聽',
    },
  ];

  it('matches by platform ID first', () => {
    const res = isGameOwned(
      { title: '艾爾登法環', platform: 'PC', externalIds: { steamAppId: 1245620 } },
      ownedGames,
      gameRankGames
    );
    expect(res.owned).toBe(true);
    expect(res.reason).toBe('platform_id');
  });

  it('matches across platforms via IGDB ID', () => {
    const res = isGameOwned(
      { title: '艾爾登法環 PS5', platform: 'PS', externalIds: { igdbId: 119133 } },
      ownedGames,
      gameRankGames
    );
    expect(res.owned).toBe(true);
    expect(res.reason).toBe('igdb_id');
  });

  it('matches against GameRank played backups by normalized title', () => {
    const res = isGameOwned(
      { title: '薩爾達傳說 王國之淚 (Switch 中文版)', platform: 'SWITCH' },
      ownedGames,
      gameRankGames
    );
    expect(res.owned).toBe(true);
    expect(res.reason).toBe('gamerank_played');
    expect(res.matchedSource).toBe('gamerank');
  });

  it('returns false when game is neither owned nor played', () => {
    const res = isGameOwned(
      { title: 'Hades II', platform: 'PC', externalIds: { steamAppId: 1145350 } },
      ownedGames,
      gameRankGames
    );
    expect(res.owned).toBe(false);
  });
});

describe('shouldNotifyDeal', () => {
  it('triggers on historical low or hitting target price/discount', () => {
    expect(
      shouldNotifyDeal({
        currentPriceTwd: 450,
        discountPercent: 25,
        isHistoricalLow: true,
        defaultMinDiscount: 40,
        notifyOnHistoricalLow: true,
      })
    ).toBe(true);

    expect(
      shouldNotifyDeal({
        currentPriceTwd: 590,
        discountPercent: 15,
        isHistoricalLow: false,
        targetPriceTwd: 600,
        defaultMinDiscount: 40,
        notifyOnHistoricalLow: true,
      })
    ).toBe(true);
  });

  it('prevents duplicate notification if price has not dropped further', () => {
    expect(
      shouldNotifyDeal({
        currentPriceTwd: 450,
        discountPercent: 50,
        isHistoricalLow: true,
        defaultMinDiscount: 30,
        notifyOnHistoricalLow: true,
        lastNotifiedPriceTwd: 450,
      })
    ).toBe(false);

    expect(
      shouldNotifyDeal({
        currentPriceTwd: 399,
        discountPercent: 60,
        isHistoricalLow: true,
        defaultMinDiscount: 30,
        notifyOnHistoricalLow: true,
        lastNotifiedPriceTwd: 450,
      })
    ).toBe(true);
  });

  it('respects muted flag', () => {
    expect(
      shouldNotifyDeal({
        currentPriceTwd: 100,
        discountPercent: 90,
        isHistoricalLow: true,
        defaultMinDiscount: 30,
        notifyOnHistoricalLow: true,
        muted: true,
      })
    ).toBe(false);
  });
});

describe('resolveLastNotifiedPriceAfterCheck', () => {
  it('resets lastNotifiedPriceTwd to null when sale ends and price returns above notified price', () => {
    const afterSaleEnds = resolveLastNotifiedPriceAfterCheck({
      lastNotifiedPriceTwd: 500,
      currentPriceTwd: 1000,
      discountPercent: 0,
    });
    expect(afterSaleEnds).toBeNull();

    // Next sale at the same price (500) should notify again
    expect(
      shouldNotifyDeal({
        currentPriceTwd: 500,
        discountPercent: 50,
        isHistoricalLow: false,
        defaultMinDiscount: 30,
        notifyOnHistoricalLow: true,
        lastNotifiedPriceTwd: afterSaleEnds,
      })
    ).toBe(true);
  });

  it('keeps lastNotifiedPriceTwd during an ongoing sale (including slight FX fluctuation)', () => {
    expect(
      resolveLastNotifiedPriceAfterCheck({
        lastNotifiedPriceTwd: 500,
        currentPriceTwd: 505,
        discountPercent: 50,
      })
    ).toBe(500);
  });

  it('does not reset on permanent regular-price drop so target-price alert will not spam', () => {
    expect(
      resolveLastNotifiedPriceAfterCheck({
        lastNotifiedPriceTwd: 450,
        currentPriceTwd: 450,
        discountPercent: 0,
      })
    ).toBe(450);
  });
});

