import { ApiError } from "./api.mjs";
const storageKey = "manyfish.pending-order";
const sameScope = (a, b) =>
  a &&
  b &&
  ["environmentId", "storeId", "ownerRef"].every(
    (k) => typeof a[k] === "string" && a[k] === b[k],
  );
export class PendingOrder {
  constructor(storage) {
    this.storage = storage;
    this.record = null;
    this.inFlight = null;
    this.generation = 0;
  }
  setScope(scope) {
    this.generation++;
    this.inFlight = null;
    this.scope = scope;
    let record;
    try {
      record = JSON.parse(this.storage.getItem(storageKey));
    } catch {}
    this.record = sameScope(record?.scope, scope) ? record : null;
    if (!this.record) this.storage.removeItem(storageKey);
  }
  begin(originalRequest, clientOrderKey) {
    if (this.record) throw new Error("請先確認上一筆送單結果。");
    if (!this.scope) throw new Error("請先登入。");
    this.generation++;
    this.record = JSON.parse(
      JSON.stringify({ scope: this.scope, clientOrderKey, originalRequest }),
    );
    this.storage.setItem(storageKey, JSON.stringify(this.record));
  }
  clear() {
    this.generation++;
    this.inFlight = null;
    this.record = null;
    this.storage.removeItem(storageKey);
  }
  async lookup(api) {
    if (!this.record) return { state: "empty" };
    const generation = this.generation;
    const record = this.record;
    try {
      const order = await api.orderByClientKey(record.clientOrderKey);
      if (generation !== this.generation || record !== this.record)
        return { state: "scope-changed" };
      this.clear();
      return { state: "found", order };
    } catch (e) {
      if (generation !== this.generation || record !== this.record)
        return { state: "scope-changed" };
      if (e instanceof ApiError && e.status === 401)
        return { state: "unauthorized" };
      if (
        e instanceof ApiError &&
        e.status === 404 &&
        e.code === "ORDER_NOT_FOUND"
      )
        return { state: "retryable" };
      return { state: "unknown", error: e };
    }
  }
  retry(api) {
    if (this.inFlight) return this.inFlight;
    if (!this.record) return Promise.reject(new Error("沒有待確認訂單。"));
    const { originalRequest, clientOrderKey } = this.record;
    const record = this.record;
    const generation = this.generation;
    const flight = api
      .placeOrder(JSON.parse(JSON.stringify(originalRequest)), clientOrderKey)
      .then(
        (order) => {
          if (generation !== this.generation || record !== this.record)
            throw new Error("登入範圍或待確認訂單已變更，原回覆已忽略。");
          this.clear();
          return order;
        },
        (error) => {
          if (generation !== this.generation || record !== this.record)
            throw new Error("登入範圍或待確認訂單已變更，原回覆已忽略。");
          throw error;
        },
      )
      .finally(() => {
        if (this.inFlight === flight) this.inFlight = null;
      });
    this.inFlight = flight;
    return flight;
  }
}
export function displayOrderStatus(order) {
  const paymentLabel =
    {
      UNPAID_ONSITE: "到店付款",
      AWAITING_ONLINE_PAYMENT: "等待線上付款",
      PAYMENT_UNCERTAIN: "付款待確認",
      PAID_ONLINE: "已線上付款",
      PAID_ONSITE: "已到店付款",
      PAYMENT_FAILED: "付款未完成",
    }[order.paymentState] ?? "付款狀態待確認";
  const state = {
    CANCEL_PENDING: "取消待確認",
    CANCELED: "已取消",
    COMPLETED: "已完成",
  }[order.orderState];
  return {
    paymentLabel,
    productionLabel:
      state ??
      (order.paymentException
        ? "請聯絡店家"
        : ({
            WAITING_PAYMENT: "等待付款",
            QUEUED: "等待製作",
            PREPARING: "製作中",
            READY_FOR_PICKUP: "可以取餐",
            PICKED_UP: "已取餐",
          }[order.productionState] ?? "狀態待確認")),
    canStartOnlinePayment: false,
    exceptionLabel: order.paymentException
      ? "付款有異常，請聯絡店家確認。"
      : "",
  };
}
export function groupSlots({ slots = [], storeTimeZone = "Asia/Taipei" }) {
  const groups = new Map();
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: storeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  for (const slot of slots) {
    const parts = format.formatToParts(new Date(slot.pickupAt));
    const get = (type) => parts.find((p) => p.type === type).value;
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(slot);
  }
  return [...groups].map(([date, slots]) => ({ date, slots }));
}
export function parseSchedule(fields, expectedVersion) {
  const integer = (value, min, max) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error("請確認天數、時段間隔與提前時間。");
    return n;
  };
  const weeklyWindows = {};
  for (let i = 0; i < 7; i++) {
    weeklyWindows[String(i)] = (fields.windows[i] ?? "")
      .split(",")
      .filter((x) => x.trim())
      .map((value) => {
        const pair = value
          .trim()
          .split("-")
          .map((x) => x.trim());
        if (
          pair.length !== 2 ||
          pair.some((x) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(x)) ||
          pair[0] > pair[1]
        )
          throw new Error(
            "時段格式應為 11:00-14:00，同日開始時間不可晚於結束時間。",
          );
        return pair;
      });
    const windows = weeklyWindows[String(i)].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    if (windows.some((w, j) => j > 0 && windows[j - 1][1] > w[0]))
      throw new Error("同一天的時段不可重疊。");
  }
  const closedDates = Array.isArray(fields.closedDates)
    ? fields.closedDates
    : fields.closedDates
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
  if (
    closedDates.some(
      (d) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d,
    )
  )
    throw new Error("休店日期格式應為 YYYY-MM-DD。");
  return {
    expectedVersion,
    advanceDays: integer(fields.advanceDays, 0, 365),
    slotIntervalMinutes: integer(fields.slotIntervalMinutes, 1, 1440),
    minimumLeadMinutes: integer(fields.minimumLeadMinutes, 0, 527040),
    storeTimeZone: fields.storeTimeZone,
    weeklyWindows,
    closedDates: [...new Set(closedDates)],
  };
}
