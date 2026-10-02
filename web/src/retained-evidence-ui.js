// SPDX-License-Identifier: AGPL-3.0-only
import {AgentRequester} from './agent-requester.js';

const sessionIdPattern = /^[a-f0-9]{64}$/;
const errorText = error => String(error?.message || error);
const text = value => JSON.stringify(value, null, 2);

/** Test workspace for retained requester evidence. Reports are display only;
 * AgentRequester reloads and verifies retained authority and bytes on every
 * inspection and acceptance. This panel never creates requests or receipts. */
export function installRetainedEvidenceUI({engine, root = document, host = window, Requester = AgentRequester}) {
  const $ = id => root.getElementById(id);
  let requester = null, loaded = null, pending = null, generation = 0, disposed = false;
  const listeners = [];
  const listen = (target, name, handler) => {
    target.addEventListener(name, handler);
    listeners.push(() => target.removeEventListener(name, handler));
  };
  const status = value => { $('retained-evidence-status').textContent = value; };
  const current = job => !disposed && pending === job && job.generation === generation
    && requester === job.owner && $('retained-evidence-id').value === job.id && !root.hidden;

  function render() {
    const visible = !disposed && !root.hidden;
    $('retained-evidence-load').disabled = !visible || !!pending || !sessionIdPattern.test($('retained-evidence-id').value);
    // A second explicit attempt exercises the atomic ledger even if an earlier
    // acceptance exists. Eligibility and current time are rechecked by accept.
    $('retained-evidence-accept').disabled = !visible || !!pending || loaded?.report?.verified !== true;
    $('retained-evidence-clear').disabled = disposed || (!requester && !loaded && !pending && !$('retained-evidence-id').value);
    $('retained-evidence-result').hidden = !loaded;
    $('retained-evidence-report').textContent = loaded ? text(loaded.report) : '';
    $('retained-evidence-verification').textContent = loaded
      ? loaded.report.verified === true ? 'Retained evidence and requester receipt verified.' : 'Evidence verification did not pass. Inspect the report below.' : '';
    $('retained-evidence-freshness').textContent = loaded
      ? `Fresh acceptance policy at the last check: ${loaded.report.fresh_action_eligible === true ? 'eligible' : 'not eligible'}. Every acceptance attempt verifies again against the current time.` : '';
    $('retained-evidence-acceptance').textContent = loaded
      ? loaded.acceptance ? 'Already accepted in this browser origin’s durable local ledger. This record is separate from signature validity and current freshness.'
        : 'No acceptance recorded in this browser origin’s local ledger at the last check.' : '';
    $('retained-evidence-acceptance-record').textContent = loaded?.acceptance ? text(loaded.acceptance) : '';
    $('retained-evidence-acceptance-details').hidden = !loaded?.acceptance;
  }

  function invalidate(message, clearInput = false) {
    generation++;
    const previous = requester;
    requester = null; loaded = null; pending = null;
    previous?.close();
    if (clearInput) $('retained-evidence-id').value = '';
    status(message); render();
  }

  function finish(job) {
    if (pending !== job) return;
    if (!current(job)) {
      invalidate('The lookup changed or this page was hidden. Load and reverify again.');
      return;
    }
    pending = null; render();
  }

  listen($('retained-evidence-load'), 'click', async () => {
    if ($('retained-evidence-load').disabled || pending || disposed || root.hidden) return;
    const id = $('retained-evidence-id').value;
    if (!sessionIdPattern.test(id)) return;
    invalidate('Loading retained bytes and reverifying the original request and receipt…');
    requester = new Requester(engine);
    const job = {id, owner: requester, generation};
    pending = job; render();
    try {
      const result = await job.owner.inspectRetained(id);
      if (!current(job)) return;
      loaded = {id, report: result.report, acceptance: result.acceptance};
      status('Retained verification finished. Loading creates no acceptance and does not renew the receipt or its deadline.');
    } catch (error) {
      if (current(job)) status(`Could not load retained evidence: ${errorText(error)}`);
    } finally { finish(job); }
  });

  listen($('retained-evidence-accept'), 'click', async () => {
    if ($('retained-evidence-accept').disabled || pending || disposed || root.hidden || !loaded || !requester) return;
    if ($('retained-evidence-id').value !== loaded.id) {
      invalidate('The session ID changed. Load and reverify again.');
      return;
    }
    const entry = loaded, job = {id: entry.id, owner: requester, generation};
    pending = job; status('Reverifying retained evidence before the atomic local acceptance…'); render();
    try {
      const acceptance = await job.owner.accept(job.id, () => current(job) && loaded === entry);
      if (!current(job) || loaded !== entry) return;
      loaded.acceptance = acceptance;
      status('Evidence reverified and accepted once in this browser origin’s durable local ledger. A repeated attempt must be rejected.');
    } catch (error) {
      if (current(job)) status(`Acceptance rejected: ${errorText(error)}`);
    } finally { finish(job); }
  });

  for (const name of ['input', 'change']) listen($('retained-evidence-id'), name, () => {
    invalidate('Enter a 64-character lowercase hexadecimal session ID, then load and reverify.');
  });
  listen($('retained-evidence-clear'), 'click', () => invalidate('Retained lookup cancelled and cleared.', true));
  listen(root, 'visibilitychange', () => {
    if (root.hidden) invalidate('Retained lookup cancelled because this page was hidden. Load and reverify again.');
    else render();
  });
  listen(host, 'pagehide', () => invalidate('Retained lookup cancelled because this page was left. Load and reverify again.'));
  listen(host, 'nonverba:pause', () => invalidate('Retained lookup cancelled because Android paused this screen. Load and reverify again.'));
  render();
  return {
    clear: () => invalidate('Retained lookup cancelled and cleared.', true),
    dispose() {
      disposed = true;
      for (const remove of listeners) remove();
      invalidate('Retained lookup closed.');
    }
  };
}
