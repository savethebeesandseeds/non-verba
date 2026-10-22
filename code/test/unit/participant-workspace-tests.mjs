// SPDX-License-Identifier: AGPL-3.0-only
// Local UI draft constraints only. These do not validate a service request,
// agreement, price, identity, entitlement or protocol record.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace, validateRequest, validateOffer, validateOperation, parseView, reduceStatuses,
  setStatusSources, renderStatuses, renderRoleSetup, renderAttention, mountBackControl,
  workflowAccess, PARTICIPANT_VIEWS} from '../../../web/apps/non-verba/src/participant.js';

assert.equal(process.platform, 'linux', 'Run only in the managed Debian container.');
assert.equal(process.env.NONVERBA_CONTAINER, '1', 'Use the managed container launcher.');

test('new preview workspaces have separate empty drafts without account or service state', () => {
  const first = createWorkspace(), second = createWorkspace();
  assert.deepEqual(first, {
    request:{title:'', description:'', place:'', budget:''},
    offer:{message:'', price:''},
    operation:{title:'', description:''},
    lastRoutes:{requester:'requester', operator:'operator'},
  });
  first.request.title = 'Private local draft';
  first.offer.message = 'Separate local offer';
  first.operation.title = 'Separate operation';
  first.lastRoutes.operator = 'operator/offer';
  assert.equal(second.request.title, '');
  assert.equal(second.offer.message, '');
  assert.equal(second.operation.title, '');
  assert.notEqual(first.operation, first.request);
  assert.notEqual(first.operation, first.offer);
  assert.equal(second.lastRoutes.operator, 'operator');
  assert.equal(first.offer.title, undefined);
  assert.equal(first.request.message, undefined);
});

test('request review requires a title and description, while place and budget stay optional', () => {
  const draft = {title:'Repair a gate', description:'The latch needs a repair.'};
  assert.deepEqual(validateRequest(draft), {valid:true, errors:[]});
  for (const field of ['title','description']) {
    const result = validateRequest({...draft, [field]:' \n\t '});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.field === field));
    assert.ok(result.errors.every(error => typeof error.message === 'string' && error.message.length > 0));
  }
  const empty = validateRequest({});
  assert.equal(empty.valid, false);
  assert.deepEqual(new Set(empty.errors.map(error => error.field)), new Set(['title','description']));
});

test('all request fields enforce their stated maximum without rewriting input', () => {
  const limits = {title:80, description:1000, place:120, budget:60};
  const full = Object.fromEntries(Object.entries(limits).map(([field, limit]) => [field, 'x'.repeat(limit)]));
  assert.equal(validateRequest(full).valid, true);
  for (const [field, limit] of Object.entries(limits)) {
    const draft = {...full, [field]:'x'.repeat(limit + 1)}, before = {...draft};
    const result = validateRequest(draft);
    assert.equal(result.valid, false, field + ' above maximum');
    assert.ok(result.errors.some(error => error.field === field));
    assert.deepEqual(draft, before, 'Validation must not silently truncate or normalize the draft.');
  }
});

test('offer review requires a message and permits an omitted or textual price', () => {
  assert.deepEqual(validateOffer({message:'I can help after we agree the details.'}), {valid:true, errors:[]});
  assert.equal(validateOffer({message:'I can help.', price:'To be agreed together'}).valid, true);
  const blank = validateOffer({message:' \n\t ', price:'75'});
  assert.equal(blank.valid, false);
  assert.ok(blank.errors.some(error => error.field === 'message'));
  assert.equal(validateOffer({message:'x'.repeat(1000), price:'x'.repeat(60)}).valid, true);
  for (const [field, value] of [['message','x'.repeat(1001)],['price','x'.repeat(61)]]) {
    const draft = {message:'I can help.', price:'', [field]:value}, before = {...draft};
    const result = validateOffer(draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.field === field));
    assert.deepEqual(draft, before);
  }
});

