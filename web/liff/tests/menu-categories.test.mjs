import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleMenu } from '../basket.mjs';
test('empty, sold-out and variant-unavailable categories are hidden without changing menu',()=>{
 const menu={categories:['empty','sold','variants','live'].map(id=>({id})),products:[{categoryId:'sold',available:false,variants:[{}]},{categoryId:'variants',variants:[{active:false}]},{categoryId:'live',variants:[{}]}]};
 const view=visibleMenu(menu,'empty');
 assert.deepEqual(view.categories.map(c=>c.id),['live']);assert.equal(view.categoryId,'live');assert.equal(view.products.length,1);assert.equal(menu.categories.length,4);
});
test('visible selection and category order are preserved; all hidden has no selection',()=>{
 const menu={categories:[{id:'b'},{id:'a'}],products:[{categoryId:'a',variants:[{}]},{categoryId:'b',variants:[{}]}]};
 assert.equal(visibleMenu(menu,'a').categoryId,'a');assert.deepEqual(visibleMenu(menu).categories.map(c=>c.id),['b','a']);
 assert.deepEqual(visibleMenu({...menu,products:[]},'a'),{categories:[],categoryId:undefined,products:[]});
});
