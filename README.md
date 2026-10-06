# ManyFish LINE LIFF 點餐

與 `../ManyFishPOSAndroid` 並列的獨立顧客端專案。已實作不需建置或 npm 套件的行動網頁、預約管理頁與 Node 測試，可搭配本機 Python API 測試；尚未公網部署或串接真實線上付款。

## 本機執行

從並列 POS 專案啟動共用 API（Python 3）：

```sh
cd ../ManyFishPOSAndroid
python3 -m cloud.liff_orders
```

開啟 `http://127.0.0.1:8766/`（亦可用 `http://localhost:8766/`）。顧客頁明確標示「本機示範・假身分」，按登入才會以 `local-customer` 建立測試會話。請固定使用同一主機名稱以維持 cookie。菜單金額僅預估，正式單金額、狀態及可選預約時段均由伺服器回覆。

店家頁為 `/admin.html`。輸入服務啟動時顯示的 admin Bearer token，可設定提前天數、每週時段、間隔、最短提前時間與指定休店日期，先預覽尚未儲存設定產生的時段、查看預約單，並暫停／恢復新單。預覽透過伺服器驗證最新設定版本，不會發布設定；按「儲存預約設定」才套用。token 僅放在頁面記憶體，重新整理後須重新輸入。

```sh
cd ../ManyFishLINE
node --test web/liff/tests/*.test.mjs
```

測試使用 Node 內建 `node:test`，無外部依賴。涵蓋登入、防重重送與跨帳號隔離、菜單與口味規則、預約時區、訂單狀態及管理請求。

## 登入與送單恢復

### 店家官方帳號

