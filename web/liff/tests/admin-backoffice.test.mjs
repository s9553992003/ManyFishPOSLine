import test from 'node:test';
import assert from 'node:assert/strict';
import { BackofficeApi } from '../admin-api.mjs';
import { priceMinor, validateCatalog, catalogChanges, canManageUsers, reportSummary } from '../admin-state.mjs';
const catalog=()=>({schemaVersion:1,datasetId:'test',menuVersion:'v1',store:{id:'s',name:'店',timezone:'Asia/Taipei',currency:'TWD',currencyScale:2},categories:[{id:'c',name:'魚',color:'#ffffff'}], products:[{id:'p',name:'魚燒',unit:'份',categoryId:'c',variants:[{id:'v',name:'一份',priceMinor:3000,isDefault:true}],modifierGroupIds:['g']}],modifierGroups:[{id:'g',name:'口味',minSelected:1,maxSelected:2,modifiers:[{id:'m',name:'紅豆',priceDeltaMinor:0,maxQuantity:2}]}]});
test('cookie session attaches CSRF on writes without bearer and clears after logout', async()=>{
 const requests=[]; const api=new BackofficeApi(async(path,options)=>{requests.push({path,...options});return {ok:true,status:200,json:async()=>({user:{id:'u',role:'STAFF'},csrfToken:'csrf'})};});
 await api.login('staff','secret'); await api.saveDraft(3,catalog()); await api.logout();
 assert.equal(requests[0].path,'/v1/admin/session');assert.equal(requests[0].credentials,'same-origin'); assert.equal(requests[0].headers.Authorization,undefined);
 assert.equal(requests[1].headers['X-CSRF-Token'],'csrf'); assert.equal(JSON.parse(requests[1].body).expectedRevision,3);assert.equal(api.csrfToken,undefined);
});
test('failed draft conflict preserves caller revision and classifies HTTP error',async()=>{
 const api=new BackofficeApi(async()=>({ok:false,status:409,json:async()=>({error:'DRAFT_CONFLICT'})}));
 await assert.rejects(api.saveDraft(7,catalog()), e=>e.status===409&&e.code==='DRAFT_CONFLICT');
});
test('money input uses exact cents and rejects rounding or empty amounts',()=>{
 assert.equal(priceMinor('30.25'),3025); assert.equal(priceMinor('0'),0);
 for(const x of ['','-1','1.001','1e3','Infinity'])assert.throws(()=>priceMinor(x));
});
test('catalog validation catches broken references and impossible selection bounds',()=>{
 const c=catalog();assert.deepEqual(validateCatalog(c),[]);c.products[0].categoryId='missing';c.modifierGroups[0].minSelected=3;
 assert.ok(validateCatalog(c).length>=2);
});
test('catalog diff lists nested price edits and availability, preserves original',()=>{
 const before=catalog(),after=structuredClone(before);after.products[0].variants[0].priceMinor=3500;after.products[0].active=false;
 const changes=catalogChanges(before,after);assert.ok(changes.some(x=>x.includes('$30.00')&&x.includes('$35.00')));assert.ok(changes.some(x=>x.includes('停售')));assert.equal(before.products[0].variants[0].priceMinor,3000);
});
test('staff cannot manage accounts; reset-required admin cannot enter operations',()=>{
 assert.equal(canManageUsers({role:'STAFF'}),false);assert.equal(canManageUsers({role:'ADMIN'}),true);assert.equal(canManageUsers({role:'ADMIN',mustChangePassword:true}),false);
});