test('operation review needs its own title and description, with literal bounded draft input', () => {
  const draft = {title:'Inspect the gate', description:'<b>Describe the condition</b>'};
  assert.deepEqual(validateOperation(draft), {valid:true, errors:[]});
  assert.deepEqual(draft, {title:'Inspect the gate', description:'<b>Describe the condition</b>'});
  for (const field of ['title','description']) {
    for (const value of ['', ' \n\t ', null, false, 42, {}, []]) {
      const result = validateOperation({...draft, [field]:value});
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(error => error.field === field));
    }
  }
  const limits = {title:80, description:1000};
  const full = Object.fromEntries(Object.entries(limits).map(([field, limit]) => [field, 'x'.repeat(limit)]));
  assert.equal(validateOperation(full).valid, true);
  for (const [field, limit] of Object.entries(limits)) {
    const input = {...full, [field]:'x'.repeat(limit + 1)}, before = {...input};
    const result = validateOperation(input);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.field === field));
    assert.deepEqual(input, before, 'Validation must not rewrite the operation.');
  }
  assert.equal(validateOperation({message:'An offer has different fields.'}).valid, false);
});

test('missing and malformed required values return field errors instead of throwing or coercing objects', () => {
  for (const value of [undefined, null, false, 42, 'text', []]) {
    assert.equal(validateRequest(value).valid, false);
    assert.equal(validateOffer(value).valid, false);
    assert.equal(validateOperation(value).valid, false);
  }
  for (const value of [null, false, 42, [], {}, {toString(){ throw new Error('Do not coerce user objects.'); }}]) {
    assert.equal(validateRequest({title:value, description:'Valid detail'}).valid, false);
    assert.equal(validateRequest({title:'Valid title', description:value}).valid, false);
    assert.equal(validateOffer({message:value}).valid, false);
    assert.equal(validateOperation({title:value, description:'Valid detail'}).valid, false);
    assert.equal(validateOperation({title:'Valid title', description:value}).valid, false);
  }
});

test('draft checks preserve literal markup and do not confuse requester and operator fields', () => {
  const text = '<img src=x onerror="throw new Error()"> & "quoted"';
  const request = {title:'A literal review', description:text, place:'', budget:''};
  const offer = {message:text, price:''};
  assert.equal(validateRequest(request).valid, true);
  assert.equal(validateOffer(offer).valid, true);
  assert.equal(request.description, text);
  assert.equal(offer.message, text);
  assert.equal(validateRequest(offer).valid, false);
  assert.equal(validateOffer(request).valid, false);
});

test('only exact internal views are accepted, without interpreting URLs, fragments or parameters', () => {
  const routes = ['home','requests','operations','operations/new','operations/review','services/api','services/docs','identity/setup',
    'account/create','account/sign-in','account/confirm','account/ready','account/recover','account/delete',
    'identity/document','identity/face','identity/review','identity/status',
    'requester','requester/review','requester/agreement','requester/progress','requester/result',
    'operator','operator/work','operator/offer','operator/review','operator/agreement','operator/progress','operator/result'];
  for (const route of routes) assert.equal(parseView(route), route);
  for (const input of [undefined, null, false, 42, {}, '', '#', '#not-a-route', '#Operator', '#operator/',
    '#operator/%72eview', '#requester/review?published=true', '#operator/review#result', '#requester/../operator',
    '#requester', '#operations/new', 'requester?published=true', 'operator/%72eview',
    '#https://example.test/', '#//example.test/', '#<img src=x>', 'https://example.test/#operator']) {
    assert.equal(parseView(input), 'home', 'Unrecognized view must return the landing page without interpreting a URL.');
  }
});

