# LINE LIFF Order Core Implementation Plan

> 2026-10-02 實作狀態：本機 Python LINE API、獨立 LIFF 顧客／預約後台及 connected POS 收件匣已完成並驗證；歷史未勾選步驟保留為原計畫，實際檔案／契約以 LINE_API 與本機驗證紀錄為準。真實 LINE／全支付、PostgreSQL 正式訂單與公網部署尚未完成。

> 2026-10-01 目錄決定：LIFF 顧客網頁與測試位於並列的 ManyFishLINE/web/liff/；共用雲端實作仍位於 ManyFishPOSAndroid/cloud/，Android 收件匣仍位於 ManyFishPOSAndroid/app/。文中的相對程式路徑以各自所屬專案為根目錄。此副本是 LINE 專案規劃入口；Android 原文件保留供整合參考。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This workspace is not a Git repository, so commit steps do not apply.

**Goal:** Build a locally testable ManyFish customer-order API that creates one formal LIFF takeaway order and exposes payment, production and change-feed states without real credentials.

**Architecture:** Add a separate `cloud/liff_orders` package beside the existing Uber webhook module. Use Python standard-library WSGI and SQLite for a local contract slice; isolate pricing, state transitions, identity verification and persistence so the later public cloud can replace the database adapter without changing client JSON.

**Tech Stack:** Python 3.13 standard library, `unittest`, SQLite; synthetic catalog and payment data only.

**Spec:** [LINE LIFF 外帶點餐與 ManyFish POS 串接規格](../specs/2026-09-26-line-liff-ordering-design.md)

## Global Constraints

- Use `LINE_LIFF` as the order source; Uber Eats manual acceptance logic does not apply.
- Keep TWD in integer `amountMinor` with scale 2; calculate every price on the server from a published menu version.
- A submitted order is formal immediately. Online payment enters production only after a trusted success result; onsite payment enters production immediately.
- A repeated `clientOrderKey` with changed content returns conflict. At most one canonical paid receipt may belong to an order; preserve any additional actual charge evidence separately as a payment exception.
- Do not expose this local WSGI service publicly or put real LINE／全支付 tokens in source, tests, fixtures or logs.
- Keep existing `cloud/uber_eats` behavior and Android demo unchanged.

## Review Focus

1. A forged client total or unavailable product must be rejected or repriced from the published menu; Task 1 tests both.
2. Same `clientOrderKey` with a changed basket or payment choice must return conflict; Task 2 tests both.
3. Duplicate payment success and an unknown payment result must not double-pay or queue an unpaid order; Task 3 tests both.
4. A token for another LINE channel or another customer's order must fail; Tasks 4 and 5 test both.
5. A POS that loses a change-feed response must reread the same event with the same cursor; Task 5 tests this.

## File Structure

| File | Responsibility |
| --- | --- |
| `cloud/liff_orders/pricing.py` | Validate one published catalog and compute immutable line snapshots. |
| `cloud/liff_orders/store.py` | SQLite schema, transactional idempotent order, payment and change-log writes. |
| `cloud/liff_orders/service.py` | Domain state transitions and provider-independent payment result handling. |
| `cloud/liff_orders/identity.py` | LINE ID-token verification boundary and local fake verifier. |
| `cloud/liff_orders/wsgi.py` | Customer and POS HTTP contract, cookie／CSRF and error mapping. |
| `cloud/tests/test_liff_*.py` | Contract and failure-mode tests with fictional IDs. |

### Task 1: Published-menu pricing

**Files:** Create `cloud/liff_orders/__init__.py`, `cloud/liff_orders/pricing.py`, `cloud/tests/test_liff_pricing.py`.

**Interfaces:** `price_order(catalog: dict, menu_version: str, lines: list[dict]) -> tuple[list[dict], int]`; raises `InvalidSelection` or `StaleMenu`. Each returned line has `productId`, `variantId`, `quantity`, `modifierIds`, `unitAmountMinor`, `lineAmountMinor`.

- [ ] **Step 1: Write failing tests.** Use a fictional menu with product `fish`, base variant `plain` at 6000 minor units, a six-choice flavor group with max 6 and per-flavor max 6. Assert two selected flavors are accepted; seven are rejected; an unavailable product is rejected; a supplied client `totalAmountMinor: 1` is ignored; a stale `menuVersion` raises `StaleMenu`.

```python
priced, total = price_order(menu, "menu-1", [{"productId": "fish", "variantId": "plain", "quantity": 1, "modifierIds": ["red", "milk"], "totalAmountMinor": 1}])
self.assertEqual(total, 6000)
self.assertEqual(priced[0]["modifierIds"], ["red", "milk"])
```

