export function remainingFlavors(group, selectedIds) {
  const ids = new Set(group.modifiers?.map((m) => m.id) ?? selectedIds);
  return Math.max(
    0,
    group.minSelected - selectedIds.filter((id) => ids.has(id)).length,
  );
}
export function isAvailable(product) {
  return product.available !== false && product.active !== false;
}
export function addSelection(
  basket,
  product,
  variantId,
  modifierIds,
  quantity,
  groups = [],
) {
  const variant = product.variants.find((v) => v.id === variantId);
  if (
    !isAvailable(product) ||
    !variant || variant.active === false || variant.available === false ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 99
  )
    throw new Error("請選擇有效規格與數量（1–99）。");
  const relevant = groups.filter((g) =>
    product.modifierGroupIds.includes(g.id),
  );
  const modifiers = relevant.flatMap((g) => g.modifiers);
  if (modifierIds.some((id) => !modifiers.some((m) => m.id === id && m.active !== false && m.available !== false)))
    throw new Error("口味選項已變更，請重新選擇。");
  for (const group of relevant) {
    const selected = modifierIds.filter((id) =>
      group.modifiers.some((m) => m.id === id),
    );
    const minimum = group.minSelected;
    if (
      selected.length < minimum ||
      selected.length > group.maxSelected ||
      group.modifiers.some(
        (m) => selected.filter((id) => id === m.id).length > m.maxQuantity,
      )
    )
      throw new Error(`${group.name}：請確認必選項目與數量上限。`);
  }
  const unit =
    variant.priceMinor +
    modifierIds.reduce(
      (sum, id) => sum + modifiers.find((m) => m.id === id).priceDeltaMinor,
      0,
    );
  return [
    ...basket,
    {
      productId: product.id,
      variantId,
      modifierIds: [...modifierIds],
      quantity,
      productName: product.name,
      variantName: variant.name,
      modifierNames: modifierIds.map(
        (id) => modifiers.find((m) => m.id === id).name,
      ),
      estimatedAmountMinor: unit * quantity,
    },
  ];
}
export function buildOrderRequest(
  basket,
  menuVersion,
  paymentChoice,
  pickupName,
  pickupAt,
  scheduleVersion,
  pickupPhone,
) {
  const phone = typeof pickupPhone === "string" ? pickupPhone.replace(/[ ()-]/g, "") : "";
  if (
    !basket.length ||
    typeof pickupName !== "string" || !pickupName.trim() || pickupName.trim().length > 80 ||
    !/^\+?[0-9]{7,15}$/.test(phone) ||
    !pickupAt ||
    !Number.isInteger(scheduleVersion) ||
    paymentChoice !== "ONSITE"
  )
    throw new Error("請填寫取餐姓名與有效電話，選擇取餐時段與到店付款。");
  return {
    menuVersion,
    pickupName: pickupName.trim(),
    pickupPhone: phone,
    paymentChoice,
    pickupAt,
    scheduleVersion,
    lines: basket.map(({ productId, variantId, quantity, modifierIds }) => ({
      productId,
      variantId,
      quantity,
      modifierIds: [...modifierIds],
    })),
  };
}
export function restoreDraft(
  request,
  menu = { products: [], modifierGroups: [] },
) {
  const allModifiers = menu.modifierGroups.flatMap((group) => group.modifiers);
  const basket = request.lines.map((line) => {
    const product = menu.products.find(
      (product) => product.id === line.productId,
    );
    const variant = product?.variants.find(
      (variant) => variant.id === line.variantId,
    );
    const modifiers = line.modifierIds.map((id) =>
      allModifiers.find((modifier) => modifier.id === id),
    );
    const known = !!variant && modifiers.every(Boolean);
    return {
      ...line,
      modifierIds: [...line.modifierIds],
      productName: product?.name ?? `原品項（${line.productId}，已不在菜單）`,
      variantName: variant?.name ?? `原規格 ${line.variantId}`,
      modifierNames: line.modifierIds.map(
        (id, i) => modifiers[i]?.name ?? `原口味 ${id}`,
      ),
      estimatedAmountMinor: known
        ? (variant.priceMinor +
            modifiers.reduce(
              (sum, modifier) => sum + modifier.priceDeltaMinor,
              0,
            )) *
          line.quantity
        : null,
    };
  });
  return { basket, pickupName: request.pickupName, pickupPhone: request.pickupPhone ?? "" };
}

// Use the same visible products for both category navigation and product cards.
export function visibleMenu(menu, selectedCategoryId) {
  const availableProducts = menu.products.filter(p => isAvailable(p) && p.variants.some(isAvailable));
  const categoryIds = new Set(availableProducts.map(p => p.categoryId));
  const categories = menu.categories.filter(c => categoryIds.has(c.id));
  const categoryId = categories.some(c => c.id === selectedCategoryId) ? selectedCategoryId : categories[0]?.id;
  return { categories, categoryId, products: availableProducts.filter(p => p.categoryId === categoryId) };
}