test('central workflow policy distinguishes basic requests and advanced operations while current authority remains pending', () => {
  const basic=['requester','requester/review','requester/agreement','requester/progress','requester/result'];
  const advanced=['operations/new','operations/review','operator/offer','operator/review','operator/agreement','operator/progress','operator/result'];
  for (const view of PARTICIPANT_VIEWS) {
    const required=basic.includes(view) ? 'basic' : advanced.includes(view) ? 'advanced' : null;
    const result=workflowAccess(view,{state:'signed_in',confirmed:true,roles:['R','O'],identity_verification:'pending'});
    assert.equal(result.required,required,view+' has the correct role prerequisite.');
    assert.equal(result.allowed,required===null);
    assert.equal(result.redirect,required==='basic' ? 'requests' : required==='advanced' ? 'operations' : view);
    if (required) assert.match(result.reason,required==='advanced' ? /advanced identity verification/i : /complete identity verification/i);
    else assert.equal(result.reason,'');
  }
  for (const input of [undefined,null,false,42,{},'#requester','requester?verified=true','operations/new/../review']) {
    const result=workflowAccess(input,{state:'signed_in',verified:true});
    assert.equal(result.allowed,false); assert.equal(result.required,null); assert.equal(result.redirect,'home');
  }
});

test('email confirmation, photos, device attestation, roles and forged capability hints cannot manufacture workflow eligibility', () => {
  for (const account of [null,undefined,false,0,'signed_in',[],{},
    {state:'confirmed',confirmed:true,roles:['R','O']},
    {state:'signed_in',confirmed:true,roles:['R'],identity_verification:'pending'},
    {state:'signed_in',confirmed:true,roles:['O'],identity_verification:'pending'},
    {state:'signed_in',confirmed:true,roles:['R','O'],identity_verification:'verified',identity_level:'advanced',
      requests:true,operations:true,ready:{requests:true,operations:true},capabilities:{requests:true,operations:true}},
    {state:'signed_in',identity_verification:{status:'verified',level:'advanced'},capabilities:['basic','advanced']},
    {state:'signed_in',confirmed:true,email_confirmed:true,photo_status:'reviewed',identity_status:'validated',
      device_status:'verified',device_bound:true,attestation:{status:'verified',security_level:'StrongBox'}},
    {state:'signed_out',confirmed:true,identity_verification:'verified',capabilities:{requests:true,operations:true}},
    {state:'signed_in',roles:true,identity_verification:42,capabilities:'advanced'}]) {
    const before=JSON.stringify(account);
    for (const view of ['requester','requester/review','operations/new','operations/review','operator/offer','operator/agreement']) {
      const result=workflowAccess(view,account);
      assert.equal(result.allowed,false,'Only a future validated eligibility contract could grant '+view+'.');
      assert.equal(result.required,view.startsWith('requester') ? 'basic' : 'advanced');
      assert.ok(result.reason.length>0);
    }
    assert.equal(JSON.stringify(account),before,'Access checks never rewrite account data.');
  }
});

const statusTree = [{id:'dashboard'}, {id:'requests',parent:'dashboard'}, {id:'operations',parent:'dashboard'},
  {id:'settings'}, {id:'account',parent:'settings'}, {id:'api',parent:'settings'}];
const status = (id, owner, kind, message = id + ' message') => ({id, owner, kind, message});

test('generic status ancestors select the highest issue plus an independent notification and isolate roots', () => {
  const sources = [status('request-warning','requests','warning'),status('operation-pending','operations','pending'),
    status('request-news','requests','notification'),status('account-error','account','error')];
  const model = reduceStatuses(statusTree,sources);
  assert.deepEqual(model.summaries.get('dashboard').kinds,['warning','notification']);
  assert.deepEqual(model.summaries.get('requests').kinds,['warning','notification']);
  assert.deepEqual(model.summaries.get('operations').kinds,['pending']);
  assert.deepEqual(model.summaries.get('settings').kinds,['error']);
  assert.deepEqual(model.summaries.get('api').kinds,[]);
  assert.equal(model.summaries.get('dashboard').messages.includes('account-error message'),false);
  assert.equal(model.summaries.get('settings').messages.includes('request-warning message'),false);
});