- [ ] **Step 2: Run red.** `python3 -m unittest cloud.tests.test_liff_pricing -v` must fail because `pricing.py` is absent.
- [ ] **Step 3: Implement.** Check catalog `published=True`, exact `menuVersion`, product/variant availability, quantity `1..99`, modifier membership and per-group maximum; allow short multi-flavor groups per current Android rule. Calculate `unitAmountMinor = variant.priceMinor + sum(modifier.priceDeltaMinor)` with integer arithmetic, then quantity total. Never copy client price fields into the returned snapshot.

```python
unit = variant["priceMinor"] + sum(option["priceDeltaMinor"] for option in resolved_options)
line_total = unit * requested_quantity
```

- [ ] **Step 4: Run green.** `python3 -m unittest cloud.tests.test_liff_pricing -v`; all Task 1 tests pass.

### Task 2: Formal order and transactionally durable change

**Files:** Create `cloud/liff_orders/store.py`, `cloud/tests/test_liff_store.py`.

**Interfaces:** `OrderStore(db_path).place_order(store_id: str, customer_id: str, client_order_key: str, request_hash: str, menu_version: str, pickup_name: str, payment_choice: str, priced_lines: list[dict], total_minor: int) -> dict`; `get_order(store_id: str, customer_id: str, order_id: str) -> dict | None`; `list_orders(store_id: str, customer_id: str) -> list[dict]`; `get_by_client_key(store_id: str, customer_id: str, client_order_key: str) -> dict | None`; `changes(store_id: str, after: int) -> list[dict]`.

- [ ] **Step 1: Write failing tests.** Place a fictional online order, assert `PLACED` + `AWAITING_ONLINE_PAYMENT` + `WAITING_PAYMENT` and one change entry; place it again with the same hash and assert the same `orderId`; place with the same key and another hash and assert `OrderConflict`; create an onsite order and assert `UNPAID_ONSITE` + `QUEUED`. `list_orders("store-1", "line-user-1")` excludes other customers and stores. Test same key across customers/stores, concurrent attempts, and two distinct successful transaction IDs for one order: one canonical receipt plus durable duplicate-charge evidence and an exception.

```python
first = store.place_order("store-1", "line-user-1", "key-1", "hash-1", "menu-1", "阿魚", "ONLINE", lines, 6000)
again = store.place_order("store-1", "line-user-1", "key-1", "hash-1", "menu-1", "阿魚", "ONLINE", lines, 6000)
self.assertEqual(first["orderId"], again["orderId"])
```

- [ ] **Step 2: Run red.** `python3 -m unittest cloud.tests.test_liff_store -v` fails on missing store.
- [ ] **Step 3: Implement.** Create `liff_orders`, `liff_order_lines`, `liff_payment_attempts`, `liff_payments`, `liff_order_changes` and `liff_customer_sessions`, `liff_provider_events` and `liff_payment_exceptions` tables. Provider events retain all verified charges independently of canonical receipts; enforce transaction identity there as well. Attempts use an `active` flag that remains true while results or termination are uncertain. Unique keys: `(store_id, customer_id, client_order_key)`, `(provider, provider_transaction_id)`, `(store_id, checkout_key)`. Use `BEGIN IMMEDIATE` around idempotency lookup, order+snapshot insert and change entry. Save canonical request hash and reject a matching key with a different hash. Use UUID for `order_id` and an independent store-local readable pickup number.

```sql
CREATE UNIQUE INDEX uq_liff_request ON liff_orders(store_id, customer_id, client_order_key);
CREATE UNIQUE INDEX uq_liff_payment ON liff_payments(provider, provider_transaction_id);
CREATE UNIQUE INDEX uq_liff_order_receipt ON liff_payments(order_id);
CREATE UNIQUE INDEX uq_liff_checkout ON liff_payments(store_id, checkout_key);
CREATE UNIQUE INDEX uq_liff_active_attempt ON liff_payment_attempts(order_id) WHERE active = 1;
CREATE INDEX ix_liff_changes ON liff_order_changes(store_id, sequence);
```

- [ ] **Step 4: Run green.** `python3 -m unittest cloud.tests.test_liff_store -v`; assert a database write exception rolls back both order and change entry.

### Task 3: Payment and production transitions

**Files:** Create `cloud/liff_orders/service.py`, `cloud/liff_orders/payment.py`, `cloud/tests/test_liff_payment.py`.

