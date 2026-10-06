import { addSelection } from './basket.mjs';
export function contactDefaults(saved = {}, lineName = '') {
  return {pickupName:saved.pickupName || lineName || '',pickupPhone:saved.pickupPhone || ''};
}
export function restorePrevious(saved, menu) {
  let basket=[], skipped=0;
  for (const line of saved?.lines ?? []) {
    const product=menu.products.find(p=>p.id===line.productId);
    try {
      if (!product) throw new Error('unavailable');
      basket=addSelection(basket,product,line.variantId,line.modifierIds,line.quantity,menu.modifierGroups);
    } catch { skipped++; }
  }
  return {basket,skipped};
}
