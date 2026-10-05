// SPDX-License-Identifier: AGPL-3.0-only
import {base64ToBytes} from './location-platform.js';
export const MAX_ATTEMPT_EXPORT = 4 * 1024 * 1024 + 32 * 1024;
export const ATTEMPT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FAULT_MODES = ['signing', 'initial-storage', 'final-storage'];

export function gpsAttemptValidationAvailable(native) {
  try {
    const value = JSON.parse(native?.debugAttemptValidationStatus?.());
    return value?.ok === true && value.available === true && value.simulated === true
      && (value.armed_mode === null || FAULT_MODES.includes(value.armed_mode));
  } catch { return false; }
}

export function readGpsAttemptExport(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_ATTEMPT_EXPORT) throw new Error('GPS attempt export exceeds its limit.');
  const v = JSON.parse(text);
  const fields = ['version','type','attempt_id','status','original_request_json','native_snapshot_json','report_base64','error'];
  if (!v || v.version !== 1 || v.type !== 'nonverba-gps-attempt-export' || !ATTEMPT_ID.test(v.attempt_id)
      || Object.keys(v).some(k => !fields.includes(k)) || fields.some(k => !Object.hasOwn(v,k))
      || !['signed','signed-storage-failed','unsigned-pending','unsigned-signing-failed','unsigned-storage-failed'].includes(v.status)
      || typeof v.original_request_json !== 'string' || new TextEncoder().encode(v.original_request_json).length > 65536
      || (v.error !== null && (typeof v.error !== 'string' || v.error.length > 400))) throw new Error('Invalid GPS attempt export.');
  if (v.status.startsWith('signed')) {
    if (v.native_snapshot_json !== null || typeof v.report_base64 !== 'string') throw new Error('Invalid signed GPS attempt export.');
    v.bytes = base64ToBytes(v.report_base64, 2 * 1024 * 1024 + 16 * 1024);
  } else if (v.report_base64 !== null || typeof v.native_snapshot_json !== 'string'
      || new TextEncoder().encode(v.native_snapshot_json).length > 2 * 1024 * 1024) throw new Error('Invalid unsigned GPS attempt export.');
  return v;
}

export function installGpsAttemptUi({document, native, engine, save}) {
  const $ = id => document.getElementById(id);
  if (!$('gps-attempt-panel')) return;
  const status = text => { $('gps-attempt-status').textContent = text; };
  let verificationRevision = 0;
  for (const id of ['gps-attempt-file','gps-attempt-original','gps-attempt-key']) {
    $(id).addEventListener(id === 'gps-attempt-key' ? 'input' : 'change', () => {
      verificationRevision++; $('gps-attempt-result').textContent = ''; status('GPS attempt verification inputs changed. Verify again.');
    });
  }
  const on = (id, fn) => $(id).addEventListener('click', async () => {
    $(id).disabled = true;
    try { await fn(); } catch (e) { status(String(e.message || e)); }
    finally { $(id).disabled = false; }
  });
  const faultPanel = $('gps-attempt-validation');
  if (faultPanel && gpsAttemptValidationAvailable(native)) {
    faultPanel.hidden = false;
    for (const mode of [...FAULT_MODES, 'clear']) {
      on(`gps-attempt-fault-${mode}`, async () => {
        const value = JSON.parse(native.armAttemptFault(mode));
        if (value.ok !== true || value.available !== true
            || value.armed_mode !== (mode === 'clear' ? null : mode)) throw new Error(value.error || 'Validation fault was not armed.');
        $('gps-attempt-fault-status').textContent = mode === 'clear'
          ? 'No validation fault armed.'
          : `SIMULATED ${mode} failure armed for the next native GPS session only. It affects reporting after a real covered failure; observations and successful-proof rules are unchanged.`;
      });
    }
  }
  on('gps-attempt-refresh', async () => {
    if (!native?.listAttempts) throw new Error('Retained native GPS attempts are available in the Android app.');
    const v = JSON.parse(native.listAttempts());
    if (!v.ok || !Array.isArray(v.attempt_ids) || v.attempt_ids.length > 33 || v.attempt_ids.some(id => !ATTEMPT_ID.test(id))) throw new Error(v.error || 'Attempt inventory unavailable.');
    const select = $('gps-attempt-id'); select.replaceChildren();
    for (const id of v.attempt_ids) { const option = document.createElement('option'); option.value = id; option.textContent = id; select.append(option); }
    status(`${v.attempt_ids.length} retained attempts. Unsigned pending records may reflect an interrupted process; signing and storage are not guaranteed.`);
  });
  on('gps-attempt-save', async () => {
    const id = $('gps-attempt-id').value;
    if (!ATTEMPT_ID.test(id) || !native?.readAttempt) throw new Error('Select a retained native attempt.');
    const text = native.readAttempt(id), v = readGpsAttemptExport(text);
    if (v.attempt_id !== id) throw new Error('Wrong retained attempt returned.');
    await save(`nonverba-gps-attempt-${id}.json`, 'application/json', text);
    await save(`nonverba-gps-attempt-request-${id}.json`, 'application/json', v.original_request_json);
    status(`Saved attempt and exact original request. Reporting state: ${v.status}. This is separate from a successful location proof.`);
  });
  on('gps-attempt-save-all', async () => {
    if (!native?.listAttempts || !native?.readAttempt) throw new Error('Native attempt retrieval is unavailable.');
    const ids = JSON.parse(native.listAttempts()).attempt_ids;
    if (!Array.isArray(ids) || ids.length > 33 || ids.some(id => !ATTEMPT_ID.test(id))) throw new Error('Attempt inventory unavailable.');
    let saved = 0;
    for (const id of ids) {
      const text = native.readAttempt(id), v = readGpsAttemptExport(text);
      if (v.attempt_id !== id) throw new Error('Wrong retained attempt returned.');
      await save(`nonverba-gps-attempt-${id}.json`, 'application/json', text);
      await save(`nonverba-gps-attempt-request-${id}.json`, 'application/json', v.original_request_json);
      saved++;
    }
    status(`Saved ${saved} retained attempts and their exact original requests. Reporting and measurement outcomes remain separate.`);
  });
  on('gps-attempt-verify', async () => {
    const revision = ++verificationRevision;
    const file = $('gps-attempt-file').files?.[0];
    if (!file || file.size > MAX_ATTEMPT_EXPORT) throw new Error('Choose a bounded GPS attempt export.');
    const v = readGpsAttemptExport(await file.text());
    if (!v.bytes) throw new Error(`No signed GPS report is present: ${v.status}. ${v.error || ''}`);
    const originalFile = $('gps-attempt-original').files?.[0];
    if (!originalFile || originalFile.size > 65536) throw new Error('Choose the exact independently retained original request.');
    const pin = $('gps-attempt-key').value.trim();
    if (!/^[a-f0-9]{64}$/.test(pin)) throw new Error('Supply the independently trusted location SPKI pin.');
    const result = await engine.json('verify_gps_attempt_report', v.bytes, await originalFile.text(), pin);
    if (revision !== verificationRevision) return;
    if (result.report_verified && result.report?.snapshot?.attempt_id !== v.attempt_id) throw new Error('Export attempt ID differs from signed report.');
    $('gps-attempt-result').textContent = JSON.stringify(result, null, 2);
    status(result.report_verified ? 'GPS failure report verified. Successful measurement acceptance remains unavailable; physical cause and operator effort/fault remain unproven.' : 'GPS attempt report verification failed.');
  });
}
