import type { TrackedArtist } from '../../shared/types.js';
import { isExcludedByArtistKeywords, simpleStableHash } from '../../shared/events.js';

export interface CandidateArticle {
  hash: string;
  artistId: string;
  artistName: string;
  source: 'google_news' | 'kktix' | 'official_site';
  title: string;
  url: string;
  publishedAt?: string;
  snippet?: string;
}

const decodeXmlEntities = (str: string): string =>
  str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 輕量 XML RSS 解析器（專供 Google News RSS 使用） */
export const parseGoogleNewsRss = (
  xml: string
): Array<{ title: string; link: string; pubDate?: string; description?: string }> => {
  const items: Array<{ title: string; link: string; pubDate?: string; description?: string }> = [];
  const itemMatches = xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi);
  for (const m of itemMatches) {
    const block = m[1];
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
    const pubMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/i);
    const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : '';
    const link = linkMatch ? decodeXmlEntities(linkMatch[1]) : '';
    if (!title || !link) continue;
    items.push({
      title,
      link,
      pubDate: pubMatch ? decodeXmlEntities(pubMatch[1]) : undefined,
      description: descMatch ? decodeXmlEntities(descMatch[1]).slice(0, 220) : undefined,
    });
  }
  return items;
};

/** 來源 1：Google News RSS（過去 14 天內的台灣活動／演唱會／見面會／售票新聞） */
export const fetchGoogleNewsCandidates = async (
  artist: TrackedArtist
): Promise<CandidateArticle[]> => {
  const names = [artist.name, ...artist.aliases.slice(0, 2)]
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => `"${n}"`);

  const nameQuery = names.length > 1 ? `(${names.join(' OR ')})` : names[0];
  const eventTerms = '(演唱會 OR 見面會 OR 專場 OR 簽唱會 OR 音樂祭 OR 售票 OR 來台 OR 台北 OR 新北 OR 桃園)';
  const q = `${nameQuery} ${eventTerms} when:14d`;

  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;

  const res = await fetch(url, {
    headers: { 'user-agent': 'PersonalNotifyBot/1.0 (+https://github.com/kenaigogo-lang/PersonalNotify)' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];

  const xml = await res.text();
  const parsed = parseGoogleNewsRss(xml);

  return parsed
    .filter((item) => !isExcludedByArtistKeywords(`${item.title} ${item.description || ''}`, artist.excludeKeywords))
    .slice(0, 12)
    .map((item) => ({
      hash: `gn_${simpleStableHash(`${artist.id}|${item.title.toLowerCase()}`)}`,
      artistId: artist.id,
      artistName: artist.name,
      source: 'google_news' as const,
      title: item.title,
      url: item.link,
      publishedAt: item.pubDate,
      snippet: item.description,
    }));
};

/** 來源 2：KKTIX 公開活動搜尋頁（輕量 HTML 擷取，失敗自動略過） */
export const fetchKktixCandidates = async (artist: TrackedArtist): Promise<CandidateArticle[]> => {
  try {
    const url = `https://kktix.com/events?search=${encodeURIComponent(artist.name)}`;
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; PersonalNotifyBot/1.0)',
        'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const out: CandidateArticle[] = [];
    const seenUrls = new Set<string>();
    const anchorMatches = html.matchAll(
      /<a\b[^>]*href="(https?:\/\/[^"]*kktix\.cc\/events\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    );

    const matchTerms = [artist.name, ...artist.aliases].map((s) => s.trim().toLowerCase()).filter(Boolean);

    for (const m of anchorMatches) {
      const href = m[1];
      const text = decodeXmlEntities(m[2]);
      if (!text || text.length < 4 || seenUrls.has(href)) continue;
      const lower = text.toLowerCase();
      if (!matchTerms.some((t) => lower.includes(t))) continue;
      if (isExcludedByArtistKeywords(text, artist.excludeKeywords)) continue;

      seenUrls.add(href);
      out.push({
        hash: `kktix_${simpleStableHash(`${artist.id}|${href}`)}`,
        artistId: artist.id,
        artistName: artist.name,
        source: 'kktix',
        title: text.slice(0, 120),
        url: href,
        snippet: 'KKTIX 售票平台活動頁',
      });
      if (out.length >= 6) break;
    }
    return out;
  } catch {
    return [];
  }
};

const OFFICIAL_SITE_SIGNAL =
  /taiwan|taipei|台灣|臺灣|台北|臺北|asia|tour|live|concert|fan\s*meeting|演唱會|見面會|公演|チケット/i;

/** 來源 3：藝人官方最新消息頁（選填，用來第一時間抓日本歌手亞巡／來台首發公告） */
export const fetchOfficialSiteCandidates = async (
  artist: TrackedArtist
): Promise<CandidateArticle[]> => {
  if (!artist.officialNewsUrl || !/^https?:\/\//i.test(artist.officialNewsUrl)) return [];
  try {
    const res = await fetch(artist.officialNewsUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; PersonalNotifyBot/1.0)',
        'accept-language': 'zh-TW,ja;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const base = new URL(artist.officialNewsUrl);

    const out: CandidateArticle[] = [];
    const seen = new Set<string>();
    const links = html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);

    for (const m of links) {
      const rawHref = m[1].trim();
      const text = decodeXmlEntities(m[2]);
      if (!text || text.length < 6 || !OFFICIAL_SITE_SIGNAL.test(text)) continue;
      if (isExcludedByArtistKeywords(text, artist.excludeKeywords)) continue;

      let resolved: string;
      try {
        resolved = new URL(rawHref, base).toString();
      } catch {
        continue;
      }
      if (!/^https?:\/\//i.test(resolved) || seen.has(resolved)) continue;
      seen.add(resolved);

      out.push({
        hash: `off_${simpleStableHash(`${artist.id}|${resolved}|${text.slice(0, 40)}`)}`,
        artistId: artist.id,
        artistName: artist.name,
        source: 'official_site',
        title: text.slice(0, 140),
        url: resolved,
        snippet: `官方公告頁：${base.hostname}`,
      });
      if (out.length >= 8) break;
    }

    return out;
  } catch {
    return [];
  }
};

export const collectArtistCandidates = async (artist: TrackedArtist): Promise<CandidateArticle[]> => {
  const [gn, kktix, official] = await Promise.allSettled([
    fetchGoogleNewsCandidates(artist),
    fetchKktixCandidates(artist),
    fetchOfficialSiteCandidates(artist),
  ]);

  const combined = [
    ...(gn.status === 'fulfilled' ? gn.value : []),
    ...(kktix.status === 'fulfilled' ? kktix.value : []),
    ...(official.status === 'fulfilled' ? official.value : []),
  ];

  const dedup = new Map<string, CandidateArticle>();
  for (const item of combined) {
    if (!dedup.has(item.hash)) dedup.set(item.hash, item);
  }
  return Array.from(dedup.values());
};