test('all issue priorities and source removals recompute instead of leaving a historical badge', () => {
  const kinds = ['error','warning','pending','unknown'];
  for (let index = 0; index < kinds.length; index++) {
    const sources = kinds.slice(index).map(kind=>status('api-' + kind,'api',kind));
    const model = reduceStatuses(statusTree,sources);
    assert.deepEqual(model.summaries.get('settings').kinds,[kinds[index]]);
  }
  assert.deepEqual(reduceStatuses(statusTree,[]).summaries.get('settings'),{kinds:[],messages:[]});
});

test('success and neutral information stay authoritative at origins without adding ancestor clutter', () => {
  const model = reduceStatuses(statusTree,[status('account-good','account','success'),status('api-detail','api','info')]);
  assert.equal(model.sources.get('account-good').kind,'success');
  assert.equal(model.sources.get('api-detail').kind,'info');
  assert.deepEqual(model.summaries.get('settings'),{kinds:[],messages:[]});
  assert.deepEqual(model.summaries.get('account'),{kinds:[],messages:[]});
});

test('new descendant owners propagate solely through declarations with no feature-specific ancestor list', () => {
  const tree = [...statusTree,{id:'keys',parent:'settings'},{id:'hardware-device',parent:'keys'},
    {id:'attestation-check',parent:'hardware-device'}];
  const model = reduceStatuses(tree,[status('device-refused','attestation-check','error'),status('device-news','hardware-device','notification')]);
  for (const id of ['attestation-check','hardware-device','keys','settings']) {
    assert.equal(model.summaries.get(id).kinds[0],'error');
  }
  assert.deepEqual(model.summaries.get('dashboard').kinds,[]);
  assert.deepEqual(model.summaries.get('settings').kinds,['error','notification']);
});

test('unknown owners, duplicate declarations, cycles and malformed status input cannot acquire a valid ancestor', () => {
  const tree = [...statusTree,{id:'cycle-a',parent:'cycle-b'},{id:'cycle-b',parent:'cycle-a'},
    {id:'cycle-child',parent:'cycle-a'},{id:'orphan',parent:'missing'},{id:'duplicate',parent:'settings'},
    {id:'duplicate',parent:'dashboard'},{id:'duplicate-child',parent:'duplicate'},
    {id:'bad" selector',parent:'dashboard'},{id:'bad-parent',parent:'bad" selector'}];
  const inputs = ['missing','cycle-a','cycle-b','cycle-child','orphan','duplicate','duplicate-child','bad" selector','bad-parent']
    .map((owner,index)=>status('invalid-' + index,owner,'error'));
  inputs.push(null,{},status('bad id','requests','error'),status('bad-kind','requests','critical'),
    status('bad-message','requests','warning',''),status('oversized','requests','error','x'.repeat(501)),
    status('control-message','requests','error','bad\u0000message'));
  const model = reduceStatuses(tree,inputs);
  assert.equal(model.sources.size,0);
  assert.deepEqual(model.summaries.get('dashboard').kinds,[]);
  assert.deepEqual(model.summaries.get('settings').kinds,[]);
  assert.equal(model.summaries.has('cycle-a'),false);
  assert.equal(model.summaries.has('duplicate-child'),false);
});

test('identical source IDs deduplicate while conflicting ownership is refused and messages remain literal text', () => {
  const warning = status('identity-request','requests','warning','<img src=x onerror="bad()">');
  const model = reduceStatuses(statusTree,[warning,{...warning},status('other-request','requests','warning',warning.message)]);
  assert.equal(model.sources.size,2);
  assert.deepEqual(model.summaries.get('dashboard'),{kinds:['warning'],messages:[warning.message]});
  const collision = reduceStatuses(statusTree,[warning,status(warning.id,'account','error')]);
  assert.equal(collision.sources.size,0);
  assert.deepEqual(collision.summaries.get('dashboard').kinds,[]);
  assert.deepEqual(collision.summaries.get('settings').kinds,[]);
});