**Interfaces:** `OrderService(store, catalog_source).place(customer_id: str, request: dict) -> dict`; `apply_provider_result(order_id: str, attempt_key: str, provider_transaction_id: str, amount_minor: int, result: str) -> dict`; `record_onsite_payment(order_id: str, checkout_key: str, amount_minor: int, method: str) -> dict`; `set_production(order_id: str, expected_revision: int, command_id: str, state: str) -> dict`; `request_cancel(order_id: str, expected_revision: int, command_id: str) -> dict`; `reconcile_cancel(order_id: str) -> dict`. `PaymentProvider` defines `createAttempt`, `verifyReturnOrNotification`, `queryTransaction` and optional capability-aware `terminateAttempt` as in the approved spec; `FakePaymentProvider` supplies test results.

- [ ] **Step 1: Write failing tests.** A matching provider `SUCCESS` moves online order to `PAID_ONLINE` + `QUEUED` once. Duplicate success returns same receipt; wrong amount or unknown result leaves `PAYMENT_UNCERTAIN` and `WAITING_PAYMENT`; a verified terminal `FAILED` with proof that no later debit can occur moves to `PAYMENT_FAILED` and allows a new attempt on the same order. A closed page or nonterminal failure does not. Onsite cash payment becomes `PAID_ONSITE` once. An online paid order rejects onsite payment; two production commands with stale revision cannot both win. Cancellation rejects confirmed paid orders; uncertain attempts may enter `CANCEL_PENDING` but cannot finish cancellation. Cover paid→late FAILED/UNKNOWN, old-attempt failure after a new attempt, duplicate success during PREPARING, two simultaneous attempts/charges, cancel→late success, and unpaid onsite pickup rejection.

```python
paid = service.apply_provider_result(order_id, "attempt-1", "txn-1", 6000, "SUCCESS")
self.assertEqual((paid["paymentState"], paid["productionState"]), ("PAID_ONLINE", "QUEUED"))
```

- [ ] **Step 2: Run red.** `python3 -m unittest cloud.tests.test_liff_payment -v` fails on missing service.
- [ ] **Step 3: Implement.** Use one DB transaction for verified event evidence, attempt update, canonical receipt, order state, exception and change entry. Every service operation receives trusted store authorization; provider results must match persisted store, order, attempt, transaction and amount. Never hold a database transaction across provider calls. Use these transition rules:

| Input / existing state | Required result |
| --- | --- |
| First matching SUCCESS on PLACED | Insert the single canonical receipt, mark PAID_ONLINE, move only WAITING_PAYMENT to QUEUED. |
| Same SUCCESS replay, including PREPARING/READY_FOR_PICKUP | Return original receipt; preserve production. |
| FAILED/UNKNOWN after a canonical paid receipt | Preserve paid and production state; retain event history, flag contradictions as exceptions. |
| UNKNOWN or amount mismatch before payment | PAYMENT_UNCERTAIN; no queue or new attempt. |
| Terminal FAILED on current attempt with no-further-debit proof | PAYMENT_FAILED; release active attempt slot, allow a later attempt on same order. |
| Old-attempt FAILED | Update historical attempt only; never overwrite current order payment state. |
| Different successful transaction for an already paid order | Preserve all charge evidence; create paymentException, keep one canonical receipt; no queue reset. |
| SUCCESS during CANCEL_PENDING or after CANCELED | Preserve charge evidence and paymentException; record PAID_ONLINE and the canonical receipt if this is the first matching charge, keep cancellation state, require manual fulfillment/refund review, no automatic queue/reopen. |

Attempt creation reserves the single active slot transactionally before calling the provider with a stable attempt key. Timeout keeps the slot occupied and retries/queries that same attempt. A slot is released only on success or verified terminal no-further-debit failure/termination; paid orders cannot create attempts. Onsite CASH and ELECTRONIC_STAFF_CONFIRMED require PLACED, UNPAID_ONSITE, no active online attempt or payment exception, exact amount, unique checkout key and the same order-level receipt constraint.

Cancellation records CANCEL_PENDING and stable command ID in a short revision-checked transaction, performs provider query/termination outside it, then reconciles against the latest revision. Only no-attempt orders or all attempts with verified no-further-debit termination may become CANCELED. If the provider cannot prove termination, remain pending. A stale response never overwrites a newer receipt; late charge evidence creates an exception. Test query-unpaid→provider-success before finalization and success arriving after cancellation.

