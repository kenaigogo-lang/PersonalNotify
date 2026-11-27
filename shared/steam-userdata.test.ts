import { describe, expect, it } from 'vitest';
import { parseSteamUserdataJson } from './steam-userdata.js';

describe('parseSteamUserdataJson', () => {
  it('extracts deduplicated owned and wishlist app IDs from Steam userdata JSON', () => {
    const raw = JSON.stringify({
      rgWishlist: [1145350, 1245620, 1145350, 'bad'],
      rgOwnedApps: [1091500, 367520, -1, 0, 1091500],
      rgIgnoredApps: {},
    });
    const res = parseSteamUserdataJson(raw);
    expect(res.ownedAppIds).toEqual([1091500, 367520]);
    expect(res.wishlistAppIds).toEqual([1145350, 1245620]);
  });

  it('throws friendly error when not logged into Steam (empty arrays)', () => {
    expect(() =>
      parseSteamUserdataJson(JSON.stringify({ rgWishlist: [], rgOwnedApps: [] }))
    ).toThrow(/登入 Steam/);
  });

  it('throws friendly error on invalid JSON', () => {
    expect(() => parseSteamUserdataJson('not json')).toThrow(/JSON 格式/);
  });
});
