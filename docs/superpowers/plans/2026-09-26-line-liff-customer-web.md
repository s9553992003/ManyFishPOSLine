# LINE LIFF Customer Web Implementation Plan

> 2026-10-02 實作狀態：本機 Python LINE API、獨立 LIFF 顧客／預約後台及 connected POS 收件匣已完成並驗證；歷史未勾選步驟保留為原計畫，實際檔案／契約以 LINE_API 與本機驗證紀錄為準。真實 LINE／全支付、PostgreSQL 正式訂單與公網部署尚未完成。

> 2026-10-01 目錄決定：LIFF 顧客網頁與測試位於並列的 ManyFishLINE/web/liff/；共用雲端實作仍位於 ManyFishPOSAndroid/cloud/，Android 收件匣仍位於 ManyFishPOSAndroid/app/。文中的相對程式路徑以各自所屬專案為根目錄。此副本是 LINE 專案規劃入口；Android 原文件保留供整合參考。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This workspace is not a Git repository, so commit steps do not apply.

**Goal:** Build a mobile LIFF takeaway ordering page that uses the ManyFish customer API and lets a customer view the same formal order after retries or reopening the page.

**Architecture:** A small static web app runs on the future HTTPS LIFF endpoint. Pure JavaScript modules own basket state and formatting; a single API client owns sessions and order requests. The LIFF SDK is injected at the boundary so local tests use a fake and no real LINE account.

**Tech Stack:** HTML/CSS, JavaScript ES modules, Node.js built-in `node:test`; official LIFF v2 SDK loaded from LINE's [CDN](https://developers.line.biz/en/docs/liff/developing-liff-apps).

**Spec:** [LINE LIFF 外帶點餐與 ManyFish POS 串接規格](../specs/2026-09-26-line-liff-ordering-design.md)

## Global Constraints

- Consume the API and state names fixed in [order core plan](2026-09-26-line-liff-order-core.md); the browser never computes an authoritative price or declares payment successful.
- Only `LINE_LIFF` takeaway, full published menu version and `ONLINE`／`ONSITE` payment choices belong in this first screen.
- Allow a multi-flavor group below its suggested count with a visible remaining-count hint; enforce maxima and required single-choice groups.
- Keep the `clientOrderKey` stable across HTTP retry; never store LINE ID tokens, service session IDs or customer profile in localStorage／sessionStorage.
- Do not enable the real online checkout button before a verified 全支付 merchant adapter is available.

## Review Focus

1. A double tap on submit sends the same key and shows one order; Task 2 test.
2. A network timeout after successful server save can recover the order by retrying the same key; Task 2 test.
3. Opening from an external browser triggers `liff.login()` and resumes after return; Task 1 test.
4. An incomplete multi-flavor selection remains selectable while an over-limit selection is blocked; Task 3 test.
5. Returning from a payment page never renders a paid badge until server state is `PAID_ONLINE`; Task 4 test.

## File Structure

| File | Responsibility |
| --- | --- |
| `web/liff/index.html`, `web/liff/styles.css` | Mobile layout, accessible labels, loading and error regions. |
| `web/liff/line-session.mjs` | LIFF initialization and exchange of raw ID token for backend session. |
| `web/liff/api.mjs` | Customer menu, order creation and read calls; CSRF handling. |
| `web/liff/basket.mjs` | Local selections and remaining-count display logic. |
| `web/liff/app.mjs` | Screen transitions and event handlers. |
| `web/liff/tests/*.test.mjs` | Pure logic and fake-fetch tests. |

### Task 1: LIFF session boundary

**Files:** Create `web/liff/line-session.mjs`, `web/liff/tests/line-session.test.mjs`.

**Interfaces:** `startLineSession(liff, api, liffId) -> Promise<void>`; `api.openSession(idToken) -> Promise<{csrfToken:string}>`.

- [ ] **Step 1: Write failing tests.** A fake LIFF client returns logged-in true and a fictional ID token; assert `init({liffId})`, then exactly one `openSession(token)` call. For external browser with `isLoggedIn() === false`, assert `login()` is called and no API request happens before the redirect.

```js
await startLineSession(fakeLiff, fakeApi, '1234567890-Fictional');
assert.deepEqual(calls, ['init', 'getIDToken', 'openSession']);
```

- [ ] **Step 2: Run red.** `node --test web/liff/tests/line-session.test.mjs` fails because the module does not exist.
- [ ] **Step 3: Implement.** Await `liff.init({liffId})`; if not logged in, call `liff.login()` and return. Otherwise pass only `liff.getIDToken()` to `api.openSession`; do not pass `getProfile()` or decoded token to the server. Render an auth error if token is absent.