test('report filters are URL encoded and password reset uses protected PATCH',async()=>{
 const requests=[];const api=new BackofficeApi(async(path,options)=>{requests.push({path,...options});return {ok:true,json:async()=>({})};});api.csrfToken='test-csrf';
 await api.reports({dateFrom:'2026-10-01',dateTo:'2026-10-03',source:'LINE_LIFF'});await api.updateUser('a/b',{password:'a-new-password'});
 assert.equal(requests[0].path,'/v1/admin/reports?dateFrom=2026-10-01&dateTo=2026-10-03&source=LINE_LIFF');assert.equal(requests[0].headers['X-CSRF-Token'],undefined);
 assert.equal(requests[1].path,'/v1/admin/users/a%2Fb');assert.equal(requests[1].method,'PATCH');assert.equal(requests[1].headers['X-CSRF-Token'],'test-csrf');
});


test('unavailable history does not render zero revenue or counts',()=>{
 const view=reportSummary({dataAvailability:'UNAVAILABLE',grossMinor:null,refundMinor:null,netMinor:null,orderCount:null,paymentOrderCount:0,limitations:['IDOO_HISTORY_NOT_IMPORTED']});
 assert.ok(view.metrics.every(([,value])=>value==='尚無可靠資料'));
 assert.ok(view.notes.some(note=>note.includes('尚未匯入')));
});
test('report distinguishes placed cohort from payment day and explains incomplete evidence',()=>{
 const view=reportSummary({dataAvailability:'PARTIAL',orderCount:3,paidOrderCount:2,paymentOrderCount:4,grossMinor:1250,unpaidAmountMinor:500,missingReceiptCount:1,unknownPaymentTimeCount:2,unknownPaymentTimeAmountMinor:900,limitations:['REFUND_WORKFLOW_NOT_IMPLEMENTED','PAYMENT_RECEIPTS_MISSING','PAYMENT_TIMES_UNKNOWN']});
 assert.deepEqual(view.metrics.find(([label])=>label==='期間收款筆數'),['期間收款筆數','4']);
 assert.deepEqual(view.metrics.find(([label])=>label==='期間下單已付款'),['期間下單已付款','2']);
 assert.ok(view.notes.some(note=>note.includes('退款')));
 assert.ok(view.notes.some(note=>note.includes('缺少收款憑證：1')));
 assert.ok(view.notes.some(note=>note.includes('全部日期')));
});
test('catalog validation prevents Android-incompatible publication',()=>{
 const mutations=[c=>delete c.store,c=>delete c.schemaVersion,c=>delete c.categories[0].color,c=>delete c.products[0].unit,c=>delete c.products[0].variants[0].isDefault,c=>{c.modifierGroups[0].maxSelected=100},c=>{c.modifierGroups[0].modifiers[0].maxQuantity=100},c=>{c.modifierGroups[0].minSelected=3;c.modifierGroups[0].maxSelected=3},c=>c.modifierGroups.push({...structuredClone(c.modifierGroups[0]),id:'g2'}),c=>{c.products[0].modifierGroupIds=['g','g']},c=>{c.products[0].variants[0].priceMinor=10000001}];
 for(const mutate of mutations){const c=catalog();mutate(c);assert.ok(validateCatalog(c).length>0);}
});

test('history summaries preserve unknown counts and label source totals separately from receipts',async()=>{
 const { importSummary }=await import('../admin-state.mjs');
 const unknown=importSummary({batchId:'b',source:'IDOO',recordCount:null,sourceTotal:null,knownOrderAmountMinor:null,blockers:['SOURCE_TOTAL_UNKNOWN']});
 assert.equal(unknown.amount,'待核對');assert.equal(unknown.count,'待核對 / 待核對');assert.ok(unknown.notes.some(x=>x.includes('來源總筆數')));
 const known=importSummary({batchId:'b',source:'IDOO',recordCount:3555,sourceTotal:3555,knownOrderAmountMinor:10050,promoted:false,coverageStatus:'UNVERIFIED',financialStatus:'PENDING',blockers:[]});
 assert.equal(known.count,'3555 / 3555');assert.equal(known.amountLabel,'原始訂單金額（非實收）');assert.ok(known.amount.includes('100.5'));assert.ok(known.state.includes('未納入'));
});
test('history summaries are read through cookie-authenticated GET',async()=>{
 let request;const api=new BackofficeApi(async(path,options)=>{request={path,...options};return {ok:true,json:async()=>({batches:[]})};});
 assert.deepEqual(await api.imports(),{batches:[]});assert.equal(request.path,'/v1/admin/imports');assert.equal(request.method,'GET');assert.equal(request.credentials,'same-origin');assert.equal(request.body,undefined);
});

