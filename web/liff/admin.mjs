import { filterOrders, orderActions, reportCsv, deviceSummary, hasAvailabilityDraftConflict } from './admin-operations.mjs';
import { createAdminNavigation } from './admin-navigation.mjs';
import { adminErrorMessage, AdminInputError, sourceLabel, fieldValidationMessage } from './admin-locale.mjs';
import { BackofficeApi } from "./admin-api.mjs";
import { validateCatalog, catalogChanges, canManageUsers, reportSummary, reportOrderSummary, reportOrderPage, importSummary, historyReportFilters } from "./admin-state.mjs";
import { renderCatalog } from "./admin-catalog.mjs";
import { parseSchedule, groupSlots } from "./state.mjs";
import { element, orderCard, money } from "./ui.mjs";
const $ = (id) => document.getElementById(id),
  api = new BackofficeApi();
let version,
  busy = false;
const weekdays = [
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
  "星期日",
];
for (let i = 0; i < 7; i++) {
  const label = element("label", weekdays[i]);
  const input = element("input");
  input.id = `window-${i}`;
  input.placeholder = "11:00-20:00";
  label.append(input);
  $("weekly-windows").append(label);
}
function status(text, error = false) {
  $("admin-status").textContent = text;
  $("admin-status").classList.toggle("error", error);
}
async function run(fn) {
  if (busy) return;
  busy = true;
  $("admin-workspace").inert = true;
  try {
    await fn();
  } catch (e) {
    if (e.status === 401 && e.code !== 'INVALID_CREDENTIALS') showSignedOut();
    status(adminErrorMessage(e), true);
  } finally {
    busy = false;
    $("admin-workspace").inert = false;
    syncPublishButton();
  }
}
function click(id, fn) {
  $(id).addEventListener("click", () => run(fn));
}
async function readSchedule() {
  const schedule = await api.schedule();
  version = schedule.scheduleVersion;
  $("schedule-version").textContent = `設定版本 ${version}`;
  $("advance-days").value = schedule.advanceDays;
  $("interval").value = schedule.slotIntervalMinutes;
  $("lead").value = schedule.minimumLeadMinutes;
  $("store-timezone").value = schedule.storeTimeZone;
  $("closed-dates").value = schedule.closedDates.join("\n");
  for (let i = 0; i < 7; i++)
    $(`window-${i}`).value = (schedule.weeklyWindows[String(i)] ?? [])
      .map((window) => window.join("-"))
      .join(", ");
}
function draftSchedule() {
  try { return parseSchedule(
    {
      advanceDays: $("advance-days").value,
      slotIntervalMinutes: $("interval").value,
      minimumLeadMinutes: $("lead").value,
      storeTimeZone: $("store-timezone").value.trim(),
      closedDates: $("closed-dates").value,
      windows: weekdays.map((_, i) => $(`window-${i}`).value),
    },
    version,
  ); } catch (error) {
    throw new AdminInputError(error instanceof RangeError ? "休店日期不正確，請輸入有效日期（例如 2026-10-10）。" : error.message.replace("YYYY-MM-DD", "西元年-月-日，例如 2026-10-10"));
  }
}
async function preview(draft = false) {
  const data = draft
    ? await api.previewSchedule(draftSchedule())
    : await api.pickupSlots();
  const groups = groupSlots(data);
  $("slot-preview").replaceChildren();
  if (!groups.length)
    $("slot-preview").append(element("p", "目前沒有可選時段。", "empty"));
  for (const group of groups) {
    const block = element("details");
    const heading = element(
      "summary",
      `${group.date} · ${group.slots.length} 個時段`,
    );
    const list = element("div", undefined, "slot-chips");
    for (const slot of group.slots)
      list.append(element("span", slot.label, "badge"));
    block.append(heading, list);
    $("slot-preview").append(block);
  }
  const label = data.draft
    ? `尚未儲存 · 目前填寫設定的時段預覽（基於版本 ${data.scheduleVersion}）`
    : `已儲存設定的時段（版本 ${data.scheduleVersion}）`;
  $("slot-preview-label").textContent = label;
  status(label);
}
let orderRows=[], loadedReport, loadedReportName, loadedReportFilters, availabilityRevision;
const pendingCommands=new Map();
async function orders() {
 const data=await api.orders();orderRows=data.orders;renderOrders();
}
function renderOrders() {
 const sorted=filterOrders(orderRows,{query:$('order-query').value,payment:$('order-payment').value,production:$('order-production').value}).sort((a,b)=>String(a.pickupAt).localeCompare(String(b.pickupAt))||String(a.orderId).localeCompare(String(b.orderId)));
 $('admin-orders').replaceChildren();$('order-count').textContent=`符合 ${sorted.length} 筆 / 已載入 ${orderRows.length} 筆`;
 for(const order of sorted){
  const card=orderCard(order),buttons=element('div',undefined,'button-row');
  for(const name of orderActions(order)){
   const label=({start:'開始製作',ready:'完成製作',complete:'已取餐完成',collect:'登記到店收款',cancel:'取消訂單'})[name];
   if(name==='collect'){
    const method=element('select');method.setAttribute('aria-label',`${order.readableNumber} 收款方式`);
    for(const [value,text] of [['CASH','現金'],['ELECTRONIC_STAFF_CONFIRMED','店員確認電子收款']]){const option=element('option',text);option.value=value;method.append(option);}
    buttons.append(method,action(label,()=>operateOrder(order,name,method.value)));
   }else buttons.append(action(label,()=>operateOrder(order,name)));
  }
  card.append(buttons);$('admin-orders').append(card);
 }
 if(!sorted.length)$('admin-orders').append(element('p','沒有符合條件的訂單。','panel empty'));
}
async function operateOrder(order,name,method) {
 if(!orderActions(order).includes(name))throw new AdminInputError('此訂單目前不可執行這項操作，請更新訂單。');
 if(name==='collect'&&!confirm(`請確認已實際收到 ${money(order.totalAmountMinor)}（${method==='CASH'?'現金':'電子收款'}），才登記收款。`))return;
 if(name==='cancel'&&!confirm(`確定取消訂單 ${order.readableNumber}？`))return;
 const key=`${order.orderId}:${order.revision}:${name}:${method??''}`;
 let body=pendingCommands.get(key);
 if(!body){body={expectedRevision:order.revision,...(name==='collect'?{checkoutKey:crypto.randomUUID(),amountMinor:order.totalAmountMinor,method}:{commandId:crypto.randomUUID()})};pendingCommands.set(key,body);}
 try{await api.orderAction(order.orderId,name,body);pendingCommands.delete(key);}
 catch(error){await orders().catch(()=>{});throw error;}
 await orders();status('訂單操作已完成，已重新讀取最新狀態。');
}
$('order-filters').addEventListener('submit',event=>event.preventDefault());
for(const id of ['order-query','order-payment','order-production'])$(id).addEventListener('input',renderOrders);
async function readOrdering() {
  const state = await api.orderingState();
  $("ordering-state").textContent = state.enabled
    ? "目前開放接單"
    : "目前暫停接單";
}
$("schedule-form").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const schedule = draftSchedule();
    const saved = await api.saveSchedule(schedule);
    version = saved.scheduleVersion;
    $("schedule-version").textContent = `設定版本 ${version}`;
    await preview();
    status(`預約設定已儲存（版本 ${version}），既有訂單不受影響。`);
  });
});
click("reload-schedule", async () => {
  await readSchedule();
  status("已重新讀取最新設定。");
});
click("preview-slots", () => preview(true));
click("admin-refresh-orders", async () => {
  await orders();
  status("已更新訂單。");
});
for (const [id, enabled] of [
  ["pause-ordering", false],
  ["resume-ordering", true],
])
  click(id, async () => {
    const result = await api.ordering(enabled);
    $("ordering-state").textContent = result.enabled
      ? "目前開放接單"
      : "目前暫停接單";
    status(
      result.enabled
        ? "已恢復接單。"
        : "已暫停新單，既有訂單仍可查詢與處理。",
    );
  });