Production commands compare expected_revision and store (order_id, command_id) results; permit QUEUED→PREPARING→READY_FOR_PICKUP→PICKED_UP only for PLACED without paymentException. The final transition also requires PAID_ONLINE/PAID_ONSITE and the canonical receipt in the same transaction; it sets COMPLETED atomically. Test concurrent onsite receipt/pickup: either pickup rejects and is retried from fresh state, or completes with committed payment; never unpaid completion.

Recovery lookup and POST replay authenticate and scope the key before new-order menu/availability checks. Compare canonical original request hash before repricing: matching committed requests return the original snapshot even after menu publication or ordering pause; changed requests return conflict. Only a missing key proceeds to fresh pricing and the transactional insert/recheck.

```python
# Contract example: duplicate success must not rewind production.
service.set_production(order_id, paid["revision"], "prepare-1", "PREPARING")
again = service.apply_provider_result(order_id, "attempt-1", "txn-1", 6000, "SUCCESS")
self.assertEqual(again["productionState"], "PREPARING")
```

- [ ] **Step 4: Run green.** `python3 -m unittest cloud.tests.test_liff_payment -v`; verify payment and production changes share the same commit boundary. Persist cancellation intent and reconciliation work durably; a local worker resumes pending cancellations after restart and retries outside transactions with the same operation key. Test restart after intent and after provider response loss, including an indefinitely unsupported termination capability.

### Task 4: Verified LINE identity boundary

**Files:** Create `cloud/liff_orders/identity.py`, `cloud/tests/test_liff_identity.py`.

**Interfaces:** `LineIdentityVerifier(channel_id: str, transport).verify(id_token: str) -> str`; `FakeIdentityVerifier(mapping: dict[str,str]).verify(id_token: str) -> str`. `transport` posts only to the configured LINE Verify ID token endpoint.

- [ ] **Step 1: Write failing tests.** Stub the LINE verification HTTP response and assert valid `aud`, future `exp`, nonempty `sub` yields customer ID; wrong `aud`, expired `exp`, missing `sub`, or network failure raises `IdentityRejected` and cannot create a session.

```python
response = {"aud": "channel-1", "sub": "Ufictional", "exp": 2000000000}
self.assertEqual(verifier.verify("fictional-token"), "Ufictional")
```

- [ ] **Step 2: Run red.** `python3 -m unittest cloud.tests.test_liff_identity -v` fails on missing identity module.
- [ ] **Step 3: Implement.** POST raw `id_token` and configured `client_id` to LINE's `/oauth2/v2.1/verify`; parse response, compare `aud`, require `exp > now`, nonempty `sub`, and reject failures closed. Do not log or echo the token. The fake verifier is injectable only in local/test startup.

```python
if claims.get("aud") != self.channel_id or claims.get("exp", 0) <= now or not claims.get("sub"):
    raise IdentityRejected()
return claims["sub"]
```

- [ ] **Step 4: Run green.** `python3 -m unittest cloud.tests.test_liff_identity -v` passes without calling real LINE.

### Task 5: HTTP contract and POS change feed

**Files:** Create `cloud/liff_orders/wsgi.py`, `cloud/tests/test_liff_wsgi.py`; update `cloud/README.md` with local-only usage.

**Interfaces:** `LiffOrderApp(store, service, identity_verifier, device_verifier, admin_verifier)` WSGI callable. Routes: `POST /v1/customer/sessions`, `GET /v1/customer/menu`, `POST /v1/customer/orders`, `GET /v1/customer/orders`, `GET /v1/customer/orders/{id}`, `GET /v1/customer/orders/by-client-key/{clientOrderKey}`, `POST /v1/admin/orders/{id}/cancel`, `GET /v1/changes?cursor=N`, `GET /v1/orders/{id}`, `POST /v1/orders/{id}/production`, `POST /v1/orders/{id}/onsite-payment`.

- [ ] **Step 1: Write failing WSGI tests.** After `POST /v1/customer/sessions` with fictional ID token, assert secure HttpOnly session cookie and CSRF token. `POST /v1/customer/orders` with cookie but missing `X-CSRF-Token` returns 403. Customer A cannot GET or list customer B's order. A request body `storeId` cannot override the server-side store selected for the LIFF endpoint. When the trusted store flag is `liffEnabled=false`, a new order POST is rejected before a DB write; replay of an already committed identical request still returns that order. Test committed POST→lost response→new menu→lookup/replay returns the original order. Key lookup returns 200 for a scoped committed order, 404 ORDER_NOT_FOUND when none is committed in that scope, 401 when unauthenticated, and 5xx on lookup failure; other customers/stores cannot discover it. A 404 does not authorize a fresh key. Admin cancellation requires store-scoped admin authorization; customer/device credentials cannot use it. Device A scoped to store 1 cannot read store 2's changes or order detail. `GET /v1/changes?cursor=0` twice returns the same ordered events until cursor advances.