// Minimal DOM surface for isolated rendering checks. Chromium checks own the
// browser's accessibility tree, layout, computed colors and real interaction.
class StatusElement extends EventTarget {
  constructor(tag, document, attributes = {}) {
    super();
    this.tagName = tag.toLowerCase(); this.ownerDocument = document; this.attributes = new Map();
    this.children = []; this.parentElement = null; this.hidden = false; this.text = '';
    this.dataset = new Proxy({}, {get:(_,key)=>this.getAttribute('data-' + String(key).replace(/[A-Z]/g,c=>'-' + c.toLowerCase())),
      set:(_,key,value)=>{this.setAttribute('data-' + String(key).replace(/[A-Z]/g,c=>'-' + c.toLowerCase()),value);return true;}});
    for (const [key,value] of Object.entries(attributes)) this.setAttribute(key,value);
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id',value); }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class',value); }
  get textContent() { return this.text + this.children.map(child=>child.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.replaceChildren(); }
  getAttribute(key) { return this.attributes.has(key) ? this.attributes.get(key) : null; }
  hasAttribute(key) { return this.attributes.has(key); }
  setAttribute(key,value) { this.attributes.set(key,String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
  matches(selector) {
    return selector.split(',').some(part=>{
      const value = part.trim(), tag = value.match(/^[a-z]+/), id = value.match(/#([\w-]+)/);
      if (tag && this.tagName !== tag[0] || id && this.id !== id[1]) return false;
      for (const match of value.matchAll(/\.([\w-]+)/g)) if (!this.className.split(/\s+/).includes(match[1])) return false;
      for (const match of value.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!this.hasAttribute(match[1]) || match[2] !== undefined && this.getAttribute(match[1]) !== match[2]) return false;
      }
      return true;
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(child=>[...(child.matches(selector) ? [child] : []),...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let value = this; value; value = value.parentElement) if (value.matches(selector)) return value; return null; }
  append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
  after(child) { child.remove(); const siblings = this.parentElement.children; child.parentElement = this.parentElement; siblings.splice(siblings.indexOf(this)+1,0,child); }
  remove() { if (this.parentElement) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this),1); this.parentElement = null; } }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...children); }
}
function statusDocument() {
  const document = new StatusElement('document',null); document.ownerDocument = document;
  document.createElement = tag=>new StatusElement(tag,document);
  document.createElementNS = (_,tag)=>document.createElement(tag);
  document.getElementById = id=>document.querySelectorAll('[id]').find(node=>node.id===id) || null;
  const element = (tag,attributes,parent = document)=>{const value = new StatusElement(tag,document,attributes);parent.append(value);return value;};
  const node = (id,parent)=>element('section',{'data-status-node':id,...(parent ? {'data-status-parent':parent} : {})});
  for (const value of statusTree) node(value.id,value.parent);
  const control = element('button',{id:'menu', 'aria-label':'Open navigation','aria-describedby':'existing-hint'});
  control.textContent = 'Dashboard';
  const menu = element('span',{class:'status-icons menu-status','data-status-summary':'dashboard'},control);
  const optionsControl = element('button',{'aria-label':'Open options'});
  const options = element('span',{class:'status-icons','data-status-summary':'settings'},optionsControl);
  const role = element('button',{id:'requests-list-link','aria-expanded':'false'});
  role.textContent = 'Requests';
  const summary = element('span',{class:'status-icons','data-status-summary':'requests','data-status-disclosure':'requests-list-link'},role);
  const setup = element('button',{id:'requests-setup-link'});
  const source = element('span',{class:'status-icons','data-status-source':'identity-requests'},setup);
  element('button',{id:'operations-setup-link'});
  const duplicateSource = element('span',{class:'status-icons','data-status-source':'identity-requests'},element('button',{}));
  const value = element('dd',{});
  const success = element('span',{class:'status-icons','data-status-source':'api-good'},value);
  const info = element('span',{class:'status-icons','data-status-source':'api-info'},value);
  const row = element('li',{});
  const item = element('button',{'data-attention-kind':'requests','data-attention-item':'local-request'},row);
  const dot = element('span',{class:'status-icons','data-status-source':'attention-requests-local-request','data-status-dot':''},item);
  return {document,element,control,menu,options,role,summary,setup,source,duplicateSource,success,info,row,item,dot};
}
const renderedKinds = host=>host.children.map(node=>node.dataset.statusKind);
const descriptions = control=>control.getAttribute('aria-describedby')?.split(/\s+/) || [];