使用者於 2026-10-02 提供 Basic ID：`@787vgbkr`。顧客頁的加好友入口為 `https://line.me/R/ti/p/%40787vgbkr`，依 [LINE 官方 URL scheme](https://developers.line.biz/en/docs/line-login/using-line-url-scheme/#sharing-a-line-official-account) 將 `@` 編碼為 `%40`。這只建立公開帳號入口；帳號後台所有權、LINE Login channel 連結與真實登入尚未驗證。

使用者依建立 LINE Login channel 的步驟，於 2026-10-02 提供新的 LINE Login Channel ID：`2011839238`；此為使用者提供的設定資料，尚未透過後台或真實登入驗證。先前的 `2008515308` 保留為類型未核對的既有 channel，不作為 Login verifier 的 client_id。使用者已指定預定公開網址 `https://manyfish.tera-software.com/`（2026-10-02）；DNS 已指向測試主機 `34.68.215.39`，公開 HTTPS 已驗證；測試點餐 API 已啟用，HTTPS 首頁回傳 200。使用者已確認沿用 GCP；測試階段依使用者最低成本要求改用單台 GCE e2-micro 與本機 PostgreSQL（詳見並列 POS 專案 `infra/gcp/liff-test-vm/README.md`），專用 production project `manyfish-pos-prod` 已建立；已連結原 CardMaster 計費帳戶（更名為 ManyFish），採低流量測試規格，初估每月 NT$150–300（非硬性上限），LIFF ID 為 `2011839238-Fr1RGtdc`，已設定於測試主機；尚待使用者在 LINE 實際登入及送單驗收。Basic ID 不能代替任一個 ID。保留現有 LINE Login／LIFF 架構，LIFF scope 使用 `openid` 與 `profile`（自動帶入 LINE 顯示名稱）；不要求 email 或 chat_message.write。部署程式已支援 profile，但後台加勾與重新授權仍待使用者完成。若啟用登入時加好友，須在同一 Provider 下將 LINE Login channel 連結到這個官方帳號。依 [LIFF 官方設定](https://developers.line.biz/en/docs/liff/registering-liff-apps/) 建立 Full 尺寸的應用，endpoint 必須為 HTTPS；目前本機假身分 runner 不可作為公開 endpoint。

待取得設定資料後，必須另外完成真實 verifier 的伺服器組裝、公開 HTTPS 部署與實際 LINE 登入驗收，才可宣稱帳號點餐串接完成。不要把 Channel secret、access token 或 LINE ID token 貼入 README、前端或日誌。

`GET /v1/customer/config` 提供 `{localDemo, liffId}`。只有 `localDemo: true` 才顯示虛構顧客登入；正式環境設定 `localDemo: false` 與 `liffId`，由 LINE 官方 LIFF v2 SDK 初始化、必要時 `login()`，取得原始 ID token 交由伺服器驗證。伺服器必須另配置真實 token verifier、公開 HTTPS 與 LINE channel；填入 LIFF ID 本身不代表完成正式登入串接。

送單前將伺服器提供的 `{environmentId,storeId,ownerRef}`、穩定 `clientOrderKey` 與原請求暫存在 `sessionStorage`。重新登入後先核對範圍並查原鍵；404 只提供原鍵原請求重送，連線／5xx 結果未知時保留待確認，找到正式單後刪除暫存。切換帳號／店家移除舊範圍待確認資料。姓名與電話會出現在待確認訂單的暫存請求；成功送單後由伺服器依店家及已驗證 LINE 帳號保存聯絡資料與上次餐點，不另存至 localStorage。token 與完整 LINE profile 不進瀏覽器儲存空間。訂單可由「我的訂單」重新取得，不根據付款返回網址判定已付款。

線上付款按鈕維持停用。取餐未選時段或無可選時段時禁止送新單；設定變更拒絕後刷新時段，必須自行重選，不自動更改取餐時間。暫停接單不阻擋已成立原單恢復。真實付款、推播、正式身分驗證、PostgreSQL 公網部署及真實 LINE 裝置驗收仍待後續設定。

## 目錄與邊界

- `web/liff/`：LIFF 行動網頁；`web/liff/tests/`：顧客端測試。
- `docs/superpowers/specs/`：LINE 功能規格；`docs/superpowers/plans/`：分階段計畫。
- `../ManyFishPOSAndroid/cloud/`：共用菜單、預約設定、訂單及付款 API。
- `../ManyFishPOSAndroid/app/`：現有 Android POS，接收同一筆雲端正式訂單。

顧客端透過 HTTPS API 連線，不直接讀取 Android 資料庫、不使用 IDoo cookie，不另建第二套正式訂單資料庫。顧客端可獨立建置；正式部署不得依賴讀取並列專案檔案。

## 已確認範圍

後台設定可提前預約天數、取餐時段、間隔、最短提前時間與休店日；暫不限制時段容量。送單立即顯示在 POS，依取餐時間排序，由店員決定開始製作；線上付款單需確認付款成功才可製作。後台變更不改寫既有預約。

## 開始閱讀

- [點餐規格](docs/superpowers/specs/2026-09-26-line-liff-ordering-design.md)
- [實作路線](docs/superpowers/plans/2026-09-26-line-liff-rollout.md)
- [LIFF 網頁計畫](docs/superpowers/plans/2026-09-26-line-liff-customer-web.md)

規劃文件保留 Android 原文件副本，日後共同契約變更需同步兩邊。本機 API 契約位於 `../ManyFishPOSAndroid/docs/implementation/LINE_API.md`。

## 品牌 LOGO

顧客頁、店家後台與 favicon 使用去背的 `web/liff/assets/manyfish-logo-transparent.png`（RGBA 1230 × 1279），完整保留魚／貓角色、「好多魚」與「Many Fish」字樣。頁面及 favicon 以完整圖框顯示，LOGO 背景透明，不使用舊 JPEG 的局部顯示視窗。原始 `web/liff/assets/manyfish-logo.jpg`（1415 × 2000）仍保留原始位元組作為來源。畫面使用與 POS 一致的棕色、米白與砂色。品牌調整不代表已串接正式 LINE 帳號。

## 聯絡資料與再次點餐（2026-10-02）

金額移除「起」。取餐姓名與電話均必填，首次姓名使用伺服器驗證 LINE ID token 後取得的 name，可修改；已有上次成功訂單則優先使用保存的取餐姓名與電話。電話接受空格、括號與連字號，正規化後需為可選 + 及 7–15 位數字。資料僅在新單成功交易內更新，重送旧單不覆寫較新的記憶資料。

下次登入以目前菜單重建上次餐點與金額；停售品項、規格、口味及不符現行選項規則的項目不加入並顯示提示。取餐日期、時段與防重鍵不沿用。待確認送單優先恢復，同一帳號重新驗證不覆寫編輯中的購物車與聯絡欄位，換帳號則清除前一帳號內容。

## 必選口味與售完隱藏（2026-10-03）

依使用者更新要求，線上點餐必須滿足菜單 minSelected；固定六入等 minSelected=maxSelected 群組顯示「必須選滿」，未滿數量不可加入餐點，伺服器同樣拒絕少選。此規則取代早期 LINE 允許多口味少選的例外，既有已成立訂單快照與原鍵恢復保留。顧客菜單隱藏 active=false 或 available=false 的產品、規格與口味；原始菜單保留供伺服器驗證，不能用舊頁面送出停售選項。再次點餐同樣依現行完整選擇規則驗證。
