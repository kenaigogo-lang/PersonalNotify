import type { DealCardItem, EventType, TrackedEvent } from './types.js';
import { PLATFORM_LABEL } from './types.js';

export interface LineFlexMessage {
  type: 'flex';
  altText: string;
  contents: Record<string, unknown>;
}

const formatTwd = (amount: number): string => `NT$${Math.round(amount).toLocaleString('en-US')}`;

/** 單張遊戲特價 Flex Bubble */
export const buildDealBubble = (deal: DealCardItem, appBaseUrl?: string): Record<string, unknown> => {
  const computedDiscount =
    deal.discountPercent > 0
      ? Math.round(deal.discountPercent)
      : deal.regularPriceTwd && deal.regularPriceTwd > deal.currentPriceTwd
        ? Math.round(((deal.regularPriceTwd - deal.currentPriceTwd) / deal.regularPriceTwd) * 100)
        : 0;

  const platformText = deal.region
    ? `${PLATFORM_LABEL[deal.platform]} (${deal.region})`
    : PLATFORM_LABEL[deal.platform];

  const badgePills: Record<string, unknown>[] = [];
  if (deal.isHistoricalLow) {
    badgePills.push({
      type: 'box',
      layout: 'horizontal',
      backgroundColor: '#D9264E',
      cornerRadius: '4px',
      paddingTop: '3px',
      paddingBottom: '3px',
      paddingStart: '8px',
      paddingEnd: '8px',
      flex: 0,
      contents: [
        {
          type: 'text',
          text: '🔥 史低特價',
          size: 'xs',
          weight: 'bold',
          color: '#FFFFFF',
          flex: 0,
        },
      ],
    });
  }
  if (computedDiscount > 0) {
    badgePills.push({
      type: 'box',
      layout: 'horizontal',
      backgroundColor: '#209CEE',
      cornerRadius: '4px',
      paddingTop: '3px',
      paddingBottom: '3px',
      paddingStart: '8px',
      paddingEnd: '8px',
      flex: 0,
      contents: [
        {
          type: 'text',
          text: `${computedDiscount}% OFF`,
          size: 'xs',
          weight: 'bold',
          color: '#FFFFFF',
          flex: 0,
        },
      ],
    });
  }
  if (badgePills.length === 0) {
    badgePills.push({
      type: 'box',
      layout: 'horizontal',
      backgroundColor: '#059669',
      cornerRadius: '4px',
      paddingTop: '3px',
      paddingBottom: '3px',
      paddingStart: '8px',
      paddingEnd: '8px',
      flex: 0,
      contents: [
        {
          type: 'text',
          text: '🎯 達目標價',
          size: 'xs',
          weight: 'bold',
          color: '#FFFFFF',
          flex: 0,
        },
      ],
    });
  }

  const hasRegularPrice =
    typeof deal.regularPriceTwd === 'number' && deal.regularPriceTwd > deal.currentPriceTwd;

  const bodyContents: Record<string, unknown>[] = [
    {
      type: 'box',
      layout: 'horizontal',
      spacing: 'xs',
      contents: badgePills,
    },
    {
      type: 'text',
      text: deal.title.slice(0, 60),
      weight: 'bold',
      size: 'md',
      wrap: true,
      maxLines: 2,
      margin: 'sm',
      color: '#111827',
    },
    {
      type: 'text',
      text: platformText,
      size: 'xs',
      color: '#6B7280',
      margin: 'xs',
    },
    {
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      margin: 'md',
      contents: [
        {
          type: 'text',
          text: formatTwd(deal.currentPriceTwd),
          size: 'xl',
          weight: 'bold',
          color: '#D9264E',
          flex: 0,
        },
        ...(computedDiscount > 0
          ? [
              {
                type: 'text',
                text: `-${computedDiscount}% OFF`,
                size: 'sm',
                weight: 'bold',
                color: '#209CEE',
                flex: 0,
              },
            ]
          : []),
      ],
    },
  ];

  if (hasRegularPrice) {
    bodyContents.push({
      type: 'box',
      layout: 'baseline',
      spacing: 'xs',
      margin: 'xs',
      contents: [
        {
          type: 'text',
          text: '原價',
          size: 'xs',
          color: '#6B7280',
          flex: 0,
        },
        {
          type: 'text',
          text: formatTwd(deal.regularPriceTwd!),
          size: 'xs',
          color: '#9CA3AF',
          decoration: 'line-through',
          flex: 0,
        },
      ],
    });
  }

  if (typeof deal.historicalLowPriceTwd === 'number' && deal.historicalLowPriceTwd > 0) {
    const diff = Math.round(deal.currentPriceTwd - deal.historicalLowPriceTwd);
    const lowLine =
      diff <= 0
        ? `史低紀錄：${formatTwd(deal.historicalLowPriceTwd)}（已達史低！）`
        : `史低紀錄：${formatTwd(deal.historicalLowPriceTwd)}（距史低 +${formatTwd(diff)}）`;
    bodyContents.push({
      type: 'text',
      text: lowLine,
      size: 'xs',
      color: diff <= 0 ? '#059669' : '#6B7280',
      wrap: true,
      margin: 'xs',
    });
  }

  if (deal.paymentHint) {
    bodyContents.push({
      type: 'text',
      text: `付款提示：${deal.paymentHint}`,
      size: 'xxs',
      color: '#6B7280',
      wrap: true,
      margin: 'xs',
    });
  }

  const footerContents: Record<string, unknown>[] = [
    {
      type: 'button',
      style: 'primary',
      color: '#212529',
      height: 'sm',
      action: {
        type: 'uri',
        label: '前往商店',
        uri: deal.storeUrl,
      },
    },
  ];

  if (deal.priceTrackerUrl) {
    footerContents.push({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: {
        type: 'uri',
        label: '看史低曲線',
        uri: deal.priceTrackerUrl,
      },
    });
  } else if (appBaseUrl) {
    footerContents.push({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: {
        type: 'uri',
        label: '管理清單 / 標記已買',
        uri: appBaseUrl,
      },
    });
  }

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents: bodyContents,
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents: footerContents,
    },
  };

  if (deal.imageUrl && /^https:\/\//i.test(deal.imageUrl)) {
    bubble.hero = {
      type: 'image',
      url: deal.imageUrl,
      size: 'full',
      aspectRatio: '20:11',
      aspectMode: 'cover',
    };
  }

  return bubble;
};

