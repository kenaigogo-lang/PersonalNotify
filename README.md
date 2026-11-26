# PersonalNotify

個人化遊戲特價（Steam / PS5 / Switch）與台灣北部藝人活動（演唱會／見面會）通知系統，透過 **LINE Messaging API** 直接推播到個人聊天室，並與 [GameRank](https://github.com/kenaigogo-lang/GameRank) 共用 Firebase 專案自動去重。

## Phase 1 已完成功能

- **復古雙主題介面**（紅白機 NES.css / 街機 CRT 霓虹一鍵切換），與 GameRank 風格一致。
- **共用 GameRank Firebase 專案**：登入同一 Google 帳號後，自動唯讀載入 `users/{uid}/backups/*` 已玩紀錄，完全不影響 GameRank 原資料與安全規則。
- **LINE Messaging API 推播與配額保護**：
  - 設定頁一鍵發送「LINE 測試推播卡片」（`/api/line-test`）。
  - 遊戲特價自動彙整成單一 Flex Carousel 卡片（最多 10 款只消耗 1 則免費額度），並內建每月 200 則免費額度保護閥（達 170 則自動切換高優先模式）。
- **Steam 自動同步＋IsThereAnyDeal 史低判斷**：
  - 自動同步 Steam 已擁有庫（`GetOwnedGames`）與願望清單（`IWishlistService/GetWishlist/v1`）。
  - 透過 IsThereAnyDeal API 取得台灣區價格與「歷史最低價（史低）」，無 ITAD Key 時自動降級走 Steam Store API。
- **友善的 Switch / 手動擁有庫管理**：支援線上搜尋補全封面、一鍵標記「已擁有／願望清單」、批次貼上多行匯入，以及在願望清單卡片上一鍵「✓ 已入手」。
- **藝人追蹤清單介面（預備 Phase 2）**：支援自由擴充歌手／演員／團體、別名與防撞名排除詞，內建一鍵載入 LiSA / Aimer / milet / 陳忻玥預設清單。
- **GitHub Actions 定時排程**：[daily-games.yml](.github/workflows/daily-games.yml) 每日台灣時間 10:00 與 20:00 自動同步查價並推播（支援手動觸發 `dry_run` 測試）。

## 快速部署與設定步驟

### 1. 本機與 Vercel 前端設定
1. 複製 `.env.example` 為 `.env.local`，填入與 **GameRank** 相同的 `VITE_FIREBASE_*` 設定。
2. 在 Vercel 專案的 Environment Variables 設定：
   - 所有 `VITE_FIREBASE_*`
   - `FIREBASE_PROJECT_ID`
   - `LINE_CHANNEL_ACCESS_TOKEN`（從 LINE Developers Console → Messaging API 發行）
   - `LINE_USER_ID`（例如 `U32ac8f3e19705ed51c36f6b8c7bb2830`）
   - （選填）沿用 GameRank 的 `IGDB_CLIENT_ID` 與 `IGDB_CLIENT_SECRET`

### 2. GitHub Actions 背景排程 Secrets 設定
前往 GitHub Repo → **Settings → Secrets and variables → Actions** 新增以下 Secrets：

| Secret 名稱 | 說明 |
| :--- | :--- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰（完整 JSON） |
| `TARGET_FIREBASE_UID` | 登入 PersonalNotify 後，在「設定」頁點「複製 UID」取得 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API Channel Access Token |
| `LINE_USER_ID` | 你的 LINE User ID |
| `STEAM_API_KEY` | Steam Web API Key（免費申請） |
| `STEAM_ID` | 你的 17 碼 Steam ID64（檔案遊戲詳情需設公開） |
| `ITAD_API_KEY` | IsThereAnyDeal API Key（免費申請於 `isthereanydeal.com/apps/`，開啟精準史低判斷） |
| `APP_BASE_URL` | （選填）你的 Vercel 網頁網址，會附在 LINE 卡片按鈕上 |

## 開發指令

```bash
npm install
npm run dev        # 啟動本機開發伺服器
npm run typecheck  # 檢查前端 + Vercel API + Worker 型別
npm test           # 執行 Vitest 單元測試
npm run build      # 建置正式版前端
```
