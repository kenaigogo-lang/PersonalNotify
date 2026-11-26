import { describe, expect, it } from 'vitest';
import {
  buildEventReminderFlex,
  buildEventsNewFlex,
  buildGameDigestFlex,
  buildTestFlexMessage,
} from './line-flex.js';
import type { DealCardItem, TrackedEvent } from './types.js';

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

const sampleEvent: TrackedEvent = {
  id: 'ev_1',
  artistId: 'art_1',
  artistName: 'Aimer',
  title: 'Aimer 2026 台北小巨蛋演唱會',
  eventType: 'concert',
  city: '台北市',
  venue: '台北小巨蛋',
  eventDate: '2026-12-20',
  ticketSaleTime: '2026-12-01T12:00:00+08:00',
  ticketPlatform: '拓元 tixCraft',
  sourceUrl: 'https://tixcraft.com/',
  summary: 'Aimer 台北小巨蛋專場將於 12/1 中午 12 點在拓元開賣。',
  notifiedNew: false,
  notifiedBefore1d: false,
  notifiedBefore1h: false,
  detectedAt: Date.now(),
};

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

  it('builds new event and ticket sale reminder Flex messages', () => {
    const newEv = buildEventsNewFlex([sampleEvent], 'https://personalnotify.vercel.app');
    expect(newEv.type).toBe('flex');
    expect(newEv.altText).toContain('Aimer');
    expect(newEv.contents.type).toBe('bubble');

    const rem1d = buildEventReminderFlex(sampleEvent, 'before_1d');
    expect(rem1d.altText).toContain('明天開賣');

    const rem1h = buildEventReminderFlex(sampleEvent, 'before_1h');
    expect(rem1h.altText).toContain('1 小時內開賣');
  });
});
