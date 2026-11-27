import type { ArtistCategory, ArtistSearchResult } from './types.js';

export interface WikiSearchPage {
  pageid: number;
  title: string;
  description?: string;
  extract?: string;
  thumbnail?: { source?: string };
  pageprops?: { wikibase_item?: string };
  lang: 'zh' | 'en';
}

export interface WikidataEntityLite {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  aliases?: Record<string, Array<{ value: string }>>;
  claims?: {
    P31?: Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>;
    P856?: Array<{ mainsnak?: { datavalue?: { value?: string } } }>;
  };
}

const DISAMBIG_QIDS = new Set([
  'Q4167410', // Wikimedia disambiguation page
  'Q13406463', // Wikimedia list article
  'Q273057', // discography
  'Q1371849', // filmography
]);
const HUMAN_QID = 'Q5';
const GROUP_QIDS = new Set([
  'Q215380', // musical group
  'Q2088357', // musical ensemble
  'Q5741069', // rock band
  'Q9212979', // musical duo
  'Q105756498', // idol group
  'Q216337', // girl group
  'Q11271494', // boy band
  'Q23002039', // J-pop group
  'Q58389226', // pop group
  'Q43229', // organization (sometimes used for groups)
]);

const GROUP_TEXT_RE =
  /樂團|團體|組合|男團|女團|偶像團|二人組|雙人組|三人組|band|musical group|musical duo|idol group|girl group|boy band|rock group/i;
const ACTOR_TEXT_RE = /演員|女演員|男演員|聲優|配音員|actor|actress|voice actor/i;
const SINGER_TEXT_RE =
  /歌手|唱作|音樂人|主唱|創作歌手|詞曲|饒舌|rapper|singer|musician|vocalist|songwriter/i;
const ARTIST_HINT_RE =
  /歌手|演員|樂團|團體|組合|藝人|聲優|偶像|音樂人|主持人|舞者|模特兒|唱作|饒舌|配音|singer|actor|actress|band|musician|group|rapper|idol|entertainer|performer|vocalist/i;
const NON_ARTIST_WORK_RE =
  /^(?:.*?(?:專輯|單曲|歌曲|電視劇|電影|漫畫|動畫|小說|遊戲|節目|巡迴演唱會|演唱會|音樂節|album|song|single|film|movie|television series|tv series|manga|anime|video game))/i;

/** 拆分維基條目標題的括號消歧義後綴，例如 "LiSA (日本歌手)" -> { name: "LiSA", disambiguation: "日本歌手" } */
export const splitWikiTitle = (rawTitle: string): { name: string; disambiguation?: string } => {
  const trimmed = rawTitle.trim();
  const match = trimmed.match(/^(.+?)\s*[（(]([^）)]+)[）)]$/);
  if (!match) return { name: trimmed };
  const base = match[1].trim();
  const disambiguation = match[2].trim();
  if (!base) return { name: trimmed };
  return { name: base, disambiguation: disambiguation || undefined };
};

const getP31Ids = (entity?: WikidataEntityLite): string[] => {
  const list = entity?.claims?.P31 || [];
  const ids: string[] = [];
  for (const item of list) {
    const id = item?.mainsnak?.datavalue?.value?.id;
    if (id) ids.push(id);
  }
  return ids;
};

export const extractOfficialWebsite = (entity?: WikidataEntityLite): string | undefined => {
  const list = entity?.claims?.P856 || [];
  const urls: string[] = [];
  for (const item of list) {
    const url = item?.mainsnak?.datavalue?.value;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      urls.push(url.trim());
    }
  }
  if (urls.length === 0) return undefined;
  const nonSocial = urls.find(
    (u) => !/(instagram\.com|facebook\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com|weibo\.com)/i.test(u)
  );
  return nonSocial || urls[0];
};

