# Android LINE LIFF Inbox Implementation Plan

> 2026-10-02 實作狀態：本機 Python LINE API、獨立 LIFF 顧客／預約後台及 connected POS 收件匣已完成並驗證；歷史未勾選步驟保留為原計畫，實際檔案／契約以 LINE_API 與本機驗證紀錄為準。真實 LINE／全支付、PostgreSQL 正式訂單與公網部署尚未完成。

> 2026-10-01 目錄決定：LIFF 顧客網頁與測試位於並列的 ManyFishLINE/web/liff/；共用雲端實作仍位於 ManyFishPOSAndroid/cloud/，Android 收件匣仍位於 ManyFishPOSAndroid/app/。文中的相對程式路徑以各自所屬專案為根目錄。此副本是 LINE 專案規劃入口；Android 原文件保留供整合參考。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This workspace is not a Git repository, so commit steps do not apply.

**Goal:** Show formal LIFF takeaway orders and their verified payment/production states in a separately installable connected Android POS, including durable catch-up after disconnection.

**Architecture:** Add a `connected` product flavor with network permission and a store-scoped inbox gateway; keep `demo` and `verification` offline. A separate local SQLite inbox stores server snapshots and cursor in one transaction. The existing cash cart and Room data are untouched; a new UI route displays LIFF orders and sends revision-checked production/onsite-payment commands to the cloud contract.

**Tech Stack:** Kotlin, Jetpack Compose, Android `HttpURLConnection`, `SQLiteOpenHelper`, existing Android test dependencies.

**Spec:** [LINE LIFF 外帶點餐與 ManyFish POS 串接規格](../specs/2026-09-26-line-liff-ordering-design.md)

## Global Constraints

- The `demo` APK must remain fully offline, without `INTERNET` or `ACCESS_NETWORK_STATE`; use an independent `applicationId` for `connected`.
- Existing orders, receipts, backup format and `PosDatabase` version 2 must remain readable and unchanged.
- A LIFF order is formal without staff acceptance. `AWAITING_ONLINE_PAYMENT` is visible but outside the production queue; `UNPAID_ONSITE` is queued.
- Only server-confirmed `PAID_ONLINE` is labelled verified online payment. Staff-confirmed onsite electronic payment is a distinct receipt kind.
- Device commands send stable `commandId` and `expectedRevision`; ambiguous responses require read-back before retry.
- This plan uses fictional device authorization in tests. Actual pairing, secret storage and public rollout follow the broader [cloud plan](../../../../ManyFishPOSAndroid/docs/CLOUD_PLAN.md).

## Review Focus

1. A demo or verification APK accidentally gains `INTERNET` permission; Task 1 inspects both merged manifests.
2. A feed page fails halfway through local storage and advances its cursor; Task 2 rollback test prevents lost orders.
3. A paid online order is offered a local checkout button; Task 3 UI test forbids it.
4. A timeout after a production command causes a second conflicting command; Task 4 read-back test forbids blind retry.
5. Two devices update the same order revision; Task 4 asserts only the first command is accepted.

## File Structure

| File | Responsibility |
| --- | --- |
| `app/build.gradle.kts` and flavor manifests | Isolated connected package and network permission. |
| `app/src/main/java/com/manyfish/pos/InboxFeature.kt` | Gateway interface and neutral UI state names. |
| `app/src/demo/.../FeatureFactory.kt`, `app/src/verification/.../FeatureFactory.kt` | Return no inbox feature. |
| `app/src/connected/.../FeatureFactory.kt`, `LiffInboxStore.kt`, `LiffInboxClient.kt` | Connected implementation, durable cursor, HTTP calls. |
| `app/src/main/java/com/manyfish/pos/LiffInboxScreen.kt`, `MainActivity.kt`, `PosApp.kt` | LIFF inbox route with clear payment/production labels. |
| `app/src/androidTest/.../LiffInboxUiTest.kt` | Fake gateway UI and separation tests. |

### Task 1: Separate connected package and permission

