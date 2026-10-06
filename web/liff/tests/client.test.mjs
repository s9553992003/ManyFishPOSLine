import test from "node:test";
import assert from "node:assert/strict";
import { CustomerApi, AdminApi, ApiError } from "../api.mjs";
import { startLineSession } from "../line-session.mjs";
import {
  addSelection,
  buildOrderRequest,
  remainingFlavors,
  isAvailable,
  restoreDraft,
} from "../basket.mjs";
import {
  PendingOrder,
  displayOrderStatus,
  groupSlots,
  parseSchedule,
} from "../state.mjs";

const scope = {
  environmentId: "local",
  storeId: "shop",
  ownerRef: "opaque-owner",
};
const response = (data, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
const memory = () => {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
};
const product = {
  id: "p",
  name: "魚餅",
  available: true,
  variants: [{ id: "v", name: "六入", priceMinor: 12000, isDefault: true }],
  modifierGroupIds: ["g"],
};
const groups = [
  {
    id: "g",
    name: "口味",
    minSelected: 6,
    maxSelected: 6,
    modifiers: [
      { id: "red", name: "紅豆", maxQuantity: 6, priceDeltaMinor: 0 },
      { id: "milk", name: "奶油", maxQuantity: 3, priceDeltaMinor: 500 },
    ],
  },
];
const request = {
  menuVersion: "v1",
  pickupName: "阿魚",
  pickupPhone: "0912345678",
  paymentChoice: "ONSITE",
  pickupAt: "2026-10-02T04:00:00Z",
  scheduleVersion: 1,
  lines: [
    { productId: "p", variantId: "v", quantity: 1, modifierIds: ["red"] },
  ],
};

test("LIFF exchanges raw ID token once and redirects an external logged-out client", async () => {
  const calls = [];
  await startLineSession(
    {
      init: async (x) => calls.push(x),
      isLoggedIn: () => true,
      getIDToken: () => "fictional-token",
    },
    { openSession: async (token) => calls.push(token) },
    "fictional-id",
  );
  assert.deepEqual(calls, [{ liffId: "fictional-id" }, "fictional-token"]);
  let login = 0,
    exchanges = 0;
  const result = await startLineSession(
    { init: async () => {}, isLoggedIn: () => false, login: () => login++ },
    { openSession: async () => exchanges++ },
    "id",
  );
  assert.equal(result, null);
  assert.equal(login, 1);
  assert.equal(exchanges, 0);
});
test("missing LIFF token rejects without creating session", async () => {
  await assert.rejects(
    startLineSession(
      { init: async () => {}, isLoggedIn: () => true, getIDToken: () => null },
      { openSession: async () => assert.fail() },
      "id",
    ),
    /ID token/,
  );
});
test("API uses same-origin credentials, mutation-only CSRF and server error codes", async () => {
  const calls = [];
  const api = new CustomerApi(async (url, options) => {
    calls.push([url, options]);
    return response(
      url.endsWith("sessions")
        ? { csrfToken: "csrf", recoveryScope: scope }
        : url.endsWith("orders")
          ? { error: "STALE_MENU" }
          : { slots: [] },
      url.endsWith("orders") ? 409 : 200,
    );
  });
  await api.openSession("local-customer");
  await api.pickupSlots();
  await assert.rejects(
    api.placeOrder(request, "same-key"),
    (e) => e instanceof ApiError && e.code === "STALE_MENU",
  );
  assert.equal(calls[1][0], "/v1/customer/pickup-slots");
  assert.equal(calls[1][1].headers["X-CSRF-Token"], undefined);
  assert.equal(calls[2][1].headers["X-CSRF-Token"], "csrf");
  assert.equal(calls[2][1].credentials, "same-origin");
  assert.equal(JSON.parse(calls[2][1].body).clientOrderKey, "same-key");
});
test("basket requires full flavors and enforces group/modifier/single-choice limits", () => {
  assert.equal(remainingFlavors(groups[0], ["red", "milk"]), 4);
  assert.throws(() => addSelection([], product, "v", ["red", "milk"], 2, groups));
  const basket = addSelection([], product, "v", ["red", "red", "red", "red", "red", "milk"], 2, groups);
  assert.equal(basket[0].estimatedAmountMinor, 25000);
  assert.throws(() =>
    addSelection([], product, "v", Array(7).fill("red"), 1, groups),
  );
  assert.throws(() =>
    addSelection([], product, "v", Array(4).fill("milk"), 1, groups),
  );
  assert.throws(() => addSelection([], product, "v", [], 0, groups));
  assert.throws(() =>
    addSelection([], product, "v", [], 1, [
      { ...groups[0], minSelected: 1, maxSelected: 1 },
    ]),
  );
  const built = buildOrderRequest(
    basket,
    "v1",
    "ONSITE",
    " 阿魚 ",
    request.pickupAt,
    1,
    "0912345678",
  );
  assert.deepEqual(built.lines, [
    {
      productId: "p",
      variantId: "v",
      quantity: 2,
      modifierIds: ["red", "red", "red", "red", "red", "milk"],
    },
  ]);
  assert.equal(built.pickupName, "阿魚");
  assert.equal(built.totalAmountMinor, undefined);
  assert.throws(() => buildOrderRequest(basket, "v1", "ONSITE", "阿魚", "", 1));
});
test("Android menu active flag permits ordering and explicit inactive flag prevents it", () => {
  const { available, ...androidProduct } = product;
  assert.equal(isAvailable({ ...androidProduct, active: true }), true);
  assert.equal(
    addSelection([], { ...androidProduct, active: true }, "v", Array(6).fill("red"), 1, groups)
      .length,
    1,
  );
  assert.equal(isAvailable({ ...androidProduct, active: false }), false);
  assert.throws(() =>
    addSelection([], { ...androidProduct, active: false }, "v", [], 1, groups),
  );
});
test("minimum one in a two-choice group stays required", () => {
  const required = [{ ...groups[0], minSelected: 1, maxSelected: 2 }];
  assert.throws(() => addSelection([], product, "v", [], 1, required));
  assert.equal(addSelection([], product, "v", ["red"], 1, required).length, 1);
});
test("recovery retains immutable original request and same key after reload and scoped 404", async () => {
  const storage = memory(),
    pending = new PendingOrder(storage);
  pending.setScope(scope);
  pending.begin(request, "key-1");
  request.pickupName = "changed";
  const restored = new PendingOrder(storage);
  restored.setScope({ ...scope });
  let sent;
  const api = {
    orderByClientKey: async () => {
      throw new ApiError(404, "ORDER_NOT_FOUND");
    },
    placeOrder: async (body, key) => {
      sent = { body, key };
      return { orderId: "saved" };
    },
  };
  assert.equal((await restored.lookup(api)).state, "retryable");
  await restored.retry(api);
  assert.equal(sent.key, "key-1");
  assert.equal(sent.body.pickupName, "阿魚");
  assert.equal(sent.body.pickupAt, "2026-10-02T04:00:00Z");
  assert.equal(restored.record, null);
  assert.equal(storage.getItem("manyfish.pending-order"), null);
});
test("unknown outcomes preserve pending; scope switch erases without replay", async () => {
  const storage = memory(),
    pending = new PendingOrder(storage);
  pending.setScope(scope);
  pending.begin({ ...request, pickupName: "阿魚" }, "key");
  assert.equal(
    (
      await pending.lookup({
        orderByClientKey: async () => {
          throw new Error("network");
        },
      })
    ).state,
    "unknown",
  );
  assert.ok(pending.record);
  pending.setScope({ ...scope, ownerRef: "other" });
  assert.equal(pending.record, null);
});
test("401 recovery requires authentication and key conflict stays unresolved", async () => {
  const pending = new PendingOrder(memory());
  pending.setScope(scope);
  pending.begin(request, "key");
  assert.equal(
    (
      await pending.lookup({
        orderByClientKey: async () => {
          throw new ApiError(401, "UNAUTHORIZED");
        },
      })
    ).state,
    "unauthorized",
  );
  await assert.rejects(
    pending.retry({
      placeOrder: async () => {
        throw new ApiError(409, "ORDER_CONFLICT");
      },
    }),
  );
  assert.ok(pending.record);
});
test("committed key lookup restores order before changed menu and schedule matter", async () => {
  const pending = new PendingOrder(memory());
  pending.setScope(scope);
  pending.begin(request, "key");
  const result = await pending.lookup({
    orderByClientKey: async () => ({
      orderId: "original",
      menuVersion: "old",
      pickupScheduleVersion: 1,
    }),
  });
  assert.equal(result.order.orderId, "original");
  assert.equal(pending.record, null);
});
test("double submission shares in-flight promise and one original key", async () => {
  const pending = new PendingOrder(memory());
  pending.setScope(scope);
  pending.begin(request, "key");
  let count = 0,
    finish;
  const api = {
    placeOrder: () => {
      count++;
      return new Promise((resolve) => (finish = resolve));
    },
  };
  const a = pending.retry(api),
    b = pending.retry(api);
  finish({ orderId: "one" });
  assert.equal((await a).orderId, "one");
  assert.equal((await b).orderId, "one");
  assert.equal(count, 1);
});
test("a late recovery reply cannot restore an order from the previous account", async () => {
  const pending = new PendingOrder(memory());
  pending.setScope(scope);
  pending.begin(request, "key");
  let finish;
  const resolving = pending.lookup({
    orderByClientKey: () => new Promise((resolve) => (finish = resolve)),
  });
  pending.setScope({ ...scope, ownerRef: "new-owner" });
  finish({ orderId: "old-account" });
  assert.equal((await resolving).state, "scope-changed");
  assert.equal(pending.record, null);
});
test("a late submit reply cannot clear a new account pending request", async () => {
  const pending = new PendingOrder(memory());
  pending.setScope(scope);
  pending.begin(request, "old");
  let finish;
  const resolving = pending.retry({
    placeOrder: () => new Promise((resolve) => (finish = resolve)),
  });
  pending.setScope({ ...scope, ownerRef: "new-owner" });
  pending.begin(request, "new");
  finish({ orderId: "old-account" });
  await assert.rejects(resolving, /登入範圍/);
  assert.equal(pending.record.clientOrderKey, "new");
});
test("a delayed lookup of A cannot clear newer B in the same account", async () => {
  const storage = memory();
  const pending = new PendingOrder(storage);
  pending.setScope(scope);
  pending.begin(request, "A");
  let finish;
  const lookupA = pending.lookup({
    orderByClientKey: () => new Promise((resolve) => (finish = resolve)),
  });
  await pending.retry({ placeOrder: async () => ({ orderId: "A-order" }) });
  pending.begin(request, "B");
  finish({ orderId: "A-order" });
  assert.equal((await lookupA).state, "scope-changed");
  assert.equal(pending.record.clientOrderKey, "B");
  assert.equal(
    JSON.parse(storage.getItem("manyfish.pending-order")).clientOrderKey,
    "B",
  );
});
test("a lookup-resolved A releases its in-flight POST without affecting newer B", async () => {
  const pending = new PendingOrder(memory());
  pending.setScope(scope);
  pending.begin(request, "A");
  let finishA;
  const submitA = pending.retry({
    placeOrder: () => new Promise((resolve) => (finishA = resolve)),
  });
  await pending.lookup({
    orderByClientKey: async () => ({ orderId: "A-order" }),
  });
  pending.begin(request, "B");
  let submittedB = false;
  const submitB = pending.retry({
    placeOrder: async (body, key) => {
      submittedB = true;
      return { orderId: key };
    },
  });
  assert.equal(submittedB, true);
  assert.equal((await submitB).orderId, "B");
  finishA({ orderId: "A-order" });
  await assert.rejects(submitA, /登入範圍|待確認訂單/);
});
test("an old rejected POST cannot expose a definitive rejection for a newer record", async () => {
  const pending = new PendingOrder(memory());
  pending.setScope(scope);
  pending.begin(request, "A");
  let rejectA;
  const submitA = pending.retry({
    placeOrder: () => new Promise((resolve, reject) => (rejectA = reject)),
  });
  await pending.lookup({
    orderByClientKey: async () => ({ orderId: "A-order" }),
  });
  pending.begin(request, "B");
  rejectA(new ApiError(409, "STALE_MENU"));
  await assert.rejects(submitA, (error) => !(error instanceof ApiError));
  assert.equal(pending.record.clientOrderKey, "B");
});
test("status trusts server payment and suppresses production actions for cancellation/exception", () => {
  assert.equal(
    displayOrderStatus({
      paymentState: "PAYMENT_UNCERTAIN",
      productionState: "WAITING_PAYMENT",
    }).paymentLabel,
    "付款待確認",
  );
  assert.equal(
    displayOrderStatus({
      paymentState: "PAID_ONLINE",
      productionState: "PREPARING",
    }).productionLabel,
    "製作中",
  );
  assert.equal(
    displayOrderStatus({
      paymentState: "UNPAID_ONSITE",
      productionState: "QUEUED",
    }).paymentLabel,
    "到店付款",
  );
  for (const orderState of ["CANCEL_PENDING", "CANCELED", "COMPLETED"])
    assert.equal(
      displayOrderStatus({ orderState, paymentState: "PAID_ONLINE" })
        .canStartOnlinePayment,
      false,
    );
  assert.ok(
    displayOrderStatus({ paymentException: { code: "X" } }).exceptionLabel,
  );
});
test("slot grouping uses store timezone across UTC midnight and keeps server values", () => {
  const slots = [
    { pickupAt: "2026-10-01T16:30:00Z", label: "00:30" },
    { pickupAt: "2026-10-02T04:00:00Z", label: "12:00" },
  ];
  const result = groupSlots({ storeTimeZone: "Asia/Taipei", slots });
  assert.equal(result[0].date, "2026-10-02");
  assert.equal(result[0].slots[0].pickupAt, slots[0].pickupAt);
  assert.deepEqual(groupSlots({ slots: [] }), []);
});
test("admin validates week windows and sends version with in-memory Bearer", async () => {
  const schedule = parseSchedule(
    {
      advanceDays: "3",
      slotIntervalMinutes: "15",
      minimumLeadMinutes: "30",
      storeTimeZone: "Asia/Taipei",
      closedDates: "2026-10-10\n2026-10-11",
      windows: ["11:00-14:00, 17:00-20:00", "", "", "", "", "", ""],
    },
    7,
  );
  assert.deepEqual(schedule.weeklyWindows["0"], [
    ["11:00", "14:00"],
    ["17:00", "20:00"],
  ]);
  assert.equal(schedule.expectedVersion, 7);
  assert.throws(() =>
    parseSchedule(
      { ...schedule, windows: ["20:00-11:00", "", "", "", "", "", ""] },
      7,
    ),
  );
  let captured;
  const api = new AdminApi(async (url, options) => {
    captured = { url, options };
    return response(schedule);
  });
  api.setToken("local-admin");
  await api.saveSchedule(schedule);
  assert.equal(captured.options.headers.Authorization, "Bearer local-admin");
  assert.equal(JSON.parse(captured.options.body).expectedVersion, 7);
});
test("admin accepts adjacent windows and single point windows matching server endpoint rules", () => {
  const fields = {
    advanceDays: 1,
    slotIntervalMinutes: 30,
    minimumLeadMinutes: 527040,
    storeTimeZone: "Asia/Taipei",
    closedDates: "",
    windows: ["11:00-14:00, 14:00-20:00", "11:00-11:00", "", "", "", "", ""],
  };
  const schedule = parseSchedule(fields, 1);
  assert.deepEqual(schedule.weeklyWindows["0"], [
    ["11:00", "14:00"],
    ["14:00", "20:00"],
  ]);
  assert.deepEqual(schedule.weeklyWindows["1"], [["11:00", "11:00"]]);
  assert.equal(schedule.minimumLeadMinutes, 527040);
});
test("reload then definite slot rejection restores original cart/name before new submission", async () => {
  const store = memory(),
    first = new PendingOrder(store);
  first.setScope(scope);
  first.begin({ ...request, pickupName: "原取餐姓名" }, "key");
  const restored = new PendingOrder(store);
  restored.setScope(scope);
  await restored.lookup({
    orderByClientKey: async () => {
      throw new ApiError(404, "ORDER_NOT_FOUND");
    },
  });
  await assert.rejects(
    restored.retry({
      placeOrder: async () => {
        throw new ApiError(409, "PICKUP_SLOT_UNAVAILABLE");
      },
    }),
  );
  const draft = restoreDraft(restored.record.originalRequest, {
    products: [product],
    modifierGroups: groups,
  });
  restored.clear();
  assert.equal(draft.pickupName, "原取餐姓名");
  assert.equal(draft.basket.length, 1);
  assert.equal(draft.basket[0].productId, "p");
  assert.equal(draft.basket[0].quantity, 1);
  assert.deepEqual(draft.basket[0].modifierIds, ["red"]);
  assert.equal(draft.basket[0].estimatedAmountMinor, 12000);
});
test("restored removed products retain identity but have no invented price", () => {
  const draft = restoreDraft(request, { products: [], modifierGroups: [] });
  assert.equal(draft.basket[0].productId, "p");
  assert.equal(draft.basket[0].estimatedAmountMinor, null);
});
test("admin previews a draft schedule through POST without writing published settings", async () => {
  const draft = {
    expectedVersion: 8,
    advanceDays: 3,
    slotIntervalMinutes: 30,
    minimumLeadMinutes: 30,
    storeTimeZone: "Asia/Taipei",
    weeklyWindows: { 0: [["11:00", "20:00"]] },
    closedDates: [],
  };
  const sent = [];
  const api = new AdminApi(async (path, options) => {
    sent.push({ path, options });
    return response({
      draft: true,
      scheduleVersion: 8,
      storeTimeZone: "Asia/Taipei",
      slots: [],
    });
  });
  api.setToken("fictional-admin");
  const result = await api.previewSchedule(draft);
  assert.equal(result.draft, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, "/v1/admin/pickup-slots");
  assert.equal(sent[0].options.method, "POST");
  assert.equal(sent[0].options.headers.Authorization, "Bearer fictional-admin");
  assert.deepEqual(JSON.parse(sent[0].options.body), draft);
});
