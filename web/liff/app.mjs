import { CustomerApi, ApiError } from "./api.mjs";
import { startLineSession, loadLiff } from "./line-session.mjs";
import {
  addSelection,
  buildOrderRequest,
  remainingFlavors,
  isAvailable,
  visibleMenu,
  restoreDraft,
} from "./basket.mjs";
import { restorePrevious, contactDefaults } from "./customer-memory.mjs";
import { PendingOrder, groupSlots } from "./state.mjs";
import { element, money, orderCard, errorMessage, pickupTimeLabel } from "./ui.mjs";
const $ = (id) => document.getElementById(id);
const api = new CustomerApi();
const pending = new PendingOrder(sessionStorage);
let config,
  menu,
  slotData,
  basket = [],
  categoryId,
  selectedProduct,
  selectedVariant,
  modifierIds = [],
  activeScope = null,
  authenticating = false,
  signedIn = false,
  busy = false;
function status(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
function action(node, fn) {
  node.addEventListener("click", () =>
    Promise.resolve()
      .then(fn)
      .catch((e) => status(errorMessage(e), true)),
  );
}
function updateSubmit() {
  $("lookup").disabled = busy;
  $("retry").disabled = busy;
  $("login").disabled = busy;
  const disabled = busy || !!pending.record;
  $("submit").disabled =
    disabled || !signedIn || !basket.length || !$("pickup-time").value;
  $("checkout-form")
    .querySelectorAll("input,select")
    .forEach((node) => (node.disabled = disabled || node.value === "ONLINE"));
  $("products")
    .querySelectorAll("button")
    .forEach(
      (node) =>
        (node.disabled = disabled || node.dataset.unavailable === "true"),
    );
}
function renderBasket() {
  const list = $("basket");
  list.replaceChildren();
  if (!basket.length)
    list.append(element("p", "還沒有餐點。選一份喜歡的口味吧！", "empty"));
  basket.forEach((line, i) => {
    const item = element("div", undefined, "basket-line");
    const description = element("div");
    description.append(
      element("strong", `${line.productName} ×${line.quantity}`),
      element("small", [line.variantName, ...line.modifierNames].join(" · ")),
    );
    const remove = element("button", "移除", "text-button");
    remove.type = "button";
    remove.disabled = busy || !!pending.record;
    remove.addEventListener("click", () => {
      basket = basket.filter((_, index) => index !== i);
      renderBasket();
    });
    item.append(
      description,
      element(
        "span",
        line.estimatedAmountMinor === null
          ? "待確認"
          : money(line.estimatedAmountMinor),
      ),
      remove,
    );
    list.append(item);
  });
  $("basket-count").textContent =
    `${basket.reduce((n, line) => n + line.quantity, 0)} 份`;
  $("total").textContent = basket.some(
    (line) => line.estimatedAmountMinor === null,
  )
    ? "待確認"
    : money(basket.reduce((n, line) => n + line.estimatedAmountMinor, 0));
  updateSubmit();
}
function renderMenu() {
  const view = visibleMenu(menu, categoryId);
  categoryId = view.categoryId;
  const nav = $("categories");
  nav.replaceChildren();
  for (const category of view.categories) {
    const button = element(
      "button",
      category.name,
      category.id === categoryId ? "active" : "",
    );
    button.type = "button";
    button.addEventListener("click", () => {
      categoryId = category.id;
      renderMenu();
    });
    nav.append(button);
  }
  $("products").replaceChildren();
  if (!view.products.length) $("products").append(element("p", "目前沒有可訂購的餐點，請稍後再來。", "empty"));
  for (const product of view.products) {
    const card = element("article", undefined, "product-card");
    const defaultVariant =
      product.variants.find((v) => v.isDefault && isAvailable(v)) ?? product.variants.find(isAvailable);
    card.append(
      element("div", product.name.slice(0, 1), "product-mark"),
      element("h3", product.name),
      element(
        "p",
        product.description || `${product.variants.length} 種規格 · 新鮮現做`,
        "muted",
      ),
    );
    const row = element("div", undefined, "product-bottom");
    const button = element(
      "button",
      "選口味 ＋",
    );
    button.type = "button";
    button.dataset.unavailable = String(!isAvailable(product));
    button.addEventListener("click", () => openSelection(product));
    row.append(
      element("strong", money(defaultVariant.priceMinor)),
      button,
    );
    card.append(row);
    $("products").append(card);
  }
  updateSubmit();
}
function openSelection(product) {
  selectedProduct = product;
  selectedVariant = (
    product.variants.find((v) => v.isDefault && isAvailable(v)) ?? product.variants.find(isAvailable)
  ).id;
  modifierIds = [];
  $("quantity").value = "1";
  $("selection-error").textContent = "";
  $("selection-title").textContent = product.name;
  $("selection-description").textContent =
    product.description || "選擇規格與喜歡的口味";
  renderChoices();
  $("selection").showModal();
}
function renderChoices() {
  $("variants").replaceChildren(element("h3", "餐點規格"));
  const variants = element("div", undefined, "choice-row");
  for (const variant of selectedProduct.variants.filter(isAvailable)) {
    const button = element(
      "button",
      `${variant.name} · ${money(variant.priceMinor)}`,
      variant.id === selectedVariant ? "selected" : "",
    );
    button.type = "button";
    button.setAttribute("aria-pressed", String(variant.id === selectedVariant));
    button.addEventListener("click", () => {
      selectedVariant = variant.id;
      renderChoices();
    });
    variants.append(button);
  }
  $("variants").append(variants);
  $("modifiers").replaceChildren();
  for (const group of menu.modifierGroups.filter((g) =>
    selectedProduct.modifierGroupIds.includes(g.id),
  )) {
    const block = element("section", undefined, "modifier-group");
    const chosen = modifierIds.filter((id) =>
      group.modifiers.some((m) => m.id === id),
    );
    const exact = group.minSelected === group.maxSelected;
    block.append(
      element("h3", group.name),
      element(
        "p",
        exact
          ? `必須選滿 ${group.minSelected} 份，目前 ${chosen.length} 份；還需選 ${remainingFlavors(group, modifierIds)} 份。`
          : `請選 ${group.minSelected}–${group.maxSelected} 項`,
        "fineprint",
      ),
    );
    for (const modifier of group.modifiers.filter(isAvailable)) {
      const count = modifierIds.filter((id) => id === modifier.id).length;
      const row = element("div", undefined, "modifier-row");
      const minus = element("button", "−");
      minus.type = "button";
      minus.disabled = !count;
      minus.setAttribute("aria-label", `減少${modifier.name}`);
      minus.addEventListener("click", () => {
        modifierIds.splice(modifierIds.indexOf(modifier.id), 1);
        renderChoices();
      });
      const plus = element("button", "＋");
      plus.type = "button";
      plus.disabled =
        count >= modifier.maxQuantity || chosen.length >= group.maxSelected;
      plus.setAttribute("aria-label", `增加${modifier.name}`);
      plus.addEventListener("click", () => {
        modifierIds.push(modifier.id);
        renderChoices();
      });
      row.append(
        element(
          "span",
          `${modifier.name}${modifier.priceDeltaMinor ? ` +${money(modifier.priceDeltaMinor)}` : ""}`,
        ),
        minus,
        element("strong", String(count)),
        plus,
      );
      block.append(row);
    }
    $("modifiers").append(block);
  }
  const addButton = $("selection-form").querySelector('button[type="submit"]');
  try {
    addSelection([], selectedProduct, selectedVariant, modifierIds, 1, menu.modifierGroups);
    addButton.disabled = false;
  } catch { addButton.disabled = true; }
}
$("selection-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    basket = addSelection(
      basket,
      selectedProduct,
      selectedVariant,
      modifierIds,
      Number($("quantity").value),
      menu.modifierGroups,
    );
    renderBasket();
    $("selection").close();
    status("已加入餐點，請選擇取餐時間。");
  } catch (e) {
    $("selection-error").textContent = e.message;
  }
});
action($("close-selection"), () => $("selection").close());
async function refreshSlots() {
  slotData = await api.pickupSlots();
  const dates = groupSlots(slotData);
  $("pickup-date").replaceChildren(element("option", "請選擇日期"));
  $("pickup-date").firstChild.value = "";
  for (const group of dates) {
    const option = element("option", group.date);
    option.value = group.date;
    $("pickup-date").append(option);
  }
  $("pickup-time").replaceChildren(element("option", "請先選擇日期"));
  $("pickup-time").firstChild.value = "";
  $("slot-note").textContent = dates.length
    ? "請選擇方便到店的取餐時間。"
    : "目前沒有可預約時段，餐點已保留，請稍後再試。";
  updateSubmit();
}
$("pickup-date").addEventListener("change", () => {
  const group = groupSlots(slotData).find(
    (x) => x.date === $("pickup-date").value,
  );
  $("pickup-time").replaceChildren(element("option", "請選擇時間"));
  $("pickup-time").firstChild.value = "";
  for (const slot of group?.slots ?? []) {
    const option = element("option", pickupTimeLabel(slot.pickupAt, slotData.storeTimeZone));
    option.value = slot.pickupAt;
    $("pickup-time").append(option);
  }
  updateSubmit();
});
$("pickup-time").addEventListener("change", updateSubmit);
function showOrders(orders) {
  $("menu-view").hidden = true;
  $("orders-view").hidden = false;
  $("menu-tab").classList.remove("active");
  $("orders-tab").classList.add("active");
  $("orders").replaceChildren(...orders.map(orderCard));
  if (!orders.length)
    $("orders").append(
      element("p", "尚無訂單。下一份好滋味，從菜單開始。", "panel empty"),
    );
}
async function myOrders() {
  if (!signedIn) {
    status("請先登入以查看你的訂單。");
    return;
  }
  const data = await api.orders();
  showOrders(data.orders);
  status("已更新訂單狀態。");
}
async function accepted(order) {
  basket = [];
  renderBasket();
  $("recovery").hidden = true;
  showOrders([order]);
  status(
    `訂單已成立，取餐號碼 ${order.readableNumber}。請於預約時間到店付款取餐。`,
  );
}
async function recover() {
  if (!pending.record) {
    $("recovery").hidden = true;
    return;
  }
  busy = true;
  updateSubmit();
  $("recovery").hidden = false;
  $("retry").hidden = true;
  try {
    const result = await pending.lookup(api);
    if (result.state === "found") {
      await accepted(result.order);
      return;
    }
    if (result.state === "unauthorized") {
      signedIn = false;
      $("auth").hidden = false;
      $("recovery-status").textContent = "請重新登入，再確認上一筆訂單。";
      return;
    }
    $("recovery-status").textContent =
      result.state === "retryable"
        ? "尚未找到這筆訂單，請按「重新送出這筆訂單」再試一次。"
        : "正在確認訂單是否送出，請按「重新查詢」，暫時不要另外下單。";
    $("retry").hidden = result.state !== "retryable";
  } finally {
    busy = false;
    renderBasket();
  }
}
const definitive = new Set([
  "STALE_MENU",
  "PICKUP_SCHEDULE_CHANGED",
  "PICKUP_SLOT_UNAVAILABLE",
  "INVALID_SELECTION",
  "INVALID_REQUEST",
  "ORDERING_PAUSED",
  "ONLINE_PAYMENT_UNAVAILABLE",
]);
async function sendPending() {
  const originalRequest = pending.record?.originalRequest;
  busy = true;
  renderBasket();
  try {
    await accepted(await pending.retry(api));
  } catch (e) {
    if (e instanceof ApiError && definitive.has(e.code)) {
      const draft = restoreDraft(originalRequest, menu);
      basket = draft.basket;
      $("pickup-name").value = draft.pickupName;
      $("pickup-phone").value = draft.pickupPhone;
      pending.clear();
      $("recovery").hidden = true;
      if (e.code === "STALE_MENU") {
        menu = await api.menu();
        basket = restoreDraft(originalRequest, menu).basket;
        renderMenu();
      }
      if (e.code.startsWith("PICKUP_")) await refreshSlots();
      status(errorMessage(e), true);
    } else {
      status(errorMessage(e), true);
      await recover();
    }
  } finally {
    busy = false;
    renderBasket();
  }
}
$("checkout-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy || pending.record) return;
  try {
    const request = buildOrderRequest(
      basket,
      menu.menuVersion,
      "ONSITE",
      $("pickup-name").value,
      $("pickup-time").value,
      slotData.scheduleVersion,
      $("pickup-phone").value,
    );
    pending.begin(request, crypto.randomUUID());
    sendPending().catch((e) => status(errorMessage(e), true));
  } catch (e) {
    status(errorMessage(e), true);
  }
});
action($("lookup"), () => (busy ? undefined : recover()));
action($("retry"), () => (busy ? undefined : sendPending()));
action($("orders-tab"), myOrders);
action($("refresh-orders"), myOrders);
action($("menu-tab"), () => {
  $("orders-view").hidden = true;
  $("menu-view").hidden = !signedIn;
  $("menu-tab").classList.add("active");
  $("orders-tab").classList.remove("active");
});
async function authenticate() {
  if (authenticating) return;
  authenticating = true;
  try {
    const session = config.localDemo
      ? await api.openSession("local-customer")
      : await startLineSession(await loadLiff(), api, config.liffId);
    if (!session) return;
    const scope = JSON.stringify(session.recoveryScope);
    const accountChanged = scope !== activeScope;
    if (accountChanged) {
      basket = [];
      $("pickup-name").value = "";
      $("pickup-phone").value = "";
      $("memory-note").textContent = "";
      $("orders").replaceChildren();
      $("orders-view").hidden = true;
    }
    activeScope = scope;
    signedIn = true;
    pending.setScope(session.recoveryScope);
    $("auth").hidden = true;
    await recover();
    menu = await api.menu();
    let saved = {};
    if (accountChanged) {
      try { saved = await api.defaults(); }
      catch { $("memory-note").textContent = "暫時無法讀取上次資料，請手動填寫。"; }
      const contact = contactDefaults(saved, session.lineDisplayName);
      $("pickup-name").value = contact.pickupName;
      $("pickup-phone").value = contact.pickupPhone;
      if (!pending.record && $("orders-view").hidden && !basket.length && saved.lines?.length) {
        const previous = restorePrevious(saved, menu);
        basket = previous.basket;
        $("memory-note").textContent = previous.skipped
          ? `已帶入可訂購的上次餐點；${previous.skipped} 項已停售或選項變更，請重新選擇。`
          : "已帶入上次餐點，金額依目前菜單計算；請確認餐點並重新選擇取餐時間。";
      }
      if (pending.record) {
        $("pickup-name").value = pending.record.originalRequest.pickupName ?? "";
        $("pickup-phone").value = pending.record.originalRequest.pickupPhone ?? "";
      }
    }
    categoryId = menu.categories[0]?.id;
    renderMenu();
    await refreshSlots();
    renderBasket();
    if ($("orders-view").hidden) $("menu-view").hidden = false;
    if (!pending.record && $("orders-view").hidden)
      status("選好口味，預約你方便的取餐時間。");
  } finally { authenticating = false; }
}
action($("login"), authenticate);
async function boot() {
  try {
    config = await api.config();
    $("mode").hidden = !config.localDemo;
    $("mode").textContent = config.localDemo
      ? "本機示範 · 假身分"
      : "LINE 預約外帶";
    $("auth").hidden = false;
    $("auth-description").textContent = config.localDemo
      ? "此為本機測試，使用虛構顧客登入。未連接真實 LINE 或線上付款。"
      : "使用 LINE 登入後，即可預約取餐及查看自己的訂單。";
    $("login").textContent = config.localDemo
      ? "使用本機虛構顧客登入"
      : "使用 LINE 登入";
    if (!config.localDemo && !config.liffId) {
      $("login").disabled = true;
      status("目前暫時無法登入，請稍後再試。", true);
    } else if (config.liffId && !config.localDemo) await authenticate();
    else status("本機示範已就緒，登入即可測試預約外帶。");
  } catch (e) {
    status(errorMessage(e), true);
  }
}
boot();