test('historical unknown payments remain distinct from paid and unpaid counts',()=>{
 const view=reportSummary({source:'IDOO',dataAvailability:'PARTIAL',orderCount:5,canceledOrderCount:1,paidOrderCount:null,unpaidOrderCount:null,grossMinor:null,refundMinor:null,netMinor:null,unknownPaymentStatusCount:5,limitations:['HISTORICAL_PAYMENTS_UNVERIFIED']});
 assert.deepEqual(view.metrics.find(([label])=>label==='付款狀態待核對'),['付款狀態待核對','5']);
 assert.deepEqual(view.metrics.find(([label])=>label==='期間下單已付款'),['期間下單已付款','尚無可靠資料']);
 assert.deepEqual(view.metrics.find(([label])=>label==='期間下單未付款'),['期間下單未付款','尚無可靠資料']);
 assert.ok(view.notes.some(text=>text.includes('原始訂單金額')&&text.includes('非實收')));
});
test('historical order presentation preserves snapshots without guessing payment evidence',async()=>{
 const { reportOrderSummary }=await import('../admin-state.mjs');
 const view=reportOrderSummary({source:'QUICKCLICK_EAA',paymentState:'UNKNOWN',confirmed:true,totalAmountMinor:5000,receivedAmountMinor:null,lines:[{name:'舊品名',quantity:2,lineAmountMinor:5000,modifiers:[{name:'原味',quantity:3}]}]});
 assert.equal(view.payment,'待核對');assert.equal(view.originalAmountLabel,'原始訂單金額（非實收）');assert.equal(view.receivedAmount,'待核對');
 assert.deepEqual(view.lines[0].slice(0,3),['舊品名','2','原味 ×3']);assert.equal(view.lines[0][3],'$50.00');
 const missing=reportOrderSummary({paymentState:'UNKNOWN',lines:[{name:'舊餐點',modifiers:[{name:'口味'}]}]});
 assert.equal(missing.originalAmount,'待核對');assert.equal(missing.lines[0][1],'待核對');assert.equal(missing.lines[0][2],'口味 ×待核對');
});

test('report pagination bounds DOM data without altering the complete result',async()=>{
 const { reportOrderPage }=await import('../admin-state.mjs');
 const orders=Array.from({length:3555},(_,id)=>({id,lines:[{name:`餐點 ${id}`}]}));
 const first=reportOrderPage(orders,0,50),last=reportOrderPage(orders,999,50);
 assert.equal(first.orders.length,50);assert.equal(first.orders[49].id,49);assert.equal(first.total,3555);assert.equal(first.pageCount,72);
 assert.equal(last.page,71);assert.equal(last.orders.length,5);assert.equal(last.orders[0].id,3550);assert.equal(last.from,3551);assert.equal(last.to,3555);
 const hundred=reportOrderPage(orders,1,100);assert.equal(hundred.orders[0].id,100);assert.equal(hundred.orders.length,100);
 assert.equal(orders.length,3555);assert.equal(orders[0].lines[0].name,'餐點 0');
});
test('empty report pages and invalid page sizes remain bounded',async()=>{
 const { reportOrderPage }=await import('../admin-state.mjs');
 const empty=reportOrderPage([],7,100);assert.equal(empty.page,0);assert.equal(empty.from,0);assert.equal(empty.to,0);assert.deepEqual(empty.orders,[]);
 const bounded=reportOrderPage(Array.from({length:110},(_,id)=>({id})),-1,100000);assert.equal(bounded.orders.length,50);assert.equal(bounded.page,0);
});

