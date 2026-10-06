import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAdminPage } from '../admin-navigation.mjs';
test('navigation resolves current and old links and defaults to reports',()=>{
 const admin={role:'ADMIN'};
 for(const id of ['reports-section','menu-section','schedule-section','orders-section','management-section','imports-section'])assert.equal(resolveAdminPage('#'+id,admin),id);
 assert.equal(resolveAdminPage('#schedule-form',admin),'schedule-section');
 assert.equal(resolveAdminPage('#admin-orders',admin),'orders-section');
 assert.equal(resolveAdminPage('#unknown',admin),'reports-section');
});
test('signed out and password reset sessions cannot open pages; staff cannot open management',()=>{
 assert.equal(resolveAdminPage('#menu-section',null),null);
 assert.equal(resolveAdminPage('#menu-section',{role:'ADMIN',mustChangePassword:true}),null);
 assert.equal(resolveAdminPage('#imports-section',{role:'STAFF'}),'reports-section');
 assert.equal(resolveAdminPage('#management-section',{role:'STAFF'}),'reports-section');
 assert.equal(resolveAdminPage('#menu-section',{role:'STAFF'}),'menu-section');
});

test('switching panels preserves drafts, supports history, and closes the mobile menu',async()=>{
 const {createAdminNavigation}=await import('../admin-navigation.mjs');
 const node=()=>({hidden:false,textContent:'',events:{},attrs:{},classList:{values:new Set(),add(x){this.values.add(x)},remove(x){this.values.delete(x)},toggle(x,on){const enabled=on??!this.values.has(x);enabled?this.add(x):this.remove(x);return enabled;}},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},addEventListener(k,fn){this.events[k]=fn},focus(){this.focused=true}});
 const ids=['reports-section','menu-section','schedule-section','orders-section','management-section','imports-section'];
 const nodes=Object.fromEntries([...ids,'admin-sidebar','admin-menu-toggle','admin-page-label'].map(id=>[id,node()]));
 const links=ids.map(id=>Object.assign(node(),{hash:'#'+id,textContent:id}));
 const doc={body:node(),getElementById:id=>nodes[id],querySelectorAll:()=>links};
 const win={location:{hash:''},events:{},addEventListener(k,fn){this.events[k]=fn},scrollTo(){},history:{pushState(a,b,url){win.location.hash=url},replaceState(a,b,url){win.location.hash=url}}};
 let user={role:'ADMIN'};const nav=createAdminNavigation(()=>user,doc,win);nav.refresh();
 nodes['menu-section'].draft='尚未儲存的菜單';nav.open('menu-section');
 assert.deepEqual(ids.filter(id=>!nodes[id].hidden),['menu-section']);
 assert.equal(links[1].attrs['aria-current'],'page');assert.equal(nodes['menu-section'].focused,true);
 nodes['admin-menu-toggle'].events.click();assert.equal(nodes['admin-menu-toggle'].attrs['aria-expanded'],'true');
 nav.open('reports-section');assert.equal(nodes['admin-menu-toggle'].attrs['aria-expanded'],'false');
 win.location.hash='#menu-section';win.events.popstate();assert.equal(nodes['menu-section'].draft,'尚未儲存的菜單');assert.equal(nodes['menu-section'].hidden,false);
 user={role:'STAFF'};nav.open('imports-section');assert.equal(nodes['imports-section'].hidden,true);assert.equal(links[5].hidden,true);
 user=null;nav.refresh();assert.ok(ids.every(id=>nodes[id].hidden));
});