test('the shared Back widget mounts one hidden native button with decorative arrow and the supplied action', () => {
  const f = statusDocument(), container = f.element('div',{id:'view-navigation'});
  let clicks = 0, target;
  const back = mountBackControl(f.document,event=>{clicks++;target=event.target;});
  assert.equal(container.children.length,1); assert.equal(container.children[0],back);
  assert.equal(f.document.getElementById('view-back'),back); assert.equal(back.tagName,'button');
  assert.equal(back.getAttribute('type'),'button'); assert.equal(back.className,'back'); assert.equal(back.hidden,true);
  assert.equal(back.children[0].getAttribute('aria-hidden'),'true'); assert.equal(back.children[0].textContent,'← ');
  assert.equal(back.children[1].textContent,'Back');
  back.hidden = false; back.dispatchEvent(new Event('click'));
  assert.equal(clicks,1); assert.equal(target,back,'The shared control delegates rather than inventing a destination.');
});

test('source producers replace independently and generic rendering preserves existing names/descriptions with literal safe messages', () => {
  const f = statusDocument(), message = '<img src=x onerror="bad()">';
  setStatusSources(f.document,'identity',[status('identity-requests','requests','warning',message)]);
  setStatusSources(f.document,'service',[status('api-down','api','error','Account API unavailable.')]);
  assert.deepEqual(renderedKinds(f.menu),['warning']); assert.deepEqual(renderedKinds(f.options),['error']);
  assert.deepEqual(renderedKinds(f.source),['warning']); assert.deepEqual(renderedKinds(f.duplicateSource),['warning']);
  assert.equal(f.source.getAttribute('aria-hidden'),'true');
  assert.equal(f.source.children[0].children[0].getAttribute('href'),'#warning');
  assert.equal(f.source.children[0].getAttribute('stroke'),'currentColor');
  const generated = descriptions(f.control).filter(id=>id!=='existing-hint');
  assert.equal(generated.length,1); assert.equal(f.document.getElementById(generated[0]).textContent,message);
  assert.equal(f.document.getElementById(generated[0]).hidden,true);
  assert.equal(f.control.getAttribute('aria-label'),'Open navigation'); assert.equal(f.control.textContent,'Dashboard' + message);
  assert.equal(f.document.querySelectorAll('img').length,0,'Messages never enter HTML parsing.');
  setStatusSources(f.document,'identity',[]);
  assert.equal(f.menu.hidden,true); assert.equal(f.source.hidden,true); assert.equal(f.duplicateSource.hidden,true);
  assert.deepEqual(descriptions(f.control),['existing-hint']); assert.deepEqual(renderedKinds(f.options),['error']);
});

test('opening a disclosure hides its aggregate glyph without acknowledging sources or clearing descriptions', () => {
  const f = statusDocument(); renderRoleSetup(f.document,{requests:false,operations:true},true);
  const before = descriptions(f.role);
  assert.equal(f.summary.hidden,false); assert.equal(f.source.hidden,false); assert.equal(f.setup.hidden,false);
  f.role.setAttribute('aria-expanded','true'); const expanded = renderStatuses(f.document);
  assert.equal(f.summary.hidden,true); assert.equal(f.source.hidden,false);
  assert.deepEqual(descriptions(f.role),before); assert.equal(expanded.sources.has('identity-requests'),true);
  f.role.setAttribute('aria-expanded','false'); renderStatuses(f.document); assert.equal(f.summary.hidden,false);
  renderRoleSetup(f.document,{requests:true,operations:true},true);
  assert.equal(f.summary.hidden,true); assert.equal(f.source.hidden,true); assert.equal(f.setup.hidden,true);
  assert.deepEqual(descriptions(f.role),[]);
});

