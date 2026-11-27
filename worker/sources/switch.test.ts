import { describe, expect, it } from 'vitest';
import { parseNintendoPriceItem } from './switch.js';

describe('parseNintendoPriceItem', () => {
  const rates = { TWD: 1, JPY: 5.0, USD: 0.03125, MXN: 0.625, HKD: 0.25 };

  it('parses discounted JP eShop price into TWD with payment hint', () => {
    const res = parseNintendoPriceItem(
      {
        title_id: 70010000063714,
        regular_price: { raw_value: '7500', currency: 'JPY' },
        discount_price: { raw_value: '5250', currency: 'JPY' },
      },
      'JP',
      rates
    );

    expect(res).not.toBeNull();
    expect(res!.nsuid).toBe('70010000063714');
    expect(res!.quote.regularPriceTwd).toBe(1500);
    expect(res!.quote.currentPriceTwd).toBe(1050);
    expect(res!.quote.discountPercent).toBe(30);
    expect(res!.quote.paymentHint).toContain('日區點數卡');
    expect(res!.quote.storeUrl).toContain('D70010000063714');
  });

  it('handles non-discounted TW eShop price with direct credit card hint', () => {
    const res = parseNintendoPriceItem(
      {
        title_id: '70010000063714',
        regular_price: { raw_value: '1790', currency: 'TWD' },
      },
      'TW',
      rates
    );

    expect(res).not.toBeNull();
    expect(res!.quote.currentPriceTwd).toBe(1790);
    expect(res!.quote.discountPercent).toBe(0);
    expect(res!.quote.paymentHint).toContain('台灣信用卡直刷');
  });
});
