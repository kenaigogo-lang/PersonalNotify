import { describe, expect, it } from 'vitest';
import {
  buildArtistSearchResults,
  inferArtistCategory,
  splitWikiTitle,
  type WikiSearchPage,
  type WikidataEntityLite,
} from './artist-search.js';

describe('splitWikiTitle', () => {
  it('splits parenthetical disambiguation suffix cleanly', () => {
    expect(splitWikiTitle('LiSA (日本歌手)')).toEqual({
      name: 'LiSA',
      disambiguation: '日本歌手',
    });
    expect(splitWikiTitle('程予希')).toEqual({ name: '程予希' });
  });
});

describe('inferArtistCategory', () => {
  it('infers actor, singer, and group accurately', () => {
    expect(
      inferArtistCategory({
        description: '台灣女演員、歌手',
        p31Ids: ['Q5'],
      })
    ).toBe('actor');
    expect(
      inferArtistCategory({
        description: '日本女歌手',
        p31Ids: ['Q5'],
      })
    ).toBe('singer');
    expect(
      inferArtistCategory({
        description: '日本雙人音樂組合',
        p31Ids: ['Q215380'],
      })
    ).toBe('group');
  });
});

describe('buildArtistSearchResults', () => {
  it('ranks Taiwanese actress/singer above non-artist pages and extracts aliases + website', () => {
    const pages: WikiSearchPage[] = [
      {
        pageid: 1,
        title: '程予希',
        description: '台灣女演員、歌手',
        extract: '程予希（1988年6月16日—），本名蘇笠汶，藝名樂樂，台灣女演員、歌手。',
        thumbnail: { source: 'https://upload.wikimedia.org/cheng.jpg' },
        pageprops: { wikibase_item: 'Q15905315' },
        lang: 'zh',
      },
      {
        pageid: 2,
        title: '程予希作品列表',
        description: '維基媒體列表條目',
        extract: '以下列出程予希曾參與的電視劇與電影作品。',
        lang: 'zh',
      },
    ];
    const entities: Record<string, WikidataEntityLite> = {
      Q15905315: {
        id: 'Q15905315',
        labels: { 'zh-tw': { value: '程予希' }, en: { value: 'Lyan Cheng' } },
        descriptions: { 'zh-tw': { value: '台灣女演員、歌手' } },
        aliases: { 'zh-tw': [{ value: '樂樂' }] },
        claims: {
          P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }],
        },
      },
    };

    const results = buildArtistSearchResults({ query: '程予希', pages, entities });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('程予希');
    expect(results[0].category).toBe('actor');
    expect(results[0].aliases).toContain('Lyan Cheng');
    expect(results[0].aliases).toContain('樂樂');
    expect(results[0].imageUrl).toBe('https://upload.wikimedia.org/cheng.jpg');
  });

  it('auto-suggests excludeKeywords when same-name artists appear together (e.g. LiSA vs Lisa)', () => {
    const pages: WikiSearchPage[] = [
      {
        pageid: 10,
        title: 'LiSA (日本歌手)',
        description: '日本女歌手',
        extract: '織部里沙，藝名LiSA，日本女歌手。',
        pageprops: { wikibase_item: 'Q100' },
        lang: 'zh',
      },
      {
        pageid: 11,
        title: 'Lisa (泰國歌手)',
        description: '泰國女歌手，女子組合BLACKPINK成員',
        extract: 'Lalisa Manobal，藝名Lisa，女子組合BLACKPINK成員。',
        pageprops: { wikibase_item: 'Q200' },
        lang: 'zh',
      },
      {
        pageid: 12,
        title: 'Lisa (消歧義)',
        description: '維基媒體消歧義頁',
        extract: 'Lisa可以指以下人物。',
        pageprops: { wikibase_item: 'Q4167410' },
        lang: 'zh',
      },
    ];
    const entities: Record<string, WikidataEntityLite> = {
      Q100: {
        id: 'Q100',
        labels: { en: { value: 'LiSA' }, ja: { value: '織部里沙' } },
        claims: {
          P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }],
          P856: [{ mainsnak: { datavalue: { value: 'https://www.lxixsxa.com/' } } }],
        },
      },
      Q200: {
        id: 'Q200',
        labels: { en: { value: 'Lisa' } },
        aliases: { en: [{ value: 'Lalisa' }] },
        claims: {
          P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }],
        },
      },
    };

    const results = buildArtistSearchResults({ query: 'LiSA', pages, entities });
    expect(results).toHaveLength(2);
    const jpLisa = results.find((r) => r.disambiguation === '日本歌手');
    expect(jpLisa).toBeDefined();
    expect(jpLisa?.officialNewsUrl).toBe('https://www.lxixsxa.com/');
    expect(jpLisa?.excludeKeywords).toContain('BLACKPINK');
    expect(jpLisa?.excludeKeywords).toContain('Lalisa');
  });
});
