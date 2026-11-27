import { describe, expect, it } from 'vitest';
import { extractNpssoToken, parseStoreUrlOrId } from './store-urls.js';

describe('extractNpssoToken', () => {
  const token = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkLmNoPqRsTuVwXyZ01';

  it('extracts npsso from full Sony ssocookie JSON response', () => {
    expect(extractNpssoToken(`{"npsso":"${token}"}`)).toBe(token);
  });

  it('extracts plain npsso string with whitespace or quotes', () => {
    expect(extractNpssoToken(`  "${token}"  `)).toBe(token);
    expect(extractNpssoToken(token)).toBe(token);
  });

  it('returns null for empty or invalid input', () => {
    expect(extractNpssoToken('')).toBeNull();
    expect(extractNpssoToken('short')).toBeNull();
    expect(extractNpssoToken('{"error":"not_logged_in"}')).toBeNull();
  });
});

describe('parseStoreUrlOrId', () => {
  it('parses Nintendo JP/HK/TW eShop URLs and raw 14-digit NSUIDs', () => {
    expect(
      parseStoreUrlOrId('https://store-jp.nintendo.com/item/software/D70010000063714')
    ).toMatchObject({
      switchNsuid: '70010000063714',
      storeUrl: 'https://store-jp.nintendo.com/item/software/D70010000063714',
    });

    expect(parseStoreUrlOrId('https://ec.nintendo.com/TW/zh/titles/70010000063714')).toMatchObject({
      switchNsuid: '70010000063714',
    });

    expect(parseStoreUrlOrId('70010000063714')).toMatchObject({
      switchNsuid: '70010000063714',
    });
  });

  it('parses PlayStation Store TW product and concept URLs', () => {
    expect(
      parseStoreUrlOrId(
        'https://store.playstation.com/zh-hant-tw/product/HP0177-PPSA01521_00-0000000000000000'
      )
    ).toMatchObject({
      psnProductId: 'HP0177-PPSA01521_00-0000000000000000',
      psnTitleId: 'PPSA01521_00',
    });

    expect(
      parseStoreUrlOrId('https://store.playstation.com/zh-hant-tw/concept/10008736')
    ).toMatchObject({
      psnConceptId: '10008736',
    });
  });

  it('parses Steam store URLs', () => {
    expect(parseStoreUrlOrId('https://store.steampowered.com/app/1245620/ELDEN_RING/')).toMatchObject({
      steamAppId: 1245620,
    });
  });
});
