// SPDX-License-Identifier: AGPL-3.0-only
// Private synthetic review only. Custody, genuine identity and workflow authority
// remain separate; no decision in this module grants work, keys or sensors.
import {IDENTITY_INTAKE_NOTICE} from './identity-intake-notice.js';
import {identityCaptureBytes,identityCaptureKey,canonicalIdentityCapturePayload} from './identity/identity-capture-proof.js';

const scope = 'synthetic-only', policy = 'identity-review-synthetic-v1';
const base = '/v1/identity/reviewer', subjectPath = '/v1/account/identity/review/status';
const bindingKeys = ['account_id','principal_id','recovery_generation','current_session_id'];
const receiptKeys = ['submission_id','operation_id','status','identity_verification','level','created_at'];
const decisionKeys = ['decision_id','submission_id','submission_sha256','receipt_sha256','revision','action','reason','created_at','scope','policy_id'];
const actions = Object.freeze(['approved','needs_correction','rejected']);
const outcomeLabel = status => ({pending:'Awaiting test review',approved:'Approved for test',rejected:'Rejected for test',needs_correction:'Correction requested'})[status] || 'Unavailable';
const kinds = ['document_front','face_front'];
const encode = value => new TextEncoder().encode(value);
const exact = (value,keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key=>Object.hasOwn(value,key));
const id = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const text = (value,limit) => typeof value === 'string' && value === value.trim() && value.length > 0
  && [...value].length <= limit && !/\p{Cc}/u.test(value) && new TextDecoder().decode(encode(value)) === value;
const frozen = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
};
const copy = value => structuredClone(value);
const invalid = (code = 'identity_review_response_invalid') => Object.assign(new Error('Identity review is unavailable.'),{code});
const require = (value,code) => { if (!value) throw invalid(code); };
const equalDecision = (first,second) => [...decisionKeys,'operation_id','reviewer_principal_id'].every(key=>first[key] === second[key]);
const digest = async (bytes,crypto) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(byte=>byte.toString(16).padStart(2,'0')).join('');
const binding = value => value && bindingKeys.every(key=>key === 'recovery_generation' ? count(value[key]) : id(value[key]))
  ? Object.fromEntries(bindingKeys.map(key=>[key,value[key]])) : null;
const sameOwner = (first,second) => !!first && !!second && bindingKeys.every(key=>first[key] === second[key]);
const boundTo = (value,target) => value.submission_id === target.submission_id
  && value.submission_sha256 === target.submission_sha256 && value.receipt_sha256 === target.receipt_sha256;
function receipt(value) {
  require(exact(value,receiptKeys) && id(value.submission_id) && id(value.operation_id)
    && value.status === 'received' && value.identity_verification === 'pending' && value.level === 1 && count(value.created_at));
}
function caseReference(value,owner) {
  require(id(value.submission_id) && id(value.account_id) && value.account_id !== owner.account_id
    && hash(value.submission_sha256) && hash(value.receipt_sha256));
  receipt(value.receipt); require(value.receipt.submission_id === value.submission_id);
}
export function validateReviewPermission(value,owner) {
  require(binding(owner) && exact(value,['scope','can_review',...bindingKeys]) && value.scope === scope
    && value.can_review === true && sameOwner(value,owner));
  return frozen(copy(value));
}
export function validateReviewDecision(value,{target,owner,operation,subject = false} = {}) {
  require(exact(value,subject ? decisionKeys : [...decisionKeys,'operation_id','reviewer_principal_id'])
    && id(value.decision_id) && id(value.submission_id) && hash(value.submission_sha256) && hash(value.receipt_sha256)
    && count(value.revision) && value.revision > 0 && actions.includes(value.action) && text(value.reason,500)
    && count(value.created_at) && value.scope === scope && value.policy_id === policy
    && (subject || id(value.operation_id) && id(value.reviewer_principal_id))
    && (!target || boundTo(value,target)) && (!owner || subject || value.reviewer_principal_id === owner.principal_id)
    && (!operation || value.operation_id === operation.operation_id && value.revision === operation.expected_revision+1
      && value.action === operation.action && value.reason === operation.reason));
  return frozen(copy(value));
}
function review(value,target,subject = false) {
  require(exact(value,['status','revision','decision']) && count(value.revision));
  if (value.status === 'pending') require(value.revision === 0 && value.decision === null);
  else {
    require(actions.includes(value.status) && value.revision > 0);
    validateReviewDecision(value.decision,{target,subject});
    require(value.decision.revision === value.revision && value.decision.action === value.status);
  }
}
export function validateReviewList(value,owner) {
  require(binding(owner) && exact(value,['scope','cases','has_more']) && value.scope === scope
    && Array.isArray(value.cases) && value.cases.length <= 20 && typeof value.has_more === 'boolean');
  const seen = new Set();
  for (const item of value.cases) {
    require(exact(item,['submission_id','account_id','receipt','submission_sha256','receipt_sha256','review']));
    caseReference(item,owner); review(item.review,item);
    require(item.review.status === 'pending' && !seen.has(item.submission_id)); seen.add(item.submission_id);
  }
  return frozen(copy(value));
}

