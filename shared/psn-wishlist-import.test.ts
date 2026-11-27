import { describe, expect, it } from 'vitest';
import { parsePsnWishlistSource, toPsnWishlistRecord } from './psn-wishlist-import.js';

describe('parsePsnWishlistSource', () => {
  it('extracts PSN wishlist items from PlayStation Store SSR __NEXT_DATA__ apolloState', () => {
    const nextData = {
      props: {
        pageProps: {
          apolloState: {
            ROOT_QUERY: {
              'wishlistItemsRetrieve({"pageArgs":{"size":100}})': {
                items: [
                  { __ref: 'Product:HP0177-PPSA01521_00-0000000000000000' },
                  { __ref: 'Concept:10008736' },
                ],
              },
            },
            'Product:HP0177-PPSA01521_00-0000000000000000': {
              __typename: 'Product',
              id: 'HP0177-PPSA01521_00-0000000000000000',
              name: '地平線 西域禁地',
              media: [{ url: 'https://image.api.playstation.com/cover1.jpg', role: 'MASTER' }],
              price: {
                basePrice: 'NT$1,790',
                discountedPrice: 'NT$895',
                discountText: '-50%',
              },
            },
            'Concept:10008736': {
              __typename: 'Concept',
              id: '10008736',
              name: '艾爾登法環',
              media: [{ url: 'https://image.api.playstation.com/cover2.jpg', role: 'MASTER' }],
            },
          },
        },
      },
    };

    const html = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      nextData
    )}</script></body></html>`;

    const items = parsePsnWishlistSource(html);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: '地平線 西域禁地',
      productId: 'HP0177-PPSA01521_00-0000000000000000',
      titleId: 'PPSA01521_00',
      regularPriceTwd: 1790,
      currentPriceTwd: 895,
      discountPercent: 50,
    });
    expect(items[1]).toMatchObject({
      title: '艾爾登法環',
      conceptId: '10008736',
    });

    const rec = toPsnWishlistRecord(items[0], 1000);
    expect(rec.id).toBe('psn_HP0177-PPSA01521_00-0000000000000000');
    expect(rec.platform).toBe('PS');
    expect(rec.source).toBe('psn');
  });

  it('throws friendly error on empty or unrecognized input', () => {
    expect(() => parsePsnWishlistSource('<html><body>empty</body></html>')).toThrow(/找不到願望清單/);
  });
});
