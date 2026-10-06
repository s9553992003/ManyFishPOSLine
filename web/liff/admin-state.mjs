export function priceMinor(value){
 const text=String(value).trim();if(!/^\d+(\.\d{1,2})?$/.test(text))throw new Error('金額須為非負數，最多兩位小數。');
 const [whole,fraction='']=text.split('.');const amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(amount))throw new Error('金額過大。');return amount;
}
export const canManageUsers=user=>user?.role==='ADMIN'&&!user.mustChangePassword;
export function validateCatalog(c) {
 const errors=[];
 if(!c || typeof c!=='object')return ['菜單格式無效'];
 if(c.schemaVersion!==1 || typeof c.datasetId!=='string' || !c.datasetId || typeof c.menuVersion!=='string' || !c.menuVersion)errors.push('菜單版本或資料集資料不完整');
 const store=c.store;
 if(!store || ['id','name','timezone'].some(k=>typeof store[k]!=='string'||!store[k]) || store.currency!=='TWD' || store.currencyScale!==2)errors.push('店家或幣別資料不完整');
 const list=(items,label)=>{
  if(!Array.isArray(items)||items.length>1000){errors.push(`${label}資料格式或數量無效`);return [];}
  const ids=new Set();
  for(const x of items){
   if(!x || typeof x!=='object'){errors.push(`${label}格式無效`);continue;}
   if(typeof x.id!=='string'||!x.id||ids.has(x.id))errors.push(`${label}代碼重複或空白`);ids.add(x.id);
   if(typeof x.name!=='string'||!x.name.trim())errors.push(`${label}名稱不可空白`);
   for(const flag of ['active','available'])if(flag in x && typeof x[flag]!=='boolean')errors.push(`${label}販售狀態無效`);
  }
  return items.filter(x=>x&&typeof x==='object');
 };
 const categories=list(c.categories,'分類'),products=list(c.products,'商品'),groups=list(c.modifierGroups,'口味群組');
 const categoryIds=new Set(categories.map(x=>x.id)),groupIds=new Set(groups.map(x=>x.id));
 for(const category of categories)if(!/^#[0-9a-f]{6}$/i.test(category.color??''))errors.push(`${category.name}：色彩需為六位色碼`);
 if(!products.length)errors.push('至少需要一個商品');
 const amounts=(value)=>Number.isSafeInteger(value)&&value>=0&&value<=10000000;
 for(const p of products){
  if(!categoryIds.has(p.categoryId))errors.push(`${p.name}：分類不存在`);
  if(typeof p.unit!=='string'||!p.unit)errors.push(`${p.name}：單位不可空白`);
  const variants=list(p.variants,'規格');
  if(!variants.length||variants.filter(v=>v.isDefault===true).length!==1)errors.push(`${p.name}：必須指定一個預設規格`);
  for(const v of variants)if(typeof v.isDefault!=='boolean'||!amounts(v.priceMinor))errors.push(`${p.name}：規格價格或預設值無效`);
  if(!Array.isArray(p.modifierGroupIds)||new Set(p.modifierGroupIds).size!==p.modifierGroupIds.length||p.modifierGroupIds.some(id=>!groupIds.has(id)))errors.push(`${p.name}：口味群組不存在或重複`);
 }
 const allModifiers=[];
 for(const g of groups){
  if(!Number.isInteger(g.minSelected)||!Number.isInteger(g.maxSelected)||g.minSelected<0||g.maxSelected<g.minSelected||g.maxSelected>99)errors.push(`${g.name}：選取數量需介於 0–99，最少不可超過最多`);
  const modifiers=list(g.modifiers,'口味');allModifiers.push(...modifiers);
  for(const m of modifiers)if(!amounts(m.priceDeltaMinor)||!Number.isInteger(m.maxQuantity??1)||(m.maxQuantity??1)<1||(m.maxQuantity??1)>99)errors.push(`${m.name}：加價或數量無效`);
  if(g.minSelected>modifiers.reduce((total,m)=>total+(m.maxQuantity??1),0))errors.push(`${g.name}：口味總數量不足以滿足必選數量`);
 }
 list(allModifiers,'全菜單口味');
 return errors;
}
export function reportSummary(report) {
 const unavailable=report.dataAvailability==='UNAVAILABLE';
 const amount=value=>Number.isSafeInteger(value)?new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:2}).format(value/100):'尚無可靠資料';
 const specs=[['期間下單數','orderCount'],['期間下單已付款','paidOrderCount'],['期間下單未付款','unpaidOrderCount'],['期間下單取消','canceledOrderCount'],['付款狀態待核對','unknownPaymentStatusCount'],['期間收款筆數','paymentOrderCount'],['收款總額','grossMinor',true],['已記錄退款','refundMinor',true],['淨實收','netMinor',true],['未收款訂單金額','unpaidAmountMinor',true]];
 const metrics=specs.map(([label,key,isAmount])=>[label,unavailable?'尚無可靠資料':isAmount?amount(report[key]):Number.isSafeInteger(report[key])?String(report[key]):'尚無可靠資料']);
 const translations={HISTORICAL_PAYMENTS_UNVERIFIED:'歷史付款與退款資料尚待核對；原始訂單金額（非實收）不列入營收。全來源實收僅含已確認收款。',IDOO_HISTORY_NOT_IMPORTED:'IDoo 歷史尚未匯入，未納入本次報表。',REFUND_WORKFLOW_NOT_IMPLEMENTED:'退款流程尚未建置；已記錄退款為 0 不代表店外沒有退款，淨實收須配合人工核對。',PAYMENT_RECEIPTS_MISSING:'部分已付款狀態缺少收款憑證，未計入實收。',PAYMENT_TIMES_UNKNOWN:'部分收款時間待核對，未按下單日期補列營收。'};
 const notes=(report.limitations??[]).map(code=>translations[code]??'部分資料尚待核對，報表可能不完整。');
 if(!unavailable){notes.push(`收款時間待核對：${report.unknownPaymentTimeCount??'未知'} 筆，已記錄金額 ${amount(report.unknownPaymentTimeAmountMinor)}；範圍為所選來源的全部日期。`);notes.push(`缺少收款憑證：${report.missingReceiptCount??'未知'} 筆；未同步的離線 POS 訂單尚未納入。`);}
 return {metrics,notes,unavailable};
}
export function catalogChanges(before,after){
 const out=[];
 const display=(key,value,catalog)=>{
  if(value===null||value===undefined)return '未設定';
  if(key==='isDefault')return value?'是':'否';
  if(key==='priceMinor'||key==='priceDeltaMinor')return new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:2}).format(value/100);
  if(key==='categoryId')return catalog.categories?.find(c=>c.id===value)?.name??'分類待確認';
  return value;
 };
 const compare=(oldItems,newItems,path)=>{for(const n of newItems){const o=oldItems.find(x=>x.id===n.id);const label=`${path}${n.name}`;if(!o){out.push(`新增 ${label}`);continue;}
 for(const key of ['name','description','categoryId','isDefault','minSelected','maxSelected','maxQuantity','priceMinor','priceDeltaMinor'])if(o[key]!==n[key])out.push(`${label} ${({priceMinor:'售價',priceDeltaMinor:'加價',minSelected:'最少選',maxSelected:'最多選',maxQuantity:'單項上限',name:'名稱',description:'說明',categoryId:'分類',isDefault:'預設規格'})[key]}：${display(key,o[key],before)} → ${display(key,n[key],after)}`);
 for(const key of ['active','available'])if((o[key]!==false)!==(n[key]!==false))out.push(`${label}：${n[key]===false?'停售':'恢復販售'}`);
 if(JSON.stringify(o.modifierGroupIds)!==JSON.stringify(n.modifierGroupIds))out.push(`${label}：調整口味群組`);
 for(const key of ['variants','modifiers'])if(n[key])compare(o[key]??[],n[key],`${label} / `);
 }for(const o of oldItems)if(!newItems.some(n=>n.id===o.id))out.push(`移除 ${path}${o.name}`);
 if(oldItems.map(x=>x.id).join()!==newItems.map(x=>x.id).join())out.push(`${path||'菜單'}排列已調整`);};
 for(const key of ['categories','products','modifierGroups'])compare(before[key]??[],after[key]??[],'');return out;
}