test('history navigation covers source dates in Taipei without changing manual filters',async()=>{
 const { historyReportFilters }=await import('../admin-state.mjs');
 assert.deepEqual(historyReportFilters({earliestCreatedAt:'2025-12-01T17:00:00Z',latestCreatedAt:'2026-10-02T15:59:00Z'}),{source:'IDOO',dateFrom:'2025-12-02',dateTo:'2026-10-02'});
 assert.equal(historyReportFilters({earliestCreatedAt:null,latestCreatedAt:'2026-10-02T15:59:00Z'}),null);
 assert.equal(historyReportFilters({earliestCreatedAt:'bad',latestCreatedAt:'bad'}),null);
});

test('historical state and timestamp caveats stay separate from payment status',async()=>{
 const {reportOrderSummary,importSummary}=await import('../admin-state.mjs');
 const view=reportOrderSummary({source:'QUICKCLICK_EAA',orderState:'HISTORICAL',sourceStatus:'confirmed',paymentState:'UNKNOWN',warnings:['SOURCE_TIMESTAMP_SEMANTICS_UNVERIFIED']});
 assert.equal(view.orderStatus,'歷史訂單');assert.equal(view.payment,'待核對');assert.equal(view.createdLabel,'來源清單時間（台北）');assert.ok(view.notes.includes('來源時間待核對'));
 const batch=importSummary({blockers:['SOURCE_TIMESTAMP_SEMANTICS_UNVERIFIED','SOURCE_CONTROLS_LIMITED_TO_100_DAYS']});
 assert.ok(batch.notes[0].includes('購物車時間'));assert.ok(batch.notes[1].includes('100'));assert.ok(batch.notes.every(note=>!note.includes('SOURCE_')));
});


test('backoffice errors and unknown server states never expose raw technical messages',async()=>{
 const {adminErrorMessage,AdminInputError,sourceLabel,fieldValidationMessage}=await import('../admin-locale.mjs');
 const {reportOrderSummary,importSummary}=await import('../admin-state.mjs');
 for(const error of [new TypeError('Failed to fetch'),new Error('Unexpected token'),{code:'NEW_SERVER_ERROR',message:'NEW_SERVER_ERROR'}]){
  const message=adminErrorMessage(error);assert.match(message,/[\u4e00-\u9fff]/);assert.doesNotMatch(message,/Failed|Unexpected|NEW_SERVER/);
 }
 assert.equal(adminErrorMessage(new AdminInputError('請先儲存草稿。')),'請先儲存草稿。');
 assert.match(adminErrorMessage({code:'PASSWORD_CHANGE_REQUIRED',status:403}),/變更密碼/);
 assert.equal(reportOrderSummary({orderState:'NEW_STATE',paymentState:'NEW_PAYMENT'}).orderStatus,'待核對');
 assert.equal(reportOrderSummary({paymentState:'NEW_PAYMENT',receivedAmountMinor:100}).payment,'待核對');
 assert.equal(importSummary({coverageStatus:'NEW_STATUS',financialStatus:'NEW_STATUS'}).coverage,'待核對');
 assert.doesNotMatch(reportSummary({limitations:['NEW_LIMIT']}).notes.join(),/NEW_LIMIT/);
 assert.equal(sourceLabel('QUICKCLICK_EAA'),'IDoo／QuickClick 歷史訂單');
 assert.equal(sourceLabel('NEW_SOURCE'),'來源待核對');
 assert.match(fieldValidationMessage({validity:{valueMissing:true}}),/必填/);
});
test('catalog differences display names, dollars and Chinese boolean labels',()=>{
 const before=catalog(),after=structuredClone(before);after.categories.push({id:'c2',name:'飲品'});after.products[0].categoryId='c2';after.products[0].variants[0].isDefault=false;
 const text=catalogChanges(before,after).join('；');assert.match(text,/魚 → 飲品/);assert.match(text,/是 → 否/);assert.doesNotMatch(text,/true|false|c2/);
});