```js
await liff.init({ liffId });
if (!liff.isLoggedIn()) { liff.login(); return; }
await api.openSession(liff.getIDToken());
```

- [ ] **Step 4: Run green.** `node --test web/liff/tests/line-session.test.mjs` passes.

### Task 2: API client and stable order key

**Files:** Create `web/liff/api.mjs`, `web/liff/tests/api.test.mjs`.

**Interfaces:** `CustomerApi(fetchImpl).openSession(idToken)`, `.menu()`, `.placeOrder(request, clientOrderKey)`, `.order(orderId)`, `.orders()`, `.orderByClientKey(clientOrderKey)`. `placeOrder` returns `{orderId, readableNumber, paymentState, productionState}`.

- [ ] **Step 1: Write failing tests.** Fake `fetch` first throws after the backend has stored a response, then returns the same order on retry. Assert both POST bodies contain the same `clientOrderKey` and immutable original request. Simulate committed POST with lost response, reload with no orderId and a changed published menu: authenticated key lookup restores the original order without a new POST. Test scoped 404 then same-key original-request retry; timeout/5xx stays unresolved; 401 reauthenticates before lookup. An account/store switch never replays the previous scope request. Assert 409 with `STALE_MENU` is surfaced to the UI and the cart is preserved; `X-CSRF-Token` is attached only to mutations.

```js
const key = 'fictional-uuid-1';
await assert.rejects(api.placeOrder(request, key));
const order = await api.placeOrder(request, key);
assert.equal(order.orderId, 'order-1');
assert.deepEqual(sentKeys, [key, key]);
```

- [ ] **Step 2: Run red.** `node --test web/liff/tests/api.test.mjs` fails on absent client.
- [ ] **Step 3: Implement.** Use same-origin `fetch(..., {credentials:'same-origin'})`, JSON content type, session CSRF token in memory, and fixed `clientOrderKey` passed by caller. Map 401 to re-login, 409 stale menu to menu refresh prompt, 409 key conflict to an explicit order-recovery error. Never log token or full basket to console. `orderByClientKey` calls `GET /v1/customer/orders/by-client-key/{clientOrderKey}` with URL-encoded key; distinguish 200, 404 ORDER_NOT_FOUND, 401 and unknown network/5xx outcomes. A lookup 404 is not permission to generate a new key: an earlier POST may still be committing.

```js
const response = await fetchImpl('/v1/customer/orders', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ ...request, clientOrderKey }) });
```

- [ ] **Step 4: Run green.** `node --test web/liff/tests/api.test.mjs` passes.

### Task 3: Basket and checkout screen

**Files:** Create `web/liff/basket.mjs`, `web/liff/index.html`, `web/liff/styles.css`, `web/liff/tests/basket.test.mjs`.

**Interfaces:** `addSelection(basket, product, variantId, modifierIds, quantity) -> basket`; `remainingFlavors(group, selectedIds) -> number`; `buildOrderRequest(basket, menuVersion, paymentChoice, pickupName) -> object`.

- [ ] **Step 1: Write failing tests.** With a six-flavor group, two choices yield `remainingFlavors === 4` and can enter checkout. Seven choices, a modifier over its max, a missing required single choice or quantity 0 are rejected locally. Test output retains product/variant/modifier IDs and never includes client total as authority.

```js
assert.equal(remainingFlavors({ minSelected: 6, maxSelected: 6 }, ['red', 'milk']), 4);
assert.equal(buildOrderRequest(basket, 'menu-1', 'ONSITE', '阿魚').paymentChoice, 'ONSITE');
```

- [ ] **Step 2: Run red.** `node --test web/liff/tests/basket.test.mjs` fails on absent basket module.
- [ ] **Step 3: Implement.** Render categories/products, a large tap target for each flavor, basket review, missing-flavor hint, pickup name and payment-choice buttons. Keep UI helper validation in `basket.mjs`; server errors remain authoritative. Use semantic buttons, visible focus, 44 px or larger tap targets, and a disabled submit button while the request is in flight.

```html
<button type="button" data-action="submit-order" aria-describedby="checkout-status">送出外帶訂單</button>
<p id="checkout-status" role="status" aria-live="polite"></p>
```

- [ ] **Step 4: Run green.** `node --test web/liff/tests/basket.test.mjs` passes. Open local page on narrow and wide mobile viewports; confirm all flavor choices, keyboard focus and errors remain visible without horizontal overflow.

### Task 4: Order status and payment guard

**Files:** Create `web/liff/app.mjs`, `web/liff/tests/app-state.test.mjs`; update `cloud/liff_orders/wsgi.py` only to serve the static page in local development.