export function importSummary(batch) {
 const count=value=>Number.isSafeInteger(value)&&value>=0?String(value):'待核對';
 const date=value=>{if(value===null||value===undefined||value==='')return '待核對';const d=new Date(value);return Number.isNaN(d.getTime())?'待核對':d.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});};
 const statuses={LIST_CAPTURED_DETAILS_IN_PROGRESS:'訂單清單已擷取，明細擷取中',API_VISIBLE_COMPLETE:'舊系統目前可讀取的資料已擷取完成',API_SNAPSHOT_COMPLETE:'本次來源快照已擷取完整',DETAILS_CAPTURED:'訂單與明細已擷取',UNVERIFIED:'尚待驗證',PENDING:'待核對',BLOCKED:'尚有待解決項目',INCOMPLETE:'尚未完整',COMPLETE:'已核對完整',EXTRACTED:'已擷取'};
 const blockers={SOURCE_TIMESTAMP_SEMANTICS_UNVERIFIED:'來源清單與原始購物車時間有差異，待核對',SOURCE_CONTROLS_LIMITED_TO_100_DAYS:'舊系統統計僅支援近 100 天；較早月份已比對官方訂單匯出檔',ORDER_DETAILS_CAPTURE_IN_PROGRESS:'正在擷取歷史訂單明細',SOURCE_RETENTION_UNVERIFIED:'來源歷史保留範圍尚待確認',PAYMENT_LEDGER_UNVERIFIED:'實際收款紀錄尚待核對',REFUND_LEDGER_UNVERIFIED:'退款紀錄尚待核對',SOURCE_CONTROLS_PARTIAL:'部分來源統計尚待核對',RECONCILIATION_APPROVAL_REQUIRED:'核對結果尚待確認',SOURCE_TOTAL_UNKNOWN:'來源總筆數尚待確認',SOURCE_TOTAL_MISMATCH:'擷取筆數與來源總筆數不一致',ALL_HISTORY_COVERAGE_UNVERIFIED:'全部歷史涵蓋範圍尚待驗證',FINANCIAL_SOURCE_MAPPING_UNVERIFIED:'原始金額與收款欄位對應尚待核對',POSSIBLE_500_ROW_TRUNCATION:'可能受到來源 500 筆上限影響',CONFLICTING_SOURCE_RECORDS:'來源紀錄有衝突',SOURCE_CONTROL_MISMATCH:'來源控制總額不一致'};
 return {count:`${count(batch.recordCount)} / ${count(batch.sourceTotal)}`,extractedAt:date(batch.extractedAt),range:`${date(batch.earliestCreatedAt)} ～ ${date(batch.latestCreatedAt)}`,
  coverage:statuses[batch.coverageStatus]??'待核對',financial:statuses[batch.financialStatus]??'待核對',
  amountLabel:'原始訂單金額（非實收）',amount:Number.isSafeInteger(batch.knownOrderAmountMinor)?new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:2}).format(batch.knownOrderAmountMinor/100):'待核對',
  state:batch.promoted===false?'財務尚待核對，未納入實收':'移轉狀態待核對',notes:(batch.blockers??[]).map(code=>blockers[code]??'另有來源資料項目待核對')};
}


