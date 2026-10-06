import { ApiError } from './api.mjs';
export class BackofficeApi {
  constructor(fetchImpl=globalThis.fetch.bind(globalThis)){this.fetch=fetchImpl;}
  async admin(path,method='GET',body){
    const headers={Accept:'application/json'};
    if(method!=='GET'&&this.csrfToken)headers['X-CSRF-Token']=this.csrfToken;
    const options={method,credentials:'same-origin',headers};
    if(body!==undefined){headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
    const response=await this.fetch(`/v1/admin/${path}`,options);
    let data;try{data=await response.json();}catch{data={};}
    if(!response.ok)throw new ApiError(response.status,data.error??'INVALID_RESPONSE');
    return data;
  }
  async session(){const data=await this.admin('session');this.csrfToken=data.csrfToken;return data;}
  async login(username,password){const data=await this.admin('session','POST',{username,password});this.csrfToken=data.csrfToken;return data;}
  async logout(){await this.admin('session','DELETE');this.csrfToken=undefined;}
  password(currentPassword,newPassword){return this.admin('password','POST',{currentPassword,newPassword});}
  draft(){return this.admin('menu/draft');}
  menu(){return this.admin('menu');}
  saveDraft(expectedRevision,catalog){return this.admin('menu/draft','PUT',{expectedRevision,catalog});}
  publish(expectedRevision){return this.admin('menu/publish','POST',{expectedRevision});}
  users(){return this.admin('users');}
  createUser(body){return this.admin('users','POST',body);}
  updateUser(id,body){return this.admin(`users/${encodeURIComponent(id)}`,'PATCH',body);}
  imports(){return this.admin('imports');}
  devices(){return this.admin('devices');}
  pairDevice(name){return this.admin('devices','POST',{name});}
  disableDevice(id){return this.admin(`devices/${encodeURIComponent(id)}`,'PATCH',{active:false});}
  reports(filters){return this.admin(`reports?${new URLSearchParams(filters)}`);}
  schedule(){return this.admin('pickup-schedule');}
  saveSchedule(body){return this.admin('pickup-schedule','PUT',body);}
  pickupSlots(){return this.admin('pickup-slots');}
  previewSchedule(body){return this.admin('pickup-slots','POST',body);}
  orderingState(){return this.admin('ordering');}
  ordering(enabled){return this.admin('ordering','PATCH',{enabled});}
  orderAction(id,action,body){return this.admin(`orders/${encodeURIComponent(id)}/${action}`,'POST',body);}
  availability(body){return this.admin('menu/availability','POST',body);}
  orders(){return this.admin('orders');}
}
