import type { DealCardItem } from './types.js';
import { PLATFORM_LABEL } from './types.js';

export interface LineFlexMessage {
  type: 'flex';
  altText: string;
  contents: Record<string, unknown>;
}

const formatTwd = (amount: number): string => `NT$${Math.round(amount).toLocaleString('en-US')}`;

/** 單張遊戲特價 Flex Bubble */
export const buildDealBubble = (deal: DealCardItem, appBaseUrl?: string): Record<string, unknown> => {
  const badgeText = deal.isHistoricalLow
    ? '🔥 史低特價'
    : `-${Math.round(deal.discountPercent)}% OFF`;

  const badgeColor = deal.isHistoricalLow ? '#D9264E' : '#209CEE';
  const platformText = deal.region
    ? `${PLATFORM_LABEL[deal.platform]} (${deal.region})`
    : PLATFORM_LABEL[deal.platform];

  const bodyContents: Record<string, unknown>[] = [
    {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: badgeText,
          size: 'xs',
          weight: 'bold',
          color: '#FFFFFF',
          align: 'center',
          gravity: 'center',
          flex: 0,
        },
      ],
      backgroundColor: badgeColor,
      cornerRadius: '4px',
      paddingAll: '4px',
      paddingStart: '8px',
      paddingEnd: '8px',
      width: '108px',
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
        ...(deal.regularPriceTwd && deal.regularPriceTwd > deal.currentPriceTwd
          ? [
              {
                type: 'text',
                text: formatTwd(deal.regularPriceTwd),
                size: 'xs',
                color: '#9CA3AF',
                decoration: 'line-through',
                flex: 0,
              },
            ]
          : []),
      ],
    },
  ];

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

  return {
    type: 'flex',
    altText: `🎮 PersonalNotify 今日特價：${topDeals.length} 款願望清單遊戲降價！`,
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
