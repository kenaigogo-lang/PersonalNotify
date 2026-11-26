import { describe, expect, it } from 'vitest';
import { buildGameDigestFlex, buildTestFlexMessage } from './line-flex.js';
import type { DealCardItem } from './types.js';

const sampleDeal = (i: number): DealCardItem => ({
  id: `deal_${i}`,
  title: `Sample Game ${i}`,
  platform: 'PC',
  imageUrl: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/header.jpg',
  currentPriceTwd: 499,
  regularPriceTwd: 1290,
  discountPercent: 61,
  isHistoricalLow: i === 0,
  historicalLowPriceTwd: 499,
  region: 'TW',
  storeUrl: 'https://store.steampowered.com/app/1245620/',
  priceTrackerUrl: 'https://isthereanydeal.com/game/example/history/',
});

describe('LINE Flex Message builders', () => {
  it('builds a single bubble when there is 1 deal', () => {
    const msg = buildGameDigestFlex([sampleDeal(0)]);
    expect(msg.type).toBe('flex');
    expect(msg.contents.type).toBe('bubble');
  });

  it('caps carousel to max 10 bubbles (consuming only 1 LINE message quota)', () => {
    const deals = Array.from({ length: 14 }, (_, i) => sampleDeal(i));
    const msg = buildGameDigestFlex(deals, 'https://personal-notify.vercel.app');
    expect(msg.contents.type).toBe('carousel');
    const contents = msg.contents.contents as unknown[];
    expect(contents.length).toBe(10);
  });

  it('builds a valid test Flex message', () => {
    const msg = buildTestFlexMessage('https://personal-notify.vercel.app');
    expect(msg.type).toBe('flex');
    expect(msg.altText).toContain('連線測試成功');
  });
});