export function reportOrderSummary(order) {
 const amount=value=>Number.isSafeInteger(value)?new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:2}).format(value/100):'待核對';
 const quantity=value=>Number.isFinite(value)?String(value):'待核對';
 const paymentLabels={UNKNOWN:'待核對',PAID_ONSITE:'到店已付款',PAID_ONLINE:'線上已付款',UNPAID_ONSITE:'到店未付款',AWAITING_ONLINE_PAYMENT:'等待線上付款',PAYMENT_UNCERTAIN:'付款待確認',PAYMENT_FAILED:'付款失敗'};
 const posReceipt=order.paymentState==null&&order.source==='POS'&&Number.isSafeInteger(order.receivedAmountMinor)&&!order.receiptMissing;
 const receivedAmountKnown=!order.receiptMissing&&(posReceipt||(Object.hasOwn(paymentLabels,order.paymentState)&&order.paymentState!=='UNKNOWN'));
 const payment=order.paymentState==='UNKNOWN'?'待核對':order.receiptMissing?'憑證待核對':posReceipt?'已收款':paymentLabels[order.paymentState]??'待核對';
 const state=order.orderState??order.status;
 const orderStatus=({HISTORICAL:'歷史訂單',CANCELED:'已取消',CANCELLED:'已取消',COMPLETED:'已完成',PLACED:'已成立',CANCEL_PENDING:'取消處理中'})[state]??'待核對';
 return {payment,orderStatus,createdLabel:order.source==='QUICKCLICK_EAA'?'來源清單時間（台北）':'下單時間（台北）',notes:(order.warnings??[]).includes('SOURCE_TIMESTAMP_SEMANTICS_UNVERIFIED')?['來源時間待核對']:[],originalAmountLabel:'原始訂單金額（非實收）',originalAmount:amount(order.totalAmountMinor),receivedAmountKnown,receivedAmount:receivedAmountKnown?amount(order.receivedAmountMinor):'待核對',
  lines:(order.lines??[]).map(line=>[line.productName??line.name??'品名待核對',quantity(line.quantity),(line.modifiers??[]).map(modifier=>`${modifier.name??'口味待核對'} ×${quantity(modifier.quantity)}`).join('、')||'—',amount(line.lineAmountMinor)])};
}

export function reportOrderPage(orders, requestedPage=0, requestedSize=50) {
 const size=requestedSize===100?100:50,total=orders.length,pageCount=Math.max(1,Math.ceil(total/size));
 const page=Math.max(0,Math.min(pageCount-1,Number.isInteger(requestedPage)?requestedPage:0));
 return {orders:orders.slice(page*size,(page+1)*size),page,pageCount,size,total,from:total?page*size+1:0,to:Math.min(total,(page+1)*size)};
}

export function historyReportFilters(batch) {
 const day=value=>{
  if(value===null||value===undefined||value==='')return null;
  const date=new Date(value);if(Number.isNaN(date.getTime()))return null;
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
 };
 const dateFrom=day(batch.earliestCreatedAt),dateTo=day(batch.latestCreatedAt);
 return dateFrom&&dateTo&&dateFrom<=dateTo?{source:'IDOO',dateFrom,dateTo}:null;
}
