// SPDX-License-Identifier: AGPL-3.0-only
// Actual engineering interface QA. It reads one bounded page at a time and codes no meanings.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

if (process.platform!=='linux'||process.env.NONVERBA_CONTAINER!=='1') throw new Error('Browser QA runs only inside the documented managed Linux container.');
const args = Object.fromEntries(process.argv.slice(2).map(value=>{const match=/^--(run|url)=(.+)$/.exec(value); if (!match) throw new Error('Expected --run=managed-path and optional --url=loopback-review-url.'); return [match[1],match[2]];}));
const run=path.resolve(args.run||''); const base='/opt/nonverba-build/priors-derivation/study-v0.2';
if (path.dirname(run)!==base||!/^[a-z0-9][a-z0-9_-]{0,95}$/.test(path.basename(run))) throw new Error('QA artifacts require an explicit managed study run.');
const url=new URL(args.url||'http://127.0.0.1:4173/review.html');
if (!['127.0.0.1','localhost'].includes(url.hostname)||url.protocol!=='http:'||url.port!=='4173'||url.pathname!=='/review.html') throw new Error('QA targets only the documented loopback review entry on4173.');
const output=path.join(run,'qa',`browser-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`); await mkdir(output,{recursive:true});
const require=createRequire('/opt/nonverba-tools/browser-tests/package.json');
const {chromium}=require(process.env.NONVERBA_PLAYWRIGHT_PATH||'/opt/nonverba-tools/browser-tests/node_modules/playwright');
const browser=await chromium.launch({headless:true,...(process.env.NONVERBA_BROWSER_EXECUTABLE?{executablePath:process.env.NONVERBA_BROWSER_EXECUTABLE}:{})});
const report={schema_version:2,status:'ACTUAL_ENGINEERING_BROWSER_QA_IN_PROGRESS',authority:'NONE',adopted_catalog:false,participant_evaluation:'NOT_RUN',meaning_coding:'NOT_RUN',url:url.href,output_directory:output,viewports:[],findings:[],limitations:['Bounded interface and source-lineage checks do not assess extraction adequacy or candidate meanings.','This report covers the service snapshot identified by its actual API counts; it does not certify the full15000-contract target.']};
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function widthCheck(page,label,results) {
  await settle(page); const width=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,body:document.body.scrollWidth,document:document.documentElement.scrollWidth}));
  assert.ok(width.body<=width.viewport+1&&width.document<=width.viewport+1,`${label} horizontal overflow: ${JSON.stringify(width)}`); results.push({check:label,...width,status:'PASSED'});
}
async function pageChange(page,endpoint,action) {
  const [response]=await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname===endpoint&&response.request().method()==='GET'),action()]);
  assert.equal(response.status(),200,`${endpoint} request failed`); const result=await response.json(); await settle(page); if (result.items) assert.ok(result.items.length<=20); return result;
}
try {
  for (const viewport of [{width:1366,height:900},{width:390,height:844}]) {
    const context=await browser.newContext({viewport}); const page=await context.newPage(); const errors=[]; const pageErrors=[]; const external=[]; const cspViolations=[]; let policyProbe=false;
    page.on('console',message=>{if (message.type()==='error'&&!policyProbe) errors.push(message.text());}); page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('request',request=>{if (new URL(request.url()).origin!==url.origin) external.push(request.url());});
    await page.addInitScript(()=>{window.__qaInlineExecuted=false; window.__qaCsp=[]; document.addEventListener('securitypolicyviolation',event=>window.__qaCsp.push(event.effectiveDirective));});
    const checks=[];
    try {
      const response=await page.goto(url.href); assert.equal(response.status(),200); const headers=await response.allHeaders();
      assert.equal(headers['x-robots-tag'],'noindex, nofollow'); assert.match(headers['content-security-policy'],/style-src-elem 'self' 'unsafe-inline'/); assert.match(headers['content-security-policy'],/style-src-attr 'none'/); assert.match(headers['content-security-policy'],/script-src 'self';/);
      await page.locator('#content .card').first().waitFor(); await settle(page);
      const summary=await (await context.request.get(new URL('/api/summary',url).href)).json(); report.actual_run={run_id:summary.run_id,counts:summary.counts,primary:summary.primary_run,representation_gate:summary.gates.representation};
      assert.equal(summary.authority,'NONE'); assert.equal(summary.adopted_catalog,false); assert.equal(summary.run_id,path.basename(run));
      assert.equal(await page.getByText('PROTOTYPE / RESEARCH ONLY',{exact:true}).isVisible(),true); assert.equal(await page.locator('#content .card').count(),20);
      const first=await page.locator('.identifier').first().textContent(); await widthCheck(page,'source page',checks);
      await page.screenshot({path:path.join(output,`source-${viewport.width}.png`),fullPage:false});
      const initialScope=await page.locator('.scope').textContent();
      if (summary.gates.representation.status!=='CALIBRATION_GATE_PASSED'&&!/pre.?gate|calibration|representation.*not.*passed/i.test(initialScope)) report.findings.push({severity:'medium',check:'visible_initial_scope',viewport:viewport.width,finding:'Initial source screen does not explicitly display that the representation gate has not passed; this state is available in Provenance & gates.'});
      const second=await pageChange(page,'/api/units',()=>page.locator('#next').click()); assert.equal(second.returned,20); assert.notEqual(second.items[0].id,first); assert.match(await page.locator('#page-note').textContent(),/Page 2/);
      await pageChange(page,'/api/units',()=>page.locator('#previous').click()); assert.equal(await page.locator('.identifier').first().textContent(),first);
      await page.locator('#search').fill('NONVERBA_QA_ABSENT_79f26be8'); await pageChange(page,'/api/units',()=>page.locator('#apply').click()); assert.equal(await page.locator('#content .card').count(),0); assert.equal(await page.getByRole('heading',{name:'No admitted evidence on this page',exact:true}).isVisible(),true);
      await page.locator('#search').fill(first); const searched=await pageChange(page,'/api/units',()=>page.locator('#apply').click()); assert.ok(searched.items.some(item=>item.id===first));
      await pageChange(page,'/api/units',()=>page.locator('#reset').click());
      const unitPage=await (await context.request.get(new URL('/api/units?limit=1',url).href)).json(); const unit=unitPage.items[0];
      assert.equal(unit.evidence_classification,'RAW_ADMITTED_SOURCE_TEXT'); assert.equal(unit.inferred_prior_meaning,null); assert.equal(unit.vector,undefined); assert.ok(['discovery-broad','discovery-relevant'].includes(unit.cohort));
      const parent=await pageChange(page,'/api/context',()=>page.locator('.card').first().getByRole('button',{name:'Inspect parent & source context',exact:true}).click());
      assert.equal(parent.unit_id,unit.id); assert.equal(parent.normalized_hash_bound_to_extraction,true); assert.match(parent.normalized_source_sha256,/^[a-f0-9]{64}$/); assert.ok(parent.excerpt?.text.includes(unit.text));
      await page.locator('.card .context').first().waitFor({state:'visible'}); await widthCheck(page,'opened source context',checks);
      await page.screenshot({path:path.join(output,`context-${viewport.width}.png`),fullPage:false});
      const contractUnits=await pageChange(page,'/api/units',()=>page.locator('.card').first().getByRole('button',{name:'This contract',exact:true}).click()); assert.ok(contractUnits.items.every(item=>item.contract_id===unit.contract_id));
      const clusters=await pageChange(page,'/api/clusters',()=>page.locator('[data-view="clusters"]').click()); assert.ok(clusters.items.length>0); await widthCheck(page,'cluster view',checks);
      const members=await pageChange(page,'/api/units',()=>page.getByRole('button',{name:'Inspect source members',exact:true}).first().click()); assert.ok(members.items.every(item=>item.assignment?.cluster_id===clusters.items[0].id));
      const contracts=await pageChange(page,'/api/contracts',()=>page.locator('[data-view="contracts"]').click()); assert.ok(contracts.items.length>0); await widthCheck(page,'contract view',checks);
      const admitted=await pageChange(page,'/api/units',()=>page.getByRole('button',{name:'Inspect admitted units',exact:true}).first().click()); assert.ok(admitted.items.every(item=>item.contract_id===contracts.items[0].id));
      await page.locator('[data-view="method"]').click(); await page.getByRole('heading',{name:'Provenance & gates',exact:true}).waitFor(); await widthCheck(page,'provenance and gates',checks);
      assert.ok((await page.locator('.gate').allTextContents()).some(value=>value.includes('NOT_PASSED_CALIBRATION_IN_PROGRESS')||value.includes('CALIBRATION_GATE_PASSED')));
      await page.screenshot({path:path.join(output,`gates-${viewport.width}.png`),fullPage:false});
      for (const button of ['Source evidence','Discovery clusters','Contracts','Provenance & gates']) {
        const tab=page.getByRole('button',{name:button,exact:true}); await tab.scrollIntoViewIfNeeded();
        const box=await tab.boundingBox(); assert.ok(box&&box.x>=-1&&box.x+box.width<=viewport.width+1,`${button} inaccessible outside horizontal viewport`);
      }
      const links=await page.locator('a.source').evaluateAll(nodes=>nodes.map(node=>node.href)); assert.ok(links.every(value=>/^https?:\/\//.test(value)));
      assert.deepEqual(external,[]); assert.deepEqual(errors,[]); assert.deepEqual(pageErrors,[]);
      policyProbe=true;
      await page.evaluate(()=>{
        const node=document.createElement('div');node.id='qa-csp-probe';node.textContent='Local policy probe';document.body.append(node);
        const style=document.createElement('style');style.textContent='#qa-csp-probe{color:rgb(1,2,3)}';document.head.append(style);
        node.setAttribute('style','background-color:rgb(4,5,6)');
        const script=document.createElement('script');script.textContent='window.__qaInlineExecuted=true';document.head.append(script);
      }); await settle(page);
      const probe=await page.evaluate(()=>({color:getComputedStyle(document.getElementById('qa-csp-probe')).color,background:getComputedStyle(document.getElementById('qa-csp-probe')).backgroundColor,executed:window.__qaInlineExecuted,violations:window.__qaCsp}));
      assert.equal(probe.color,'rgb(1, 2, 3)'); assert.notEqual(probe.background,'rgb(4, 5, 6)'); assert.equal(probe.executed,false); assert.ok(probe.violations.includes('style-src-attr')); assert.ok(probe.violations.includes('script-src-elem')); cspViolations.push(...probe.violations);
      report.viewports.push({viewport,status:'PASSED',checks,console_errors:errors,page_errors:pageErrors,external_requests:external,expected_probe_csp_violations:cspViolations});
    } finally {await context.close();}
  }
  report.status='ACTUAL_ENGINEERING_BROWSER_QA_PASSED';
} catch(error) {report.status='ACTUAL_ENGINEERING_BROWSER_QA_FAILED'; report.failure={message:error.message,stack:error.stack}; process.exitCode=1;}
finally {await browser.close(); await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'}); console.log(JSON.stringify({status:report.status,actual_run:report.actual_run,viewports:report.viewports.length,findings:report.findings,report_path:path.join(output,'report.json'),failure:report.failure?.message||null}));}
