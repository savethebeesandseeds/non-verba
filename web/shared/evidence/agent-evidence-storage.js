// SPDX-License-Identifier: AGPL-3.0-only
// Durable local replay protection for the shared requester path. Clearing this
// origin's storage clears this ledger; it is not a global acceptance service.
let opened;
function database() {
  return opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('nonverba-agent-evidence-v1', 1);
    request.onupgradeneeded = () => {
      for (const name of ['tasks', 'nonces', 'outcomes', 'accepted']) request.result.createObjectStore(name);
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}
const ID = /^[0-9a-f]{64}$/;
function identifier(value) { if (typeof value !== 'string' || !ID.test(value)) throw new Error('Invalid evidence session identifier.'); }
async function write(stores, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, 'readwrite');
    let result, failure;
    const fail = error => { failure = error; transaction.abort(); };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = transaction.onabort = () => reject(failure || transaction.error || new Error('Evidence ledger transaction failed.'));
    try { action(transaction, value => { result = value; }, fail); } catch (error) { fail(error); }
  });
}
export async function reserveEvidenceSession(record) {
  identifier(record.session_id); identifier(record.sensor_nonce);
  await write(['tasks', 'nonces'], transaction => {
    transaction.objectStore('tasks').add({...record, state: 'awaiting'}, record.session_id);
    transaction.objectStore('nonces').add(record.session_id, record.sensor_nonce);
  });
}
export async function abandonEvidenceSession(sessionId) {
  identifier(sessionId);
  await write(['tasks'], transaction => {
    const store = transaction.objectStore('tasks'), request = store.get(sessionId);
    request.onsuccess = () => { if (['awaiting', 'complete'].includes(request.result?.state)) store.put({...request.result, state: 'abandoned'}, sessionId); };
  });
}
export async function retainEvidenceOutcome(sessionId, originalRequest, outcome) {
  identifier(sessionId);
  await write(['tasks', 'outcomes'], (transaction, _, fail) => {
    const tasks = transaction.objectStore('tasks'), request = tasks.get(sessionId);
    request.onsuccess = () => {
      if (request.result?.state !== 'awaiting' || request.result.original_request !== originalRequest) {
        fail(new Error('This evidence reservation is unavailable or has already finished.')); return;
      }
      transaction.objectStore('outcomes').add(outcome, sessionId);
      tasks.put({...request.result, state: 'complete'}, sessionId);
    };
  });
}
export async function readEvidenceSession(sessionId) {
  identifier(sessionId);
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['tasks', 'outcomes', 'accepted']);
    const task = transaction.objectStore('tasks').get(sessionId), outcome = transaction.objectStore('outcomes').get(sessionId);
    const accepted = transaction.objectStore('accepted'), acceptance = accepted.get(`session:${sessionId}`);
    let challengeAcceptance;
    task.onsuccess = () => {
      if (typeof task.result?.sensor_nonce === 'string' && ID.test(task.result.sensor_nonce)) {
        challengeAcceptance = accepted.get(`challenge:${task.result.sensor_nonce}`);
      }
    };
    transaction.oncomplete = () => resolve({task: task.result, outcome: outcome.result,
      acceptance: acceptance.result, challengeAcceptance: challengeAcceptance?.result});
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Evidence records are unavailable.'));
  });
}
function sameBytes(left, right) {
  return left instanceof Uint8Array && right instanceof Uint8Array && left.length === right.length && left.every((value, index) => value === right[index]);
}
function sameSnapshot(left, right) {
  return JSON.stringify(left.task) === JSON.stringify(right.task)
    && left.outcome?.receipt === right.outcome?.receipt
    && left.outcome?.audio_transcript_json === right.outcome?.audio_transcript_json
    && sameBytes(left.outcome?.primary, right.outcome?.primary)
    && sameBytes(left.outcome?.secondary, right.outcome?.secondary);
}
export async function verifyRetainedEvidence(engine, sessionId, expectedRequesterPin) {
  const snapshot = await readEvidenceSession(sessionId), {task, outcome} = snapshot;
  if (task?.state !== 'complete' || !outcome || task.requester_pin !== expectedRequesterPin) throw new Error('No completed evidence for this independently known requester.');
  const verifiedAtSecs = Math.floor(Date.now() / 1000);
  const report = await engine.json('verify_evidence_session_receipt', outcome.receipt, task.original_request,
    outcome.primary, outcome.secondary, outcome.audio_transcript_json, expectedRequesterPin, task.context_json, verifiedAtSecs);
  if (report.request?.session_id !== sessionId || report.request?.sensor_nonce !== task.sensor_nonce) throw new Error('Retained evidence belongs to a different reservation.');
  return {snapshot, report, verifiedAtSecs};
}
export async function inspectRetainedEvidence(engine, sessionId, expectedRequesterPin) {
  const {snapshot, report} = await verifyRetainedEvidence(engine, sessionId, expectedRequesterPin);
  const {acceptance, challengeAcceptance} = snapshot;
  if (acceptance === undefined && challengeAcceptance === undefined) return {report, acceptance: null};
  // This is only a consistency check of our local ledger, never a signed
  // assertion of acceptance or an input to Rust's evidence/freshness verdict.
  const request = report.request, receipt = report.receipt;
  const sameBinding = (left, right) => left?.sha256 === right?.sha256 && left?.bytes === right?.bytes;
  if (!report.verified || !acceptance || JSON.stringify(acceptance) !== JSON.stringify(challengeAcceptance)
      || acceptance.version !== 1 || acceptance.session_id !== sessionId || acceptance.sensor_nonce !== request.sensor_nonce
      || acceptance.acceptance_recorded !== true || acceptance.local_replay_checked !== true || acceptance.global_replay_checked !== false
      || !Number.isSafeInteger(acceptance.accepted_at_ms) || acceptance.accepted_at_ms < receipt.sealed_at_ms
      || acceptance.accepted_at_ms >= request.expires_at_ms
      || acceptance.accepted_at_ms - receipt.timing.received_at_ms > request.spec.delivery.max_receipt_age_ms
      || !sameBinding(acceptance.request_binding, report.request_binding)
      || ['primary_binding', 'secondary_binding', 'audio_transcript_binding', 'context_binding'].some(key => !sameBinding(acceptance[key], receipt[key]))) {
    throw new Error('The local acceptance record does not match the retained verified evidence.');
  }
  return {report, acceptance};
}
class AcceptanceClockChanged extends Error {}
function currentAcceptance(stillCurrent) {
  if (typeof stillCurrent !== 'function' || stillCurrent() !== true) throw new Error('The evidence acceptance context changed.');
}
export async function acceptEvidenceSession(engine, sessionId, expectedRequesterPin, stillCurrent = () => true) {
  currentAcceptance(stillCurrent);
  // A saved verdict is never input to acceptance: recheck original authority,
  // signed receipt and raw artifacts immediately before the atomic commit.
  // Rust evaluates certificate, revocation and enrollment context at integer
  // seconds. Its verdict cannot cross that time boundary before committing.
  // Retry a bounded number of times instead of carrying an older trust verdict.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await acceptVerifiedEvidence(engine, sessionId, expectedRequesterPin, stillCurrent); }
    catch (error) {
      if (!(error instanceof AcceptanceClockChanged) || attempt === 2) throw error;
    }
  }
}
async function acceptVerifiedEvidence(engine, sessionId, expectedRequesterPin, stillCurrent) {
  currentAcceptance(stillCurrent);
  const {snapshot, report, verifiedAtSecs} = await verifyRetainedEvidence(engine, sessionId, expectedRequesterPin);
  currentAcceptance(stillCurrent);
  if (!report.verified || !report.fresh_action_eligible || report.demo) throw new Error('Evidence does not satisfy this fresh action policy.');
  return write(['tasks', 'outcomes', 'accepted'], (transaction, done, fail) => {
    const task = transaction.objectStore('tasks').get(sessionId), outcome = transaction.objectStore('outcomes').get(sessionId);
    let pending = 2;
    const ready = () => {
      if (--pending) return;
      try { currentAcceptance(stillCurrent); } catch (error) { fail(error); return; }
      const at = Date.now(), receipt = report.receipt, request = report.request;
      if (Math.floor(at / 1000) !== verifiedAtSecs) {
        fail(new AcceptanceClockChanged('The verification clock changed before acceptance; reverify the current trust context.')); return;
      }
      if (!sameSnapshot(snapshot, {task: task.result, outcome: outcome.result})
          || at < receipt.sealed_at_ms || at >= request.expires_at_ms
          || at - receipt.timing.received_at_ms > request.spec.delivery.max_receipt_age_ms) {
        fail(new Error('Evidence changed or expired while acceptance was being verified.')); return;
      }
      const accepted = {version: 1, session_id: sessionId, sensor_nonce: request.sensor_nonce, accepted_at_ms: at,
        request_binding: report.request_binding, primary_binding: receipt.primary_binding,
        secondary_binding: receipt.secondary_binding, audio_transcript_binding: receipt.audio_transcript_binding,
        context_binding: receipt.context_binding, acceptance_recorded: true, local_replay_checked: true, global_replay_checked: false};
      const store = transaction.objectStore('accepted');
      store.add(accepted, `session:${sessionId}`);
      store.add(accepted, `challenge:${request.sensor_nonce}`);
      done(accepted);
    };
    task.onsuccess = ready; outcome.onsuccess = ready;
  });
}