/**
 * 將當日特價清單打包成單一 LINE Flex Carousel（最多 10 張卡片只算 1 則推播額度！）
 */
export const buildGameDigestFlex = (deals: DealCardItem[], appBaseUrl?: string): LineFlexMessage => {
  const topDeals = deals.slice(0, 10);
  const bubbles = topDeals.map((deal) => buildDealBubble(deal, appBaseUrl));

  let altText = `🎮 PersonalNotify 今日特價：${topDeals.length} 款願望清單遊戲降價！`;
  if (topDeals.length === 1) {
    const d = topDeals[0];
    const pct =
      d.discountPercent > 0
        ? Math.round(d.discountPercent)
        : d.regularPriceTwd && d.regularPriceTwd > d.currentPriceTwd
          ? Math.round(((d.regularPriceTwd - d.currentPriceTwd) / d.regularPriceTwd) * 100)
          : 0;
    const parts = [formatTwd(d.currentPriceTwd)];
    if (d.regularPriceTwd && d.regularPriceTwd > d.currentPriceTwd) {
      parts.push(`原價 ${formatTwd(d.regularPriceTwd)}`);
    }
    if (pct > 0) parts.push(`${pct}% OFF`);
    altText = `🎮 ${d.title.slice(0, 40)} 特價 ${parts.join('｜')}`.slice(0, 180);
  }

  return {
    type: 'flex',
    altText,
    contents:
      bubbles.length === 1
        ? bubbles[0]
        : {
            type: 'carousel',
            contents: bubbles,
          },
  };
};

/** 測試推播用的復古系統通知卡片 */
export const buildTestFlexMessage = (appBaseUrl?: string): LineFlexMessage => {
  const nowStr = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const contents: Record<string, unknown> = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#212529',
      contents: [
        {
          type: 'text',
          text: 'PERSONAL NOTIFY',
          color: '#31E6FF',
          weight: 'bold',
          size: 'sm',
        },
        {
          type: 'text',
          text: 'LINE 推播連線測試成功',
          color: '#FFFFFF',
          weight: 'bold',
          size: 'md',
          margin: 'xs',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: '你的個人化通知系統已成功連上 LINE Messaging API！之後的遊戲特價與北部藝人活動都會以卡片形式推播到這個聊天室。',
          wrap: true,
          size: 'sm',
          color: '#374151',
        },
        {
          type: 'text',
          text: `測試時間：${nowStr}`,
          size: 'xs',
          color: '#6B7280',
          margin: 'md',
        },
      ],
    },
  };

  if (appBaseUrl && /^https:\/\//i.test(appBaseUrl)) {
    contents.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#212529',
          height: 'sm',
          action: {
            type: 'uri',
            label: '開啟 PersonalNotify',
            uri: appBaseUrl,
          },
        },
      ],
    };
  }

  return {
    type: 'flex',
    altText: '🔔 PersonalNotify LINE 推播連線測試成功！',
    contents,
  };
};

const EVENT_TYPE_LABEL: Record<EventType, string> = {
  concert: '演唱會',
  fanmeeting: '見面會',
  festival: '音樂祭',
  other: '實體活動',
};

