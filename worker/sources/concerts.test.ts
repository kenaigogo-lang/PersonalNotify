import { describe, expect, it } from 'vitest';
import { parseGoogleNewsRss } from './concerts.js';

describe('parseGoogleNewsRss', () => {
  it('parses Google News RSS items and strips HTML / CDATA cleanly', () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0"><channel>
        <item>
          <title><![CDATA[Aimer 宣布 2026 台北小巨蛋開唱！售票時間曝光]]></title>
          <link>https://news.google.com/rss/articles/abc123</link>
          <pubDate>Thu, 26 Nov 2026 02:00:00 GMT</pubDate>
          <description><![CDATA[<a href="https://example.com">Aimer 台北演唱會</a> 將於下週六中午 12 點拓元開賣。]]></description>
        </item>
      </channel></rss>`;

    const items = parseGoogleNewsRss(sampleXml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain('Aimer 宣布 2026 台北小巨蛋開唱');
    expect(items[0].link).toBe('https://news.google.com/rss/articles/abc123');
    expect(items[0].description).toContain('拓元開賣');
    expect(items[0].description).not.toContain('<a');
  });
});
