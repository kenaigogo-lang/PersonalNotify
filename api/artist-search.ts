import {
  buildArtistSearchResults,
  type WikidataEntityLite,
  type WikiSearchPage,
} from '../shared/artist-search.js';
import { fetchWithTimeout, handle, json, requireUser } from './_lib/auth.js';

const WIKI_HEADERS = {
  'user-agent': 'PersonalNotify/1.0 (https://personalnotify.vercel.app/)',
  accept: 'application/json',
};

const searchWikipedia = async (
  query: string,
  lang: 'zh' | 'en',
  limit = 8
): Promise<WikiSearchPage[]> => {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: String(limit),
    prop: 'pageimages|extracts|description|pageprops',
    piprop: 'thumbnail',
    pithumbsize: '180',
    exintro: '1',
    explaintext: '1',
    exsentences: '2',
    ppprop: 'wikibase_item',
    redirects: '1',
  });
  if (lang === 'zh') {
    params.set('variant', 'zh-tw');
  }

  const endpoint = `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`;
  const res = await fetchWithTimeout(endpoint, { headers: WIKI_HEADERS }, 10_000);
  if (!res.ok) return [];

  const data = (await res.json()) as {
    query?: {
      pages?: Array<{
        pageid: number;
        title: string;
        description?: string;
        extract?: string;
        thumbnail?: { source?: string };
        pageprops?: { wikibase_item?: string };
      }>;
    };
  };

  return (data.query?.pages || []).map((p) => ({
    pageid: p.pageid,
    title: p.title,
    description: p.description,
    extract: p.extract,
    thumbnail: p.thumbnail,
    pageprops: p.pageprops,
    lang,
  }));
};

const fetchWikidataEntities = async (
  qids: string[]
): Promise<Record<string, WikidataEntityLite>> => {
  const unique = Array.from(new Set(qids.filter(Boolean))).slice(0, 16);
  if (unique.length === 0) return {};

  const params = new URLSearchParams({
    action: 'wbgetentities',
    format: 'json',
    ids: unique.join('|'),
    props: 'labels|aliases|descriptions|claims',
    languages: 'zh-tw|zh-hant|zh|en|ja',
  });

  const endpoint = `https://www.wikidata.org/w/api.php?${params.toString()}`;
  const res = await fetchWithTimeout(endpoint, { headers: WIKI_HEADERS }, 10_000);
  if (!res.ok) return {};

  const data = (await res.json()) as {
    entities?: Record<string, WikidataEntityLite>;
  };
  return data.entities || {};
};

export const GET = handle(async (request) => {
  await requireUser(request);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json({ results: [] });

  const isAsciiQuery = /^[\x20-\x7e]+$/.test(q);
  const [zhRes, enRes] = await Promise.allSettled([
    searchWikipedia(q, 'zh', 8),
    isAsciiQuery ? searchWikipedia(q, 'en', 6) : Promise.resolve<WikiSearchPage[]>([]),
  ]);

  let pages: WikiSearchPage[] = [
    ...(zhRes.status === 'fulfilled' ? zhRes.value : []),
    ...(enRes.status === 'fulfilled' ? enRes.value : []),
  ];

  // 非純英文查詢但中文維基結果偏少時，補查英文維基
  if (!isAsciiQuery && pages.length < 3) {
    const extraEn = await searchWikipedia(q, 'en', 5).catch(() => []);
    pages = [...pages, ...extraEn];
  }

  const qids = pages
    .map((p) => p.pageprops?.wikibase_item)
    .filter((id): id is string => Boolean(id));
  const entities = await fetchWikidataEntities(qids).catch(() => ({}));

  const results = buildArtistSearchResults({ query: q, pages, entities });
  return json({ results });
});