// Historical capture records are checked below without applying the original
// challenge's live expiry window to already retained evidence.
async function captureRecord(value,kind,accountId,crypto) {
  if (value === null) return;
  require(exact(value,['proof','assessment']));
  const proof = value.proof, payload = proof?.payload, request = payload?.request;
  require(exact(proof,['payload','public_spki_der_b64','signature_b64']) && encode(JSON.stringify(proof)).length <= 16384
    && exact(payload,['request','image_sha256','image_bytes','width','height','captured_at_ms','lens_facing','acquisition'])
    && exact(request,['version','purpose','challenge_id','nonce','account_id','principal_id','current_session_id','recovery_generation',
      'kind','source','public_spki_sha256','issued_at_ms','capture_expires_at_ms','submit_expires_at_ms'])
    && request.version === 1 && request.purpose === 'identity-capture' && request.account_id === accountId
    && ['account_id','principal_id','current_session_id'].every(key=>id(request[key])) && count(request.recovery_generation)
    && request.kind === kind && ['browser-camera','native-camera2'].includes(request.source) && hash(request.public_spki_sha256)
    && /^[A-Za-z0-9_-]{43}$/.test(request.challenge_id) && /^[A-Za-z0-9_-]{43}$/.test(request.nonce)
    && ['issued_at_ms','capture_expires_at_ms','submit_expires_at_ms'].every(key=>count(request[key]))
    && request.capture_expires_at_ms > request.issued_at_ms && request.capture_expires_at_ms-request.issued_at_ms <= 120000
    && request.submit_expires_at_ms >= request.capture_expires_at_ms && request.submit_expires_at_ms-request.issued_at_ms <= 900000
    && hash(payload.image_sha256) && count(payload.image_bytes) && payload.image_bytes > 0 && payload.image_bytes <= 2097152
    && ['width','height'].every(key=>count(payload[key]) && payload[key] > 0 && payload[key] <= (kind === 'face_front' ? 1280 : 2400))
    && count(payload.captured_at_ms) && payload.captured_at_ms >= request.issued_at_ms && payload.captured_at_ms < request.capture_expires_at_ms
    && ['front','back','external','unknown'].includes(payload.lens_facing));
  const assessment = value.assessment;
  require(exact(assessment,['signature_valid','exact_image_bound','original_request_bound','source','hardware_attested',
    'native_origin_attested','browser_origin_attested','capture_time_trusted','identity_verified'])
    && ['signature_valid','exact_image_bound','original_request_bound'].every(key=>assessment[key] === true)
    && ['hardware_attested','native_origin_attested','browser_origin_attested','capture_time_trusted','identity_verified'].every(key=>assessment[key] === false)
    && assessment.source === request.source);
  for (const name of ['challenge_id','nonce']) identityCaptureBytes(request[name].replaceAll('-','+').replaceAll('_','/')+'=',32,32);
  if (request.source === 'browser-camera') require(payload.acquisition === null);
  else {
    const acquisition = payload.acquisition, times = ['request_elapsed_realtime_ns','image_received_elapsed_realtime_ns',
      'result_received_elapsed_realtime_ns','sensor_timestamp_ns','image_timestamp_ns'];
    const nanoseconds = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
    require(exact(acquisition,['version','timestamp_source',...times,'zsl_requested_disabled','test_pattern_requested_disabled',
      'zsl_result_enabled','test_pattern_result_mode']) && acquisition.version === 1
      && ['realtime','unknown'].includes(acquisition.timestamp_source) && times.every(key=>nanoseconds(acquisition[key]))
      && acquisition.zsl_requested_disabled === true && acquisition.test_pattern_requested_disabled === true
      && [null,false].includes(acquisition.zsl_result_enabled) && [null,0].includes(acquisition.test_pattern_result_mode)
      && acquisition.sensor_timestamp_ns === acquisition.image_timestamp_ns && payload.lens_facing === (kind === 'document_front' ? 'back' : 'front'));
    const [requested,image,result,sensor] = times.map(key=>BigInt(acquisition[key]));
    require(image >= requested && result >= requested && image-requested <= 15000000000n && result-requested <= 15000000000n
      && (acquisition.timestamp_source !== 'realtime' || sensor >= requested && sensor <= image && sensor <= result));
  }
  const key = await identityCaptureKey(proof.public_spki_der_b64,crypto);
  require(key.hash === request.public_spki_sha256 && await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key.key,
    identityCaptureBytes(proof.signature_b64,64,64),canonicalIdentityCapturePayload(payload)));
}
export async function validateReviewCase(value,owner,submissionId,crypto = globalThis.crypto) {
  require(binding(owner) && exact(value,['scope','submission_id','account_id','receipt','submission_sha256','receipt_sha256',
    'details','notice','capture','is_current','review','history','history_has_more']) && value.scope === scope
    && value.submission_id === submissionId && typeof value.is_current === 'boolean');
  caseReference(value,owner); review(value.review,value);
  require(exact(value.details,['document_type','full_name','birth_city','nationality','age'])
    && ['passport','national_id','driving_licence','residence_permit'].includes(value.details.document_type)
    && text(value.details.full_name,200) && text(value.details.birth_city,120) && text(value.details.nationality,120)
    && Number.isInteger(value.details.age) && value.details.age >= 1 && value.details.age <= 130
    && exact(value.notice,['notice_id','version','sha256','text'])
    && Object.keys(value.notice).every(key=>value.notice[key] === IDENTITY_INTAKE_NOTICE[key])
    && await digest(encode(value.notice.text),crypto) === value.notice.sha256
    && exact(value.capture,kinds) && Array.isArray(value.history) && value.history.length <= 20
    && typeof value.history_has_more === 'boolean');
  const decisions = new Set(); let revision = value.review.revision;
  for (const decision of value.history) {
    validateReviewDecision(decision,{target:value});
    require(decision.revision === revision-- && !decisions.has(decision.decision_id)); decisions.add(decision.decision_id);
  }
  require(value.history_has_more === (revision > 0) && (value.review.revision === 0
    ? value.history.length === 0 : value.history.length > 0 && equalDecision(value.review.decision,value.history[0])));
  require(kinds.every(kind=>value.capture[kind] === null || value.capture[kind]?.proof?.payload?.request?.principal_id !== owner.principal_id));
  await Promise.all(kinds.map(kind=>captureRecord(value.capture[kind],kind,value.account_id,crypto)));
  return frozen(copy(value));
}
export function validateSubjectReview(value,owner) {
  require(binding(owner) && exact(value,[...bindingKeys,'scope','level_1']) && sameOwner(value,owner) && value.scope === scope);
  const level = value.level_1;
  require(exact(level,['status','receipt','submission_sha256','receipt_sha256','review_revision','decision']) && count(level.review_revision));
  if (level.status === 'not_submitted') require(level.receipt === null && level.submission_sha256 === null
    && level.receipt_sha256 === null && level.review_revision === 0 && level.decision === null);
  else {
    receipt(level.receipt); require(hash(level.submission_sha256) && hash(level.receipt_sha256));
    if (['not_eligible','pending'].includes(level.status)) require(level.review_revision === 0 && level.decision === null);
    else review({status:level.status,revision:level.review_revision,decision:level.decision},
      {submission_id:level.receipt.submission_id,...level},true);
  }
  return frozen(copy(value));
}
export async function validateReviewPhoto(value,{submission_id,kind,capture} = {},crypto = globalThis.crypto) {
  require(exact(value,['scope','submission_id','kind','media_type','sha256','size_bytes','base64']) && value.scope === scope
    && value.submission_id === submission_id && kinds.includes(kind) && value.kind === kind && value.media_type === 'image/jpeg'
    && hash(value.sha256) && count(value.size_bytes) && value.size_bytes > 3 && value.size_bytes <= 2097152);
  const bytes = identityCaptureBytes(value.base64,2097152,value.size_bytes);
  require(bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217
    && await digest(bytes,crypto) === value.sha256 && (!capture || capture.proof.payload.image_sha256 === value.sha256
      && capture.proof.payload.image_bytes === bytes.length));
  return bytes;
}

