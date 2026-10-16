// SPDX-License-Identifier: AGPL-3.0-only
// Checks only this authored synthetic challenge file. No corpus/model input is read.
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE=dirname(fileURLToPath(import.meta.url));
const SOURCE=resolve(HERE,'fixed-facts-prototype.json');
const QA='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000/qa';
const STATUS='PREPARATORY_UNBOUND_TO_FROZEN_CANDIDATES';
const KINDS=['counterparty_benefit','irrelevant_emphasis','near_confusion'];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const text=value=>typeof value==='string'&&value.trim().length>0;
function canonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&Object.getPrototypeOf(value)===Object.prototype)return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  throw new Error('Only finite literal JSON may enter a challenge binding');
}
const hash=value=>sha256(canonical(value));
function assert(condition,message){if(!condition)throw new Error(message);}
function exactKeys(value,keys,name){assert(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|'),`${name} has undeclared fields`);}
function textArray(value,name){assert(Array.isArray(value)&&value.length>0&&value.every(text),`${name} requires literal nonempty statements`);}

export function modelInputProjection(version){exactKeys(version,['id','fixed_case','declared_emphasis'],'paired version');return {fixed_case:structuredClone(version.fixed_case),declared_emphasis:structuredClone(version.declared_emphasis)};}

export function validate(packet){
  assert(packet.schema_version===2&&packet.status===STATUS&&packet.data_classification==='DECLARED_SYNTHETIC'&&packet.authority==='NONE'&&packet.adopted_catalog===false&&packet.candidate_binding_status==='NOT_BOUND','Packet must remain explicitly synthetic, preparatory, unbound and without authority');
  assert(packet.provenance?.author_kind==='AGENT'&&packet.provenance.fictional_people_and_records===true&&packet.provenance.actual_participant_findings===false&&packet.provenance.reasoning_model_evaluation==='NOT_RUN'&&packet.provenance.legal_or_normative_validation==='NOT_RUN'&&packet.provenance.author_expectations_are_observations===false,'Authorship limits cannot claim participant findings, model competence or legal/normative validation');
  assert(packet.protocol?.financial_target==='NONE'&&packet.protocol.candidate_count_prescribed===false,'A financial target or prescribed candidate count is not permitted');
  const inputPolicy=packet.protocol.model_input_policy;assert(inputPolicy?.status==='PREDECLARED_INPUT_BOUNDARY_MODEL_RUN_NOT_PERFORMED'&&canonical(inputPolicy.allowed_fields)===canonical(['versions[].fixed_case','versions[].declared_emphasis'])&&canonical(inputPolicy.withheld_until_generated_judgments_sealed)===canonical(['author_notes','challenge_kind','title','author_notes.possible_beneficiary_of_higher_emphasis'])&&text(inputPolicy.routing_ids)&&text(inputPolicy.projection),'Model input must contain fixed case and declaration only; withhold author predictions, classification and pair titles until judgments are sealed');
  assert(Array.isArray(packet.pairs)&&packet.pairs.length>=50,'At least 50 authored pairs required');
  const ids=new Set(),titles=new Set(),factIds=new Set(),evidenceIds=new Set(),actorIds=new Set();
  const coverage=Object.fromEntries(KINDS.map(kind=>[kind,0]));const roles={Requester:0,Operator:0};const bindings=[];let missing=0;
  for(const pair of packet.pairs){
    assert(/^NV-PREP-FF-\d{3}$/.test(pair.id)&&!ids.has(pair.id),'Pair IDs must be unique stable synthetic IDs');ids.add(pair.id);
    assert(text(pair.title)&&!titles.has(pair.title),'Each authored situation requires its own title');titles.add(pair.title);
    assert(pair.status===STATUS&&pair.candidate_id===null&&pair.later_binding?.candidate_id===null&&pair.later_binding.candidate_wording_sha256===null&&pair.later_binding.status==='AWAITING_FROZEN_CANDIDATE_REVIEW','Challenge cannot silently bind an adopted or unfrozen candidate');
    assert(KINDS.includes(pair.challenge_kind),'Unknown challenge kind');coverage[pair.challenge_kind]++;
    const fixed=pair.fixed_case;assert(fixed?.fictional===true&&fixed.case_id===`${pair.id}-CASE`,'Fixed case must declare its own fictional identity');
    exactKeys(fixed.actor_roles,['Requester','Operator'],'actor roles');for(const role of ['Requester','Operator']){assert(text(fixed.actor_roles[role].id)&&text(fixed.actor_roles[role].description)&&!actorIds.has(fixed.actor_roles[role].id),'Actor identities must be distinct fictional roles');actorIds.add(fixed.actor_roles[role].id);}
    assert(['Requester','Operator'].includes(fixed.declarer_role),'A fixed declaring role is required');roles[fixed.declarer_role]++;
    exactKeys(fixed.assignment_contract,['task','acceptance','scope','procedure'],'agreed assignment');for(const value of Object.values(fixed.assignment_contract))assert(text(value),'Concrete assignment terms required');
    assert(Array.isArray(fixed.established_facts)&&fixed.established_facts.length>=3,'Retain at least three detailed stipulated facts per situation');for(const fact of fixed.established_facts){assert(text(fact.id)&&!factIds.has(fact.id)&&text(fact.statement)&&fact.epistemic_status==='ESTABLISHED_ONLY_WITHIN_THIS_DECLARED_FICTION','Facts require unique IDs and explicit fictional epistemic status');factIds.add(fact.id);}
    assert(Array.isArray(fixed.evidence)&&fixed.evidence.length>=2,'Every fixed case needs its agreed record and its retained event record');for(const item of fixed.evidence){assert(text(item.id)&&!evidenceIds.has(item.id)&&text(item.kind)&&item.kind.startsWith('DECLARED_SYNTHETIC_'),'Evidence identities and fictional class required');evidenceIds.add(item.id);textArray(item.limitations,'evidence limits');if(item.supports)assert(item.supports.every(id=>fixed.established_facts.some(fact=>fact.id===id)),'Evidence cannot cite a fact outside its fixed case');}
    textArray(fixed.missing_facts,'missing facts');missing+=fixed.missing_facts.length;
    exactKeys(fixed.mandatory_rules,['scope','consent','protected_rights','evidence','applies_to'],'mandatory boundaries');for(const key of ['scope','consent','protected_rights','evidence'])textArray(fixed.mandatory_rules[key],`mandatory ${key}`);assert(canonical(fixed.mandatory_rules.applies_to)===canonical(['higher','lower']),'Mandatory rules must apply at both levels');
    assert(Array.isArray(pair.versions)&&pair.versions.length===2,'Exactly one higher and one lower declaration required');
    const expectedHash=hash(fixed),versions={};for(const version of pair.versions){exactKeys(version,['id','fixed_case','declared_emphasis'],'paired version');const input=modelInputProjection(version);exactKeys(input,['fixed_case','declared_emphasis'],'model-input projection');const emphasis=version.declared_emphasis;exactKeys(emphasis,['declarer_role','frame','level','statement'],'emphasis declaration');assert(['higher','lower'].includes(emphasis.level)&&!versions[emphasis.level]&&version.id===`${pair.id}-${emphasis.level}`,'Versions require unique higher/lower IDs');assert(hash(version.fixed_case)===expectedHash,'FIXED_CASE_CHANGED: contract, roles, facts, evidence, missing facts and all mandatory rules must be canonically identical');assert(emphasis.declarer_role===fixed.declarer_role&&text(emphasis.frame)&&text(emphasis.statement),'The declaring role and ordinary-language frame remain fixed');versions[emphasis.level]=version;}
    assert(versions.higher.declared_emphasis.frame===versions.lower.declared_emphasis.frame,'FRAME_CHANGED: only emphasis level may change');
    assert(versions.higher.declared_emphasis.statement.replace('higher emphasis','LEVEL emphasis')===versions.lower.declared_emphasis.statement.replace('lower emphasis','LEVEL emphasis'),'DECLARATION_CHANGED: the paired statement may vary the emphasis word only');
    const note=pair.author_notes;assert(note?.status==='AUTHOR_EXPECTATION_NOT_OBSERVED_MODEL_RESULT'&&text(note.expected_reasoning_change)&&text(note.boundary_test)&&note.scope_and_evidence_remain_fixed===true&&note.financial_outcome_target===null,'Expected changes remain authored hypotheses without outcome targets');
    if(pair.challenge_kind==='counterparty_benefit')assert(note.possible_beneficiary_of_higher_emphasis===(fixed.declarer_role==='Requester'?'Operator':'Requester'),'Counterparty-benefit challenge must explicitly identify the other role as a possible beneficiary');
    else assert(note.possible_beneficiary_of_higher_emphasis==='UNDETERMINED_NO_OUTCOME_TARGET','Other challenge types must not prescribe a beneficiary or resolution');
    bindings.push({id:pair.id,challenge_kind:pair.challenge_kind,fixed_case_sha256:expectedHash,higher_fixed_case_sha256:hash(versions.higher.fixed_case),lower_fixed_case_sha256:hash(versions.lower.fixed_case),higher_declaration_sha256:hash(versions.higher.declared_emphasis),lower_declaration_sha256:hash(versions.lower.declared_emphasis),author_expectation_sha256:hash(note)});
  }
  assert(KINDS.every(kind=>coverage[kind]>0),'All three challenge categories require actual authored situations');assert(roles.Requester>0&&roles.Operator>0,'Both declaring roles must appear');
  return {counts:{pairs:packet.pairs.length,versions:packet.pairs.length*2,fixed_cases:packet.pairs.length,stipulated_facts:factIds.size,evidence_items:evidenceIds.size,fictional_actors:actorIds.size,missing_fact_statements:missing},coverage:{challenge_kinds:coverage,declarer_roles:roles},bindings,canonical_bindings_sha256:hash(bindings)};
}

function rejectionChecks(packet){
  const mutations=[
    ['changed stipulated fact',copy=>{copy.pairs[0].versions[1].fixed_case.established_facts[0].statement+=' MUTATED';}],
    ['changed acceptance criterion',copy=>{copy.pairs[0].versions[1].fixed_case.assignment_contract.acceptance+=' MUTATED';}],
    ['removed missing fact',copy=>{copy.pairs[0].versions[1].fixed_case.missing_facts.pop();}],
    ['removed protected-right rule',copy=>{copy.pairs[0].versions[1].fixed_case.mandatory_rules.protected_rights.pop();}],
    ['changed evidence',copy=>{copy.pairs[0].versions[1].fixed_case.evidence[0].content.task+=' MUTATED';}],
    ['changed declaring frame',copy=>{copy.pairs[0].versions[1].declared_emphasis.frame+=' MUTATED';}],
    ['premature candidate binding',copy=>{copy.pairs[0].candidate_id='UNFROZEN_CANDIDATE';}],
    ['missing pair',copy=>{copy.pairs.pop();}],
    ['duplicate pair identity',copy=>{copy.pairs[49].id=copy.pairs[48].id;}],
    ['exposed author predictions',copy=>{copy.protocol.model_input_policy.withheld_until_generated_judgments_sealed.shift();}],
    ['answer-key model input',copy=>{copy.protocol.model_input_policy.allowed_fields.push('author_notes');}]
  ];
  return mutations.map(([name,mutate])=>{const copy=structuredClone(packet);mutate(copy);let message=null;try{validate(copy);}catch(error){message=error.message;}assert(message,`Negative structural check did not reject ${name}`);return {name,rejected:true,reason:message};});
}

async function unlinked(path,{missing=false}={}){let current='/';for(const component of resolve(path).split('/').filter(Boolean)){current=resolve(current,component);let entry;try{entry=await lstat(current);}catch(error){if(missing&&error.code==='ENOENT')return;throw error;}assert(!entry.isSymbolicLink(),`Linked path refused: ${current}`);}}

async function main(){
  assert(process.platform==='linux'&&process.env.NONVERBA_CONTAINER==='1','Run validation only inside the documented existing managed Debian container');
  const options={};for(const argument of process.argv.slice(2)){const match=/^--(input|receipt)=(.+)$/.exec(argument);assert(match&&!Object.hasOwn(options,match[1]),'Use unique --input= and --receipt= arguments');options[match[1]]=match[2];}
  const input=resolve(options.input??SOURCE);assert(input===SOURCE,'Validation reads only this adjacent authored challenge source');
  const destination=resolve(options.receipt??'');assert(dirname(destination)===QA&&/^fixed-facts-prototype-[A-Za-z0-9_.-]+\.json$/.test(destination.slice(QA.length+1)),'Use one new fixed-facts-prototype receipt below the exact main-run qa folder');
  await unlinked(input);const bytes=await readFile(input);assert(bytes.length<2*1024*1024,'Authored fixture exceeds the declared 2 MiB validation bound');const packet=JSON.parse(bytes);const checked=validate(packet),negative_checks=rejectionChecks(packet);const validatorPath=fileURLToPath(import.meta.url),validatorBytes=await readFile(validatorPath);
  const payload={schema_version:2,status:'PASSED_STRUCTURAL_FIXED_FACTS_PROTOTYPE',performed_at:new Date().toISOString(),authority:'NONE',adopted_catalog:false,data_classification:'DECLARED_SYNTHETIC',input:{path:input,bytes:bytes.length,sha256:sha256(bytes)},validator:{path:validatorPath,bytes:validatorBytes.length,sha256:sha256(validatorBytes)},runtime:{node:process.version,platform:process.platform,arch:process.arch,container_boundary:'NONVERBA_CONTAINER=1'},...checked,negative_checks,checks:{canonical_fixed_case_equal_in_both_versions:true,only_declared_level_changes:true,scope_consent_rights_evidence_missing_facts_fixed:true,unique_ids_and_source_references:true,model_input_contains_fixed_case_and_declaration_only:true,author_predictions_classification_and_titles_withheld_until_judgments_sealed:true,candidate_binding:false,financial_target:false},limits:{semantic_review:'NOT_RUN',reasoning_model_evaluation:'NOT_RUN',participant_findings:false,legal_or_normative_validation:'NOT_RUN',external_execution_attestation:false,authorship:'Agent-authored preparatory fiction; author predictions are not observed results.'}};
  const receipt={...payload,receipt_sha256:hash(payload)};await unlinked(QA,{missing:true});await mkdir(QA,{recursive:true});await unlinked(QA);await writeFile(destination,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  const logPath=destination.replace(/\.json$/,'.log');const log=`Actual structural validation passed for ${checked.counts.pairs} authored pairs and ${checked.counts.versions} versions.\nInput SHA256 ${payload.input.sha256}\nCanonical pair bindings SHA256 ${checked.canonical_bindings_sha256}\nNegative mutation checks ${negative_checks.length}/${negative_checks.length} rejected.\nNo participant/model/semantic/legal findings were produced.\nReceipt ${destination}\nReceipt body SHA256 ${receipt.receipt_sha256}\n`;await writeFile(logPath,log,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:receipt.status,counts:checked.counts,coverage:checked.coverage,input_sha256:payload.input.sha256,canonical_bindings_sha256:checked.canonical_bindings_sha256,negative_checks:negative_checks.length,receipt:destination,receipt_file_sha256:sha256(await readFile(destination)),log:logPath}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.stack??error.message);process.exitCode=1;});
