// SPDX-License-Identifier: AGPL-3.0-only
// Service submission state only. Photos, local review, account roles and device
// proof do not establish this state or grant verified workflow eligibility.
// The account adapter supplies freshly validated authenticated context/results.
// Persist neither this state nor its receipt as authority across authentication;
// a fresh account-scoped status read must restore a prior saved submission.
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const counter = value => Number.isSafeInteger(value) && value >= 0;
const bindingFields = ['account_id','principal_id','recovery_generation','current_session_id'];
const receiptFields = ['submission_id','operation_id','status','identity_verification','level','created_at'];
const copyBinding = value => value && identifier(value.account_id) && identifier(value.principal_id)
  && counter(value.recovery_generation) && identifier(value.current_session_id)
  ? Object.freeze(Object.fromEntries(bindingFields.map(field => [field,value[field]]))) : null;

export function identityBinding(context) {
  if (context?.confirmed !== true || context.session_active !== true
    || context.identity_verification !== 'pending' || context.session?.session_id !== context.current_session_id) return null;
  return copyBinding(context);
}

export function sameIdentityBinding(first, second) {
  return !!copyBinding(first) && !!copyBinding(second) && bindingFields.every(field => first[field] === second[field]);
}

function receivedReceipt(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === receiptFields.length && receiptFields.every(field => Object.hasOwn(value,field))
    && identifier(value.submission_id) && identifier(value.operation_id) && value.status === 'received'
    && value.identity_verification === 'pending' && value.level === 1 && counter(value.created_at)
    ? Object.freeze(Object.fromEntries(receiptFields.map(field => [field,value[field]]))) : null;
}

export function createIdentityState() {
  return Object.freeze({status:'signed_out',binding:null,request:null,receipt:null,revision:0});
}

function change(state, status, {binding = state.binding, request = null, receipt = null} = {}) {
  const revision = state.revision + 1;
  if (!counter(revision)) throw new Error('Identity state revision exhausted.');
  return Object.freeze({status,binding,request,receipt,revision});
}

function currentRequest(state, request) {
  return !!state.request && request?.revision === state.request.revision
    && sameIdentityBinding(request.binding,state.binding) && sameIdentityBinding(request.binding,state.request.binding);
}

// account: bind the adapter's current authenticated context; a new owner,
// recovery generation or login session invalidates every previous observation.
// begin: capture state.request before awaiting the latest-status read.
// resolved: pass that token and null for validated not_submitted, or the exact
// authenticated pending receipt for received. Missing/malformed data is unknown.
// received: direct successful POST/original-operation GET, with its captured
// full binding; it supersedes older status reads. This is never an approval.
// failed: a current status read failed; clear the saved-status presentation.
// signed_out/unknown: discard all authority on logout or lost account context.
export function transitionIdentityState(state, event) {
  switch (event?.type) {
    case 'signed_out': return change(state,'signed_out',{binding:null});
    case 'unknown': return change(state,'unknown',{binding:null});
    case 'account': {
      const binding = identityBinding(event.context);
      if (!binding) return change(state,'unknown',{binding:null});
      return sameIdentityBinding(binding,state.binding) ? state : change(state,'checking',{binding});
    }
    case 'begin': {
      if (!state.binding) return state;
      const revision = state.revision + 1;
      const request = Object.freeze({revision,binding:state.binding});
      return change(state,'checking',{request});
    }
    case 'resolved': {
      if (!currentRequest(state,event.request)) return state;
      if (event.receipt === null) return change(state,'unverified');
      const receipt = receivedReceipt(event.receipt);
      return change(state,receipt ? 'awaiting_approval' : 'unknown',{receipt});
    }
    case 'failed': return currentRequest(state,event.request) ? change(state,'unknown') : state;
    case 'received': {
      if (!sameIdentityBinding(event.binding,state.binding)) return state;
      const receipt = receivedReceipt(event.receipt);
      return change(state,receipt ? 'awaiting_approval' : 'unknown',{receipt});
    }
    default: return state;
  }
}

export function identityPrerequisites(state) {
  const awaiting = state.status === 'awaiting_approval' && !!receivedReceipt(state.receipt) && !!state.binding;
  const status = awaiting ? 'awaiting_approval' : state.status === 'awaiting_approval' ? 'unknown' : state.status;
  const reasons = {
    signed_out:['Sign in and start Level 1 identity before creating a request.',
      'Sign in and start Level 2 identity before creating or accepting an operation.'],
    checking:['Checking Level 1 identity.','Checking Level 2 identity.'],
    unknown:['Level 1 identity status is unavailable. Check again.','Level 2 identity status is unavailable. Check again.'],
    unverified:['Start Level 1 identity before creating a request.','Start Level 1 identity before Level 2 identity.'],
    awaiting_approval:['Awaiting review of Level 1 identity before creating a request.','Awaiting review of Level 1 identity before Level 2 identity.']
  };
  const messages = reasons[status] || reasons.unknown;
  return Object.freeze({
    requests:Object.freeze({allowed:false,status,requiredLevel:1,pendingLevel:awaiting ? 1 : null,reason:messages[0]}),
    operations:Object.freeze({allowed:false,status:awaiting ? 'awaiting_prerequisite' : status,
      requiredLevel:2,pendingLevel:awaiting ? 1 : null,reason:messages[1]})
  });
}
