import test from 'node:test';
import assert from 'node:assert/strict';
import { restorePrevious, contactDefaults } from '../customer-memory.mjs';
import { buildOrderRequest, restoreDraft } from '../basket.mjs';
const menu={products:[{id:'p',name:'魚',active:true,variants:[{id:'v',name:'原味',priceMinor:18000}],modifierGroupIds:[]}],modifierGroups:[]};
const line={productId:'p',variantId:'v',quantity:2,modifierIds:[]};
test('previous basket reprices and skips removed or invalid selections',()=>{
 const result=restorePrevious({lines:[line,{...line,productId:'gone'},{...line,modifierIds:['removed']}]},menu);
 assert.equal(result.basket.length,1);
 assert.equal(result.basket[0].estimatedAmountMinor,36000);
 assert.equal(result.skipped,2);
 assert.equal(restorePrevious({lines:[line]},{...menu,products:[{...menu.products[0],active:false}]}).basket.length,0);
});
test('saved editable contact wins over LINE name and empty account has no previous phone',()=>{
 assert.deepEqual(contactDefaults({},'LINE魚'),{pickupName:'LINE魚',pickupPhone:''});
 assert.deepEqual(contactDefaults({pickupName:'取餐人',pickupPhone:'0912345678'},'LINE魚'),{pickupName:'取餐人',pickupPhone:'0912345678'});
});
test('name and phone are required and recovery preserves original phone',()=>{
 for(const phone of ['',undefined,'letters','123','1'.repeat(16)]) assert.throws(()=>buildOrderRequest([line],'v1','ONSITE','魚','date',1,phone));
 const request=buildOrderRequest([line],'v1','ONSITE',' 魚 ','date',1,'09 1234-5678');
 assert.equal(request.pickupPhone,'0912345678');
 assert.equal(restoreDraft(request,menu).pickupPhone,'0912345678');
 assert.throws(()=>buildOrderRequest([line],'v1','ONSITE','  ','date',1,'0912345678'));
});

test('inactive variants and modifiers are not restored',()=>{
 const inactiveVariant={...menu,products:[{...menu.products[0],variants:[{...menu.products[0].variants[0],active:false}]}]};
 assert.equal(restorePrevious({lines:[line]},inactiveVariant).skipped,1);
 const inactiveModifier={products:[{...menu.products[0],modifierGroupIds:['g']}],modifierGroups:[{id:'g',minSelected:0,maxSelected:1,modifiers:[{id:'m',active:false,maxQuantity:1,priceDeltaMinor:0}]}]};
 assert.equal(restorePrevious({lines:[{...line,modifierIds:['m']}]},inactiveModifier).skipped,1);
});
