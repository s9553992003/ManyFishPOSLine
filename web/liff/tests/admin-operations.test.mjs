import test from 'node:test';
import assert from 'node:assert/strict';
import {filterOrders, orderActions, reportCsv, deviceSummary, hasAvailabilityDraftConflict} from '../admin-operations.mjs';
import {BackofficeApi} from '../admin-api.mjs';
const order={source:'LINE_LIFF',orderId:'1',readableNumber:'A001',pickupName:'測試',pickupPhone:'0912-345-678',orderState:'PLACED',productionState:'QUEUED',paymentChoice:'ONSITE',paymentState:'UNPAID_ONSITE'};
test('order filters combine number/name/normalized phone and exact state',()=>{
 assert.equal(filterOrders([order],{query:'0912345',payment:'UNPAID_ONSITE',production:'QUEUED'}).length,1);
 assert.equal(filterOrders([order],{query:'a001'}).length,1);
 assert.equal(filterOrders([order],{query:'測試',production:'PREPARING'}).length,0);
});
test('actions exclude history, unknown, exceptions, terminal and unpaid completion',()=>{
 assert.deepEqual(orderActions(order),['start','collect','cancel']);
 for(const patch of [{source:'QUICKCLICK_EAA'},{source:undefined},{orderState:'HISTORICAL'},{orderState:'COMPLETED'},{paymentState:'UNKNOWN'},{paymentException:'PROBLEM'}])assert.deepEqual(orderActions({...order,...patch}),[]);
 assert.ok(!orderActions({...order,productionState:'READY_FOR_PICKUP'}).includes('complete'));
 assert.deepEqual(orderActions({...order,productionState:'READY_FOR_PICKUP',paymentState:'PAID_ONSITE'}),['complete']);
});
test('CSV includes BOM, quotes, formula escaping, pending finance and only explicit safe fields',()=>{
 const csv=reportCsv({orders:[{...order,readableNumber:'=1+1',totalAmountMinor:12300,paymentState:'UNKNOWN',receivedAmountMinor:0,pickupName:'SECRET',token:'SECRET',lines:[{productName:'魚,"香"\n六入'}]}]});
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=1+1"'));assert.ok(csv.includes('待核對'));assert.ok(!csv.includes('SECRET'));assert.ok(!csv.includes('0912'));assert.ok(csv.includes('魚,""香""\n六入'));
});
test('device stats mark stale offline and unknown counters remain unknown',()=>{
 const now=1_800_000_000_000;
 assert.equal(deviceSummary({active:true,lastSeenAt:now-600001,syncState:'SYNCED'},now).connection,'離線或回報逾時');
 assert.equal(deviceSummary({active:true},now).pending,'待回報');
 assert.equal(deviceSummary({active:true,lastSeenAt:now,pendingSales:0,syncState:'SYNCED'},now).pending,'0');
});
test('admin action and availability use CSRF and encoded IDs',async()=>{
 const calls=[],api=new BackofficeApi(async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>({})};});api.csrfToken='test';
 await api.orderAction('id/1','start',{expectedRevision:1,commandId:'retry'});await api.availability({expectedRevision:2,productId:'fish',available:false});
 assert.equal(calls[0].path,'/v1/admin/orders/id%2F1/start');assert.equal(calls[0].options.headers['X-CSRF-Token'],'test');assert.equal(calls[1].path,'/v1/admin/menu/availability');
});

test('availability conflict includes fields outside visual diff and ignores object key ordering',()=>{
 assert.equal(hasAvailabilityDraftConflict({products:[],store:{name:'魚'}},{store:{name:'魚'},products:[]}),false);
 assert.equal(hasAvailabilityDraftConflict({products:[],store:{name:'魚'}},{products:[],store:{name:'魚',timezone:'Asia/Taipei'}}),true);
});
test('unrecognized payment states never export fabricated zero receipts',()=>{
 const csv=reportCsv({orders:[{readableNumber:'X',paymentState:'FUTURE_STATE',receivedAmountMinor:0}]});
 assert.ok(!csv.includes('0.00'));
});

test('CSV formats epoch zero and dates in Taipei and states report date basis',()=>{
 const csv=reportCsv({orders:[{createdAt:0,paidAt:'invalid'}]},{dateFrom:'2026-10-01',dateTo:'2026-10-03',source:'POS'});
 assert.ok(csv.includes('1970'));assert.ok(csv.includes('08:00:00'));assert.ok(csv.includes('下單時間（台北）'));assert.ok(csv.includes('2026-10-01'));assert.ok(csv.includes('實收按收款日；訂單數按下單日'));assert.ok(!csv.includes('invalid'));
});

test('actual POS report receipt shape stays known while explicit unknown states stay pending',async()=>{
 const {reportOrderSummary}=await import('../admin-state.mjs');
 const pos={source:'POS',status:'COMPLETED',receivedAmountMinor:12300,totalAmountMinor:12300};
 assert.equal(reportOrderSummary(pos).payment,'已收款');
 assert.ok(reportCsv({orders:[pos]}).includes('"已收款","123.00","123.00"'));
 for(const paymentState of ['UNKNOWN','FUTURE_STATE']){
  const unknown={...pos,paymentState};assert.equal(reportOrderSummary(unknown).payment,'待核對');assert.equal(reportOrderSummary(unknown).receivedAmount,'待核對');
  assert.ok(reportCsv({orders:[unknown]}).includes('"待核對","123.00","待核對"'));
 }
 assert.equal(reportOrderSummary({...pos,receiptMissing:true}).payment,'憑證待核對');
 assert.equal(reportOrderSummary({...pos,source:'QUICKCLICK_EAA'}).payment,'待核對');
});

test('history export prefers original order identifiers and preserves leading zeros',()=>{
 const csv=reportCsv({orders:[{source:'QUICKCLICK_EAA',orderNumber:'00123',sourceRecordId:'record-7',orderId:'history:hash',paymentState:'UNKNOWN'},{source:'QUICKCLICK_EAA',sourceRecordId:'00009',orderId:'history:other',paymentState:'UNKNOWN'}]});
 assert.ok(csv.includes('"00123"'));assert.ok(csv.includes('"00009"'));assert.ok(!csv.includes('history:'));assert.ok(!csv.includes('record-7'));
});