const formatTaipeiTime = (iso?: string): string => {
  if (!iso) return '尚未公布';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const buildEventBubble = (
  event: TrackedEvent,
  headerBg: string,
  headerBadge: string,
  headerTitle: string,
  appBaseUrl?: string
): Record<string, unknown> => {
  const details: Record<string, unknown>[] = [
    {
      type: 'text',
      text: event.title.slice(0, 80),
      weight: 'bold',
      size: 'md',
      wrap: true,
      color: '#111827',
    },
    {
      type: 'text',
      text: `地點：${event.city}${event.venue ? ` ・ ${event.venue}` : ''}`,
      size: 'xs',
      color: '#374151',
      wrap: true,
      margin: 'sm',
    },
  ];

  if (event.eventDate) {
    details.push({
      type: 'text',
      text: `活動日期：${event.eventDate}`,
      size: 'xs',
      color: '#374151',
      wrap: true,
    });
  }

  details.push({
    type: 'text',
    text: `開賣時間：${formatTaipeiTime(event.ticketSaleTime)}`,
    size: 'sm',
    weight: 'bold',
    color: event.ticketSaleTime ? '#D9264E' : '#6B7280',
    wrap: true,
    margin: 'xs',
  });

  if (event.ticketPlatform) {
    details.push({
      type: 'text',
      text: `售票平台：${event.ticketPlatform}`,
      size: 'xs',
      color: '#2563EB',
      wrap: true,
    });
  }

  if (event.summary) {
    details.push({
      type: 'text',
      text: event.summary.slice(0, 140),
      size: 'xs',
      color: '#6B7280',
      wrap: true,
      margin: 'sm',
    });
  }

  const footerContents: Record<string, unknown>[] = [];
  if (event.sourceUrl && /^https?:\/\//i.test(event.sourceUrl)) {
    footerContents.push({
      type: 'button',
      style: 'primary',
      color: headerBg,
      height: 'sm',
      action: {
        type: 'uri',
        label: '查看活動 / 售票資訊',
        uri: event.sourceUrl,
      },
    });
  }
  if (appBaseUrl && /^https:\/\//i.test(appBaseUrl)) {
    footerContents.push({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: {
        type: 'uri',
        label: '開啟 PersonalNotify',
        uri: appBaseUrl,
      },
    });
  }

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: headerBg,
      contents: [
        {
          type: 'text',
          text: headerBadge,
          color: '#FFE14A',
          weight: 'bold',
          size: 'xs',
        },
        {
          type: 'text',
          text: headerTitle.slice(0, 40),
          color: '#FFFFFF',
          weight: 'bold',
          size: 'md',
          margin: 'xs',
          wrap: true,
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents: details,
    },
  };

  if (footerContents.length > 0) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents: footerContents,
    };
  }

  return bubble;
};

/** 偵測到新的台灣北部藝人活動（可將多筆新活動合併為單一 Carousel 節省額度） */
export const buildEventsNewFlex = (events: TrackedEvent[], appBaseUrl?: string): LineFlexMessage => {
  const selected = events.slice(0, 10);
  const bubbles = selected.map((ev) =>
    buildEventBubble(
      ev,
      '#1F2937',
      `🎤 台灣北部新活動・${EVENT_TYPE_LABEL[ev.eventType] || '活動'}`,
      ev.artistName,
      appBaseUrl
    )
  );

  const first = selected[0];
  const altText =
    selected.length === 1
      ? `🎤 【${first.artistName}】台灣北部新活動：${first.title.slice(0, 40)}`
      : `🎤 偵測到 ${selected.length} 筆台灣北部藝人新活動（${selected.map((e) => e.artistName).slice(0, 3).join('、')}）`;

  return {
    type: 'flex',
    altText,
    contents:
      bubbles.length === 1
        ? bubbles[0]
        : {
            type: 'carousel',
            contents: bubbles,
          },
  };
};

/** 開賣前 24 小時 / 開賣前 1 小時搶票警報卡片 */
export const buildEventReminderFlex = (
  event: TrackedEvent,
  kind: 'before_1d' | 'before_1h',
  appBaseUrl?: string
): LineFlexMessage => {
  const isUrgent = kind === 'before_1h';
  const badge = isUrgent ? '🚨 1 小時內開賣！準備搶票' : '⏰ 明天開賣！搶票提前提醒';
  const headerBg = isUrgent ? '#DC2626' : '#D97706';

  return {
    type: 'flex',
    altText: `${badge}【${event.artistName}】${event.title.slice(0, 40)}`,
    contents: buildEventBubble(event, headerBg, badge, `${event.artistName} 搶票提醒`, appBaseUrl),
  };
};

/** 系統警報卡片（例如 PSN Refresh Token 即將到期或已過期提醒） */
export const buildSystemAlertFlex = (
  title: string,
  bodyText: string,
  appBaseUrl?: string
): LineFlexMessage => {
  const contents: Record<string, unknown> = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#B45309',
      contents: [
        {
          type: 'text',
          text: '⚠️ PERSONAL NOTIFY 系統提醒',
          color: '#FEF3C7',
          weight: 'bold',
          size: 'xs',
        },
        {
          type: 'text',
          text: title.slice(0, 40),
          color: '#FFFFFF',
          weight: 'bold',
          size: 'md',
          margin: 'xs',
          wrap: true,
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: bodyText,
          size: 'sm',
          color: '#374151',
          wrap: true,
        },
      ],
    },
  };

  if (appBaseUrl && /^https:\/\//i.test(appBaseUrl)) {
    contents.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#212529',
          height: 'sm',
          action: {
            type: 'uri',
            label: '前往設定頁更新',
            uri: appBaseUrl,
          },
        },
      ],
    };
  }

  return {
    type: 'flex',
    altText: `⚠️ PersonalNotify：${title}`,
    contents,
  };
};


