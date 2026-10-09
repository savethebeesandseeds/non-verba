// SPDX-License-Identifier: AGPL-3.0-only
// Platform boundary only: all evidence and signal operations run in Rust/WASM.
export function createCoreClient({Worker: WorkerClass = globalThis.Worker} = {}) {
  const worker = new WorkerClass(new URL('./core-worker.js', import.meta.url), {type: 'module'});
  const pending = new Map();
  let sequence = 0;
  let terminalError = null;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Pages may create the client before attaching their startup error display.
  ready.catch(() => {});
  worker.onmessage = ({data}) => {
    if (terminalError) return;
    if (data.ready) return resolveReady();
    if (data.fatal) return fail(new Error(data.fatal));
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    data.error ? item.reject(new Error(data.error)) : item.resolve(data.value);
  };
  function fail(error) {
    if (terminalError) return;
    terminalError = error;
    rejectReady(error);
    for (const item of pending.values()) item.reject(error);
    pending.clear();
    worker.terminate?.();
  }
  worker.onerror = () => fail(new Error('The local Rust engine could not load.'));
  worker.onmessageerror = () => fail(new Error('The local Rust engine returned an unreadable message.'));
  async function call(method, ...args) {
    if (terminalError) throw terminalError;
    await ready;
    if (terminalError) throw terminalError;
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, {resolve, reject});
      try { worker.postMessage({id, method, args}); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }
  return {ready, call, json: async (...args) => JSON.parse(await call(...args)),
    close: () => fail(new Error('The local Rust engine client is closed.'))};
}