**Files:** Modify `app/build.gradle.kts`, `app/src/main/AndroidManifest.xml`; create `app/src/demo/AndroidManifest.xml`, `app/src/verification/AndroidManifest.xml`, `app/src/connected/AndroidManifest.xml`, three flavor-specific `FeatureFactory.kt` files and main `InboxFeature.kt`.

**Interfaces:** `interface InboxFeature { val orders: StateFlow<List<LiffInboxOrder>>; suspend fun refresh(scope: InboxScope); suspend fun setProduction(scope: InboxScope, orderId: String, expectedRevision: Long, commandId: String, state: String); suspend fun recordOnsitePayment(scope: InboxScope, orderId: String, checkoutKey: String, amountMinor: Long, method: String) }`. Each flavor provides `FeatureFactory.create(context): InboxFeature?`.

- [ ] **Step 1: Write failing build assertions.** `connected` package must have suffix `.connected`; `demo` and `verification` must have no `INTERNET` permission. Add a small verification script or instrumentation assertion that reads `PackageInfo.requestedPermissions` for each built APK.

```kotlin
assertFalse(requestedPermissions("com.manyfish.pos.demo").contains(android.Manifest.permission.INTERNET))
```

- [ ] **Step 2: Run red.** `./gradlew :app:assembleConnectedDebug` fails because the flavor does not exist.
- [ ] **Step 3: Implement.** Add the `connected` flavor with suffix `.connected`; move manifest `tools:node="remove"` rules from main into demo and verification manifests; add `INTERNET` only in `src/connected/AndroidManifest.xml`. Create a no-op `FeatureFactory` for demo/verification, and a connected factory that can return a fake inbox until Task 2. Keep `usesCleartextTraffic="false"`.

```kotlin
create("connected") { dimension = "mode"; applicationIdSuffix = ".connected" }
```

- [ ] **Step 4: Run green.** Build all three debug flavors and inspect merged manifests; assert demo/verification have no network permission and connected has exactly the intended permission.

### Task 2: Durable feed snapshot and cursor

**Files:** Create `app/src/connected/java/com/manyfish/pos/connected/LiffInboxStore.kt`, `LiffInboxClient.kt`; add `app/src/androidTestConnectedDebug/java/com/manyfish/pos/LiffInboxStoreTest.kt` under the connected debug test variant.

**Interfaces:** `InboxScope(environmentId: String, storeId: String, pairingGeneration: Long)`; `ChangeBatch(scope: InboxScope, events: List<LiffChange>, nextCursor: Long)`; `LiffInboxStore.activate(scope: InboxScope?)`; `LiffInboxStore.apply(scope: InboxScope, batch: ChangeBatch)`; `LiffInboxStore.snapshot(scope: InboxScope)`; `LiffInboxStore.cursor(scope: InboxScope)`; `LiffInboxClient.fetch(scope: InboxScope, cursor: Long)`. The generation is a local monotonic pairing epoch; bind it to requests and validate the server storeId against the captured scope.

- [ ] **Step 1: Write failing tests.** Apply a batch with a LIFF online unpaid order and cursor 7; assert one local row and cursor 7. Apply the same batch again and assert one row. Inject an exception after row insert but before cursor write and assert both row and cursor roll back. Fetch after cursor 7 and assert an onsite order appears exactly once. Switch store A→B using the same orderId and cursor values, deliver a delayed A response, and assert only B is visible/written. Repeat across environments, revoke pairing, and re-pair the same store with a new generation; stale snapshots, errors and command read-backs cannot repopulate the screen.

```kotlin
store.activate(scope)
store.apply(scope, ChangeBatch(scope, listOf(change(orderId = "order-1", paymentState = "AWAITING_ONLINE_PAYMENT")), 7))
assertEquals(7L, store.cursor(scope))
assertEquals(1, store.snapshot(scope).size)
```

