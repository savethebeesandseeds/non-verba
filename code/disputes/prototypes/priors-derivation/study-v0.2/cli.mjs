// SPDX-License-Identifier: AGPL-3.0-only
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {args,readJSON,requireContainer} from '../lib/common.mjs';
import {initStudy,acquireStudy,verifyStudy} from './lib/acquisition.mjs';
import {validateStudyRoot,studyPath} from './lib/store.mjs';
import {extractStudy} from './lib/workflow.mjs';
import {embedStudy,discoverStudy,verifyGeometry,readEmbeddingBatches} from './lib/analysis.mjs';
const root=dirname(fileURLToPath(import.meta.url));
async function main(argv) {
  if(!argv.length||argv[0]==='--help'){console.log('Priors Derivation Lab v0.2 — PROTOTYPE / RESEARCH ONLY\nCommands: init, acquire, extract, audit, prepare, embed, discover, verify, serve, comparison-model, sensitivity, seal-quality, verify-calibration, novelty-plan\nUse --run-dir=/opt/nonverba-build/priors-derivation/study-v0.2/NAME; acquisition/extraction default to the 1000-record calibration. Pass explicit relative stage manifests for dependent commands.');return;}
  requireContainer();const [command,...rest]=argv;const options=args(rest);
  const allowed={init:['run-dir','recipe'],acquire:['run-dir','limit'],extract:['run-dir','limit','calibration'],audit:['run-dir','manifest','protocol'],prepare:['run-dir','manifest'],embed:['run-dir','manifest'],discover:['run-dir','manifest'],verify:['run-dir','embeddings','geometry'],serve:['run-dir','admission','geometry'],'comparison-model':['run-dir'],sensitivity:['run-dir','manifest'],'seal-quality':['run-dir','extraction','packet','review','development-review','integrity-review'],'verify-calibration':['run-dir'],'novelty-plan':['run-dir']}[command];
  if(!allowed||Object.keys(options).some(key=>!allowed.includes(key)))throw new Error('Unknown command or unsupported option');
  if(!options['run-dir'])throw new Error('Explicit managed run directory required');const runDir=validateStudyRoot(options['run-dir']);
  const positive=(value,fallback,max)=>{const n=Number(value??fallback);if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error('Count outside registered limits');return n;};
  const manifest=async key=>{if(!options[key]||options[key].startsWith('/')||options[key].includes('..'))throw new Error(`Explicit relative ${key} manifest required`);return {...await readJSON(await studyPath(runDir,options[key])),manifest_path:options[key]};};
  let result;
  if(command==='init'){const recipe=await readJSON(options.recipe?resolve(options.recipe):resolve(root,'recipe.json'));result=await initStudy(runDir,recipe,{sourceRun:recipe.sourceRun});if(result.status==='READY'){const {freezeMainUnitBudget}=await import('./lib/budget.mjs');await freezeMainUnitBudget(runDir);}}
  if(command==='acquire')result=await acquireStudy(runDir,{limit:positive(options.limit,1000,10000),cohorts:['discovery-broad','discovery-relevant']});
  if(command==='extract'){if(options.calibration&&!['true','false'].includes(options.calibration))throw new Error('Calibration must be true or false');result=await extractStudy(runDir,{limit:positive(options.limit,1000,10000),calibrationOnly:options.calibration!=='false'});result={status:result.status,contracts:result.contracts,accepted:result.accepted,rejected:result.rejected,sections:result.sections,selected_units:result.selected_units,manifest_path:result.manifest_path};}
  if(command==='audit'){const {buildAuditPackets}=await import('./lib/audit.mjs');result=await buildAuditPackets(runDir,await manifest('manifest'),{protocolPath:options.protocol});}
  if(command==='prepare'){const {prepareDiscovery}=await import('./lib/admission.mjs');result=await prepareDiscovery(runDir,await manifest('manifest'));}
  if(command==='comparison-model'){const {provisionComparisonModel}=await import('./lib/comparisons.mjs');const stage=await provisionComparisonModel(runDir);result={status:stage.status,downloaded_bytes:stage.downloaded_bytes,manifest_path:stage.manifest_path};}
  if(command==='verify-calibration'){const {verifyCalibrationGate}=await import('./lib/quality.mjs');result=await verifyCalibrationGate(runDir);}
  if(command==='novelty-plan'){const {freezeNoveltyPlan}=await import('./lib/novelty.mjs');const plan=await freezeNoveltyPlan(runDir);result={status:plan.status,manifest_path:plan.manifest_path,protocol_sha256:plan.protocol_sha256,source_content_read:plan.source_content_read,batches:plan.batches.map(batch=>({checkpoint:batch.checkpoint,target:batch.target,pool:batch.pool.length}))};}
  if(command==='sensitivity'){const {runSensitivity}=await import('./lib/sensitivity.mjs');const stage=await runSensitivity(runDir,await manifest('manifest'));result={status:stage.status,manifest_path:stage.manifest_path,counts:stage.counts??null};}
  if(command==='seal-quality'){const {sealQualityGate}=await import('./lib/quality.mjs');for(const key of ['extraction','packet','review','development-review'])await manifest(key);result=await sealQualityGate(runDir,{extractionPath:options.extraction,packetPath:options.packet,reviewPath:options.review,developmentReviewPath:options['development-review'],integrityReviewPath:options['integrity-review']});}
  if(command==='embed'){const stage=await embedStudy(runDir,await manifest('manifest'));result={status:stage.status,rows:stage.rows,dimensions:stage.dimensions,elapsed_seconds:stage.elapsed_seconds,manifest_path:stage.manifest_path};}
  if(command==='discover'){const stage=await discoverStudy(runDir,await manifest('manifest'));result={status:stage.status,rows:stage.rows,runs:stage.runs.length,manifest_path:stage.manifest_path};}
  if(command==='verify'){const verified=await verifyStudy(runDir);result={status:'VERIFIED',selected:verified.study.selected};if(options.embeddings){const stage=await manifest('embeddings');for await(const ignored of readEmbeddingBatches(runDir,stage)){}result.embeddings={rows:stage.rows,status:'VERIFIED'};}if(options.geometry)result.geometry=await verifyGeometry(runDir,await manifest('geometry'));}
  if(command==='serve'){const {serveStudy}=await import('./lib/review.mjs');await serveStudy(runDir,{admission:await manifest('admission'),geometry:await manifest('geometry'),host:'0.0.0.0',port:4173});return;}
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{console.error(error.stack);process.exitCode=1;});
