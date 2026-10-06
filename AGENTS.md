# ManyFishLINE 工作約束

本專案是獨立的 LINE LIFF 顧客網頁。先讀 README.md 與 docs/superpowers/specs/2026-09-26-line-liff-ordering-design.md。

- LIFF 網頁與測試在本專案；共用 Python 雲端及 Android POS 在 ../ManyFishPOSAndroid。修改另一專案前先確認任務授權和其工作約束。
- 相容現有 API、整數金額、訂單快照、防重、付款驗證及 POS 重連規則。不直接操作 Android Room 或將 LINE 訂單送進 IDoo。
- 可提前天數由後台設定，不固定一天；暫無容量限制。所有預約單立即在 POS 可見，由店員決定製作時間。
- 勿保存真實憑證或顧客資料於程式、fixture、日誌或 URL。真實付款尚未實作。
- 本專案已提供本機可執行顧客網頁、預約管理頁及 Node 測試；正式 LINE 登入、真實線上付款、PostgreSQL 公網部署與裝置驗收尚未啟用。
