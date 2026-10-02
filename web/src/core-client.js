// SPDX-License-Identifier: AGPL-3.0-only
// Platform boundary only: all evidence and signal operations run in Rust/WASM.
export function createCoreClient() {
  const worker = new Worker(new URL('./core-worker.js', import.meta.url), {type: 'module'});
  const pending = new Map();
  let sequence = 0;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  worker.onmessage = ({data}) => {
    if (data.ready) return resolveReady();
    if (data.fatal) return fail(new Error(data.fatal));
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    data.error ? item.reject(new Error(data.error)) : item.resolve(data.value);
  };
  function fail(error) { rejectReady(error); for (const item of pending.values()) item.reject(error); pending.clear(); }
  worker.onerror = () => fail(new Error('The local Rust engine could not load.'));
  async function call(method, ...args) {
    await ready;
    return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, {resolve, reject}); worker.postMessage({id, method, args}); });
  }
  return {ready, call, json: async (...args) => JSON.parse(await call(...args))};
}