// gateway owns authentication and exact endpoint admission. It accepts a JSON
// object body and returns {status,body,headers}; expected is the complete actor
// binding. Neither this client nor its snapshots receive bearer credentials.
export function createIdentityReviewClient({gateway,onChange = () => {},crypto = globalThis.crypto,urls = URL} = {}) {
  require(typeof gateway?.request === 'function' && typeof gateway.owner === 'function' && typeof onChange === 'function');
  let owner = null, epoch = 0, reviewEpoch = 0, view = 0, permissionRevision = 0, subjectRevision = 0, permission = 'unknown', phase = 'unavailable', busy = false;
  let entries = [], detail = null, subject = null, lastDecision = null, original = null, message = '';
  const controllers = new Set(), subjectControllers = new Set(), photos = new Map();
  const dropPhotos = () => { for (const url of photos.values()) urls.revokeObjectURL(url); photos.clear(); };
  const stop = ({reviewOnly = false} = {}) => {
    reviewEpoch++; permissionRevision++;
    if (!reviewOnly) { epoch++; subjectRevision++; }
    for (const controller of controllers) if (!reviewOnly || !subjectControllers.has(controller)) {
      controller.abort(); controllers.delete(controller); subjectControllers.delete(controller);
    }
    dropPhotos();
  };
  function reconcile() {
    let current; try { current = binding(gateway.owner()); } catch { current = null; }
    if ((current === null) !== (owner === null) || current && !sameOwner(current,owner)) {
      stop(); owner = current; permission = 'unknown'; phase = 'unavailable'; busy = false;
      entries = []; detail = subject = lastDecision = original = null; message = '';
    }
    return owner;
  }
  const selected = () => detail ? {key:detail.submission_id,title:'Test Level 1',facts:[
    {label:'Submission',value:detail.submission_id},{label:'Test review',value:outcomeLabel(detail.review.status)},
    {label:'Review revision',value:String(detail.review.revision)},{label:'Submission SHA-256',value:detail.submission_sha256},
    {label:'Receipt SHA-256',value:detail.receipt_sha256},{label:'Receipt operation',value:detail.receipt.operation_id},
    ...Object.entries(detail.details).map(([label,value])=>({label:({document_type:'Document type',full_name:'Full name',birth_city:'City of birth',nationality:'Nationality',age:'Age'})[label],value:String(value)}))],
    photos:kinds.filter(kind=>photos.has(kind)).map(kind=>({label:kind === 'document_front' ? 'Document front' : 'Face photo',url:photos.get(kind)})),
    notice:{label:`Identity review notice · Version ${detail.notice.version}`,text:detail.notice.text},history:detail.history,
    historyHasMore:detail.history_has_more,capture:kinds.map(kind=>({kind,source:detail.capture[kind]?.assessment.source ?? null}))}
    : original ? {key:original.caseId,title:'Test Level 1',facts:[],photos:[],notice:null}
    : lastDecision ? {key:lastDecision.submission_id,title:'Recorded test decision',photos:[],notice:null,
      facts:[{label:'Submission',value:lastDecision.submission_id},{label:'Recorded test outcome',value:outcomeLabel(lastDecision.action)},
        {label:'Reason',value:lastDecision.reason},{label:'Recorded revision',value:String(lastDecision.revision)}]} : null;
  const snapshot = () => { reconcile(); return copy({permission,phase,busy,view:detail || original || lastDecision ? 'case' : 'list',
    canDecide:permission === 'granted' && phase === 'ready' && !busy && !!detail?.is_current
      && detail.review.revision < Number.MAX_SAFE_INTEGER && !original,
    actions,entries,selected:selected(),subject,lastDecision,pendingOperation:!!original,message}); };
  const notify = () => { const value = snapshot(); onChange(value); return value; };
  const token = (selectedView = false,subjectLane = false) => {
    require(reconcile(),'account_required'); const controller = new AbortController(); controllers.add(controller);
    if (subjectLane) subjectControllers.add(controller);
    return {epoch,reviewEpoch:subjectLane ? null : reviewEpoch,owner:copy(owner),view:selectedView ? view : null,controller};
  };
  function ensure(value) {
    reconcile(); require(value.epoch === epoch && sameOwner(value.owner,owner)
      && (value.reviewEpoch === null || value.reviewEpoch === reviewEpoch)
      && (value.view === null || value.view === view) && !value.controller.signal.aborted,'stale_operation');
  }
  async function request(value,method,path,body,maximum = 65536) {
    ensure(value);
    const response = await gateway.request({method,path,...(body === undefined ? {} : {body}),signal:value.controller.signal,expected:copy(value.owner)});
    ensure(value); require(response && Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
      && typeof response.body === 'string' && encode(response.body).length <= maximum
      && /^application\/json(?:\s*;|$)/i.test(response.headers?.['content-type'] || response.headers?.['Content-Type'] || ''));
    if (response.status !== 200) {
      let error; try { error = JSON.parse(response.body).error; } catch { /* Never expose arbitrary service text. */ }
      throw Object.assign(invalid(),{status:response.status,serviceCode:error});
    }
    try { return JSON.parse(response.body); } catch { throw invalid(); }
  }
  function failure(error,value,writing = false) {
    try { ensure(value); } catch { return snapshot(); }
    busy = false;
    if (error.status === 401 || error.code === 'invalid_authorization') {
      stop(); permission = 'unknown'; phase = 'unavailable';
      entries = []; detail = subject = original = lastDecision = null;
    } else if (error.status === 403) {
      stop({reviewOnly:true}); permission = 'denied'; phase = 'denied'; entries = []; detail = original = lastDecision = null;
    } else if (error.status === 409 || error.status === 400 && error.serviceCode === 'invalid_identity_review_decision') {
      dropPhotos(); detail = null; original = null; phase = 'conflict';
    } else if (writing || original) { dropPhotos(); detail = null; phase = 'unknown'; }
    else { dropPhotos(); detail = null; phase = 'unavailable'; }
    return notify();
  }
  async function probe() {
    if (!reconcile()) return snapshot();
    const value = token(), revision = ++permissionRevision;
    permission = 'checking'; message = ''; notify();
    try {
      validateReviewPermission(await request(value,'GET',base+'/context'),value.owner); ensure(value);
      if (revision !== permissionRevision) return snapshot();
      permission = 'granted'; if (!original && !detail && !lastDecision) phase = 'ready'; return notify();
    } catch (error) { if (revision !== permissionRevision) return snapshot(); permission = 'unknown'; return failure(error,value); }
    finally { controllers.delete(value.controller); }
  }
  async function loadCases() {
    if (!reconcile() || original) return snapshot();
    message = '';
    dropPhotos(); detail = lastDecision = null; entries = []; const startedView = ++view; phase = 'loading'; busy = true;
    await probe(); if (view !== startedView) return snapshot();
    if (permission !== 'granted') { busy = false; return notify(); }
    const value = token(true); phase = 'loading'; busy = true; notify();
    try {
      const list = validateReviewList(await request(value,'GET',base+'/cases'),value.owner); ensure(value);
      entries = list.cases.map(item=>({key:item.submission_id,label:'Test Level 1',detail:item.submission_id}));
      phase = entries.length ? 'ready' : 'empty'; busy = false; return notify();
    } catch (error) { return failure(error,value); } finally { controllers.delete(value.controller); }
  }
  async function selectCase(caseId) {
    if (!reconcile() || original) return snapshot();
    if (!id(caseId)) { dropPhotos(); detail = null; busy = false; phase = 'unavailable'; return notify(); }
    message = '';
    const startedView = ++view; dropPhotos(); detail = lastDecision = null; busy = true; phase = 'loading'; notify();
    if (permission !== 'granted') await probe(); if (view !== startedView) return snapshot();
    if (permission !== 'granted') { busy = false; return notify(); }
    const value = token(true), path = base+'/cases/'+caseId;
    try {
      const selectedCase = await validateReviewCase(await request(value,'GET',path,undefined,262144),value.owner,caseId,crypto); ensure(value);
      const images = await Promise.all(kinds.map(async kind=>validateReviewPhoto(await request(value,'GET',path+'/photos/'+kind,undefined,3145728),
        {submission_id:caseId,kind,capture:selectedCase.capture[kind]},crypto)));
      ensure(value); detail = selectedCase;
      images.forEach((bytes,index)=>photos.set(kinds[index],urls.createObjectURL(new Blob([bytes],{type:'image/jpeg'}))));
      busy = false; phase = 'ready'; return notify();
    } catch (error) { return failure(error,value); } finally { controllers.delete(value.controller); }
  }
  async function decide({action,reason,deliberate} = {}) {
    if (!reconcile()) return snapshot();
    if (!snapshot().canDecide || deliberate !== true || !actions.includes(action) || typeof reason !== 'string' || !text(reason.trim(),500)) {
      message = 'Choose a test action and enter a reason of 1–500 characters.'; return notify();
    }
    let body;
    try {
      body = frozen({operation_id:'review:'+crypto.randomUUID(),submission_sha256:detail.submission_sha256,
        receipt_sha256:detail.receipt_sha256,expected_revision:detail.review.revision,action,reason:reason.trim()});
      require(id(body.operation_id) && encode(JSON.stringify(body)).length <= 8192);
    } catch { phase = 'unavailable'; return notify(); }
    message = '';
    const value = token(true); original = frozen({owner:copy(owner),caseId:detail.submission_id,body}); busy = true; phase = 'loading'; notify();
    try {
      const decision = validateReviewDecision(await request(value,'POST',base+'/cases/'+original.caseId+'/decisions',body),
        {target:detail,owner:value.owner,operation:body}); ensure(value);
      dropPhotos(); detail = null; lastDecision = decision; original = null; busy = false; phase = 'saved'; return notify();
    } catch (error) { return failure(error,value,true); } finally { controllers.delete(value.controller); }
  }
  async function checkOriginal() {
    if (!reconcile() || busy || !original || !sameOwner(original.owner,owner)) return snapshot();
    message = '';
    const operation = original, value = token(true); busy = true; phase = 'unknown'; notify();
    try {
      const decision = validateReviewDecision(await request(value,'GET',base+'/cases/'+operation.caseId+'/operations/'+operation.body.operation_id),
        {target:{submission_id:operation.caseId,...operation.body},owner:value.owner,operation:operation.body}); ensure(value);
      // An immutable replay is historical; do not install it as current review.
      dropPhotos(); detail = null; lastDecision = decision; original = null; busy = false; phase = 'saved'; return notify();
    } catch (error) { return failure(error,value,true); } finally { controllers.delete(value.controller); }
  }
  async function subjectStatus() {
    if (!reconcile()) return snapshot();
    const value = token(false,true), revision = ++subjectRevision;
    // A fresh receipt/read cannot borrow an older package's test outcome while
    // its current authoritative summary is still being fetched.
    subject = null; notify();
    try {
      const result = validateSubjectReview(await request(value,'GET',subjectPath),value.owner); ensure(value);
      if (revision !== subjectRevision) return snapshot(); subject = result; return notify();
    } catch (error) {
      try { ensure(value); } catch { return snapshot(); }
      if (revision !== subjectRevision) return snapshot(); subject = null;
      return error.status === 401 || error.code === 'invalid_authorization' ? failure(error,value) : notify();
    }
    finally { controllers.delete(value.controller); subjectControllers.delete(value.controller); }
  }
  function clear({preserveOperation = true} = {}) {
    reconcile(); stop(); view++; entries = []; detail = subject = lastDecision = null; busy = false; message = '';
    if (!preserveOperation) { original = null; permission = 'unknown'; }
    phase = original ? 'unknown' : 'unavailable'; return snapshot();
  }
  return Object.freeze({snapshot,permission:probe,loadCases,selectCase,decide,checkOriginal,subjectStatus,clear});
}
