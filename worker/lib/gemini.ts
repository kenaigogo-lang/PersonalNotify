import type { EventType, TrackedArtist } from '../../shared/types.js';
import type { CandidateArticle } from '../sources/concerts.js';

export interface ExtractedNorthernEvent {
  candidateIndex: number;
  title: string;
  eventType: EventType;
  city: string;
  venue?: string;
  eventDate?: string;
  ticketSaleTime?: string; // ISO 8601 +08:00
  ticketPlatform?: string;
  summary: string;
}

const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'];

const getModelList = (): string[] => {
  const preferred = (process.env.GEMINI_MODEL || '').trim();
  if (!preferred) return FALLBACK_MODELS;
  return [preferred, ...FALLBACK_MODELS.filter((m) => m !== preferred)];
};

const callGeminiJson = async (apiKey: string, prompt: string): Promise<string> => {
  const models = getModelList();
  let lastError = '未知錯誤';

  for (const model of models) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(25_000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        lastError = `model=${model} HTTP ${res.status}: ${errText.slice(0, 180)}`;
        if (res.status === 429 || res.status === 503 || res.status === 404) {
          console.warn(`[Gemini] ${lastError}，嘗試下一個備援模型...`);
          continue;
        }
        throw new Error(lastError);
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
      lastError = `model=${model} 回傳空內容`;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }

  throw new Error(`Gemini 呼叫失敗：${lastError}`);
};

const normalizeEventType = (raw: unknown): EventType => {
  const s = String(raw || '').toLowerCase();
  if (s === 'concert' || s === 'fanmeeting' || s === 'festival') return s;
  return 'other';
};

/**
 * 批次將某位藝人的最新候選文章交給 Gemini 判斷：
 * 1. 必須是「能見到藝人本人的線下實體活動」（演唱會、見面會、簽唱會、音樂祭、映後座談等）。
 * 2. 必須是未來即將舉行或即將開賣的活動（排除已經結束的報導）。
 * 3. 地點必須是「台灣北部（台北、新北、桃園、基隆、新竹）」或「確定來台但尚未公布縣市」。
 */
export const filterAndExtractNorthernEvents = async (
  artist: TrackedArtist,
  candidates: CandidateArticle[],
  apiKey: string
): Promise<ExtractedNorthernEvent[]> => {
  if (candidates.length === 0) return [];

  const todayTw = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const candidateLines = candidates.map((c, idx) => ({
    index: idx,
    source: c.source,
    title: c.title,
    publishedAt: c.publishedAt || '',
    snippet: c.snippet || '',
    url: c.url,
  }));

  const prompt = `你是一個精準的台灣活動監控助理。今天台灣日期是 ${todayTw}。
目標追蹤人物：${artist.name}（類型：${artist.category}${artist.description ? `；簡介：${artist.description}` : ''}；別名：${artist.aliases.join('、') || '無'}；必須排除的同名人物/關鍵字：${artist.excludeKeywords.join('、') || '無'}）。

請審查以下候選文章清單，**只挑選出符合以下全部條件的活動**：
1. 確認主角真的是目標人物「${artist.name}」（排除任何同名不同人，例如日本歌手 LiSA 絕對不是 BLACKPINK 的 Lisa）。
2. 是「現場能見到本人」的實體線下活動（演唱會、專場、見面會、簽唱會、音樂祭、電影映後見面會、實體活動嘉賓）。排除：新歌發行、MV、專輯宣傳、純訪談、純線上直播、已結束的回顧報導。
3. 活動地點必須位於 **台灣北部（台北市、新北市、桃園市、基隆市、新竹縣市）**，或是 **明確宣布將來台灣舉辦但尚未公布縣市**（city 請填 "台灣（縣市待公布）"）。若明確只辦在高雄、台中、台南或海外（日本、香港、韓國等），請直接排除。
4. 若同一場活動有多篇重複新聞，只保留資訊最完整的一筆（選一個 candidateIndex）。

請嚴格回傳 JSON 物件（不要有 markdown 符號），格式如下：
{
  "events": [
    {
      "candidateIndex": 0,
      "title": "活動正式或精簡名稱",
      "eventType": "concert | fanmeeting | festival | other",
      "city": "台北市 / 新北市 / 桃園市 / 新竹 / 基隆 / 台灣（縣市待公布）",
      "venue": "場地名稱（未知則留空字串）",
      "eventDate": "YYYY-MM-DD（或日期區間，未知則留空字串）",
      "ticketSaleTime": "YYYY-MM-DDTHH:mm:00+08:00（若文章有明確開賣日期與時間請填 ISO 格式；未知請填 null）",
      "ticketPlatform": "拓元 tixCraft / KKTIX / 遠大 Ticket Plus / 寬宏 / ibon / 年代 等（未知留空字串）",
      "summary": "1到2句繁體中文重點摘要（包含票價或搶票重點）"
    }
  ]
}

若沒有任何符合條件的活動，請回傳 {"events": []}。

候選文章：
${JSON.stringify(candidateLines, null, 2)}`;

  const rawText = await callGeminiJson(apiKey, prompt);
  const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(cleaned) as { events?: Array<Record<string, unknown>> };

  const out: ExtractedNorthernEvent[] = [];
  for (const row of parsed.events || []) {
    const idx = Number(row.candidateIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= candidates.length) continue;
    const title = String(row.title || '').trim();
    const city = String(row.city || '').trim();
    if (!title || !city) continue;

    const rawSale = row.ticketSaleTime ? String(row.ticketSaleTime).trim() : '';
    const validSale = rawSale && Number.isFinite(Date.parse(rawSale)) ? rawSale : undefined;

    out.push({
      candidateIndex: idx,
      title,
      eventType: normalizeEventType(row.eventType),
      city,
      venue: row.venue ? String(row.venue).trim() : undefined,
      eventDate: row.eventDate ? String(row.eventDate).trim() : undefined,
      ticketSaleTime: validSale,
      ticketPlatform: row.ticketPlatform ? String(row.ticketPlatform).trim() : undefined,
      summary: String(row.summary || '').trim(),
    });
  }

  return out;
};