- [ ] **Step 2: Run red.** Run the connected `LiffInboxStoreTest`; it fails because the store is absent.
- [ ] **Step 3: Implement.** Use a separate `liff_inbox.db` with `orders(environment_id, store_id, pairing_generation, order_id, revision, snapshot_json, PRIMARY KEY(environment_id, store_id, pairing_generation, order_id))` and `sync_state(environment_id, store_id, pairing_generation, cursor, PRIMARY KEY(environment_id, store_id, pairing_generation))`; persist the active scope separately. `activate` and `apply` serialize through one transaction boundary. On switch/revoke atomically invalidate the old scope and delete its inbox rows/cursor; clear the observable list before publishing the new scope. Every read/write, request and callback validates captured scope against current scope, including generation. `apply` wraps all scoped upserts and cursor update in one SQLite transaction and rejects mismatched batches. Do not delete existing demo or Room data. Reject a change with a lower revision than the cached order, and never delete an order merely because it is absent from a page. `LiffInboxClient.fetch` uses HTTPS, store-scoped device credential and `/v1/changes?cursor=`; JSON parsing is bounded.

```kotlin
db.beginTransaction()
try {
    requireActiveScope(scope)
    require(batch.scope == scope)
    batch.events.forEach { upsertIfNewer(scope, it) }
    writeCursor(scope, batch.nextCursor)
    db.setTransactionSuccessful()
}
finally { db.endTransaction() }
```

- [ ] **Step 4: Run green.** Run connected store tests and a fake-HTTP client test for repeated pages, server 503 and malformed JSON; cursor stays unchanged after failure.

### Task 3: LIFF inbox and clear payment badges

**Files:** Create `app/src/main/java/com/manyfish/pos/LiffInboxScreen.kt`; modify `MainActivity.kt` and `PosApp.kt`; create `app/src/androidTest/java/com/manyfish/pos/LiffInboxUiTest.kt`.

**Interfaces:** `LiffInboxOrder` includes `orderId`, `readableNumber`, `pickupName`, `lines`, `orderState`, `paymentState`, `paymentException`, `productionState`, `revision`, `totalAmountMinor`; `LiffInboxScreen(feature: InboxFeature)` renders it.

- [ ] **Step 1: Write failing Compose UI tests.** Fake feature emits one `AWAITING_ONLINE_PAYMENT` order and one `UNPAID_ONSITE` order. Assert the first appears in the visible all-orders list with “線上付款待確認” but not in “待製作”; the second appears in “待製作” with “到店付款／未收款”. A `PAID_ONLINE` order shows “線上已付款” and no checkout button. An unpaid onsite READY_FOR_PICKUP order has a disabled pickup/completion action and “請先收款”; paid orders enable it only for PLACED without paymentException. CANCEL_PENDING/CANCELED and payment exceptions stay visible with a warning but have no normal production controls. Demo flavor has no inbox tab.

```kotlin
composeRule.onNodeWithText("線上付款待確認").assertExists()
composeRule.onNodeWithText("待製作").performClick()
composeRule.onNodeWithText("到店付款／未收款").assertExists()
```

- [ ] **Step 2: Run red.** Run `LiffInboxUiTest`; it fails because the route is absent.
- [ ] **Step 3: Implement.** `MainActivity` obtains `FeatureFactory.create(this)` and passes it into `PosApp`. Add a navigation tab only when the feature is non-null. The inbox has All, Waiting Payment, To Prepare and Ready tabs; each row shows source `LINE LIFF`, pickup number, items/remaining flavor hint, payment evidence and last sync time. Build amount labels from server snapshot, never from current catalog. On error show only current-scope cached rows plus a stale-sync banner; never restore a prior scope. Exclude canceled/pending-cancel and payment-exception orders from actionable production tabs while keeping them visible in All.

```kotlin
if (inboxFeature != null) NavigationItem(label = "LIFF 訂單", onClick = { screen = "liff_inbox" })
```

- [ ] **Step 4: Run green.** Connected UI tests pass on emulator. Run `scripts/test.sh` for existing domain/lint checks, and inspect demo APK permissions and navigation to ensure offline behavior is intact.