```python
status, body = call(app, "GET", "/v1/changes?cursor=0", device="device-store-1")
self.assertEqual(status, 200)
self.assertEqual(body["events"][0]["source"], "LINE_LIFF")
```

- [ ] **Step 2: Run red.** `python3 -m unittest cloud.tests.test_liff_wsgi -v` fails on missing WSGI module.
- [ ] **Step 3: Implement.** Parse bounded JSON (64 KiB max), require session and `X-CSRF-Token` on customer mutations, derive `storeId` and `liffEnabled` from trusted endpoint configuration, and require store-scoped device verifier on POS routes and a separate store-scoped admin verifier on cancellation. Route by-client-key before the generic order-ID route. The session response also returns recoveryScope={environmentId, storeId, ownerRef}; ownerRef is opaque, stable for the same customer/store across reauthentication, changes for another customer, and grants no authorization. Return orderState, paymentException and storeId in order snapshots; feed envelopes include storeId for scope validation. Map invalid selection/stale menu to 400/409, paused ordering to 503, and idempotency conflict to 409. Issue random opaque session ID and CSRF token; store only hashes with expiry. Set cookie `Secure; HttpOnly; SameSite=Lax; Path=/`. Return `nextCursor` only with committed changes; no event disappears on response loss.

```python
headers = [("Set-Cookie", f"mf_session={session_id}; Secure; HttpOnly; SameSite=Lax; Path=/")]
return json_response(200, {"csrfToken": csrf_token, "recoveryScope": recovery_scope}, headers)
```

- [ ] **Step 4: Run green.** `python3 -m unittest cloud.tests.test_liff_wsgi -v` passes. Run `python3 -m unittest discover -s cloud/tests -v`; existing Uber webhook tests remain green. The local runner binds `127.0.0.1` only and uses fictional data.

## Handoff to next plans

The local API contract is now fixed for [customer web](2026-09-26-line-liff-customer-web.md) and [POS inbox](2026-09-26-line-liff-pos-inbox.md). This plan does **not** turn on online payment or establish a production database. Public release requires a hosted transactional database, HTTPS, real device authorization, actual LINE channel and the separate 全支付 merchant integration gate in the [rollout](2026-09-26-line-liff-rollout.md).

> 架構相容要求：實作前遵循規格的「現有架構相容約束」；沿用已存在的 connected／IDoo、Android 分層、Room 舊資料與 Python 雲端，新增通路不得覆蓋既有功能。

## 2026-10-01 預約取餐增補（優先於原介面範例）

本增補待本次規格審閱；原計畫仍未實作。遵循規格的「預約取餐」章節，不加入容量限制。

- [ ] 新增店家預約設定及版本：advanceDays、storeTimeZone、weeklyWindows、slotIntervalMinutes、minimumLeadMinutes、closedDates；以 store-scoped 管理者授權讀取／發布，expectedVersion 防止覆蓋。明確提供 GET/PUT /v1/admin/pickup-schedule，發布成功回新版本。
- [ ] 新增 GET /v1/customer/pickup-slots，以伺服器時鐘及店家時區產生可選時段，回 serverNow、storeTimeZone、scheduleVersion、slots。測試日曆日界線、多段時窗、間隔、休店日及提前時間等號邊界。
- [ ] place_order／place 接收 pickupAt、scheduleVersion；防重雜湊包含兩者。先恢復已提交原單，再驗證新單時段；設定發布與下單在交易中協調。映射 PICKUP_SCHEDULE_CHANGED／PICKUP_SLOT_UNAVAILABLE 為 409。
- [ ] 訂單持久化 pickupAt UTC、pickupTimeZone、pickupScheduleVersion；所有查單、回覆與變更事件帶此快照。現有範例需加預約欄位，不以目前時間自動補值。
- [ ] 測試同時多單同時段均成功、防重換時段衝突、設定並發、提交後跨日／停用仍可恢復、修改設定不改舊單。付款成功不受時間自動排程限制，不引入自動取消。

管理 API 與顧客／POS API 在此階段可先以本機虛構資料驗證；實際後台管理畫面仍需另列工作，正式開放前必須可操作並驗收。
