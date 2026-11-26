export type GamePlatform = 'PC' | 'PS' | 'SWITCH' | 'XBOX';

export type DataSource = 'steam' | 'psn' | 'manual' | 'gamerank';

export type SwitchRegion = 'TW' | 'JP' | 'HK' | 'US' | 'MX';

export interface SwitchRegionMeta {
  code: SwitchRegion;
  label: string;
  currency: string;
  paymentHint: string;
}

export const SWITCH_REGIONS: Record<SwitchRegion, SwitchRegionMeta> = {
  TW: { code: 'TW', label: '台灣', currency: 'TWD', paymentHint: '台灣信用卡直刷' },
  JP: { code: 'JP', label: '日本', currency: 'JPY', paymentHint: '需日區點數卡（如 Amazon JP）' },
  HK: { code: 'HK', label: '香港', currency: 'HKD', paymentHint: '需港區點數卡' },
  US: { code: 'US', label: '美國', currency: 'USD', paymentHint: '需美區點數卡' },
  MX: { code: 'MX', label: '墨西哥', currency: 'MXN', paymentHint: '需墨區點數卡（低價區）' },
};

export const PLATFORM_LABEL: Record<GamePlatform, string> = {
  PC: 'Steam / PC',
  PS: 'PS5 / PSN',
  SWITCH: 'Switch',
  XBOX: 'Xbox',
};

/** GameRank 原有 users/{uid}/backups/{gameId} 資料格式（唯讀） */
export interface GameRankRecord {
  id: string;
  title: string;
  platform: GamePlatform;
  score: number;
  comment: string;
  genre?: string;
  ratingDate?: string;
  playtime?: number;
  imageUrl?: string;
  addedAt?: number;
}

export interface ExternalGameIds {
  steamAppId?: number;
  itadId?: string;
  psnTitleId?: string;
  switchNsuid?: string;
  igdbId?: number;
}

export interface OwnedGameRecord {
  id: string;
  title: string;
  normalizedTitle: string;
  platform: GamePlatform;
  source: Exclude<DataSource, 'gamerank'>;
  externalIds?: ExternalGameIds;
  imageUrl?: string;
  notes?: string;
  addedAt: number;
  updatedAt?: number;
}

export interface PriceHistoryPoint {
  date: string; // YYYY-MM-DD
  priceTwd: number;
  discountPercent: number;
  region?: string;
}

export interface WishlistGameRecord {
  id: string;
  title: string;
  normalizedTitle: string;
  platform: GamePlatform;
  source: Exclude<DataSource, 'gamerank'>;
  externalIds?: ExternalGameIds;
  imageUrl?: string;
  targetPriceTwd?: number | null;
  minDiscountPercent?: number | null;
  currentBestPriceTwd?: number | null;
  regularPriceTwd?: number | null;
  currentDiscountPercent?: number | null;
  currentBestRegion?: string | null;
  currentStoreUrl?: string | null;
  isHistoricalLow?: boolean;
  historicalLowPriceTwd?: number | null;
  lowestSeenPriceTwd?: number | null;
  priceHistory?: PriceHistoryPoint[];
  priceTrackerUrl?: string | null;
  lastCheckedAt?: number | null;
  lastNotifiedPriceTwd?: number | null;
  lastNotifiedAt?: number | null;
  muted?: boolean;
  addedAt: number;
  updatedAt?: number;
}

export type ArtistCategory = 'singer' | 'actor' | 'group';

export interface TrackedArtist {
  id: string;
  name: string;
  category: ArtistCategory;
  aliases: string[];
  excludeKeywords: string[];
  officialNewsUrl?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt?: number;
}

export type EventType = 'concert' | 'fanmeeting' | 'festival' | 'other';

export interface TrackedEvent {
  id: string;
  artistId: string;
  artistName: string;
  title: string;
  eventType: EventType;
  city: string;
  venue?: string;
  eventDate?: string;
  ticketSaleTime?: string; // ISO 8601
  ticketPlatform?: string;
  sourceUrl: string;
  summary: string;
  notifiedNew: boolean;
  notifiedBefore1d: boolean;
  notifiedBefore1h: boolean;
  dismissed?: boolean;
  detectedAt: number;
}

export type NotifyLogType = 'game_digest' | 'event_new' | 'event_reminder' | 'system_alert' | 'line_test';

export interface NotifyLogRecord {
  id: string;
  type: NotifyLogType;
  messageCount: number;
  summary: string;
  sentAt: number;
  status: 'sent' | 'dry_run' | 'skipped_quota' | 'failed';
  errorMessage?: string;
}

export interface NotifyConfig {
  lineUserId: string;
  steamId: string;
  switchRegions: SwitchRegion[];
  defaultMinDiscount: number;
  notifyOnHistoricalLow: boolean;
  monthlyLineLimit: number;
  monthlyLineCount: number;
  monthlyLineMonth: string; // YYYY-MM
  psnTokenStatus?: 'unset' | 'active' | 'expiring_soon' | 'expired';
  psnTokenExpiresAt?: number | null;
  lastGameSyncAt?: number | null;
  lastEventSyncAt?: number | null;
  updatedAt?: number;
}

export const DEFAULT_LINE_USER_ID = 'U32ac8f3e19705ed51c36f6b8c7bb2830';

export const STARTER_ARTISTS: Omit<TrackedArtist, 'id' | 'createdAt'>[] = [
  {
    name: 'LiSA',
    category: 'singer',
    aliases: ['織部里沙', 'LiSA 織部里沙'],
    excludeKeywords: ['BLACKPINK', 'Lalisa', 'LISA 麗莎', '泰國', 'Crazy Horse'],
    officialNewsUrl: 'https://www.lxixsxa.com/info/',
    enabled: true,
  },
  {
    name: 'Aimer',
    category: 'singer',
    aliases: ['エメ'],
    excludeKeywords: [],
    officialNewsUrl: 'https://www.aimer-web.jp/news/',
    enabled: true,
  },
  {
    name: 'milet',
    category: 'singer',
    aliases: ['ミレイ'],
    excludeKeywords: [],
    officialNewsUrl: 'https://www.milet.jp/news/',
    enabled: true,
  },
  {
    name: '陳忻玥',
    category: 'singer',
    aliases: ['Vicky Chen', 'Vicky 陳忻玥'],
    excludeKeywords: [],
    officialNewsUrl: '',
    enabled: true,
  },
];

export interface DealCardItem {
  id: string;
  title: string;
  platform: GamePlatform;
  imageUrl?: string;
  currentPriceTwd: number;
  regularPriceTwd?: number | null;
  discountPercent: number;
  isHistoricalLow: boolean;
  historicalLowPriceTwd?: number | null;
  region?: string | null;
  paymentHint?: string | null;
  storeUrl: string;
  priceTrackerUrl?: string | null;
}

export interface GameSearchResult {
  title: string;
  platform: GamePlatform;
  imageUrl?: string;
  steamAppId?: number;
  igdbId?: number;
  source: 'steam' | 'igdb';
}
