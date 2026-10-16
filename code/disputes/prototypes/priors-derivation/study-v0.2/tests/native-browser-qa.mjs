// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC renderer QA. No real study API or corpus is opened.
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {sha256} from '../../lib/common.mjs';
import {studyPath,validateStudyRoot,writeJSON} from '../lib/store.mjs';
import {localReviewCsp} from '../lib/review.mjs';
import {traceNativeDecoration,bindNativeDecoration,createNativeDecorationView} from '../lib/source-decoration.mjs';

if(process.platform!=='linux'||process.env.NONVERBA_CONTAINER!=='1')throw new Error('Managed Linux container required');
const run=process.argv[2];validateStudyRoot(run);
const base=`qa/native-renderer-${new Date().toISOString().replace(/[:.]/gu,'-')}-${randomUUID()}`;
await mkdir(await studyPath(run,base,{missing:true}),{recursive:true});
const raw='<p>Declared synthetic Alpha<strike> </strike><u>  </u>Beta <u>&lt;img src=x onerror="window.__sourceExecuted=true"&gt;</u></p>';
const trace=traceNativeDecoration(raw);assert.equal(trace.runs.length,5);
const normalizedText=trace.runs[0].decoded_text+' '+trace.runs.slice(3).map(run=>run.decoded_text).join('');
const origin=index=>({run_id:trace.runs[index].id,decoded_start:0,decoded_end:trace.runs[index].decoded_text.length});
let end=trace.runs[0].decoded_text.length;
const collectorSegments=[{normalized_start:0,normalized_end:end,sources:[origin(0)],normalization:'EXACT_DECODED'},
  {normalized_start:end,normalized_end:++end,sources:[origin(1),origin(2)],normalization:'EXTRACTOR_WHITESPACE_TO_ASCII_SPACE_V1'}];
