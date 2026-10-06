import { displayOrderStatus } from "./state.mjs";
export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export const money = (amount) =>
  new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 2,
  }).format(amount / 100);
export function pickupLabel(order) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: order.pickupTimeZone ?? "Asia/Taipei",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(order.pickupAt));
}
export function orderCard(order) {
  const card = element("article", undefined, "panel order-card");
  const status = displayOrderStatus(order);
  const heading = element("div", undefined, "section-heading");
  heading.append(
    element("h3", `取餐號碼 ${order.readableNumber}`),
    element("span", status.productionLabel, "badge"),
  );
  card.append(
    heading,
    element("p", `預約 ${pickupLabel(order)}`, "pickup"),
    element("p", `取餐姓名：${order.pickupName}`, "muted"),
  );
  if (order.pickupPhone) card.append(element("p", `聯絡電話：${order.pickupPhone}`, "muted"));
  const list = element("ul");
  for (const line of order.lines ?? []) {
    const names = (line.modifiers ?? [])
      .map((m) => `${m.name} ×${m.quantity}`)
      .join("、");
    list.append(
      element(
        "li",
        `${line.productName} · ${line.variantName} ×${line.quantity}${names ? `（${names}）` : ""} — ${money(line.lineAmountMinor)}`,
      ),
    );
  }
  card.append(
    list,
    element(
      "p",
      `${status.paymentLabel} · 合計 ${money(order.totalAmountMinor)}`,
      "order-total",
    ),
  );
  if (status.exceptionLabel)
    card.append(element("p", status.exceptionLabel, "error"));
  if (
    !["COMPLETED", "CANCELED"].includes(order.orderState) &&
    Date.parse(order.pickupAt) < Date.now()
  )
    card.append(
      element("p", "預約取餐時間已過，若尚未取餐請聯絡店家。", "notice"),
    );
  return card;
}
export const errorMessage = (e) =>
  ({
    STALE_MENU: "菜單已更新，購物車已保留。請核對餐點後再次送出。",
    PICKUP_SCHEDULE_CHANGED: "預約設定已更新，請重新選擇取餐日期與時段。",
    PICKUP_SLOT_UNAVAILABLE: "這個取餐時段已不可選，請重新選擇。",
    ORDERING_PAUSED: "店家暫停接單，請稍後再試。",
    INVALID_SELECTION: "餐點或口味選擇不符店家規則，請調整購物車。",
    ONLINE_PAYMENT_UNAVAILABLE: "線上付款尚未開放，請使用到店付款。",
    ORDER_CONFLICT:
      "這筆訂單需要確認，請聯絡店家，暫時不要重新下單。",
    UNAUTHORIZED: "登入已失效，請重新登入後確認原訂單。",
    FORBIDDEN: "目前無法完成操作，請重新登入後再試。",
    REVISION_CONFLICT: "店家設定已更新，請重新整理後再試。",
    INVALID_REQUEST: "資料格式不正確，請確認輸入。",
    STORAGE_UNAVAILABLE: "服務暫時無法儲存，請稍後查詢原訂單。",
  })[e.code] ??
  (!e.code && typeof e.message === "string" && /[\u3400-\u9fff]/.test(e.message) ? e.message : "目前無法完成操作，請稍後再試；若剛送出訂單，請先到「我的訂單」確認。");

export function pickupTimeLabel(pickupAt, timeZone = "Asia/Taipei") {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(pickupAt));
}