**Interfaces:** `displayOrderStatus(order) -> {paymentLabel, productionLabel, canStartOnlinePayment, exceptionLabel}`; online payment navigation requires a live verified merchant adapter flag plus server-reported eligibility. CANCEL_PENDING, CANCELED, COMPLETED, paymentException and uncertain/active prior attempts block creation of a new attempt; resuming/querying the existing attempt uses its stable key.

- [ ] **Step 1: Write failing tests.** `AWAITING_ONLINE_PAYMENT` and `PAYMENT_UNCERTAIN` display unpaid/pending labels even after a simulated return URL; `PAID_ONLINE` shows paid and the actual server production state, including PREPARING. CANCEL_PENDING shows cancellation pending; CANCELED shows canceled; paymentException shows a contact-store notice without offering payment or implying production. Test these states even when a paid receipt exists. `UNPAID_ONSITE` shows “到店付款”. When `onlinePaymentEnabled=false`, show the option as unavailable and keep onsite ordering usable.

```js
assert.equal(displayOrderStatus({paymentState:'PAYMENT_UNCERTAIN', productionState:'WAITING_PAYMENT'}).paymentLabel, '付款待確認');
```

- [ ] **Step 2: Run red.** `node --test web/liff/tests/app-state.test.mjs` fails on absent app module.
- [ ] **Step 3: Implement.** After `placeOrder`, show readable pickup number and call `api.order(orderId)` on refresh/reopen. A “我的訂單” view calls `api.orders()` so a returning customer can find earlier orders without a saved local key. Payment return route only reloads `api.order`; it does not infer success from URL query. Before the initial POST, persist `{scope, clientOrderKey, originalRequest}` in sessionStorage, where scope binds the trusted environment/store and an opaque server session-owner reference (not a token or LINE profile). The original request includes only order submission fields, including pickup name, and is immutable while unresolved. After reload, authenticate and validate scope first, then look up the key before attempting any submission. On 200, restore the returned order and erase the pending payload; retain only its scoped order ID. On 404, offer retry using the exact original request and same key; never reconstruct it from a changed menu. On timeout/5xx, keep pending state and offer lookup again. On 401, reauthenticate; on a different owner/store, hide and remove the old pending record without replaying it. Do not log or retain tokens/profile. Do not clear pending state or generate a replacement key merely because a response was lost. A definitive new-order validation rejection allows explicit cart correction as a new submission; a key conflict remains a recovery error. Test reload with no orderId, menu publication and ordering pause after the original commit, lookup failure, and account switching. The actual Full Pay redirect remains disabled until its adapter is verified.

```js
const latest = await api.order(orderId);
renderOrderStatus(displayOrderStatus(latest));
```

- [ ] **Step 4: Run green.** `node --test web/liff/tests/*.test.mjs` passes. With fake LIFF and fake API, manually verify submit, timeout/retry, refresh and back-navigation. Real LIFF testing waits for the public HTTPS endpoint and LINE channel.

## Handoff

Run all browser-model tests with `node --test web/liff/tests/*.test.mjs`. The [POS plan](2026-09-26-line-liff-pos-inbox.md) consumes the same order and change-feed fields. LINE's [LIFF development guide](https://developers.line.biz/en/docs/liff/developing-liff-apps) documents the v2 CDN and external-browser login; public rollout must run in HTTPS and use an actual LIFF ID.

> 架構相容要求：實作前遵循規格的「現有架構相容約束」；沿用已存在的 connected／IDoo、Android 分層、Room 舊資料與 Python 雲端，新增通路不得覆蓋既有功能。

## 2026-10-01 預約取餐增補（優先於原介面範例）

本增補待本次規格審閱；原計畫仍未實作。

- [ ] api.mjs 增加 pickupSlots()；checkout 以伺服器提供的日期／時段顯示必選取餐時間，不自行推算可選範圍，不顯示額滿。
- [ ] buildOrderRequest 新增 pickupAt、scheduleVersion；確認頁顯示店家當地完整日期與時間。無可選時段時禁止新單送出，保留購物車。
- [ ] 409 PICKUP_SCHEDULE_CHANGED／PICKUP_SLOT_UNAVAILABLE 刷新時段並要求重選；不自動改取餐時間或重送。僅明確驗證拒絕後可修正為新提交；結果未知沿用原鍵原請求查單。
- [ ] pending originalRequest 保留取餐時間及設定版本；重載先恢復原單，不以新時段替換舊請求。顧客訂單頁及我的訂單顯示預約日期、時間與逾時未完成提示。
- [ ] 測試午夜跨日、設定修改、無可選時段、缺少時段、提交回覆遺失及跨日恢復。行動版確認日期與時段選擇、付款方式及總額清楚可用。