export const inferArtistCategory = (params: {
  description?: string;
  extract?: string;
  disambiguation?: string;
  p31Ids?: string[];
}): ArtistCategory => {
  const p31 = params.p31Ids || [];
  if (p31.some((id) => GROUP_QIDS.has(id) && id !== 'Q43229')) {
    return 'group';
  }

  const primaryText = `${params.disambiguation || ''} ${params.description || ''}`;
  const fullText = `${primaryText} ${(params.extract || '').slice(0, 140)}`;

  if (!p31.includes(HUMAN_QID) && GROUP_TEXT_RE.test(primaryText)) {
    return 'group';
  }
  if (!p31.includes(HUMAN_QID) && GROUP_TEXT_RE.test(fullText) && !ACTOR_TEXT_RE.test(primaryText)) {
    return 'group';
  }

  const actorMatch = primaryText.match(ACTOR_TEXT_RE) || fullText.match(ACTOR_TEXT_RE);
  const singerMatch = primaryText.match(SINGER_TEXT_RE) || fullText.match(SINGER_TEXT_RE);

  if (actorMatch && singerMatch) {
    // 以主要簡介先出現的身分為主（例如「台灣女演員、歌手」-> actor；「日本女歌手、配音員」-> singer）
    const actorIdx = primaryText.search(ACTOR_TEXT_RE);
    const singerIdx = primaryText.search(SINGER_TEXT_RE);
    if (actorIdx >= 0 && singerIdx >= 0) {
      return actorIdx < singerIdx ? 'actor' : 'singer';
    }
    if (actorIdx >= 0) return 'actor';
    if (singerIdx >= 0) return 'singer';
    return (actorMatch.index ?? 999) < (singerMatch.index ?? 999) ? 'actor' : 'singer';
  }
  if (actorMatch) return 'actor';
  if (singerMatch) return 'singer';
  return 'singer';
};

export const extractAliases = (params: {
  name: string;
  entity?: WikidataEntityLite;
  extract?: string;
}): string[] => {
  const nameLower = params.name.trim().toLowerCase();
  const seen = new Set<string>([nameLower]);
  const out: string[] = [];

  const pushAlias = (raw?: string) => {
    if (!raw) return;
    const cleaned = raw
      .replace(/[「」『』""''（）()]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned || cleaned.length < 2 || cleaned.length > 32) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  };

  const entity = params.entity;
  if (entity?.labels) {
    for (const lang of ['zh-tw', 'zh-hant', 'en', 'ja']) {
      pushAlias(entity.labels[lang]?.value);
    }
  }
  if (entity?.aliases) {
    for (const lang of ['zh-tw', 'zh-hant', 'en', 'ja']) {
      for (const a of entity.aliases[lang] || []) {
        pushAlias(a.value);
      }
    }
  }

  // 從維基導言第一句抓「藝名XX」「本名XX」「英語：XX」
  const firstSentence = (params.extract || '').split(/[。！？\n]/)[0] || '';
  const patterns = [
    /(?:藝名|暱稱|本名)[為是：:\s]*([A-Za-z0-9\u4e00-\u9fff\u3040-\u30ff·・ ]{2,20})/g,
    /(?:英語|英文名?)[：:\s]*([A-Za-z][A-Za-z .'-]{1,28})/g,
    /(?:日語|日文名?)[：:\s]*([\u3040-\u30ff\u4e00-\u9fffA-Za-z0-9 ]{2,24})/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(firstSentence)) !== null) {
      pushAlias(m[1]);
    }
  }

  return out.slice(0, 5);
};

const extractSiblingExcludeTokens = (sibling: {
  disambiguation?: string;
  description: string;
  extract?: string;
  aliases: string[];
}): string[] => {
  const tokens: string[] = [];
  const text = `${sibling.description} ${sibling.extract || ''}`;

  // 常見英文團體名（全大寫 4+ 字元，例如 BLACKPINK、BTS、TWICE、AKB48）
  const upperBands = text.match(/\b[A-Z][A-Z0-9]{3,14}\b/g) || [];
  for (const b of upperBands) {
    if (!['HTML', 'HTTP', 'JSON', 'JPEG', 'SONY', 'UMG'].includes(b)) {
      tokens.push(b);
    }
  }

  // 同名對手的獨特英文別名（例如 Lalisa）
  for (const alias of sibling.aliases) {
    if (/^[A-Za-z][A-Za-z0-9 .-]{3,24}$/.test(alias)) {
      tokens.push(alias);
    }
  }

  return Array.from(new Set(tokens)).slice(0, 4);
};

