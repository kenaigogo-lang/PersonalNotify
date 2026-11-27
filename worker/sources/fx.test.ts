import { describe, expect, it } from 'vitest';
import { convertToTwd } from './fx.js';

describe('convertToTwd', () => {
  const rates = { TWD: 1, JPY: 4.8, HKD: 0.24, USD: 0.03125, MXN: 0.625 };

  it('converts JPY, USD, HKD, MXN into rounded TWD', () => {
    expect(convertToTwd(4800, 'JPY', rates)).toBe(1000);
    expect(convertToTwd(31.25, 'USD', rates)).toBe(1000);
    expect(convertToTwd(625, 'MXN', rates)).toBe(1000);
    expect(convertToTwd(990, 'TWD', rates)).toBe(990);
  });

  it('returns 0 for non-positive values', () => {
    expect(convertToTwd(0, 'JPY', rates)).toBe(0);
    expect(convertToTwd(-100, 'USD', rates)).toBe(0);
  });
});