for(let index=3;index<trace.runs.length;index++){const start=end;end+=trace.runs[index].decoded_text.length;collectorSegments.push({normalized_start:start,normalized_end:end,sources:[origin(index)],normalization:'EXACT_DECODED'});}
const envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments,tracerSourceSHA256:'a'.repeat(64),collectorSourceSHA256:'b'.repeat(64)});
assert.equal(envelope.input_eligibility,'COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE');
const view=createNativeDecorationView(envelope,{raw,normalizedText});
const unit={id:'DECLARED-SYNTHETIC-UNIT',contract_id:'DECLARED-SYNTHETIC-CONTRACT',parent_section_id:'synthetic-parent',cohort:'discovery-broad',kind:'synthetic',text:normalizedText,sha256:sha256(normalizedText),start:0,end:normalizedText.length,source_url:'https://example.com/declared-synthetic',source_navigation:{scope:'LITERAL_SOURCE_NAVIGATION_ONLY',governing_hierarchy_verified:false,nearest_anchor:null,within_unit:[]},native_source_evidence:{status:'BOUND_NATIVE_SOURCE_EVIDENCE_AVAILABLE_IN_CONTEXT'}};
const report={schema:'declared-synthetic-native-renderer-browser-qa-v1',performed_at:new Date().toISOString(),snapshot:process.cwd(),data_classification:'DECLARED_SYNTHETIC',api:'UI_FIXTURE_RESPONSES_ONLY_NOT_SERVER_INTEGRATION',actual_source_reading:false,actual_study_inference:false,fresh_opened:false,authority:'NONE',source_files:{},viewports:[],status:'RUNNING'};
const assets={};for(const [name,file,type]of [['/review.html','index.html','text/html'],['/review.mjs','review.mjs','text/javascript'],['/review.css','review.css','text/css']]){const bytes=await readFile(new URL('../review/'+file,import.meta.url));assets[name]={bytes,type};report.source_files[file]=sha256(bytes);}
const summary={run_id:'DECLARED_SYNTHETIC_RENDERER_ONLY',authority:'NONE',adopted_catalog:false,counts:{admitted_representatives:1,represented_contracts:1,primary_assignments:0,primary_clusters:0},gates:{representation:{status:'CURRENT_SOURCE_GATE_NOT_PASSED'}}};
const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');response.setHeader('Content-Security-Policy',localReviewCsp());response.setHeader('X-Robots-Tag','noindex, nofollow');response.setHeader('Cache-Control','no-store');
  if(assets[url.pathname]){const asset=assets[url.pathname];response.setHeader('Content-Type',asset.type);response.end(asset.bytes);return;}
  let value;if(url.pathname==='/api/summary')value=summary;
  else if(url.pathname==='/api/units')value={items:[unit],returned:1,next_cursor:null};
  else if(url.pathname==='/api/context')value={unit_id:unit.id,representation_gate:summary.gates.representation,context_status:'DECLARED SYNTHETIC FULL PARENT',excerpt:{start:0,end:normalizedText.length,parent_start:0,parent_end:normalizedText.length,text:normalizedText,complete_parent:true,next_start:null},native_source_decorations:(url.searchParams.get('native_styles')==='all'?view.project:view.projectRelevant)({start:0,end:normalizedText.length,includeEndZeroWidth:true}),parent_section_id:unit.parent_section_id,normalized_source_sha256:sha256(normalizedText),raw_source_sha256:sha256(raw),normalized_hash_bound_to_extraction:true};
  else {response.statusCode=404;value={error:'Only synthetic renderer routes are exposed'};}
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify(value));
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const require=createRequire('/opt/nonverba-tools/browser-tests/package.json'),{chromium}=require('/opt/nonverba-tools/browser-tests/node_modules/playwright');
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.NONVERBA_BROWSER_EXECUTABLE?{executablePath:process.env.NONVERBA_BROWSER_EXECUTABLE}:{})});
  for(const viewport of [{width:1366,height:900},{width:390,height:844}]){
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],external=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).hostname!=='127.0.0.1')external.push(request.url());});
    try{
      const response=await page.goto(`http://127.0.0.1:${server.address().port}/review.html`);assert.equal(response.status(),200);assert.match(response.headers()['content-security-policy'],/style-src-attr 'none'/u);
      await page.locator('.card').waitFor();await page.getByRole('button',{name:'Inspect parent & source context',exact:true}).click();await page.getByRole('heading',{name:'Native source markup',exact:true}).waitFor();
      assert.equal(await page.getByText('Joint whitespace: source attribution unverified',{exact:true}).isVisible(),true);
      const origins=page.locator('.native-evidence ol > li');assert.equal(await origins.count(),2);assert.match(await origins.nth(0).textContent(),/<strike>/u);assert.match(await origins.nth(1).textContent(),/<u>/u);assert.match(await origins.nth(0).textContent(),/U\+0020 × 1/u);assert.match(await origins.nth(1).textContent(),/U\+0020 × 2/u);
      assert.match(await page.locator('.native-evidence').textContent(),/No origin's marks are assigned/u);assert.match(await page.locator('.context').textContent(),/<img src=x/u);assert.equal(await page.locator('.context img').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.__sourceExecuted)),false);
      await page.getByRole('button',{name:'Show all source styles',exact:true}).click();await page.getByRole('button',{name:'Show relevant native marks',exact:true}).waitFor();assert.equal(await origins.count(),2);
      const widths=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,body:document.body.scrollWidth,document:document.documentElement.scrollWidth}));assert.ok(widths.body<=widths.viewport+1&&widths.document<=widths.viewport+1,JSON.stringify(widths));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
      const screenshot=base+`/native-${viewport.width}.png`;await page.locator('.native-evidence').screenshot({path:await studyPath(run,screenshot,{missing:true})});report.viewports.push({viewport,status:'PASSED',widths,screenshot,ordered_origin_count:2,literal_markup_not_executed:true});
    }finally{await context.close();}
  }
  report.status='PASSED_DECLARED_SYNTHETIC_RENDERER_ONLY';
}catch(error){report.status='FAILED';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});console.log(JSON.stringify({...await writeJSON(run,base+'/report.json',report),status:report.status,viewports:report.viewports.length,error:report.error?.message??null}));}