const scoreCandidate = (params: {
  query: string;
  name: string;
  description: string;
  extract: string;
  p31Ids: string[];
  lang: 'zh' | 'en';
}): number => {
  let score = 0;
  const qLower = params.query.trim().toLowerCase();
  const nLower = params.name.trim().toLowerCase();

  if (nLower === qLower) score += 35;
  else if (nLower.includes(qLower) || qLower.includes(nLower)) score += 15;

  const isHuman = params.p31Ids.includes(HUMAN_QID);
  const isGroup = params.p31Ids.some((id) => GROUP_QIDS.has(id));
  if (isHuman || isGroup) score += 50;

  const combined = `${params.description} ${params.extract.slice(0, 140)}`;
  if (ARTIST_HINT_RE.test(combined)) score += 35;

  if (!isHuman && !isGroup && NON_ARTIST_WORK_RE.test(params.description)) {
    score -= 55;
  }

  if (params.lang === 'zh') score += 10;
  return score;
};

export const buildArtistSearchResults = (params: {
  query: string;
  pages: WikiSearchPage[];
  entities: Record<string, WikidataEntityLite>;
}): ArtistSearchResult[] => {
  const scored: Array<{ result: ArtistSearchResult; score: number }> = [];
  const seenIds = new Set<string>();

  for (const page of params.pages) {
    const qid = page.pageprops?.wikibase_item;
    const entity = qid ? params.entities[qid] : undefined;
    const p31Ids = getP31Ids(entity);

    const rawDesc =
      entity?.descriptions?.['zh-tw']?.value ||
      entity?.descriptions?.['zh-hant']?.value ||
      page.description ||
      entity?.descriptions?.en?.value ||
      '';
    const extract = (page.extract || '').replace(/\s+/g, ' ').trim();

    // 過濾消歧義頁、列表條目、作品集頁
    if (
      p31Ids.some((id) => DISAMBIG_QIDS.has(id)) ||
      /消歧義|消歧义|disambiguation|列表條目|列表条目|作品列表|音樂作品|獲獎與提名|list article|discography|filmography/i.test(
        `${page.title} ${rawDesc}`
      )
    ) {
      continue;
    }

    const isPersonOrGroup = p31Ids.includes(HUMAN_QID) || p31Ids.some((id) => GROUP_QIDS.has(id));
    const hasArtistHint = ARTIST_HINT_RE.test(`${rawDesc} ${extract.slice(0, 140)}`);
    if (!isPersonOrGroup && !hasArtistHint) {
      continue;
    }

    const dedupId = qid || `${page.lang}_${page.pageid}`;
    if (seenIds.has(dedupId)) continue;
    seenIds.add(dedupId);

    const { name, disambiguation } = splitWikiTitle(page.title);
    const category = inferArtistCategory({
      description: rawDesc,
      extract,
      disambiguation,
      p31Ids,
    });
    const aliases = extractAliases({ name, entity, extract });
    const officialNewsUrl = extractOfficialWebsite(entity);
    const wikiUrl =
      page.lang === 'zh'
        ? `https://zh.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`
        : `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`;

    const score = scoreCandidate({
      query: params.query,
      name,
      description: rawDesc,
      extract,
      p31Ids,
      lang: page.lang,
    });

    if (score < 35) continue;

    scored.push({
      score,
      result: {
        id: dedupId,
        name,
        ...(disambiguation ? { disambiguation } : {}),
        category,
        description: rawDesc || extract.slice(0, 60) || '演藝人員',
        ...(extract ? { extract: extract.slice(0, 160) } : {}),
        aliases,
        excludeKeywords: [],
        ...(officialNewsUrl ? { officialNewsUrl } : {}),
        ...(page.thumbnail?.source ? { imageUrl: page.thumbnail.source } : {}),
        wikiUrl,
        source: entity ? 'wikidata' : 'wikipedia',
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 6).map((s) => s.result);

  // 若結果中存在同名撞名藝人（例如 LiSA (日本歌手) 與 Lisa (泰國歌手)），自動填入建議排除詞
  for (const item of top) {
    const siblings = top.filter(
      (other) => other.id !== item.id && other.name.toLowerCase() === item.name.toLowerCase()
    );
    if (siblings.length === 0) continue;
    const ownText = `${item.name} ${item.aliases.join(' ')} ${item.description} ${item.extract || ''}`.toLowerCase();
    const excludeSet = new Set<string>();
    for (const sib of siblings) {
      for (const token of extractSiblingExcludeTokens(sib)) {
        if (!ownText.includes(token.toLowerCase())) {
          excludeSet.add(token);
        }
      }
    }
    item.excludeKeywords = Array.from(excludeSet).slice(0, 4);
  }

  return top;
};
