import { reportOrderSummary } from './admin-state.mjs';
import { sourceLabel } from './admin-locale.mjs';
export function filterOrders(orders,{query='',payment='',production=''}={}) {
 const q=query.trim().toLocaleLowerCase(),phone=q.replace(/[\s()+-]/g,'');
 return orders.filter(o=>(!payment||o.paymentState===payment)&&(!production||o.productionState===production)&&(!q||[o.readableNumber,o.pickupName].some(x=>String(x??'').toLocaleLowerCase().includes(q))||(/^[\d]+$/.test(phone)&&String(o.pickupPhone??'').replace(/[\s()+-]/g,'').includes(phone))));
}
export function orderActions(o) {
 if((o.source??o.channel)!=='LINE_LIFF'||o.orderState!=='PLACED'||o.paymentException||!['UNPAID_ONSITE','PAID_ONSITE','PAID_ONLINE','AWAITING_ONLINE_PAYMENT','PAYMENT_FAILED','PAYMENT_UNCERTAIN'].includes(o.paymentState))return [];
 const out=[],paid=['PAID_ONSITE','PAID_ONLINE'].includes(o.paymentState);
 if(o.productionState==='QUEUED'&&(paid||o.paymentState==='UNPAID_ONSITE'))out.push('start');
 if(o.productionState==='PREPARING'&&(paid||o.paymentState==='UNPAID_ONSITE'))out.push('ready');
 if(o.productionState==='READY_FOR_PICKUP'&&paid)out.push('complete');
 if(o.paymentState==='UNPAID_ONSITE'&&o.paymentChoice==='ONSITE')out.push('collect');
 if(!paid)out.push('cancel');
 return out;
}
function csvCell(value) {
 let s=String(value??'待核對');
 if(/^[\s\u0000-\u001f]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;
 return '"'+s.replaceAll('"','""')+'"';
}
export function reportCsv(report,filters={}) {
 const rows=[['訂單號碼','來源','下單時間（台北）','收款時間（台北）','訂單狀態','付款狀態','原始訂單金額（非實收，元）','已確認收款金額（元）','餐點','統計備註','查詢開始日期','查詢結束日期','查詢來源','日期依據']];
 const date=value=>{if(value===null||value===undefined||value==='')return '待核對';const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'待核對';};
 const amount=value=>Number.isSafeInteger(value)?(value/100).toFixed(2):'待核對';
 for(const o of report.orders??[]) {const view=reportOrderSummary(o);rows.push([o.readableNumber??o.number??o.orderNumber??o.sourceRecordId??o.orderId??o.id,sourceLabel(o.source??o.channel),date(o.createdAt),date(o.paidAt),view.orderStatus,view.payment,amount(o.totalAmountMinor),view.receivedAmountKnown?amount(o.receivedAmountMinor):'待核對',(o.lines??[]).map(x=>`${x.productName??x.name??'待核對'} ×${x.quantity??'待核對'}`).join('\n'),[o.includedInRevenue?'本期實收':'',o.paymentTimeUnknown?'收款時間待核對':'',...(view.notes??[])].filter(Boolean).join('；'),filters.dateFrom,filters.dateTo,sourceLabel(filters.source??'ALL'),'實收按收款日；訂單數按下單日']);}
 return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export function deviceSummary(d,now=Date.now()) {
 const date=v=>v!==null&&v!==undefined&&Number.isFinite(new Date(v).getTime())?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'待回報';
 const seen=d.lastSeenAt===null||d.lastSeenAt===undefined?NaN:new Date(d.lastSeenAt).getTime(),fresh=Number.isFinite(seen)&&now-seen>=0&&now-seen<=5*60*1000;
 return {connection:!d.active?'已停用':fresh&&d.syncState!=='OFFLINE'?'最近曾回報（非即時連線）':Number.isFinite(seen)?'離線或回報逾時':'尚未回報',lastSeen:date(d.lastSeenAt),menuVersion:d.menuVersion??'待回報',pending:Number.isSafeInteger(d.pendingSales)&&d.pendingSales>=0?String(d.pendingSales):'待回報',lastSync:date(d.lastSyncAt),sync:({IDLE:'待同步',SYNCING:'同步中',SYNCED:'已同步',OFFLINE:'離線',ERROR:'同步失敗'})[d.syncState]??'待回報'};
}

export function hasAvailabilityDraftConflict(published,draft) {
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 return JSON.stringify(canonical(published))!==JSON.stringify(canonical(draft));
}
