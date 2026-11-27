# PersonalNotify

個人化遊戲特價（Steam / PS5 / Switch）與台灣北部藝人活動（演唱會／見面會）通知系統，透過 **LINE Messaging API** 直接推播到個人聊天室，並與 [GameRank](https://github.com/kenaigogo-lang/GameRank) 共用 Firebase 專案自動去重。

## 已完成功能（Phase 1 ～ Phase 4）

- **復古雙主題介面**（紅白機 NES.css / 街機 CRT 霓虹一鍵切換），與 GameRank 風格一致。
- **共用 GameRank Firebase 專案**：登入同一 Google 帳號後，自動唯讀載入 `users/{uid}/backups/*` 已玩紀錄，完全不影響 GameRank 原資料與安全規則。
- **LINE Messaging API 推播與配額保護**：
  - 設定頁一鍵發送「LINE 測試推播卡片」（`/api/line-test`）。
  - 三平台遊戲特價自動彙整成單一 Flex Carousel 卡片（最多 10 款只消耗 1 則免費額度），內建每月 200 則免費額度保護閥（達 170 則自動切換高優先模式）。
- **Steam 私人帳號匯入＋IsThereAnyDeal 史低判斷**：
  - Steam 檔案可全程維持「私人」，透過「🔒 Steam 私人帳號匯入」貼上 `store.steampowered.com/dynamicstore/userdata/` JSON 一鍵同步已擁有庫＋願望清單。
  - 透過 IsThereAnyDeal API 取得台灣區即時折扣與精準「歷史最低價（史低）」。
- **PS5 / PSN 整合**：
  - 在設定頁貼上 Sony `npsso` token 即刻換取約 2 個月效期之 `refreshToken`（`/api/psn-verify`），到期前 5 天自動發 LINE 提醒更新。
  - 透過 `psn-api` 自動同步 PS4/PS5 已購買數位庫與已遊玩實體片清單納入去重，並查詢台灣 PS Store 即時折扣＋附 PlatPrices 史低曲線按鈕。
- **Switch 友善擁有庫管理＋多區比價（TW / JP / HK / US / MX）**：
  - 支援線上搜尋補全封面、一鍵標記「已擁有／願望清單」、批次貼上多行匯入、貼上任天堂商店連結自動擷取 14 碼 NSUID。
  - 每日自動比對勾選區域的 eShop 價格並依即時匯率換算台幣，挑出最便宜區域推播並標註付款方式（台灣直刷／日美港墨點數卡）＋附 Deku Deals 史低曲線連結。
- **GitHub Actions 定時排程**：
  - [daily-games.yml](.github/workflows/daily-games.yml)：每日台灣時間 10:00 與 20:00 自動執行三平台同步、去重與特價推播。
  - [monitor-events.yml](.github/workflows/monitor-events.yml)：每日台灣時間 09:00 / 13:00 / 17:00 / 21:00 掃描 Google News RSS + KKTIX + 藝人官網，經 Gemini 嚴格過濾「台灣北部（台北、新北、桃園、基隆、新竹）」可見本人之實體活動並即時推播。
  - [sale-reminders.yml](.github/workflows/sale-reminders.yml)：每小時輕量檢查 Firestore，於開賣前 24 小時與前 1 小時自動發送 LINE 搶票警報。

## 快速部署與設定步驟

### 1. 本機與 Vercel 前端設定
1. 複製 `.env.example` 為 `.env.local`，填入與 **GameRank** 相同的 `VITE_FIREBASE_*` 設定。
2. 在 Vercel 專案的 Environment Variables 設定：
   - 所有 `VITE_FIREBASE_*`
   - `FIREBASE_PROJECT_ID`
   - `LINE_CHANNEL_ACCESS_TOKEN`（從 LINE Developers Console → Messaging API 發行）
   - `LINE_USER_ID`（從 LINE Developers Console → Basic settings 最下方 `Your user ID` 取得）
   - （選填）`IGDB_CLIENT_ID` 與 `IGDB_CLIENT_SECRET`

### 2. GitHub Actions 背景排程 Secrets 設定
前往 GitHub Repo → **Settings → Secrets and variables → Actions** 新增以下 Secrets：

| Secret 名稱 | 說明 |
| :--- | :--- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰（完整 JSON） |
| `TARGET_FIREBASE_UID` | 登入 PersonalNotify 後，在「設定」頁點「複製 UID」取得 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API Channel Access Token（超過 170 碼那串） |
| `LINE_USER_ID` | LINE Developers Console → Basic settings 最下方的 `Your user ID` |
| `GEMINI_API_KEY` | Google AI Studio API Key（建議無綁帳單之免費專案，供 Phase 2 北部活動過濾使用） |
| `STEAM_API_KEY` | Steam Web API Key（免費申請） |
| `STEAM_ID` | 你的 17 碼 Steam ID64（檔案遊戲詳情需設公開） |
| `ITAD_API_KEY` | IsThereAnyDeal API Key（免費申請於 `isthereanydeal.com/apps/`，開啟精準史低判斷） |
| `APP_BASE_URL` | 你的 Vercel 網址（例如 `https://personalnotify.vercel.app`），會附在 LINE 卡片按鈕上 |

## 開發指令

```bash
npm install
npm run dev        # 啟動本機開發伺服器
npm run typecheck  # 檢查前端 + Vercel API + Worker 型別
npm test           # 執行 Vitest 單元測試
npm run build      # 建置正式版前端
```