let user, draftOwner, draft, published, dirty=false, previewed=false;
const navigation = createAdminNavigation(() => user);
function syncPublishButton(){ $('publish-menu').disabled=busy||dirty||!previewed||!draft; }
function showSignedOut(){user=undefined;orderRows=[];loadedReport=undefined;pendingCommands.clear();$('export-report').disabled=true;$('availability-list').replaceChildren();$('device-list').replaceChildren();$('login-panel').hidden=false;$('account-panel').hidden=true;$('admin-workspace').hidden=true;$('pair-result').textContent='';$('import-batches').replaceChildren();navigation.refresh();}
function submit(id,fn){$(id).addEventListener('submit',event=>{event.preventDefault();run(fn);});}
function action(text,fn){const b=element('button',text);b.type='button';b.addEventListener('click',()=>run(fn));return b;}
async function signedIn(session){
 if(draftOwner && draftOwner !== session.user.id){draft=undefined;published=undefined;dirty=false;previewed=false;$('catalog-editor').replaceChildren();}
 user=session.user;$('login-panel').hidden=true;$('account-panel').hidden=false;$('signed-in-user').textContent=`${user.username} · ${user.role==='ADMIN'?'管理員':'店員'}`;
 document.querySelectorAll('[data-admin-only]').forEach(x=>x.hidden=!canManageUsers(user));
 $('admin-workspace').hidden=!!user.mustChangePassword;
 navigation.refresh();
 if(user.mustChangePassword){$('password-details').open=true;status('請先設定新密碼，再使用店家後台。');return;}
 if(!draft||!dirty)await readMenu();
 await readAvailability();await readSchedule();await orders();await readOrdering();await readReport();
 if(canManageUsers(user)){await readManagement();await readImports();}status('已登入店家後台。');
}
submit('admin-login',async()=>{const session=await api.login($('admin-username').value.trim(),$('admin-password').value);$('admin-password').value='';await signedIn(session);});
click('logout',async()=>{await api.logout();draft=undefined;published=undefined;dirty=false;previewed=false;$('catalog-editor').replaceChildren();$('report-result').replaceChildren();$('admin-orders').replaceChildren();$('user-list').replaceChildren();showSignedOut();status('已登出。');});
submit('password-form',async()=>{if($('new-password').value!==$('confirm-password').value)throw new AdminInputError('兩次輸入的新密碼不一致。');await api.password($('current-password').value,$('new-password').value);$('password-form').reset();showSignedOut();status('密碼已更新，請使用新密碼重新登入。');});
function menuChanged(){dirty=true;previewed=false;$('menu-state').textContent='有尚未儲存的修改。';$('menu-diff').replaceChildren();syncPublishButton();}
async function readMenu(){const [next,live]=await Promise.all([api.draft(),api.menu()]);draft=next;draftOwner=user.id;published=live;dirty=false;previewed=false;$('draft-version').textContent=`草稿 ${draft.revision} · 已發布 ${published.menuVersion}`;$('menu-state').textContent='已讀取草稿。';$('menu-diff').replaceChildren();renderCatalog($('catalog-editor'),draft.catalog,menuChanged);syncPublishButton();}
function checkMenu(){const errors=validateCatalog(draft.catalog);if(errors.length)throw new AdminInputError(errors.join('；'));}
click('reload-menu',async()=>{if(dirty&&!confirm('重新讀取會捨棄本頁尚未儲存的菜單修改，是否繼續？'))return;await readMenu();status('已重新讀取菜單草稿。');});
click('save-menu',async()=>{checkMenu();const saved=await api.saveDraft(draft.revision,draft.catalog);draft=saved;dirty=false;previewed=false;$('draft-version').textContent=`草稿 ${draft.revision} · 已發布 ${published.menuVersion}`;$('menu-state').textContent='草稿已儲存，請預覽發布差異。';status('菜單草稿已儲存。');});
click('preview-menu',async()=>{checkMenu();if(dirty)throw new AdminInputError('請先儲存草稿，再預覽發布差異。');const list=element('ul');const changes=catalogChanges(published,draft.catalog);for(const change of changes)list.append(element('li',change));$('menu-diff').replaceChildren(element('h3','此次發布差異'),changes.length?list:element('p','與已發布菜單沒有欄位差異。'));previewed=true;$('menu-state').textContent='已預覽；發布後新訂單使用新菜單。';});
click('publish-menu',async()=>{if(dirty||!previewed)throw new AdminInputError('請先儲存並預覽草稿。');checkMenu();await api.publish(draft.revision);await readMenu();await readAvailability();status('菜單已發布，POS 與 LINE 將取得新版本。');});
async function readAvailability(){
 const [live,currentDraft]=await Promise.all([api.menu(),api.draft()]);availabilityRevision=currentDraft.revision;
 const host=$('availability-list');host.replaceChildren();
 const conflict=hasAvailabilityDraftConflict(live,currentDraft.catalog);
 $('availability-state').textContent=`已發布版本 ${live.menuVersion}。${conflict?'有未發布草稿，快速販售切換暫停；請先發布或處理草稿。':'販售狀態依已發布菜單顯示。'}`;
 function row(label,item,target){const line=element('div',undefined,'account-row');line.append(element('span',label),element('span',item.active===false?'已停用':item.available===false?'已售完':'販售中','badge'));
 const button=action(item.available===false?'恢復販售':'設為售完',async()=>{
  if(dirty)throw new AdminInputError('本頁有尚未儲存的菜單修改，請先儲存並處理草稿後再切換販售狀態。');
  try{await api.availability({expectedRevision:availabilityRevision,...target,available:item.available===false});}
  catch(error){await readAvailability().catch(()=>{});throw error;}
  await readAvailability();await readMenu();status('販售狀態已發布，POS 與 LINE 將取得新版本。');
 });button.disabled=conflict||item.active===false;line.append(button);host.append(line);}
 for(const product of live.products??[]){row(product.name,product,{productId:product.id});for(const variant of product.variants??[])row(`${product.name} / ${variant.name}`,variant,{productId:product.id,variantId:variant.id});}
 for(const group of live.modifierGroups??[])for(const modifier of group.modifiers??[])row(`${group.name} / ${modifier.name}`,modifier,{groupId:group.id,modifierId:modifier.id});
}
click('refresh-availability',readAvailability);
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());$('report-from').value=today;$('report-to').value=today;
function table(headers,rows){const wrap=element('div',undefined,'admin-table-wrap'),t=element('table',undefined,'admin-table'),head=element('thead'),tr=element('tr');for(const label of headers)tr.append(element('th',label));head.append(tr);const body=element('tbody');for(const row of rows){const r=element('tr');for(const value of row)r.append(element('td',String(value??'—')));body.append(r);}t.append(head,body);wrap.append(t);return wrap;}
async function readReport(){
 const dateFrom=$('report-from').value,dateTo=$('report-to').value;if(dateFrom>dateTo)throw new AdminInputError('結束日期不可早於開始日期。');
 $('export-report').disabled=true;loadedReport=undefined;
 const report=await api.reports({dateFrom,dateTo,source:$('report-source').value}),root=$('report-result');root.replaceChildren();const metrics=element('div',undefined,'metrics');
 const view=reportSummary(report);
 for(const [label,value] of view.metrics){const card=element('div',label,'metric');card.append(element('strong',value));metrics.append(card);}root.append(metrics);
 for(const note of view.notes)root.append(element('p',note,'notice'));
 if(view.unavailable)return;
 loadedReport=report;loadedReportFilters={dateFrom,dateTo,source:$('report-source').value};loadedReportName=`ManyFish-${dateFrom}-${dateTo}-${$('report-source').value}.csv`;$('export-report').disabled=false;
 root.append(element('h3','餐點銷量（收款日）'),table(['餐點','數量','金額'],(report.items??[]).map(x=>[x.name,x.quantity,Number.isSafeInteger(x.amountMinor)?money(x.amountMinor):'待核對'])));
 root.append(element('h3','口味銷量（收款日）'),table(['口味','數量'],(report.modifiers??[]).map(x=>[x.name,x.quantity])));
 const details=element('details');details.append(element('summary',`訂單明細（${report.orders?.length??0} 筆）`));
 const rows=report.orders??[],pager=element('div',undefined,'button-row'),list=element('div'),count=element('span',undefined,'muted');count.setAttribute('role','status');
 const sizeLabel=element('label','每頁筆數'),sizeSelect=element('select');sizeSelect.setAttribute('aria-label','每頁訂單筆數');for(const size of [50,100]){const option=element('option',String(size));option.value=String(size);sizeSelect.append(option);}sizeLabel.append(sizeSelect);
 let page=0;
 const previous=action('上一頁',()=>{page-=1;renderPage();}),next=action('下一頁',()=>{page+=1;renderPage();});
 pager.append(sizeLabel,previous,count,next);details.append(pager,list);
 sizeSelect.addEventListener('change',()=>{page=0;renderPage();});
 function renderPage(){
 const result=reportOrderPage(rows,page,Number(sizeSelect.value));page=result.page;list.replaceChildren();
 previous.disabled=page===0;next.disabled=page===result.pageCount-1;count.textContent=`第 ${result.from}–${result.to} 筆，共 ${result.total} 筆 · 第 ${page+1}/${result.pageCount} 頁`;
 const time=value=>{if(value===null||value===undefined)return '待核對';const date=new Date(value);return Number.isNaN(date.getTime())?'待核對':date.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});};
 for(const order of result.orders){
  const view=reportOrderSummary(order),card=element('details',undefined,'catalog-product');
  card.append(element('summary',`${order.readableNumber??order.number??order.orderNumber??order.sourceRecordId??order.orderId??order.id} · ${sourceLabel(order.source??order.channel)} · ${view.payment}`));
  const scope=[order.includedInPlacedCounts?'本期下單':'',order.includedInRevenue?'本期實收':'',order.paymentState==='UNKNOWN'?'歷史付款待核對':'',order.paymentTimeUnknown?'收款時間待核對':'',order.receiptMissing?'缺憑證':''].filter(Boolean).join('、');
  card.append(table(['項目','訂單紀錄'],[[view.createdLabel,time(order.createdAt)],['收款時間（台北）',time(order.paidAt)],['訂單狀態',view.orderStatus],['付款狀態',view.payment],[view.originalAmountLabel,view.originalAmount],['已確認收款金額',view.receivedAmount],['統計範圍',scope||'待核對']]));
  for(const note of view.notes)card.append(element('p',note,'notice'));
  card.append(element('h3','原始餐點與口味'),table(['餐點','數量','口味與數量','原始餐點金額（非實收）'],view.lines));
  if(!view.lines.length)card.append(element('p','此筆訂單未提供餐點明細。','muted'));
  list.append(card);
 }
 }
 renderPage();
 root.append(details);
}
click('export-report',()=>{if(!loadedReport)return;const url=URL.createObjectURL(new Blob([reportCsv(loadedReport,loadedReportFilters)],{type:'text/csv;charset=utf-8'}));const a=element('a');a.href=url;a.download=loadedReportName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已匯出目前查詢的全部訂單，不含聯絡資料。');});
submit('reports-form',async()=>{await readReport();status('報表已更新。');});
async function readManagement(){
 const [accounts,devices]=await Promise.all([api.users(),api.devices()]);$('user-list').replaceChildren();
 for(const account of accounts.users){const row=element('div',undefined,'account-row');row.append(element('strong',account.username),element('span',account.active?'啟用':'停用','badge'));
 const role=element('select');role.setAttribute('aria-label',`${account.username} 角色`);for(const [value,label] of [['STAFF','店員'],['ADMIN','管理員']]){const option=element('option',label);option.value=value;role.append(option);}role.value=account.role;
 row.append(role,action('儲存角色',async()=>{await api.updateUser(account.id,{role:role.value});await readManagement();status('帳號角色已更新。');}),action(account.active?'停用帳號':'啟用帳號',async()=>{await api.updateUser(account.id,{active:!account.active});await readManagement();status('帳號狀態已更新。');}));
 const password=element('input');password.type='password';password.autocomplete='new-password';password.placeholder='重設為新密碼（至少 8 個字元）';password.setAttribute('aria-label',`${account.username} 重設密碼`);
 row.append(password,action('重設密碼',async()=>{if(password.value.length<8)throw new AdminInputError('新密碼至少需要 8 個字元。');await api.updateUser(account.id,{password:password.value});password.value='';status('密碼已重設，此帳號下次登入需變更密碼。');}));$('user-list').append(row);
 }
 $('device-list').replaceChildren();for(const device of devices.devices){const row=element('div',undefined,'account-row');const view=deviceSummary(device);row.append(element('strong',device.name),element('span',view.connection,'badge'),table(['裝置回報項目','最近回報值'],[['最後連線（台北）',view.lastSeen],['菜單版本',view.menuVersion],['待上傳筆數',view.pending],['同步狀態',view.sync],['最後成功同步（台北）',view.lastSync]]),element('p','菜單版本、待上傳筆數與同步狀態由裝置回報；離線時不是即時資料。','fineprint'));if(device.active)row.append(action('停用裝置',async()=>{await api.disableDevice(device.id);await readManagement();status('裝置已停用。');}));$('device-list').append(row);}
}
async function readImports(){
 if(!canManageUsers(user))return;
 const data=await api.imports(),host=$('import-batches');host.replaceChildren();
 if(!data.batches.length){host.append(element('p','尚無擷取批次摘要。','empty'));return;}
 for(const batch of data.batches){
  const summary=importSummary(batch),card=element('article',undefined,'panel');
  card.append(element('h3',`${sourceLabel(batch.source)} · 批次 ${batch.batchId}`),element('p',summary.state,'badge'));
  const filters=historyReportFilters(batch),browse=action('查閱歷史訂單',async()=>{
   if(!filters)return;
   $('report-source').value=filters.source;$('report-from').value=filters.dateFrom;$('report-to').value=filters.dateTo;
   await readReport();navigation.open('reports-section');status('已載入完整來源日期範圍的歷史訂單，付款資料仍待核對。');
  });browse.disabled=!filters;card.append(browse);
  card.append(table(['核對項目','批次摘要'],[['已擷取 / 來源總筆數',summary.count],['擷取時間（台北）',summary.extractedAt],['來源訂單日期範圍（台北）',summary.range],['涵蓋範圍核對',summary.coverage],['財務核對',summary.financial],[summary.amountLabel,summary.amount]]));
  if(summary.notes.length){const list=element('ul');for(const note of summary.notes)list.append(element('li',note));card.append(element('h3','待核對項目'),list);}
  host.append(card);
 }
}
click('refresh-devices',async()=>{await readManagement();status('已更新裝置最近回報資料。');});
click('refresh-imports',async()=>{await readImports();status('歷史資料批次摘要已更新。');});
submit('create-user',async()=>{await api.createUser({username:$('new-username').value.trim(),password:$('user-password').value,role:$('user-role').value});$('create-user').reset();await readManagement();status('已建立帳號，首次登入需修改密碼。');});
submit('pair-device',async()=>{const result=await api.pairDevice();const raw=result.expiresAt;const date=typeof raw==='number'?new Date(raw<1e12?raw*1000:raw):new Date(raw);$('pair-result').textContent=`配對碼：${result.pairCode} · 到期：${date.toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}。請在 POS「設定」輸入這 6 位數字，即可完成配對。`;await readManagement();});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
run(async()=>{try{await signedIn(await api.session());}catch(e){if(e.status===401){showSignedOut();status('請使用個人店家帳號登入。');}else throw e;}});

// 自訂欄位提示，避免受瀏覽器介面語言影響。
const localizedFields = new WeakSet();
document.addEventListener('invalid', event => {
 const field = event.target;
 if (!field.setCustomValidity || field.validity.customError) return;
 field.setCustomValidity(fieldValidationMessage(field));
 localizedFields.add(field);
}, true);
for (const name of ['input', 'change']) document.addEventListener(name, event => {
 if (localizedFields.has(event.target)) { event.target.setCustomValidity(''); localizedFields.delete(event.target); }
}, true);
