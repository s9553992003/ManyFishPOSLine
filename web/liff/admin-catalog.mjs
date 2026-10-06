import { element } from './ui.mjs';
import { priceMinor } from './admin-state.mjs';
const id=()=>crypto.randomUUID();
export function renderCatalog(host,catalog,onChange){
 host.replaceChildren();
 const rerender=()=>{onChange();renderCatalog(host,catalog,onChange);};
 const button=(text,fn)=>{const b=element('button',text);b.type='button';b.addEventListener('click',fn);return b;};
 const fields=()=>element('div',undefined,'catalog-fields');
 function field(parent,label,obj,key,type='text'){
  const wrap=element('label',label),input=element('input');input.type=type==='money'?'number':type;input.value=type==='money'?(obj[key]??0)/100:obj[key]??'';
  if(type==='money'||type==='number'){input.min='0';input.step=type==='money'?'0.01':'1';}
  input.addEventListener('input',()=>{input.setCustomValidity('');try{obj[key]=type==='money'?priceMinor(input.value):type==='number'?(input.value===''?NaN:Number(input.value)):input.value;}catch(e){obj[key]=NaN;input.setCustomValidity(e.message);}onChange();});wrap.append(input);parent.append(wrap);
 }
 function check(parent,label,obj,key){const wrap=element('label',undefined,'check-field'),input=element('input');input.type='checkbox';input.checked=obj[key]!==false;input.addEventListener('change',()=>{obj[key]=input.checked;onChange();});wrap.append(input,document.createTextNode(label));parent.append(wrap);}
 function reorder(parent,list,item,include=()=>true){const row=element('div',undefined,'button-row'),siblings=list.filter(include);for(const [label,delta] of [['往前',-1],['往後',1]]){const neighbor=siblings[siblings.indexOf(item)+delta];const b=button(label,()=>{if(neighbor){const at=list.indexOf(item),next=list.indexOf(neighbor);[list[at],list[next]]=[list[next],list[at]];rerender();}});b.disabled=!neighbor;row.append(b);}parent.append(row);}
 function detail(parent,title,cls){const d=element('details',undefined,cls);d.append(element('summary',title));parent.append(d);return d;}
 function variants(parent,p){parent.append(element('h3','規格與價格'));const defaultLabel=element('label','預設規格'),defaultSelect=element('select');for(const v of p.variants){const option=element('option',v.name);option.value=v.id;defaultSelect.append(option);}defaultSelect.value=(p.variants.find(v=>v.isDefault)??p.variants[0])?.id??'';defaultSelect.addEventListener('change',()=>{for(const v of p.variants)v.isDefault=v.id===defaultSelect.value;onChange();});defaultLabel.append(defaultSelect);parent.append(defaultLabel);for(const v of p.variants){const row=fields();field(row,'規格名稱',v,'name');field(row,'售價（元）',v,'priceMinor','money');check(row,'上架',v,'active');check(row,'有貨',v,'available');parent.append(row);reorder(parent,p.variants,v);}parent.append(button('新增規格',()=>{p.variants.push({id:id(),name:'新規格',priceMinor:0,isDefault:false,active:true,available:true});rerender();}));}
 function group(parent,g){const d=detail(parent,`${g.name} · 必選 ${g.minSelected} / 最多 ${g.maxSelected}`,'catalog-group');reorder(d,catalog.modifierGroups,g);const f=fields();field(f,'群組名稱',g,'name');field(f,'最少選取數',g,'minSelected','number');field(f,'最多選取數',g,'maxSelected','number');d.append(f);for(const m of g.modifiers){const row=fields();row.classList.add('catalog-row');field(row,'口味名稱',m,'name');field(row,'加價（元）',m,'priceDeltaMinor','money');field(row,'單項數量上限',m,'maxQuantity','number');check(row,'上架',m,'active');check(row,'有貨',m,'available');d.append(row);reorder(d,g.modifiers,m);}d.append(button('新增口味',()=>{g.modifiers.push({id:id(),name:'新口味',priceDeltaMinor:0,maxQuantity:Math.max(1,g.maxSelected),active:true,available:true});rerender();}));}
 for(const c of catalog.categories){const section=detail(host,c.name,'catalog-category');const f=fields();field(f,'分類名稱',c,'name');field(f,'分類色彩',c,'color','color');section.append(f);reorder(section,catalog.categories,c);
 for(const p of catalog.products.filter(x=>x.categoryId===c.id)){
 const d=detail(section,`${p.name}${p.active===false?' · 已停售':''}`,'catalog-product'),pf=fields();field(pf,'商品名稱',p,'name');field(pf,'商品說明',p,'description');field(pf,'單位',p,'unit');check(pf,'商品上架',p,'active');check(pf,'目前有貨',p,'available');
 const label=element('label','所屬分類'),select=element('select');for(const category of catalog.categories){const o=element('option',category.name);o.value=category.id;select.append(o);}select.value=p.categoryId;select.addEventListener('change',()=>{p.categoryId=select.value;rerender();});label.append(select);pf.append(label);d.append(pf);reorder(d,catalog.products,p,item=>item.categoryId===p.categoryId);variants(d,p);
 d.append(element('h3','使用的口味群組'));const choices=fields();for(const g of catalog.modifierGroups){const label=element('label',undefined,'check-field'),input=element('input');input.type='checkbox';input.checked=(p.modifierGroupIds??[]).includes(g.id);input.addEventListener('change',()=>{p.modifierGroupIds=input.checked?[...(p.modifierGroupIds??[]),g.id]:(p.modifierGroupIds??[]).filter(x=>x!==g.id);onChange();});label.append(input,document.createTextNode(g.name));choices.append(label);}d.append(choices);
 }
 section.append(button('在此分類新增商品',()=>{catalog.products.push({id:id(),categoryId:c.id,name:'新商品',description:'',unit:'份',active:true,available:true,variants:[{id:id(),name:'單份',priceMinor:0,isDefault:true}],modifierGroupIds:[]});rerender();}));
 }
 host.append(button('新增分類',()=>{catalog.categories.push({id:id(),name:'新分類',color:'#EBE3D9'});rerender();}));host.append(element('h3','共用口味群組'),element('p','群組可供多個商品使用；修改會影響所有使用此群組的商品。','muted'));
 for(const g of catalog.modifierGroups)group(host,g);
 host.append(button('新增口味群組',()=>{catalog.modifierGroups.push({id:id(),name:'新口味群組',minSelected:0,maxSelected:1,modifiers:[{id:id(),name:'新口味',priceDeltaMinor:0,maxQuantity:1}]});rerender();}));
}
