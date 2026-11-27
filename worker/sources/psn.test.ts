import { describe, expect, it } from 'vitest';
import { parsePsStoreNextDataPrice, parseTwdPriceString } from './psn.js';

describe('parseTwdPriceString', () => {
  it('parses NT$ formatted prices and free strings', () => {
    expect(parseTwdPriceString('NT$1,790')).toBe(1790);
    expect(parseTwdPriceString('NT$ 595')).toBe(595);
    expect(parseTwdPriceString('免費')).toBe(0);
    expect(parseTwdPriceString('')).toBeNull();
  });
});

describe('parsePsStoreNextDataPrice', () => {
  it('extracts regular price, discounted price, discount %, and product URL from __NEXT_DATA__', () => {
    const mockHtml = `<html><head></head><body>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: {
          pageProps: {
            productId: 'HP0177-PPSA01521_00-0000000000000000',
            price: {
              basePrice: 'NT$1,790',
              discountedPrice: 'NT$895',
              discountText: '-50%',
            },
          },
        },
      })}</script>
    </body></html>`;

    const quote = parsePsStoreNextDataPrice(
      mockHtml,
      'https://store.playstation.com/zh-hant-tw/search/test',
      'Horizon Forbidden West'
    );

    expect(quote).not.toBeNull();
    expect(quote!.regularPriceTwd).toBe(1790);
    expect(quote!.currentPriceTwd).toBe(895);
    expect(quote!.discountPercent).toBe(50);
    expect(quote!.productId).toBe('HP0177-PPSA01521_00-0000000000000000');
    expect(quote!.priceTrackerUrl).toContain('platprices.com');
  });
});
