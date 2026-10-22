// SPDX-License-Identifier: AGPL-3.0-only
import {launchBrowser} from './harness.mjs';
// Exact participant assets in Chromium, with intercepted bundled requests only.
// UI interactions plus synthetic history restoration for legacy views without
// an exposed menu path; no Android WebView or backend acceptance claim.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {collectParticipantAssets, PARTICIPANT_SHELL_SOURCES, PARTICIPANT_SHELL_BUDGET} from '../../tools/build/participant-assets.mjs';

assert.equal(process.platform, 'linux', 'Run only in the managed Debian container.');
assert.equal(process.env.NONVERBA_CONTAINER, '1', 'Use the managed container launcher.');
const assets = await collectParticipantAssets();
const origin = 'https://appassets.androidplatform.net';
const entry = origin + '/assets/participant/index.html';
const hostileSearches = new Set(['?view=requester', '?account=example&view=operator', '?view=operations%2Freview']);
const errors = [], unexpected = [], consoleErrors = [], checks = [], screenshots = [];
const output = resolve('artifacts/qa/participant-browser-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, {recursive:true});
const browser = await launchBrowser({headless:true, args:['--no-sandbox']});
let context, page;
const protectedViews = ['requester','requester/review','requester/agreement','requester/progress','requester/result',
  'operations/new','operations/review','operator/offer','operator/review','operator/agreement','operator/progress','operator/result'];
const lockedDestination = view => view.startsWith('requester') ? 'requests' : 'operations';

async function check(name, action) { await action(); checks.push(name); }
async function stableUrl() {
  assert.equal(page.url(), entry, 'App navigation, drafts and drawers must leave one clean document URL.');
  const url = await page.evaluate(() => ({search:location.search, hash:location.hash}));
  assert.deepEqual(url, {search:'', hash:''});
}
async function currentView() {
  return page.locator('.screen:visible').getAttribute('data-view');
}
async function route(name, {focused = true} = {}) {
  const view = name.replace(/^#/, '');
  await page.waitForFunction(expected => {
    const screen = document.querySelector('.screen:not([hidden])');
    return screen?.dataset.view === expected && history.state?.view === expected;
  }, view);
  await stableUrl();
  if (view !== 'services/api') {
    assert.equal(await page.locator('#api-key-options').evaluate(element=>element.hidden),true,'Leaving key management collapses its options.');
    assert.equal(await page.locator('#api-key-add').getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('#api-key-value').inputValue(),'');
    assert.equal(await page.locator('#api-key-result').evaluate(element=>element.hidden),true);
    for (const id of ['name','permissions','expiry']) assert.equal(await page.locator('#api-key-'+id).inputValue(),'');
  }
  if (view === 'home') {
    await page.locator('#home-screen').waitFor({state:'visible'});
    if (focused) await page.waitForFunction(() => document.activeElement?.id === 'home-screen');
    assert.equal(await page.locator('.workspace-heading').isVisible(), false,
      'The quiet home screen must not introduce a visible workspace heading.');
    assert.equal(await page.locator('main h1:visible').count(), 0);
    assert.equal(await page.locator('#workspace').getAttribute('aria-label'), 'Non-verba home');
    return;
  }
  await page.locator('#view-title').waitFor({state:'visible'});
  if (focused) await page.waitForFunction(() => document.activeElement?.id === 'view-title');
  assert.equal(await page.locator('main h1:visible').count(), 1, 'Each route needs one main heading.');
  const back=page.locator('#view-navigation button#view-back.back');
  assert.equal(await back.count(),1,'The shared navigation slot contains one native Back control.');
  assert.equal(await page.locator('#view-back').count(),1);
  assert.equal(await back.getAttribute('type'),'button');
  assert.equal(await page.locator('#view-navigation').getByRole('button',{name:'Back',exact:true}).count(),1);
  assert.equal(await back.isVisible(),true);
}
async function restoreViewFixture(view, {expected = view} = {}) {
  // Lists and the signed-out local key prototype have no current menu entry.
  // Exercise popstate without granting authority or putting state in the URL.
  const previous = await currentView();
  await page.evaluate(next => {
    const index = history.state?.index || 0;
    const current = history.state?.view || 'home';
    history.pushState({nonverbaPreview:true, index:index + 1, view:next}, '', location.pathname);
    history.pushState({nonverbaPreview:true, index:index + 2, view:current}, '', location.pathname);
  }, view);
  await page.goBack();
  await route(expected, {focused:expected !== previous});
}
async function home() {
  while (await currentView() !== 'home') {
    const before = await page.evaluate(() => ({view:history.state.view, index:history.state.index}));
    await page.locator('#view-back').click();
    await page.waitForFunction(previous => history.state?.view !== previous.view || history.state?.index !== previous.index, before);
    await stableUrl();
  }
  await route('home', {focused:false});
}
async function visit(name) {
  const view = name.replace(/^#/, '');
  if (protectedViews.includes(view)) return restoreViewFixture(view,{expected:lockedDestination(view)});
  if (await currentView() === view) return route(view, {focused:false});
  if (view === 'home') return home();
  if (['requests','operations','services/api'].includes(view)) return restoreViewFixture(view);
  if (view === 'account/sign-in') {
    await openPanel('options'); await page.locator('#account-setup-link').click();
    await page.locator('#options-panel').waitFor({state:'hidden'});
    return route(view);
  }
  if (view === 'identity/setup') {
    if (await page.locator('#requests-setup-link').evaluate(element=>element.hidden)) {
      return restoreViewFixture(view);
    } else {
      await openPanel('navigation'); await page.locator('#requests-list-link').click();
      await page.locator('#requests-setup-link').click();
      await page.locator('#navigation-panel').waitFor({state:'hidden'});
    }
  } else if (view === 'requester' || view === 'operations/new') {
    await navigateDrawer(view === 'requester' ? '#new-request' : '#new-operation');
  } else if (view === 'operator') {
    await visit('operations'); await page.locator('#operation-example-work').click();
  } else if (view === 'operator/work') {
    await visit('operator'); await page.locator('#view-example-work').click();
  } else if (view === 'operator/offer') {
    await visit('operator/work'); await page.locator('#make-offer').click();
  } else if (/^(requester|operator)\/(agreement|progress|result)$/.test(view)) {
    const [role, step] = view.split('/');
    await visit(role === 'requester' ? 'requester' : 'operator/work');
    await page.locator('.screen:visible button[data-navigate="' + role + '/agreement"]').click();
    await route(role + '/agreement');
    if (step !== 'agreement') { await page.locator('#example-progress').click(); await route(role + '/progress'); }
    if (step === 'result') await page.locator('#example-result').click();
  } else throw new Error('No user-action fixture path to ' + view);
  await route(view);
}
async function screenshot(name) {
  await page.screenshot({path:output + '/' + name + '.png', fullPage:true}); screenshots.push(name + '.png');
}
async function formLabel(selector) {
  assert.equal(await page.locator(selector).evaluate(element => element.labels?.length > 0), true,
    selector + ' needs a native visible label.');
}
async function noOverflow(label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true,
    'Horizontal overflow: ' + label);
}
async function openPanel(name) {
  await page.locator('#' + name + '-toggle').click();
  await page.locator('#' + name + '-panel').waitFor({state:'visible'});
  await stableUrl();
  if (name === 'navigation') {
    await page.waitForFunction(() => document.activeElement?.id === 'requests-list-link');
    await collapsedNavigation();
  } else await page.waitForFunction(() => document.activeElement?.id === 'options-title');
}
async function collapsedNavigation() {
  for (const kind of ['requests','operations']) {
    const toggle = page.locator('#' + kind + '-list-link');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await toggle.getAttribute('aria-controls'), 'navigation-' + kind);
    assert.equal(await page.locator('#navigation-' + kind).getAttribute('hidden') !== null, true);
    assert.equal(await page.locator('#navigation-' + kind).isVisible(), false);
  }
}
async function dismissOutside(name) {
  const panel = page.locator('#' + name + '-panel');
  const bounds = await panel.boundingBox();
  const width = page.viewportSize().width;
  const x = bounds.x > 8 ? 2 : bounds.x + bounds.width + 8;
  assert.ok(x >= 0 && x < width, 'A backdrop must remain available at this viewport.');
  await page.mouse.click(x, Math.min(100, bounds.y + bounds.height / 2));
  await panel.waitFor({state:'hidden'});
  await stableUrl();
  assert.equal(await page.evaluate(() => document.activeElement.id), name + '-toggle');
}
async function navigateDrawer(id, {keyboard = false} = {}) {
  await openPanel('navigation');
  const choice = page.locator(id);
  if (keyboard) {
    await choice.focus(); await page.keyboard.press('Enter');
  } else await choice.click();
  await page.locator('#navigation-panel').waitFor({state:'hidden'});
  await stableUrl();
}
async function usableTarget(selector, label) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box && box.width >= 44 && box.height >= 44, selector + ' target below 44px: ' + label);
}
async function panelFits(name, label) {
  const panel = page.locator('#' + name + '-panel');
  assert.equal(await panel.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= -1 && bounds.right <= innerWidth + 1 &&
      element.scrollWidth <= element.clientWidth + 1;
  }), true, name + ' panel overflows: ' + label);
}
async function centeredPanelHeading(name, label) {
  const panel = page.locator('#' + name + '-panel');
  const geometry = await panel.evaluate(element => {
    const heading = document.getElementById(element.getAttribute('aria-labelledby'));
    const range = document.createRange();
    range.selectNodeContents(heading);
    const text = range.getBoundingClientRect(), bounds = element.getBoundingClientRect();
    const close = element.querySelector('.panel-heading button')?.getBoundingClientRect();
    return {centerDifference:Math.abs((text.left + text.right - bounds.left - bounds.right) / 2),
      hasText:text.width > 0 && text.height > 0,
      clearOfClose:!close || text.right <= close.left + 1};
  });
  assert.equal(geometry.hasText, true, name + ' needs a visible heading: ' + label);
  assert.ok(geometry.centerDifference <= 1.5, name + ' heading must be centered in the panel: ' + label);
  assert.equal(geometry.clearOfClose, true, name + ' heading overlaps its close control: ' + label);
}
async function matchingDashboardDividers(label) {
  const styles = await page.evaluate(() => {
    const divider = element => {
      const style = getComputedStyle(element);
      return Object.fromEntries(['borderTopWidth','borderTopStyle','borderTopColor',
        'paddingTop','paddingBottom','marginBottom'].map(key => [key, style[key]]));
    };
    return {settings:divider(document.querySelector('.account-details > div')),
      dashboard:[...document.querySelectorAll('.navigation-section')].map(divider)};
  });
  assert.equal(styles.settings.borderTopWidth, '1px');
  assert.equal(styles.settings.borderTopStyle, 'solid');
  assert.equal(styles.dashboard.length, 2);
  for (const section of styles.dashboard) {
    assert.deepEqual(section, styles.settings, 'Dashboard dividers must match Settings: ' + label);
  }
}
async function groupedSettings(label) {
  const grouping = await page.locator('#options-panel').evaluate(panel => {
    const sections=[...panel.querySelectorAll('.account-details > div')];
    const group=sections.find(section=>section.querySelector('dt')?.textContent.trim()==='Services');
    const budget=sections.find(section=>section.querySelector('dt')?.textContent.trim()==='Budgets');
    return {
      sections:sections.map(section=>section.querySelector('dt')?.textContent.trim()),
      visibleSections:sections.filter(section=>!section.hidden).map(section=>section.querySelector('dt')?.textContent.trim()),
      rows:[...group.querySelectorAll('.service-status-list > div')].map(row=>({
        label:row.querySelector('dt')?.textContent.trim(),parent:row.dataset.statusParent===group.dataset.statusNode,
        noDivider:parseFloat(getComputedStyle(row).borderTopWidth) === 0})),
      configureInside:Boolean(group.contains(panel.querySelector('#configure-api-access'))),
      configureHidden:panel.querySelector('#configure-api-access').hidden,
      budgetSeparate:Boolean(budget && !group.contains(budget) && !budget.closest('.service-status-list')),
      budgetHidden:budget?.id === 'settings-budgets' && budget.hidden,
      deviceKeyNodes:panel.querySelectorAll('[data-status-node="keys"],[data-status-source="settings-keys"],#account-key-label,#account-key-detail').length,
      noDropdown:group.querySelectorAll('details,input,form').length===0,
      noRefresh:panel.querySelectorAll('#settings-refresh,#settings-check-state,#account-key-detail').length===0,
      fits:group.scrollWidth <= group.clientWidth+1
    };
  });
  assert.deepEqual(grouping.sections,['Account','Services','Budgets'],'Settings keeps budgets outside Services: '+label);
  assert.deepEqual(grouping.visibleSections,['Account','Services'],'Anonymous Settings shows only Account and Services: '+label);
  assert.deepEqual(grouping.rows,['Network','API','Server'].map(label=>({label,parent:true,noDivider:true})),
    'Service states are compact nested rows without their own section dividers: '+label);
  assert.deepEqual({configure:grouping.configureInside,budget:grouping.budgetSeparate,noDropdown:grouping.noDropdown,noRefresh:grouping.noRefresh,fits:grouping.fits},
    {configure:true,budget:true,noDropdown:true,noRefresh:true,fits:true});
  assert.deepEqual({configureHidden:grouping.configureHidden,budgetHidden:grouping.budgetHidden,deviceKeyNodes:grouping.deviceKeyNodes},
    {configureHidden:true,budgetHidden:true,deviceKeyNodes:0});
}
async function apiAccessMockup(label) {
  const screen=page.locator('#api-access-screen');
  assert.equal(await screen.isVisible(),true);
  assert.equal(await screen.getAttribute('data-view'),'services/api');
  assert.equal(await page.locator('#view-title').innerText(),'API and MCP keys');
  assert.equal(await page.locator('#view-eyebrow').textContent(),'Developer services');
  assert.equal(await page.locator('#view-title').evaluate(element=>element.scrollWidth<=element.clientWidth+1
    && element.scrollHeight<=element.clientHeight+1),true,'The full developer-service heading wraps within its available width: '+label);
  assert.match(await screen.getAttribute('aria-label'),/^API key management(?: preview)?$/);
  assert.equal(await screen.locator('#api-server,#api-key').count(),0,'API access manages issued keys rather than accepting a server or pasted secret.');
  assert.equal(await screen.locator('.paper').count(),1,'The API key header, options and inventory share one panel.');
  const inventory=screen.locator('#api-key-inventory');
  assert.equal(await inventory.isVisible(),true);
  assert.equal(await inventory.locator('.card-top h2').innerText(),'Active keys');
  assert.equal(await inventory.locator('.card-top #api-key-add').count(),1);
  assert.equal(await screen.locator('p:visible, .tag:visible').count(),0,'The key dashboard has no visible explanatory prose or Preview badge.');
  assert.equal(await page.locator('#view-description').isVisible(),false,'The compact key dashboard has no main introduction.');
  const add=screen.locator('#api-key-add'), generate=screen.locator('#api-key-generate');
  assert.equal((await add.innerText()).trim(),'+');
  assert.equal(await add.getAttribute('aria-label'),'New API key');
  assert.equal(await add.isDisabled(),false);
  assert.equal(await add.getAttribute('aria-controls'),'api-key-options');
  assert.equal(await add.getAttribute('aria-expanded'),'false');
  assert.equal(await screen.locator('#api-keys-preview').count(),0);
  const options=inventory.locator('#api-key-options');
  assert.equal(await options.evaluate(element=>element.tagName),'FORM');
  assert.equal(await options.locator('details,summary').count(),0);
  assert.equal(await options.evaluate(element=>element.hidden),true);
  assert.equal(await options.isVisible(),false);
  const requests=[], observe=request=>requests.push(request.url()); page.on('request',observe);
  await add.focus(); await page.keyboard.press('Enter');
  assert.equal(await add.getAttribute('aria-expanded'),'true');
  assert.equal(await options.isVisible(),true);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'api-key-name');
  for (const [selector,label] of [['#api-key-name','Name'],['#api-key-permissions','Permissions'],['#api-key-expiry','Expiration']]) {
    const control=options.locator(selector);
    assert.equal(await control.isVisible(),true); assert.equal(await control.isDisabled(),false);
    assert.equal(await control.evaluate(element=>element.required),true);
    assert.equal(await control.evaluate(element=>element.labels[0].textContent.trim()),label); await formLabel(selector);
  }
  assert.equal(await options.locator('#api-key-name').inputValue(),'');
  assert.equal(await options.locator('#api-key-name').getAttribute('placeholder'),'Key name');
  assert.equal(await options.locator('#api-key-name').getAttribute('maxlength'),'80');
  for (const [id,expected] of [['permissions',[['','Select'],['read','Read only'],['write','Read and write']]],
    ['expiry',[['','Select'],['1','24 hours'],['7','7 days'],['30','30 days'],['90','90 days'],['365','365 days'],['never','Never expires']]]]) {
    assert.deepEqual(await options.locator('#api-key-'+id+' option').evaluateAll(elements=>elements.map(element=>[element.value,element.textContent])),expected);
  }
  assert.equal(await options.locator('.key-options-grid').count(),1);
  assert.equal((await generate.innerText()).trim(),'Generate API key');
  assert.equal(await generate.getAttribute('type'),'submit'); assert.equal(await generate.isDisabled(),false);
  assert.equal(await generate.evaluate(button=>Math.abs(button.getBoundingClientRect().right
    - button.closest('form').querySelector('.key-options-grid').getBoundingClientRect().right)<=1.5),true,
    'Generate aligns with the right edge of the options grid: '+label);
  const region=inventory.locator('.key-table');
  assert.equal(await region.getAttribute('role'),'region');
  assert.equal(await region.getAttribute('aria-label'),'API key list');
  assert.equal(await region.getAttribute('tabindex'),'0','The complete table remains keyboard reachable on narrow screens.');
  assert.deepEqual(await inventory.locator('thead th').allTextContents(),['Name','Key prefix','Access','Created','Last used','Actions']);
  assert.equal((await inventory.locator('tbody td').innerText()).trim(),'Unavailable');
  assert.equal(await inventory.locator('tbody tr').count(),1,'Disconnected inventory contains only its unknown-state row.');
  assert.equal(await inventory.locator('tbody td').count(),1,'Unknown inventory does not invent service records.');
  assert.equal(await inventory.locator('tbody td').getAttribute('colspan'),'6');
  assert.equal(await screen.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true,
    'Expanded key options and the bounded table fit their workspace: '+label);
  await noOverflow(label); await noAuthority();
  const name=options.locator('#api-key-name'), permissions=options.locator('#api-key-permissions'), expiry=options.locator('#api-key-expiry');
  await generate.click();
  assert.equal(await name.evaluate(element=>element.validity.valueMissing),true);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'api-key-name');
  assert.equal(await inventory.locator('[data-demo-key]').count(),0);
  await name.fill('   '); await permissions.selectOption('read'); await expiry.selectOption('never'); await generate.click();
  assert.equal(await name.evaluate(element=>element.validity.customError),true,'Whitespace is not a usable demo-key name.');
  const injection='<img src=x onerror="window.__participantInjected=true">';
  const demos=[{name:injection,access:'read',expiry:'never',label:'Read only',expires:'Never expires'},
    {name:'Write demo',access:'write',expiry:'90',label:'Read and write',expires:'90 days'},
    {name:'Route demo',access:'read',expiry:'30',label:'Read only',expires:'30 days'},
    {name:'Daily demo',access:'read',expiry:'1',label:'Read only',expires:'24 hours'},
    {name:'Weekly demo',access:'write',expiry:'7',label:'Read and write',expires:'7 days'},
    {name:'Yearly demo',access:'read',expiry:'365',label:'Read only',expires:'365 days'}];
  const values=[];
  for (const [index,demo] of demos.entries()) {
    if (index) { await add.click(); assert.equal(await page.evaluate(()=>document.activeElement.id),'api-key-name'); }
    await name.fill('Edit this'); await name.press('Control+A'); await page.keyboard.type(demo.name);
    await permissions.selectOption(demo.access); await expiry.selectOption(demo.expiry);
    await generate.focus(); await page.keyboard.press('Enter');
    assert.equal(await options.isVisible(),false); assert.equal(await add.getAttribute('aria-expanded'),'false');
    const result=screen.locator('#api-key-result'), value=screen.locator('#api-key-value');
    assert.equal(await result.isVisible(),true); assert.equal(await result.getAttribute('role'),'group');
    assert.equal(await result.getAttribute('aria-label'),'Generated API key');
    assert.match(await result.innerText(),/Demo key/); assert.equal(await value.evaluate(element=>element.readOnly),true);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'api-key-value'); await formLabel('#api-key-value');
    const full=await value.inputValue(); values.push(full); assert.match(full,/^nv-[a-f0-9]{32}$/);
    assert.equal(await value.isDisabled(),false); assert.equal(await value.evaluate(element=>getComputedStyle(element).userSelect),'text');
    await value.focus(); await value.press('Control+A');
    assert.equal(await value.evaluate(element=>element.selectionStart===0 && element.selectionEnd===element.value.length),true,'The complete readonly key remains manually selectable.');
    assert.equal(await screen.locator('#api-key-result-summary').textContent(),demo.label+' · '+demo.expires);
    const row=inventory.locator('[data-demo-key]').nth(index), cells=row.locator('td');
    assert.equal(await row.getAttribute('title'),demo.expires);
    assert.equal(await cells.count(),6); assert.equal(await cells.nth(0).textContent(),demo.name+'Demo');
    assert.equal(await cells.nth(0).locator('.tag').textContent(),'Demo'); assert.equal(await row.locator('img').count(),0);
    assert.equal(await cells.nth(1).textContent(),full.slice(0,13)+'…');
    assert.equal(await cells.nth(2).textContent(),demo.label+demo.expires);
    assert.equal(await cells.nth(2).locator('.key-expiry').textContent(),demo.expires); assert.match(await cells.nth(3).textContent(),/\d/);
    assert.equal(await cells.nth(4).textContent(),'Never'); assert.equal((await row.innerText()).includes(full),false);
    assert.equal(await row.getByRole('button',{name:'Revoke demo key '+demo.name,exact:true}).count(),1);
    assert.equal((await page.evaluate(()=>JSON.stringify(history.state))).includes(full),false);
    await noOverflow(label+' demo result'); await noAuthority();
    if (index === 0) {
      const copy=screen.locator('#api-key-copy'), status=screen.locator('#api-key-copy-status');
      assert.equal(await copy.getAttribute('aria-label'),'Copy API key'); await usableTarget('#api-key-copy','API key copy');
      assert.equal(await status.isVisible(),false); assert.equal(await status.getAttribute('role'),'status');
      assert.equal(await status.getAttribute('aria-live'),'polite');
      await copy.focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(()=>document.getElementById('api-key-copy-status').textContent==='Copied.');
      assert.ok(await page.evaluate(expected=>window.__apiCopied===expected,full),'Copy writes the complete current key.');
      await page.evaluate(()=>{window.__apiClipboardRefuse=true;}); await copy.click();
      await page.waitForFunction(()=>/select.*copy/i.test(document.getElementById('api-key-copy-status').textContent));
      assert.equal(await page.evaluate(()=>document.activeElement.id),'api-key-value');
      assert.equal(await value.evaluate(element=>element.selectionStart===0 && element.selectionEnd===element.value.length),true,'Refused clipboard access selects the full key for manual copy.');
      assert.doesNotMatch(await status.textContent(),/copied|saved/i);
      await page.evaluate(()=>{window.__apiClipboardRefuse=false;window.__apiClipboardGate=true;}); await copy.click();
      await page.waitForFunction(()=>typeof window.__apiReleaseClipboard==='function');
      await screen.locator('#api-key-done').focus(); await page.keyboard.press('Enter');
      assert.equal(await value.inputValue(),''); assert.equal(await result.isVisible(),false);
      assert.equal(await page.evaluate(()=>document.activeElement.id),'api-key-add');
      await page.evaluate(()=>{window.__apiClipboardGate=false;window.__apiReleaseClipboard();delete window.__apiReleaseClipboard;});
      assert.equal(await status.evaluate(element=>element.hidden && element.textContent===''),true,'Done fences a late copy result and clears its status.');
      await page.evaluate(()=>{window.__apiCopied=null;});
    } else if (index === 1) {
      await add.click(); assert.equal(await value.inputValue(),''); assert.equal(await result.isVisible(),false);
      await add.click(); assert.equal(await options.isVisible(),false); assert.equal(await value.inputValue(),'');
    }
  }
  page.off('request',observe); assert.deepEqual(requests,[],'Editing, validating and generating demo keys never contacts a service.');
  const previous=await page.evaluate(()=>history.state.index);
  await page.locator('#view-back').click();
  await page.waitForFunction(index=>history.state.index<index,previous); await route(await currentView(),{focused:false});
  await visit('services/api');
  assert.equal(await inventory.locator('[data-demo-key]').count(),demos.length,'Demo metadata survives view changes within this page.');
  assert.equal(await options.isVisible(),false); assert.equal(await screen.locator('#api-key-value').inputValue(),'');
  const fresh=await context.newPage();
  await fresh.goto(entry); await fresh.waitForFunction(()=>history.state?.view === 'home');
  await fresh.locator('#home-screen').waitFor({state:'visible'});
  assert.equal(await fresh.locator('[data-demo-key]').count(),0,'A separate page has no demo-key metadata.');
  assert.equal(await fresh.locator('#api-key-value').inputValue(),''); await fresh.close();
  requests.length=0; page.on('request',observe);
  for (const demo of demos) await inventory.getByRole('button',{name:'Revoke demo key '+demo.name,exact:true}).click();
  page.off('request',observe); assert.deepEqual(requests,[],'Demo revocation never contacts a service.');
  assert.equal(await inventory.locator('[data-demo-key]').count(),0); assert.equal((await inventory.locator('tbody td').innerText()).trim(),'Unavailable');
  assert.equal(await screen.locator('#api-key-value').inputValue(),''); await noAuthority();
  for (const value of values) assert.equal((await page.evaluate(()=>JSON.stringify(history.state))).includes(value),false);
  const docsLink=screen.locator('#api-documentation-link');
  assert.equal(await docsLink.isVisible(),true); assert.equal((await docsLink.innerText()).trim(),'swagger.platform.non-verba.com');
  assert.equal(await docsLink.getAttribute('type'),'button'); assert.equal(await docsLink.getAttribute('data-navigate'),'services/docs');
  assert.equal(await docsLink.evaluate(button=>{
    const card=document.getElementById('api-key-inventory').getBoundingClientRect(), bounds=button.getBoundingClientRect(), style=getComputedStyle(button);
    return style.display === 'block' && parseFloat(style.marginTop)>=24 && bounds.top-card.bottom>=23
      && Math.abs((bounds.left+bounds.right-card.left-card.right)/2)<=1.5;
  }),true,'Documentation is centered with at least a 24px gap below the card: '+label);
  assert.equal(await docsLink.evaluate(button=>button.classList.contains('text-link')
    && !document.getElementById('api-key-inventory').contains(button)
    && Boolean(document.getElementById('api-key-inventory').compareDocumentPosition(button)&Node.DOCUMENT_POSITION_FOLLOWING)),true);
  requests.length=0; page.on('request',observe);
  await docsLink.focus(); await page.keyboard.press('Enter'); await route('services/docs');
  const documentation=page.locator('#api-documentation-screen');
  assert.equal(await documentation.evaluate(element=>element.hidden),false); assert.equal(await documentation.getAttribute('aria-label'),'API and MCP documentation');
  assert.equal(await documentation.evaluate(element=>element.children.length===0 && !element.textContent.trim()
    && element.scrollWidth<=element.clientWidth+1),true,'The documentation placeholder is empty and fits its view.');
  assert.equal(await page.locator('#view-title').textContent(),'swagger.platform.non-verba.com');
  assert.equal(await page.locator('#view-eyebrow').textContent(),'Documentation');
  assert.equal(await page.locator('#view-description').isVisible(),false);
  assert.equal(await page.locator('#view-title').evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
  await noOverflow(label+' documentation');
  await page.locator('#view-back').click(); await route('services/api');
  page.off('request',observe); assert.deepEqual(requests,[],'Documentation navigation stays local and does not load the named host.');
  await add.click(); await name.fill('Discard this unfinished key'); await permissions.selectOption('write'); await expiry.selectOption('never');
}
async function centeredHeader(label) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const boxes = await page.locator('.brand').evaluate(header => {
    const brand = header.querySelector('.brand-identity');
    const name = header.querySelector('.brand-name');
    const left = header.querySelector('#navigation-toggle').getBoundingClientRect();
    const right = header.querySelector('#options-toggle').getBoundingClientRect();
    const bounds = header.getBoundingClientRect(), identity = brand.getBoundingClientRect();
    return {centerDifference:Math.abs((bounds.left + bounds.right) / 2 - (identity.left + identity.right) / 2),
      identityFits:brand.scrollWidth <= brand.clientWidth + 1,
      nameFits:name.scrollWidth <= name.clientWidth + 1 && name.scrollHeight <= name.clientHeight + 1
        && name.getBoundingClientRect().height > 0,
      controlsClear:left.right <= identity.left + 1 && identity.right <= right.left + 1};
  });
  assert.ok(boxes.centerDifference <= 1.5, 'Brand must stay centered: ' + label);
  assert.equal(boxes.identityFits, true, 'Brand text overflows its column: ' + label);
  assert.equal(boxes.nameFits, true, 'The header name must remain readable without clipping: ' + label);
  assert.equal(boxes.controlsClear, true, 'Header controls overlap the brand: ' + label);
  for (const id of ['navigation','options']) await usableTarget('#' + id + '-toggle', label);
}
async function quietHomeLayout(label, {largeText = false} = {}) {
  if (await currentView() !== 'home') await home();
  await route('#home', {focused:false});
  await page.evaluate(() => window.scrollTo(0, 0));
  const layout = await page.locator('#workspace').evaluate(workspace => {
    const bounds = workspace.getBoundingClientRect();
    const logo = document.getElementById('home-logo').getBoundingClientRect();
    const creditElement = document.getElementById('app-credit'), credit = creditElement.getBoundingClientRect();
    const creditLogo = creditElement.querySelector('img').getBoundingClientRect();
    const creditLabel = creditElement.querySelector('span').getBoundingClientRect();
    return {
      centered:Math.abs((bounds.left + bounds.right - logo.left - logo.right) / 2),
      verticallyCentered:Math.abs((bounds.top + bounds.bottom - logo.top - logo.bottom) / 2),
      logoWidth:logo.width, logoHeight:logo.height,
      noOverlap:logo.bottom + 8 <= credit.top,
      creditCentered:Math.abs((credit.left + credit.right) / 2 - innerWidth / 2),
      creditBottom:credit.bottom, viewportHeight:innerHeight,
      creditFits:creditElement.scrollWidth <= creditElement.clientWidth + 1
        && creditLogo.left >= credit.left - 1 && creditLabel.right <= credit.right + 1
        && creditLogo.width > 0 && creditLogo.height > 0 && creditLabel.height > 0,
      creditClear:creditLogo.right <= creditLabel.left + 1,
    };
  });
  assert.ok(layout.centered <= 2, 'Home artwork must be centered: ' + label);
  assert.ok(layout.verticallyCentered <= 2, 'Home artwork must sit in the center of the main area: ' + label);
  assert.ok(layout.logoWidth > 0 && layout.logoWidth <= 140 && layout.logoHeight > 0 && layout.logoHeight <= 140,
    'Home artwork must stay small: ' + label);
  assert.equal(layout.noOverlap, true, 'Home artwork overlaps the credit: ' + label);
  assert.ok(layout.creditCentered <= 2, 'The app credit must be centered: ' + label);
  assert.equal(layout.creditFits, true, 'The footer logo and text must remain readable without clipping: ' + label);
  assert.equal(layout.creditClear, true, 'The footer logo must not overlap its text: ' + label);
  if (!largeText) {
    assert.ok(layout.creditBottom <= layout.viewportHeight + 1 && layout.creditBottom >= layout.viewportHeight - 90,
      'The compact home footer must sit near the viewport bottom: ' + label);
  }
  await usableTarget('a#app-credit, #app-credit a', label + ' app credit');
}
async function focusStaysInPanel(name) {
  const selector = '#' + name + '-panel';
  if (name === 'options') await page.waitForFunction(() => document.querySelector('.service-status-list').getAttribute('aria-busy') !== 'true');
  const count = await page.locator(selector).evaluate(element =>
    [...element.querySelectorAll('button, a[href], input, textarea, select, summary, [tabindex="0"]')]
      .filter(control => !control.disabled && control.getClientRects().length > 0).length);
  assert.ok(count > 0, name + ' panel needs a usable control.');
  if (name === 'options') assert.equal(count, 1, 'Signed-out Settings exposes only the account entry.');
  for (const direction of ['Tab','Shift+Tab']) {
    for (let index = 0; index <= Math.max(count, 2); index++) {
      await page.keyboard.press(direction);
      assert.equal(await page.locator(selector).evaluate(element => element.contains(document.activeElement)), true,
        'Focus escaped the modal ' + name + ' panel using ' + direction);
    }
  }
}
async function noAuthority() {
  const state = await page.evaluate(() => ({
    forbiddenCalls:window.__participantForbiddenCalls,
    localStorage:localStorage.length, sessionStorage:sessionStorage.length, cookies:document.cookie,
    bridge:['NativeVault','NativeLocation','NativeCamera','NativeAudio'].filter(key => key in window),
    injection:window.__participantInjected === true,
  }));
  assert.deepEqual(state, {forbiddenCalls:[], localStorage:0, sessionStorage:0, cookies:'', bridge:[], injection:false});
  for (const id of ['new-request','list-new-request','new-operation','list-new-operation'])
    assert.equal(await page.locator('#'+id).isDisabled(),true,'An unverified shell cannot enable '+id+'.');
}
async function statusKinds(selector) {
  return page.locator(selector).evaluate(host => host.hidden ? [] : [...new Set(
    [...host.querySelectorAll('[data-status-kind]')].filter(marker => !marker.hidden).map(marker => marker.dataset.statusKind))].sort());
}
async function attentionState(requests, operations, ready = {requests:false, operations:false}, signedIn = false) {
  const actual=await page.evaluate(()=>{
    const kinds=host=>host.hidden ? [] : [...host.querySelectorAll('[data-status-kind]')].filter(marker=>!marker.hidden).map(marker=>marker.dataset.statusKind);
    const section=kind=>{
      const expanded=document.getElementById(kind+'-list-link').getAttribute('aria-expanded')==='true';
      const markers=kinds(document.querySelector('[data-status-summary="'+kind+'"]'));
      return {expanded,notification:markers.includes('notification'),warning:markers.includes('warning'),
        items:[...document.querySelectorAll('[data-attention-kind="'+kind+'"][data-attention-item]')].map(item=>({
          id:item.dataset.attentionItem,pending:Boolean(item.querySelector('.status-dot:not([hidden])'))}))};
    };
    return {menu:kinds(document.querySelector('[data-status-summary="dashboard"]')),
      label:document.getElementById('navigation-toggle').getAttribute('aria-label'),requests:section('requests'),operations:section('operations')};
  });
  assert.equal(actual.label,'Open navigation','Status descriptions must not replace the control name.');
  assert.equal(actual.menu.includes('notification'),requests || operations);
  assert.equal(actual.menu.includes('warning'),signedIn && (!ready.requests || !ready.operations));
  for (const [kind,pending,id] of [['requests',requests,'local-request'],['operations',operations,'local-operation']]) {
    const section=actual[kind];
    assert.equal(section.notification,pending && !section.expanded,'Expanded sections expose origins and hide their summaries.');
    assert.equal(section.warning,signedIn && !ready[kind] && !section.expanded);
    assert.deepEqual(section.items,[{id,pending},{id,pending}]);
  }
  await stableUrl();
}
async function roleSetupState(requests, operations, signedIn = false) {
  for (const [kind,complete] of [['requests',requests],['operations',operations]]) {
    assert.equal(await page.locator('#'+kind+'-setup-link').getAttribute('hidden') !== null,!signedIn || complete);
    assert.deepEqual(await statusKinds('[data-status-source="identity-'+kind+'"]'),signedIn && !complete ? ['warning'] : []);
    const expanded=await page.locator('#'+kind+'-list-link').getAttribute('aria-expanded')==='true';
    assert.equal((await statusKinds('[data-status-summary="'+kind+'"]')).includes('warning'),signedIn && !complete && !expanded);
  }
  assert.equal((await statusKinds('[data-status-summary="dashboard"]')).includes('warning'),signedIn && (!requests || !operations));
}
async function accountSetupView() {
  await route('identity/setup');
  assert.equal(await page.locator('#view-title').textContent(), 'Account and identity');
  const screen = page.locator('#identity-setup-screen');
  assert.equal(await screen.isVisible(), true);
  const purpose = await screen.innerText();
  assert.match(purpose, /account.*(?:first|before)|first.*account/is,
    'The shared setup flow must place account creation before identity verification.');
  assert.match(purpose, /post(?:ing)? (?:a )?requests?/i);
  assert.match(purpose, /accept(?:ing)? (?:an? )?operations?/i);
  assert.equal(await screen.locator('form, input, textarea').count(), 0,
    'The setup gateway must not collect credentials or identity documents.');
  assert.equal(await page.locator('#enrollment-begin').isDisabled(), true,
    'A role display flag must not open enrollment before a confirmed service account exists.');
  assert.match(await page.locator('#onboarding-notice').textContent(), /photos stay only in this open page.*(?:uploaded|verified)/i);
  assert.equal(await page.locator('#start-verification').count(), 0,
    'Verification cannot start before an account exists.');
}
async function signInView() {
  await route('account/sign-in');
  assert.equal(await page.locator('#view-title').textContent(),'Sign in');
  for (const id of ['view-eyebrow','view-description','onboarding-notice']) {
    assert.equal(await page.locator('#'+id).isVisible(),false,'Sign in keeps setup and development context out of the login: '+id);
  }
  assert.equal(await page.locator('#view-eyebrow').textContent(),'');
  assert.equal(await page.locator('#view-description').textContent(),'');
  const screen=page.locator('[data-onboarding-view="account/sign-in"]'), form=screen.locator('#account-email-form');
  assert.equal(await form.isVisible(),true);
  assert.deepEqual(await form.locator('label:visible').allTextContents(),['Email or username']);
  assert.deepEqual((await screen.locator('button:visible').allTextContents()).map(text=>text.trim()),['Continue','Create account']);
  await formLabel('#sign-in-email');
  for (const id of ['account-email-confirm-form','account-sign-in-form','sign-in-recover']) assert.equal(await page.locator('#'+id).isVisible(),false);
  assert.equal(await page.locator('#account-session-entry').isVisible(),false);
  assert.equal(await page.locator('#account-page-actions').isVisible(),false);
  assert.equal(await page.locator('#account-detail-identity').count(),0);
  for (const id of ['account-detail-email','account-detail-username'])
    assert.equal(await page.locator('#'+id).textContent(),'','Signed-out pages expose no stale account details.');
  assert.doesNotMatch(await screen.innerText(),/identity|verification|sign.?up|local development|document|face photo/i);
  assert.equal(await screen.getByRole('button',{name:'Create account',exact:true}).count(),1);
  assert.equal(await screen.locator('[data-navigate="account/create"]:visible').count(),0);
  assert.equal(await screen.locator('#sign-in-recover').getAttribute('type'),'button');
  await noAuthority();
}
async function setupPresentation(kind,expanded,signedIn=false) {
  if (!signedIn) {
    assert.equal(await page.locator('#'+kind+'-setup-link').evaluate(element=>element.hidden),true,'Identity setup is absent before sign-in.');
    assert.deepEqual(await statusKinds('[data-status-source="identity-'+kind+'"]'),[]);
    assert.equal(await page.locator('#navigation-'+kind).evaluate(element=>!element.hidden),expanded);
    return;
  }
  const actual=await page.evaluate(({kind,expanded})=>{
    const heading=document.getElementById(kind+'-list-link'),link=document.getElementById(kind+'-setup-link');
    const host=document.querySelector(expanded ? '[data-status-source="identity-'+kind+'"]' : '[data-status-summary="'+kind+'"]');
    const warning=host.querySelector('[data-status-kind="warning"]');
    const bounds=heading.getBoundingClientRect(),marker=warning.getBoundingClientRect(),group=host.getBoundingClientRect(),row=link.getBoundingClientRect();
    const rgb=value=>value.match(/\d+(?:\.\d+)?/g)?.map(Number)||[];
    const blue=rgb(getComputedStyle(link).color),triangle=rgb(getComputedStyle(warning.querySelector('svg')||warning).stroke);
    return {markerFits:marker.width>=15 && marker.width<=24 && marker.height>=15 && marker.height<=24,
      rightGap:bounds.right-group.right,indentation:row.left-bounds.left,
      blue:blue[2]>blue[1] && blue[2]>blue[0],yellow:triangle[0]>triangle[1] && triangle[1]>triangle[2] && triangle[2]<50,
      contentVisible:!document.getElementById('navigation-'+kind).hidden,
      summaryHidden:document.querySelector('[data-status-summary="'+kind+'"]').hidden,
      sourceInsideLink:link.contains(document.querySelector('[data-status-source="identity-'+kind+'"]'))};
  },{kind,expanded});
  assert.equal(actual.markerFits,true,'The visible setup status must remain legible.');
  assert.equal(actual.yellow,true,'Warnings stay yellow beside the blue setup link.');
  assert.equal(actual.contentVisible,expanded);assert.equal(actual.summaryHidden,expanded);
  assert.equal(actual.sourceInsideLink,true,'Warning origins stay in their setup row.');
  if (expanded) {assert.equal(actual.blue,true);assert.ok(actual.indentation>=12 && actual.indentation<=40);}
  else assert.ok(actual.rightGap>=-1 && actual.rightGap<=8,'Collapsed summaries belong at the heading right edge.');
}
async function dashboardRowIcons(kinds=['requests','operations']) {
  const rows=await page.evaluate(kinds=>{
    const reference=element=>element?.querySelector('use')?.getAttribute('href'),checks=[];
    for (const [kind,singular] of [['requests','request'],['operations','operation']]) {
      if (!kinds.includes(kind)) continue;
      const setup=document.getElementById(kind+'-setup-link'),empty=document.getElementById('navigation-'+kind+'-empty');
      const draft=document.getElementById('navigation-'+singular+'-draft'),newAction=document.getElementById('new-'+singular);
      for (const [type,row] of [['setup',setup],['empty',empty],['draft',draft]]) {
        if (type === 'setup' && row.hidden) continue;
        const icon=row.querySelector('svg'),href=reference(icon),symbol=href?.startsWith('#') ? document.getElementById(href.slice(1)) : null;
        let leftAligned=true,rightDot=true;
        if (row.getClientRects().length) {
          const walker=document.createTreeWalker(row,NodeFilter.SHOW_TEXT);let text;
          while ((text=walker.nextNode()) && (!text.textContent.trim() || text.parentElement.closest('[hidden]'))) {}
          const range=document.createRange();range.selectNode(text);
          const label=range.getBoundingClientRect(),graphic=icon.getBoundingClientRect(),bounds=row.getBoundingClientRect();
          const dot=row.querySelector('.status-dot:not([hidden])')?.getBoundingClientRect();
          leftAligned=graphic.width>0 && graphic.right<=label.left+1 && graphic.left>=bounds.left-1;
          rightDot=!dot || dot.left>=label.right-1 && bounds.right-dot.right<=2;
        }
        checks.push({kind,type,localSymbol:symbol?.namespaceURI==='http://www.w3.org/2000/svg',
          leading:row.firstElementChild===icon || row.firstElementChild?.contains(icon),leftAligned,rightDot,
          matching:type==='draft' ? href===reference(newAction) : type==='setup'
            ? Boolean(row.querySelector('[data-status-source="identity-'+kind+'"] [data-status-kind="warning"]'))
            : Boolean(symbol?.querySelector('circle') && symbol?.querySelector('path,line'))});
      }
    }
    return checks;
  },kinds);
  for (const row of rows) assert.equal(row.localSymbol && row.leading && row.matching && row.leftAligned && row.rightDot,true,
    row.kind+' '+row.type+' row needs a leading local icon and optional right-side status dot.');
}
async function menuIndicatorsFit(label) {
  const geometries=await page.evaluate(()=>['dashboard','settings'].map(root=>{
    const host=document.querySelector('[data-status-summary="'+root+'"]');
    const menu=document.getElementById(root === 'dashboard' ? 'navigation-toggle' : 'options-toggle').getBoundingClientRect();
    const frame=host.getBoundingClientRect(),middleX=(menu.left+menu.right)/2,middleY=(menu.top+menu.bottom)/2;
    const markers=[...host.querySelectorAll('[data-status-kind]')],boxes=markers.map(marker=>marker.getBoundingClientRect());
    return {root,kinds:markers.map(marker=>marker.dataset.statusKind),frame:frame.width===44 && frame.height===44,
      fits:boxes.every(box=>box.width>0 && box.height>0 && box.left>=0 && box.right<=innerWidth+1
        && box.top>=0 && box.bottom<=innerHeight+1 && box.left>=menu.left-3 && box.right<=menu.right+3
        && box.top>=menu.top-3 && box.bottom<=menu.bottom+3),
      corners:boxes.every((box,index)=>{
        const x=(box.left+box.right)/2,y=(box.top+box.bottom)/2;
        return (root==='dashboard' ? x>middleX : x<middleX)
          && (markers[index].dataset.statusKind==='notification' ? y<middleY : y>middleY);
      }),
      separate:boxes.every((box,index)=>boxes.slice(index+1).every(other=>box.bottom<=other.top+1 || other.bottom<=box.top+1
        || box.right<=other.left+1 || other.right<=box.left+1))};
  }));
  for (const geometry of geometries) {
    assert.ok(geometry.kinds.includes('warning') && geometry.kinds.includes('notification'));
    assert.equal(geometry.frame && geometry.fits && geometry.corners && geometry.separate,true,
      'Issue below and notification above at the inward header corner: '+geometry.root+' / '+label);
  }
}
async function freshDocument(suffix = '') {
  // A separate page tests boot behavior independently of the document's memory.
  await page?.close();
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(entry + suffix);
}
try {
  context = await browser.newContext({viewport:{width:390, height:844}, reducedMotion:'reduce'});
  // The default shell may discover and check the unavailable account relay.
  // Only the two public read-only probes are allowed through its structured RPC.
  await context.addInitScript(() => {
    window.__participantForbiddenCalls = [];
    window.__apiCopied=null; window.__apiClipboardRefuse=false; window.__apiClipboardGate=false;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{
      if (window.__apiClipboardRefuse) throw new DOMException('Synthetic clipboard refusal','NotAllowedError');
      if (window.__apiClipboardGate) await new Promise(resolve=>{window.__apiReleaseClipboard=resolve;});
      window.__apiCopied=value;
    }}});
    const note = name => window.__participantForbiddenCalls.push(name);
    for (const name of ['setItem','removeItem','clear']) {
      const original = Storage.prototype[name];
      Storage.prototype[name] = function (...args) { note('storage.' + name); return original.apply(this, args); };
    }
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => { note('indexedDB.open'); return open(...args); };
    const fetch = window.fetch.bind(window);
    window.fetch = (...args) => {
      const target = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href);
      const method = args[1]?.method || args[0]?.method || 'GET';
      if (target.origin !== location.origin || target.search || target.hash
        || !(method === 'GET' && target.pathname === '/account-api/config'
          || method === 'POST' && target.pathname === '/account-api/transport')) note('fetch');
      return fetch(...args);
    };
    const xhr = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (...args) { note('XMLHttpRequest'); return xhr.apply(this, args); };
    if (navigator.sendBeacon) {
      const beacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (...args) => { note('sendBeacon'); return beacon(...args); };
    }
    for (const name of ['WebSocket','EventSource']) {
      const Original = window[name];
      window[name] = new Proxy(Original, {construct(target, args) { note(name); return Reflect.construct(target, args); }});
    }
  });
  await context.route('**/*', async requestRoute => {
    const url = new URL(requestRoute.request().url()), key = url.pathname.replace(/^\/assets\//, '');
    if (url.origin === origin && url.pathname === '/account-api/config' && !url.search && !url.hash
      && requestRoute.request().method() === 'GET') {
      await requestRoute.fulfill({json:{enabled:false}, headers:{'Cache-Control':'no-store'}}); return;
    }
    if (url.origin === origin && url.pathname === '/account-api/transport' && !url.search && !url.hash
      && requestRoute.request().method() === 'POST') {
      const envelope = requestRoute.request().postDataJSON(), probe = envelope?.request;
      assert.equal(typeof envelope.id, 'string');
      assert.equal(probe?.method, 'GET');
      assert.ok(['/dev-oidc/.well-known/openid-configuration','/readyz'].includes(probe?.path),
        'The disconnected shell checks only public API/service readiness.');
      assert.ok(probe.body == null); assert.equal(Object.keys(probe.headers || {}).length, 0);
      await requestRoute.fulfill({json:{id:envelope.id,response:{status:503,headers:{'cache-control':'no-store'},
        body:JSON.stringify({error:'unavailable'})}},headers:{'Cache-Control':'no-store'}}); return;
    }
    const hostileEntry = key === 'participant/index.html' && requestRoute.request().isNavigationRequest()
      && hostileSearches.has(url.search);
    if (url.origin !== origin || (url.search && !hostileEntry) || url.hash || requestRoute.request().method() !== 'GET'
      || !key.startsWith('participant/') || !assets.has(key)) {
      unexpected.push(url.href); await requestRoute.abort(); return;
    }
    const type = key.endsWith('.html') ? 'text/html' : key.endsWith('.css') ? 'text/css' :
      key.endsWith('.js') ? 'text/javascript' : key.endsWith('.png') ? 'image/png' :
      /\.jpe?g$/.test(key) ? 'image/jpeg' : key.endsWith('.webp') ? 'image/webp' : 'image/svg+xml';
    await requestRoute.fulfill({body:assets.get(key), contentType:type, headers:{'Cache-Control':'no-store'}});
  });
  await freshDocument();

  await check('closed bundled shell, artwork and strict content policy', async () => {
    await route('#home', {focused:false});
    assert.equal(await page.locator('.brand img').evaluate(image => image.complete && image.naturalWidth > 0), true);
    for (const selector of ['#home-logo','#app-credit img']) {
      assert.equal(await page.locator(selector).evaluate(image => image.complete && image.naturalWidth > 0), true,
        selector + ' must load from the bundled app assets.');
      assert.match(await page.locator(selector).getAttribute('src'), /^branding\//);
    }
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    for (const directive of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "form-action 'none'"]) {
      assert.ok(policy.includes(directive), 'Missing CSP directive ' + directive);
    }
    assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
    assert.equal(await page.locator('script:not([src]), [onclick], [onsubmit], [onerror]').count(), 0);
    assert.equal(await page.locator('a[href^="#"], a[data-navigate]').count(), 0,
      'Internal app actions must use buttons rather than stateful URL links.');
    const shellBytes = Object.keys(PARTICIPANT_SHELL_SOURCES).reduce((sum, name) => sum + assets.get(name).length, 0);
    assert.ok(shellBytes <= PARTICIPANT_SHELL_BUDGET);
    assert.equal(await page.locator('[data-status-source="identity-requests"] [data-status-kind="warning"]').count(), 0,
      'A signed-out participant has no identity-verification warning.');
    await roleSetupState(false, false);
    await attentionState(false, false);
    await noAuthority(); await screenshot('home-phone');
  });

  await check('quiet home shows only its artwork and credit before drawer selection', async () => {
    assert.equal(await page.locator('main form:visible').count(), 0, 'Landing must not select a request or offer form.');
    assert.equal(await page.locator('.preview-strip, .preview-label, #requester-choice, #operator-choice').count(), 0);
    assert.equal(await page.locator('#home-request-list, #home-operation-list, #preview-details').count(), 0);
    assert.equal(await page.locator('#home-screen a, #home-screen button, #home-screen form').count(), 0,
      'Home must leave workflow choices in navigation.');
    assert.equal(await page.locator('#home-screen').getAttribute('tabindex'), '-1');
    const credit = page.locator('a#app-credit, #app-credit a');
    assert.equal(await credit.getAttribute('href'), 'https://waajacu.com/');
    assert.equal((await credit.innerText()).trim(), 'by waajacu');
    await quietHomeLayout('390px home');
    await visit('#requests');
    assert.equal(await page.locator('main form:visible').count(), 0);
    assert.equal(await page.locator('#request-list-draft').isVisible(), false);
    assert.doesNotMatch(await page.locator('main').innerText(), /Check a small garden/);
    await visit('#operations');
    assert.equal(await page.locator('main form:visible').count(), 0);
    assert.equal(await page.locator('#operation-list-draft').isVisible(), false);
    assert.doesNotMatch(await page.locator('main').innerText(), /Check a small garden/);
    await visit('#home');
    await openPanel('navigation');
    assert.equal(await page.locator('#home-link, #navigation-close, #options-close').count(), 0);
    assert.equal(await page.locator('#navigation-panel').getAttribute('aria-labelledby'), 'navigation-title');
    assert.equal(await page.locator('#navigation-panel .panel-heading h2').textContent(), 'Dashboard');
    await matchingDashboardDividers('390px drawer');
    await setupPresentation('requests', false); await setupPresentation('operations', false);
    for (const kind of ['requests','operations']) {
      const selector = '#' + kind + '-list-link';
      assert.equal(await page.locator(selector).evaluate(element => element.tagName), 'BUTTON');
      assert.equal(await page.locator(selector).getAttribute('href'), null);
      assert.equal(await page.locator(selector).evaluate(element => getComputedStyle(element).fontWeight), '650');
      await usableTarget(selector, 'navigation disclosure');
    }
    for (const [selector, view] of [['#new-request','requester'], ['#new-operation','operations/new']]) {
      assert.equal(await page.locator(selector).evaluate(element => element.tagName), 'BUTTON');
      assert.equal(await page.locator(selector).getAttribute('data-navigate'), view);
      assert.equal(await page.locator(selector).getAttribute('href'), null);
      await usableTarget(selector, 'navigation');
    }
    for (const [selector, label] of [['#new-request','New request'], ['#new-operation','New operation']]) {
      assert.equal(await page.locator(selector).getAttribute('title'), label,
        'New icon actions need a native hover label.');
      assert.equal(await page.locator(selector).getAttribute('aria-label'), label);
      assert.equal(await page.locator(selector + ' svg').count(), 1, 'New actions use a bundled line icon.');
      assert.equal(await page.locator(selector + ' svg').getAttribute('aria-hidden'), 'true');
    }
    await page.locator('#requests-list-link').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#requests-list-link').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#navigation-requests').isVisible(), true);
    assert.equal(await page.locator('#navigation-requests-empty').isVisible(), true);
    await setupPresentation('requests', true);
    assert.equal(await page.locator('#navigation-operations').isVisible(), false);
    await page.locator('#operations-list-link').click();
    assert.equal(await page.locator('#operations-list-link').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#navigation-operations-empty').isVisible(), true);
    assert.equal(await page.locator('#navigation-requests').isVisible(), true,
      'Request and operation lists must expand independently.');
    await setupPresentation('operations', true); await dashboardRowIcons();
    await page.locator('#requests-list-link').click();
    assert.equal(await page.locator('#requests-list-link').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#navigation-requests').isVisible(), false);
    await setupPresentation('requests', false);
    assert.equal(await page.locator('#navigation-operations').isVisible(), true);
    assert.equal(await currentView(), 'home', 'List disclosure must not navigate.');
    await stableUrl();
    await focusStaysInPanel('navigation');
    await page.keyboard.press('Escape');
    await openPanel('navigation'); await dismissOutside('navigation');
    await openPanel('navigation');
    for (const selector of ['#new-request','#new-operation']) {
      assert.equal(await page.locator(selector).isDisabled(),true,'Creating work requires identity authority even in the disconnected shell.');
      await page.locator(selector).evaluate(element=>element.focus());
      assert.equal(await page.locator(selector).evaluate(element=>element===document.activeElement),false,'Native disabled actions are outside keyboard activation.');
    }
    await page.locator('#requests-list-link').focus(); await page.keyboard.press('Enter');
    assert.equal(await currentView(),'home');
    await page.keyboard.press('Escape'); await page.locator('#navigation-panel').waitFor({state:'hidden'});
    await visit('#requests');
    assert.equal(await page.locator('#list-new-request').isDisabled(),true);
    await screenshot('locked-requests-phone'); await noAuthority();
  });

  await check('header drawers are labelled, keyboard-contained and dismiss without opening locked drafts', async () => {
    assert.equal(await page.locator('.preview-label').count(), 0);
    assert.equal(await page.locator('.brand-name').textContent(), 'Facta, non verba.');
    assert.equal(await page.locator('.brand-name em').textContent(), 'non verba.');
    assert.equal(await page.locator('.brand-wordmark, .brand-tagline').count(), 0);
    await stableUrl();
    for (const [name, titleText] of [['navigation','Dashboard'], ['options','Settings']]) {
      const toggle = page.locator('#' + name + '-toggle');
      assert.equal(await toggle.getAttribute('aria-label'), 'Open ' + name);
      assert.equal(await toggle.getAttribute('aria-controls'), name + '-panel');
      await toggle.focus(); await page.keyboard.press('Enter');
      const panel = page.locator('#' + name + '-panel');
      await panel.waitFor({state:'visible'});
      assert.equal(await panel.evaluate(element => element.tagName), 'DIALOG');
      assert.equal(await panel.evaluate(element => element.matches(':modal')), true);
      const labelledBy = await panel.getAttribute('aria-labelledby');
      assert.ok(labelledBy, name + ' dialog needs a heading label.');
      assert.equal(await page.locator('#' + labelledBy).textContent(), titleText);
      assert.equal(await page.locator('#' + labelledBy).evaluate(element => element.tagName), 'H2');
      await centeredPanelHeading(name, '390px drawer');
      if (name === 'navigation') {
        assert.equal(labelledBy, 'navigation-title');
        await page.waitForFunction(() => document.activeElement?.id === 'requests-list-link');
        await collapsedNavigation();
      } else {
        assert.equal(labelledBy, 'options-title');
        assert.equal(await panel.locator('button:visible').count(), 1);
        assert.equal(await panel.locator('#account-setup-link').isVisible(), true);
        assert.equal(await panel.locator('#configure-api-access').isVisible(), false);
        assert.equal(await panel.locator('#settings-budgets').isVisible(),false);
        assert.equal(await panel.locator('#account-sign-out').isVisible(), false);
        assert.equal(await panel.locator('#account-devices-link,#account-session-continue,#account-sign-out,#account-delete-link,#account-discard-session,.account-actions').count(),0,
          'Account actions belong to the separate Account page.');
      }
      await focusStaysInPanel(name);
      await page.keyboard.press('Escape'); await panel.waitFor({state:'hidden'});
      assert.equal(await page.evaluate(() => document.activeElement.id), name + '-toggle');
      assert.equal(await page.locator('#request-title').inputValue(), '');
      assert.equal(await page.locator('#request-description').inputValue(), '');
      const underlyingRoute = await currentView();
      await openPanel(name); await page.goBack(); await panel.waitFor({state:'hidden'});
      assert.equal(await currentView(), underlyingRoute,
        'Browser Back should close the panel before leaving the current route.');
      await stableUrl();
      assert.equal(await page.evaluate(() => document.activeElement.id), name + '-toggle');
      assert.equal(await page.locator('#request-title').inputValue(), '');
      assert.equal(await page.locator('#request-description').inputValue(), '');
      await page.goForward(); await panel.waitFor({state:'visible'}); await stableUrl();
      if (name === 'navigation') await collapsedNavigation();
      assert.equal(await currentView(), underlyingRoute, 'Forward should restore the drawer on its current view.');
      await page.goBack(); await panel.waitFor({state:'hidden'}); await stableUrl();
      await openPanel(name);
      await dismissOutside(name);
      assert.equal(await page.evaluate(() => document.activeElement.id), name + '-toggle');
    }
    await openPanel('options');
    const options = await page.locator('#options-panel').innerText();
    for (const label of ['Account','Network','API','Server','Services']) assert.ok(options.includes(label));
    for (const label of ['Device keys','Budgets','Manage API keys']) assert.equal(options.includes(label),false);
    await groupedSettings('390px drawer');
    const network=page.locator('#network-label');
    await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'));});
    assert.match(await network.innerText(),/offline/i);
    assert.ok((await statusKinds('[data-status-source="settings-network"]')).some(kind=>['warning','error'].includes(kind)),
      'The local browser signal reports offline without claiming an Internet probe.');
    await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:undefined});window.dispatchEvent(new Event('online'));});
    assert.match(await network.innerText(),/unconfirmed/i);
    assert.deepEqual(await statusKinds('[data-status-source="settings-network"]'),['unknown']);
    await page.evaluate(()=>{delete navigator.onLine;window.dispatchEvent(new Event('online'));});
    assert.match(await network.innerText(),/network available/i);
    assert.deepEqual(await statusKinds('[data-status-source="settings-network"]'),['success'],
      'The available network signal uses a check while API and server readiness remain independent.');
    assert.equal(await page.locator('[data-status-source="settings-network"] use').getAttribute('href'),'#status-success');
    await page.waitForFunction(() => document.querySelector('.service-status-list').getAttribute('aria-busy') === 'false');
    assert.match(await page.locator('#account-api-label').innerText(), /not checked|unavailable/i);
    assert.equal(await page.locator('#options-panel input:not(:disabled), #options-panel textarea, #options-panel form').count(), 0,
      'Unconnected options must not solicit account credentials or operational API configuration.');
    const account = page.locator('#account-setup-link');
    assert.equal((await account.innerText()).trim(), 'Sign in');
    assert.equal(await account.getAttribute('data-navigate'), 'account/sign-in');
    assert.equal(await account.getAttribute('type'), 'button');
    assert.equal(await account.isDisabled(), false);
    const accountColors = await account.evaluate(element => {
      const rgb = value => value.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
      const text = rgb(getComputedStyle(element).color), warning = rgb(getComputedStyle(element.querySelector('svg')).stroke);
      return {blue:text[2] > text[1] && text[2] > text[0],
        yellow:warning[0] > warning[1] && warning[1] > warning[2] && warning[2] < 50};
    });
    assert.deepEqual(accountColors, {blue:true, yellow:true}, 'Account setup needs blue text and a distinct yellow warning.');
    await usableTarget('#account-setup-link', 'Settings account setup');
    assert.equal(await page.locator('#app-about').evaluate(element => element.tagName), 'SECTION');
    assert.equal(await page.locator('#app-about').getAttribute('aria-labelledby'), 'about-title');
    assert.equal(await page.locator('#about-title').evaluate(element => element.tagName), 'H3');
    assert.equal(await page.locator('#about-title').textContent(), 'About');
    assert.equal(await page.locator('#app-about > p').textContent(), 'Version 0.7.0 · AGPL-3.0-only');
    assert.equal(await page.locator('#app-about').isVisible(), true);
    assert.equal(await page.locator('#app-about').evaluate(element => element.children.length), 2);
    assert.equal(await page.locator('#options-panel').evaluate(element => element.lastElementChild.id), 'app-about');
    assert.equal(await page.locator('#app-about details, #app-about summary, #app-about button').count(), 0,
      'About is a small, always-visible version section.');
    assert.equal(await page.locator('#draft-controls, #reset-drafts, #reset-confirmation, #confirm-reset, #cancel-reset').count(), 0,
      'Settings must not contain draft reset controls.');
    const previousApiView=await currentView();
    assert.equal(await page.locator('#configure-api-access').getAttribute('data-navigate'),'services/api');
    assert.equal((await page.locator('#configure-api-access').textContent()).trim(),'Manage API keys');
    assert.equal(await page.locator('#configure-api-access').isVisible(),false);
    await page.keyboard.press('Escape'); await page.locator('#options-panel').waitFor({state:'hidden'});
    await restoreViewFixture('services/api');
    await apiAccessMockup('390px API key management workspace');
    await page.locator('#view-back').click(); await route(previousApiView);
    assert.equal(await page.locator('#request-title').inputValue(),'');
    assert.equal(await page.locator('#request-description').inputValue(),'');
    await page.setViewportSize({width:631, height:871});
    for (const name of ['navigation','options']) {
      await openPanel(name);
      await dismissOutside(name);
    }
    await page.setViewportSize({width:390, height:844});
    await noAuthority();
  });

  await check('navigation and options stay visible and clickable while the brand scrolls away', async () => {
    await page.setViewportSize({width:390,height:400});
    await visit('account/sign-in');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const state = await page.evaluate(() => {
      const brand = document.querySelector('.brand-identity').getBoundingClientRect();
      const controls = ['navigation','options'].map(name => {
        const element = document.getElementById(name + '-toggle'), bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return {name, visible:bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth,
          hit:hit === element || element.contains(hit)};
      });
      return {scrollY, brandHidden:brand.bottom <= 0, controls};
    });
    assert.ok(state.scrollY > 0, 'Use an actually scrolled document.');
    assert.equal(state.brandHidden, true, 'The logo and title should scroll with the header.');
    for (const control of state.controls) {
      assert.equal(control.visible, true, control.name + ' must remain inside the viewport.');
      assert.equal(control.hit, true, control.name + ' must remain available above the scrolled content.');
      await openPanel(control.name);
      await page.keyboard.press('Escape');
      await page.locator('#' + control.name + '-panel').waitFor({state:'hidden'});
    }
    await screenshot('scrolled-controls-phone');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({width:390,height:844});
  });

  await check('identity prerequisites block every creation route, forged activation and stale history restoration', async () => {
    await freshDocument(); await route('home',{focused:false});
    for (const target of protectedViews) {
      await restoreViewFixture(target,{expected:lockedDestination(target)});
      assert.equal(await page.locator('.screen:visible form').count(),0,'A blocked route exposes only the read-only list: '+target);
      await noAuthority();
    }
    for (const [selector,description] of [['#new-request','new-request-prerequisite'],['#new-operation','new-operation-prerequisite']]) {
      await openPanel('navigation');
      const action=page.locator(selector);
      assert.equal(await action.isDisabled(),true);
      assert.ok((await action.getAttribute('aria-describedby')).split(/\s+/).includes(description));
      assert.match(await page.locator('#'+description).textContent(),/identity|verification/i);
      const before=await currentView();
      await action.evaluate(button=>{button.focus();button.click();button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
      assert.equal(await action.evaluate(button=>button===document.activeElement),false);
      assert.equal(await currentView(),before,'Native disabled controls cannot activate by mouse or keyboard.');
      await page.keyboard.press('Escape'); await page.locator('#navigation-panel').waitFor({state:'hidden'});
    }
    for (const target of protectedViews) {
      await page.evaluate(next=>{
        const button=document.createElement('button');button.type='button';button.dataset.navigate=next;button.id='blocked-route-attempt';
        document.body.append(button);button.click();button.remove();
      },target);
      await route(lockedDestination(target),{focused:false});
    }
    await page.evaluate(()=>{
      const index=history.state.index;
      history.pushState({nonverbaPreview:true,index:index+1,view:'requester',identity_verified:true,
        identity_level:'advanced',capabilities:{requests:true,operations:true}},'',location.pathname);
      history.pushState({nonverbaPreview:true,index:index+2,view:'home'},'',location.pathname);
    });
    await page.goBack(); await route('requests',{focused:false});
    assert.equal(await page.locator('#request-list-draft').isVisible(),false);
    await page.goForward(); await route('home',{focused:false});
    await noAuthority(); await screenshot('identity-prerequisites-locked');
  });

  await check('hidden form inputs and programmatic submissions cannot create or review unverified drafts', async () => {
    const injected='<img src=x onerror="window.__participantInjected=true">';
    for (const [kind,values] of [
      ['request',{title:'Blocked request',description:injected,place:'Courtyard',budget:'Discuss together'}],
      ['operation',{title:'Blocked operation',description:injected}],
      ['offer',{message:injected,price:'Discuss together'}]]) {
      const previous=await currentView();
      const ids=await page.locator('#'+kind+'-form input,#'+kind+'-form textarea').evaluateAll(nodes=>nodes.map(node=>node.id));
      for (const id of ids) await formLabel('#'+id);
      await page.evaluate(({kind,values})=>{
        for (const [field,value] of Object.entries(values)) {
          const input=document.getElementById(kind+'-'+field);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
        }
        document.getElementById(kind+'-form').requestSubmit();
      },{kind,values});
      await route(previous,{focused:false});
      assert.ok((await page.locator('#'+kind+'-form input,#'+kind+'-form textarea').evaluateAll(nodes=>nodes.map(node=>node.value))).every(value=>value===''),
        'Blocked input events do not mutate or retain an unverified '+kind+' draft.');
      assert.equal(await page.locator('#request-list-draft').isVisible(),false);
      assert.equal(await page.locator('#operation-list-draft').isVisible(),false);
      assert.equal(await page.locator('#navigation-request-row').evaluate(element=>element.hidden),true);
      assert.equal(await page.locator('#navigation-operation-row').evaluate(element=>element.hidden),true);
      assert.equal(await page.locator('#'+kind+'-errors').isVisible(),false,'Identity guards run before draft validation.');
      assert.equal(await page.locator('#'+kind+'-review-description img,#'+kind+'-review-message img').count(),0);
      await noAuthority();
    }
    for (const target of ['requester/review','operations/review','operator/review'])
      await restoreViewFixture(target,{expected:lockedDestination(target)});
    for (const id of ['publish-request','save-operation','send-offer','agree-work','submit-result'])
      assert.equal(await page.locator('#'+id).isDisabled(),true);
    await noAuthority();
  });

  await check('read-only example work stays browseable while offers and example workflow steps stay guarded', async () => {
    await visit('operator');
    assert.match(await page.locator('main').innerText(),/example|sample/i);
    await page.locator('#view-example-work').click(); await route('operator/work');
    assert.match(await page.locator('main').innerText(),/example|sample/i);
    assert.equal(await page.locator('#make-offer').isDisabled(),true);
    await page.locator('#make-offer').evaluate(button=>button.click());
    await route('operator/work',{focused:false});
    for (const target of ['operator/offer','operator/review','operator/agreement','operator/progress','operator/result'])
      await restoreViewFixture(target,{expected:'operations'});
    await noAuthority(); await screenshot('read-only-example-work');
  });

  await check('legacy URLs, stale state and reload never restore gated drafts or verification authority', async () => {
    for (const suffix of ['#not-a-route','#requester/review','#operator/review','#operations/review',
      '#requester/review?published=true','#operator/%72eview','#requester/../../operator',
      '?view=requester#requester/review','?account=example&view=operator#operator/review',
      '?view=operations%2Freview#operations/review']) {
      await freshDocument(suffix); await route('home',{focused:false});
      assert.deepEqual(await page.evaluate(()=>history.state),{nonverbaPreview:true,index:0,view:'home'});
      assert.equal(await page.locator('dialog:visible').count(),0);
    }
    for (const invalid of ['not-a-view','#requester','requester/review?published=true','operator/../../requester'])
      await restoreViewFixture(invalid,{expected:'home'});
    await page.evaluate(()=>history.replaceState({nonverbaPreview:true,index:85,view:'requester/review',
      nonverbaPanel:'options',identity_verification:'verified',roles:['R','O'],capabilities:{requests:true,operations:true}},'',location.pathname));
    await page.reload(); await route('home',{focused:false});
    assert.deepEqual(await page.evaluate(()=>history.state),{nonverbaPreview:true,index:0,view:'home'});
    for (const kind of ['request','operation','offer']) {
      const values=await page.locator('#'+kind+'-form input,#'+kind+'-form textarea').evaluateAll(nodes=>nodes.map(node=>node.value));
      assert.ok(values.every(value=>value===''),'Reload clears inaccessible '+kind+' controls.');
    }
    await noAuthority();
  });
  await check('phone to desktop routes preserve readable layout and usable controls', async () => {
    for (const width of [320,390,631,1280]) {
      await page.setViewportSize({width, height:900});
      for (const hash of ['#home','#requests','#operations','#operations/new','#account/sign-in','#identity/setup','#services/api',
        '#requester','#operator','#operator/work','#operator/offer','#operator/agreement','#operator/progress','#operator/result']) {
        await visit(hash); await noOverflow(width + 'px ' + hash);
        if (hash === '#account/sign-in') await signInView();
        if (hash === '#services/api') await apiAccessMockup(width+'px API key management workspace');
        for (const selector of ['#review-request','#review-offer','#review-operation']) {
          if (!await page.locator(selector).isVisible()) continue;
          await usableTarget(selector, width + 'px ' + hash);
        }
      }
      await quietHomeLayout(width + 'px home');
      await centeredHeader(width + 'px');
      for (const name of ['navigation','options']) {
        await openPanel(name); await noOverflow(width + 'px ' + name); await panelFits(name, width + 'px');
        await centeredPanelHeading(name, width + 'px');
        if (name === 'navigation') {
          await matchingDashboardDividers(width + 'px');
          for (const selector of ['#requests-list-link','#operations-list-link','#new-request','#new-operation']) {
            await usableTarget(selector, width + 'px');
          }
        } else {
          await usableTarget('#account-setup-link', width + 'px Settings');
          await groupedSettings(width + 'px Settings');
        }
        await page.keyboard.press('Escape');
        await page.locator('#' + name + '-panel').waitFor({state:'hidden'});
      }
    }
    await visit('#requester'); await screenshot('locked-requests-desktop');
    await page.setViewportSize({width:320, height:900});
    // CSSOM text scaling does not change the authored content policy.
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    for (const hash of ['#home','#requests','#operations','#operations/new','#account/sign-in','#identity/setup','#services/api',
      '#requester','#operator','#operator/work','#operator/offer','#operator/agreement','#operator/result']) {
      await visit(hash); await noOverflow('320px, 200% text, ' + hash);
      if (hash === '#account/sign-in') await signInView();
      if (hash === '#services/api') await apiAccessMockup('320px, 200% API key management workspace');
    }
    await quietHomeLayout('320px, 200% text home', {largeText:true});
    await centeredHeader('320px, 200% text');
    for (const name of ['navigation','options']) {
      await openPanel(name); await panelFits(name, '320px, 200% text');
      await centeredPanelHeading(name, '320px, 200% text');
      await noOverflow('320px, 200% text, ' + name);
      if (name === 'navigation') {
        await matchingDashboardDividers('320px, 200% text');
        for (const selector of ['#requests-list-link','#operations-list-link','#new-request','#new-operation']) {
          await usableTarget(selector, '320px, 200% text');
        }
      } else {
        await usableTarget('#account-setup-link', '320px, 200% text Settings');
        await groupedSettings('320px, 200% text Settings');
        assert.equal(await page.locator('#configure-api-access').isVisible(),false);
      }
      await page.keyboard.press('Escape');
      await page.locator('#' + name + '-panel').waitFor({state:'hidden'});
    }
    await screenshot('large-text-phone');
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
  });

  await check('Settings and identity setup presentation cannot grant workspace verification authority', async () => {
    await freshDocument(); await route('home',{focused:false});
    await page.setViewportSize({width:390,height:844}); await roleSetupState(false,false);
    await visit('requests'); const previousAccountView=await currentView();
    await openPanel('options'); await page.locator('#account-setup-link').click();
    await page.locator('#options-panel').waitFor({state:'hidden'}); await signInView();
    await restoreViewFixture('account/recover'); await route('account/recover');
    assert.equal(await page.locator('#onboarding-notice').isVisible(),false);
    await page.locator('#view-back').click(); await signInView();
    await page.locator('#view-back').click(); await route(previousAccountView);
    for (const kind of ['requests','operations']) {
      const previous=await currentView();
      // A display-only status rendering has no account session or identity authority.
      await page.evaluate(async()=>{(await import('./participant.js')).renderRoleSetup(document,{},true);});
      await openPanel('navigation');
      const warning=page.locator('[data-status-summary="'+kind+'"] [data-status-kind="warning"]');
      const origin=page.locator('[data-status-source="identity-'+kind+'"]');
      const originalOrigin=await origin.elementHandle();
      assert.equal(await warning.isVisible(),true); assert.equal(await warning.getAttribute('aria-hidden'),'true');
      await setupPresentation(kind,false,true); await warning.locator('use').click();
      await page.locator('#navigation-'+kind).waitFor({state:'visible'});
      assert.equal(await page.locator('#navigation-panel').isVisible(),true);
      assert.equal(await currentView(),previous,'A warning expands its role without navigating.');
      const link=page.locator('#'+kind+'-setup-link');
      assert.equal(await link.getAttribute('data-navigate'),'identity/setup');
      assert.equal((await link.innerText()).trim(),kind==='operations' ? 'Set up advanced identity verification' : 'Set up identity verification');
      await setupPresentation(kind,true,true); await dashboardRowIcons([kind]);
      await page.locator('#'+kind+'-list-link').click(); await setupPresentation(kind,false,true);
      await page.locator('#'+kind+'-list-link').click(); await setupPresentation(kind,true,true);
      assert.equal(await originalOrigin.evaluate(element=>element===document.querySelector('[data-status-source="'+element.dataset.statusSource+'"]')),true);
      await originalOrigin.dispose(); await usableTarget('#'+kind+'-setup-link',kind+' identity setup');
      await link.click(); await page.locator('#navigation-panel').waitFor({state:'hidden'}); await accountSetupView();
      await noAuthority(); await page.locator('#view-back').click(); await route(previous);
    }
    for (const ready of [{requests:true,operations:false},{requests:false,operations:true},
      {requests:true,operations:true},{requests:false,operations:false}]) {
      await page.evaluate(async input=>{(await import('./participant.js')).renderRoleSetup(document,input,true);},ready);
      await roleSetupState(ready.requests,ready.operations,true);
      await noAuthority();
      await restoreViewFixture(ready.requests ? 'requester' : 'operations/new',{expected:ready.requests ? 'requests' : 'operations'});
      for (const id of ['#enrollment-begin','#publish-request','#save-operation','#send-offer'])
        assert.equal(await page.locator(id).isDisabled(),true,'Display readiness does not grant identity authority.');
      await page.evaluate(async()=>{(await import('./participant.js')).renderRoleSetup(document,{},false);});
    }
    await noAuthority();
  });

  await check('attention for nonexistent or blocked workspace drafts cannot mint rows or pending-work notices', async () => {
    await freshDocument(); await route('home',{focused:false});
    for (const input of [{requests:['local-request'],operations:['local-operation']},null,
      {requests:['local-request','local-request'],operations:['local-operation','local-operation']},
      {requests:['missing-request','local-request"] img'],operations:['missing-operation']},
      {requests:'local-request',operations:[null,42,{},'<img src=x onerror="window.__participantInjected=true">']}]) {
      await page.evaluate(async value=>{(await import('./participant.js')).renderAttention(document,value);},input);
      await attentionState(false,false);
      assert.equal(await page.locator('#navigation-request-row').evaluate(element=>element.hidden),true);
      assert.equal(await page.locator('#navigation-operation-row').evaluate(element=>element.hidden),true);
      await noAuthority();
    }
    await restoreViewFixture('requester',{expected:'requests'}); await attentionState(false,false);
    await restoreViewFixture('operations/new',{expected:'operations'}); await attentionState(false,false);
    await page.reload(); await route('home',{focused:false}); await attentionState(false,false); await noAuthority();
  });
  await check('new source owners bubble through declared ancestors, isolate drawers and resolve without acknowledgement', async () => {
    await freshDocument(); await route('home', {focused:false});
    await page.evaluate(async () => {
      const {renderRoleSetup} = await import('./participant.js');
      renderRoleSetup(document,{requests:true,operations:true});
      const branch = document.createElement('section');
      branch.id = 'browser-status-fixture'; branch.dataset.statusNode = 'fixtureBranch'; branch.dataset.statusParent = 'requests';
      branch.innerHTML = '<button id="fixture-disclosure" type="button" aria-expanded="false">Fixture branch'
        + '<span class="status-icons" data-status-summary="fixtureBranch" data-status-disclosure="fixture-disclosure"></span></button>'
        + '<section data-status-node="fixtureLeaf" data-status-parent="fixtureBranch">'
        + '<button type="button">Fixture leaf<span class="status-icons" data-status-summary="fixtureLeaf"></span></button>'
        + ['fixture-warning','fixture-warning-two','fixture-notification','fixture-unknown','fixture-success','fixture-info']
          .map(id=>'<button type="button">'+id+'<span class="status-icons" data-status-source="'+id+'"'
            + (id === 'fixture-notification' ? ' data-status-dot' : '') + '></span></button>').join('') + '</section>';
      document.getElementById('navigation-requests').append(branch);
      const settings = document.createElement('section');
      settings.id = 'browser-settings-fixture'; settings.dataset.statusNode = 'fixtureSettings'; settings.dataset.statusParent = 'settings';
      settings.innerHTML = '<button type="button">Settings fixture<span class="status-icons" data-status-source="fixture-settings-notification"></span></button>';
      document.getElementById('options-panel').append(settings);
    });
    const warning = {id:'fixture-warning',owner:'fixtureLeaf',kind:'warning',message:'Synthetic nested warning'},
      second = {id:'fixture-warning-two',owner:'fixtureLeaf',kind:'warning',message:'Synthetic second warning'},
      notification = {id:'fixture-notification',owner:'fixtureLeaf',kind:'notification',message:'Synthetic unread item'},
      settings = {id:'fixture-settings-notification',owner:'fixtureSettings',kind:'notification',message:'Synthetic settings notice'};
    const publish = records => page.evaluate(async input => {
      const {setStatusSources} = await import('./participant.js'); setStatusSources(document,'browser-fixture',input);
    }, records);
    const summary = id => '[data-status-summary="' + id + '"]';
    const source = id => '[data-status-source="' + id + '"]';
    await publish([warning,second,notification,{...notification}]);
    for (const id of ['fixtureLeaf','fixtureBranch','requests','dashboard']) {
      assert.deepEqual(await statusKinds(summary(id)),['notification','warning']);
      assert.equal(await page.locator(summary(id)+' [data-status-kind="warning"]').count(),1,'Warnings of the same kind aggregate once.');
      assert.equal(await page.locator(summary(id)+' [data-status-kind="notification"]').count(),1,'Repeated identical sources aggregate once.');
    }
    assert.equal((await statusKinds(summary('settings'))).includes('notification'),false,'A dashboard source cannot enter Settings.');
    assert.deepEqual(await statusKinds(source('fixture-warning-two')),['warning']);
    assert.equal(await page.locator(source('fixture-notification')+' .status-dot').count(),1);
    await openPanel('navigation'); await page.locator('#requests-list-link').click();
    assert.deepEqual(await statusKinds(summary('requests')),[],'Expanded summaries hide every type.');
    assert.deepEqual(await statusKinds(summary('dashboard')),['notification','warning'],'Opening does not acknowledge the header summary.');
    await page.locator('#fixture-disclosure').evaluate(button=>button.setAttribute('aria-expanded','true'));
    await page.evaluate(async()=>{ (await import('./participant.js')).renderStatuses(document); });
    assert.deepEqual(await statusKinds(summary('fixtureBranch')),[]);
    assert.deepEqual(await statusKinds(summary('fixtureLeaf')),['notification','warning']);
    assert.deepEqual(await statusKinds(source('fixture-warning')),['warning'],'Disclosure never removes the original source.');
    await publish([warning,notification,settings]);
    const bellColor=await page.locator(summary('dashboard')+' [data-status-kind="notification"]').evaluate(element=>getComputedStyle(element.querySelector('svg')||element).stroke);
    const blue=bellColor.match(/\d+(?:\.\d+)?/g)?.map(Number);
    assert.ok(blue && blue[2]>blue[1] && blue[2]>blue[0],'Display-only attention bells retain the blue notification stroke.');
    for (const [width,scale] of [[390,'100%'],[320,'100%'],[320,'200%']]) {
      await page.setViewportSize({width,height:900}); await page.evaluate(value=>{document.documentElement.style.fontSize=value;},scale);
      await noOverflow(width+'px independent status, '+scale+' text');
      await panelFits('navigation',width+'px independent status, '+scale+' text');
      await centeredPanelHeading('navigation',width+'px independent status, '+scale+' text');
      await menuIndicatorsFit(width+'px independent status, '+scale+' text');
      await noAuthority();
    }
    await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
    await page.setViewportSize({width:390,height:844}); await screenshot('independent-status-origins');
    await page.keyboard.press('Escape'); await page.locator('#navigation-panel').waitFor({state:'hidden'});
    await publish([notification,settings]);
    assert.deepEqual(await statusKinds(summary('dashboard')),['notification'],'Resolving warnings preserves the notification.');
    assert.ok((await statusKinds(summary('settings'))).includes('notification'),'Independent Settings notification stays in its own root.');
    await publish([settings]);
    assert.deepEqual(await statusKinds(summary('dashboard')),[],'Removing the nested source clears its entire ancestor path.');
    assert.ok((await statusKinds(summary('settings'))).includes('notification'));
    await publish([{id:'fixture-unknown',owner:'fixtureLeaf',kind:'unknown',message:'Synthetic result not confirmed'},
      {id:'fixture-success',owner:'fixtureLeaf',kind:'success',message:'Synthetic completed item'},
      {id:'fixture-info',owner:'fixtureLeaf',kind:'info',message:'Synthetic neutral context'},settings]);
    assert.deepEqual(await statusKinds(summary('dashboard')),['unknown'],'Unconfirmed results never become success.');
    assert.deepEqual(await statusKinds(source('fixture-success')),['success']);
    assert.deepEqual(await statusKinds(source('fixture-info')),['info']);
    const accessible = await page.evaluate(() => ({
      decorative:[...document.querySelectorAll('.status-icons')].every(host=>host.getAttribute('aria-hidden')==='true'),
      descriptions:[...document.querySelectorAll('[aria-describedby]')].every(control=>control.getAttribute('aria-describedby').split(/\s+/)
        .filter(id=>id.startsWith('nonverba-status-description-'))
        .every(id=>Boolean(document.getElementById(id)?.hidden && document.getElementById(id).textContent.trim()))),
      names:['navigation','options'].map(name=>document.getElementById(name+'-toggle').getAttribute('aria-label'))
    }));
    assert.deepEqual(accessible,{decorative:true,descriptions:true,names:['Open navigation','Open options']});
    await publish([{id:'fixture-success',owner:'fixtureLeaf',kind:'success',message:'Synthetic completed item'}]);
    for (const id of ['fixtureLeaf','fixtureBranch','requests','dashboard']) {
      assert.equal(await page.locator(summary(id)).evaluate(host=>host.hidden),true,'Success remains at its source and never bubbles.');
    }
    await publish([]);
    assert.deepEqual(await statusKinds(summary('dashboard')),[]);
    assert.equal((await statusKinds(summary('settings'))).includes('notification'),false);
    await page.evaluate(async()=>{
      document.getElementById('browser-status-fixture').remove(); document.getElementById('browser-settings-fixture').remove();
      (await import('./participant.js')).renderStatuses(document);
    });
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('[aria-describedby]')].every(control=>
      control.getAttribute('aria-describedby').split(/\s+/).every(id=>document.getElementById(id)))),true,'Removing hosts leaves no dangling description references.');
    await freshDocument(); await route('home',{focused:false});
  });

  await check('no service, persistence, native authority, unexpected requests or browser errors', async () => {
    await noAuthority(); assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.deepEqual(consoleErrors, []);
  });
  const result = {passed:true, scope:'Bundled participant shell, history and fail-closed identity prerequisites', checks,
    shellBytes:Object.keys(PARTICIPANT_SHELL_SOURCES).reduce((sum, name) => sum + assets.get(name).length, 0),
    screenshots:output, screenshotFiles:screenshots,
    syntheticFixtures:['Status origins are display-only fixtures; workspace actions remain identity-gated.'],
    android_device_tested:false, services_connected:false};
  await writeFile(output + '/result.json', JSON.stringify(result, null, 2) + '\n', {flag:'wx'});
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const result = {passed:false, scope:'Bundled participant shell, history and fail-closed identity prerequisites', checks,
    failure:error.stack || String(error), errors, unexpected, consoleErrors, screenshots:output,
    android_device_tested:false, services_connected:false};
  if (page) await page.screenshot({path:output + '/failure.png', fullPage:true}).catch(() => {});
  await writeFile(output + '/result.json', JSON.stringify(result, null, 2) + '\n', {flag:'wx'});
  throw error;
} finally { await context?.close(); await browser.close(); }