### Task 4: Revision-checked staff commands and reconnect

**Files:** Modify connected `LiffInboxClient.kt`, `FeatureFactory.kt`, main `LiffInboxScreen.kt`; add connected fake-server tests.

**Interfaces:** `POST /v1/orders/{id}/production` with `{expectedRevision, commandId, state}` and `POST /v1/orders/{id}/onsite-payment` with `{checkoutKey, amountMinor, method}`; responses contain latest order snapshot.

- [ ] **Step 1: Write failing tests.** A production command returns 409 after another device changes revision: UI reloads latest order and does not show success. A simulated timeout triggers GET/read-back before any retry. Duplicate taps use the same `commandId`. Onsite payment is enabled only for `UNPAID_ONSITE`; server-confirmed online paid and `PAYMENT_UNCERTAIN` orders have no onsite payment control. Unpaid pickup/completion rejects server-side even if a stale client enables it. Test payment/pickup races and scope changes during command timeout/read-back; no former-store result may enter current cache/UI.

```kotlin
assertEquals("command-1", sentCommands[0].commandId)
assertEquals("command-1", sentCommands[1].commandId)
assertEquals(1, acceptedCommands.count { it.orderId == "order-1" })
```

- [ ] **Step 2: Run red.** Run connected fake-server command tests; expected command handling is absent.
- [ ] **Step 3: Implement.** Generate UUID `commandId` once per user action, keep it until server confirms or read-back resolves it, send `expectedRevision`, and refresh the order on 409 or ambiguous network failure. Poll `/v1/changes` while foreground and on resume; a failed poll keeps the cursor. Offer manual refresh. Do not change local payment status optimistically. Capture InboxScope for every command and read-back, reject late results on generation mismatch, and require current-scope PAID_ONLINE/PAID_ONSITE plus PLACED, READY_FOR_PICKUP and no paymentException before enabling pickup/completion. The server rechecks canonical receipt and revision atomically.

```kotlin
try { client.setProduction(scope, orderId, revision, commandId, state) }
catch (e: AmbiguousNetworkResult) {
    val latest = client.getOrder(scope, orderId)
    store.upsertIfNewerWhenActive(scope, latest) // transactional scope/generation guard
}
```

- [ ] **Step 4: Run green.** Connected command tests and UI tests pass; with the local fake cloud, disconnect and reconnect a connected emulator, then verify all queued orders and payment changes appear once. Re-run `scripts/test.sh` and permission inspection.

## Handoff

This is a connected-flavor local/contract slice. Real POS activation requires device pairing/credential storage, public cloud HTTPS and the full [rollout](2026-09-26-line-liff-rollout.md). Do not install test variants over the user's demo package or clear existing Room data.

> 架構相容要求：實作前遵循規格的「現有架構相容約束」；沿用已存在的 connected／IDoo、Android 分層、Room 舊資料與 Python 雲端，新增通路不得覆蓋既有功能。

## 2026-10-01 預約取餐增補（優先於原介面範例）

本增補待本次規格審閱；原計畫仍未實作。

- [ ] InboxOrder／快照保存 pickupAt、pickupTimeZone、pickupScheduleVersion，日期顯示使用訂單的店家時區，不能使用平板系統時區取代。
- [ ] 所有正式單送出即顯示，包括明天及更遠日期的單；按 pickupAt、createdAt、orderId 排序。清楚顯示完整取餐日期、時間、付款狀態及逾時未完成提示。
- [ ] 不以倒數時間隱藏訂單或自動開始製作。店員手動推進；到店未付允許開始，線上未付禁用開始，既有已付才能完成規則維持。
- [ ] 測試未來預約立即可見、跨日排序、不同平板時區一致、後台改設定不改舊單、離線重連保留取餐快照及待付款單不能開始製作。
- [ ] 原 Task 1 已有 connected flavor，執行前先核對現有實作並沿用，不能再建立相同 flavor 或覆蓋 IDoo 連線功能。