test('unchanged status glyphs retain their DOM nodes while descriptions and actual changes update', () => {
  const f = statusDocument();
  const record = status('identity-requests','requests','warning','Identity pending.');
  setStatusSources(f.document,'identity',[record]);
  const icon = f.source.children[0], summary = f.menu.children[0];
  setStatusSources(f.document,'identity',[{...record,message:'Verification required.'}]);
  assert.equal(f.source.children[0],icon); assert.equal(f.menu.children[0],summary);
  assert.match(f.control.textContent,/Verification required/);
  setStatusSources(f.document,'identity',[{...record,kind:'error'}]);
  assert.notEqual(f.source.children[0],icon); assert.deepEqual(renderedKinds(f.source),['error']);
});

test('identity warnings require a signed-in account and clear again on sign-out', () => {
  const f = statusDocument();
  renderRoleSetup(f.document);
  assert.equal(f.setup.hidden,true); assert.equal(f.menu.hidden,true);
  const model=renderRoleSetup(f.document,{},true);
  assert.equal(model.sources.get('identity-requests').message,'Set up identity verification before posting requests.');
  assert.equal(model.sources.get('identity-operations').message,'Set up advanced identity verification before accepting operations.');
  assert.equal(f.setup.hidden,false); assert.deepEqual(renderedKinds(f.menu),['warning']);
  renderRoleSetup(f.document,{},false);
  assert.equal(f.setup.hidden,true); assert.equal(f.menu.hidden,true);
  assert.deepEqual(descriptions(f.role),[]);
});

test('notification origins use dots while summaries use bells and success/info never propagate', () => {
  const f = statusDocument();
  setStatusSources(f.document,'readiness',[status('api-good','api','success','API ready.'),status('api-info','api','info','Budget data is not available yet.')]);
  assert.deepEqual(renderedKinds(f.success),['success']); assert.deepEqual(renderedKinds(f.info),['info']);
  assert.equal(f.options.hidden,true);
  renderAttention(f.document,{requests:['local-request'],operations:[]});
  assert.deepEqual(renderedKinds(f.dot),['notification']); assert.equal(f.dot.children[0].tagName,'span');
  assert.equal(f.dot.children[0].className,'status-dot'); assert.deepEqual(renderedKinds(f.menu),['notification']);
  assert.equal(f.menu.children[0].children[0].getAttribute('href'),'#bell');
  assert.equal(f.control.getAttribute('aria-label'),'Open navigation');
  f.row.hidden = true; renderAttention(f.document); assert.equal(f.menu.hidden,true); assert.equal(f.dot.hidden,true);
  f.row.hidden = false; renderAttention(f.document); assert.equal(f.menu.hidden,false,'List changes cannot acknowledge stored producer attention IDs.');
  renderAttention(f.document,null); assert.equal(f.menu.hidden,true);
});

test('removed hosts release generated descriptions without removing unrelated descriptions or another root state', () => {
  const first = statusDocument(), second = statusDocument();
  const records = [status('identity-requests','requests','warning','Identity setup required.')];
  setStatusSources(first.document,'identity',records); setStatusSources(second.document,'identity',records);
  records.length = 0; renderStatuses(first.document); assert.equal(first.menu.hidden,false,'Producer arrays are copied.');
  const id = descriptions(first.control).find(value=>value!=='existing-hint'); first.menu.remove(); renderStatuses(first.document);
  assert.equal(first.document.getElementById(id),null); assert.deepEqual(descriptions(first.control),['existing-hint']);
  setStatusSources(first.document,'identity',[]); assert.equal(second.menu.hidden,false);
  setStatusSources(second.document,'invalid namespace',[]); assert.equal(second.menu.hidden,false,'Malformed namespaces cannot replace an unrelated producer.');
});
