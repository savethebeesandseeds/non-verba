// SPDX-License-Identifier: AGPL-3.0-only
// A fixed local development account channel. No URL is selected by form input.
const fail = () => new Error('The local account service is unavailable. Try again when it is connected.');
const maximum = 64 * 1024;
const inventoryPath = '/v1/account/signin-devices';
const proofPath = inventoryPath + '/prove';
const responseLimit = request => request?.path === inventoryPath ? 256 * 1024 : maximum;

export function createAccountTransport() {
  const native = window.NonverbaAccount;
  const pending = new Map();
  if (native?.postMessage) native.onmessage = event => {
    if (typeof event.data !== 'string' || event.data.length > 256 * 1024 * 6 + 2048) return;
    let value;
    try { value = JSON.parse(event.data); } catch { return; }
    const item = pending.get(value?.id);
    if (!item) return;
    if (value.error) item.finish(fail()); else item.finish(null, value);
  };
  async function send(request, signal, config = false) {
    if (signal?.aborted) throw new DOMException('Account action cancelled.', 'AbortError');
    const id = crypto.randomUUID();
    const envelope = config ? {id,config:true} : {id,request};
    if (native?.postMessage) {
      if (pending.size >= 4) throw fail();
      return new Promise((resolve, reject) => {
        const abort = () => finish(new DOMException('Account action cancelled.', 'AbortError'));
        const timer = setTimeout(() => finish(fail()), 15000);
        function finish(error, value) {
          if (!pending.delete(id)) return;
          clearTimeout(timer); signal?.removeEventListener('abort', abort);
          if (error) reject(error); else resolve(value);
        }
        pending.set(id, {finish}); signal?.addEventListener('abort', abort, {once:true});
        try { native.postMessage(JSON.stringify(envelope)); } catch { finish(fail()); }
      });
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, 15000);
    signal?.addEventListener('abort', abort, {once:true});
    try {
      const response = await fetch(config ? '/account-api/config' : '/account-api/transport', {
        method:config ? 'GET' : 'POST', cache:'no-store', credentials:'omit', redirect:'error',
        headers:config ? {} : {'Content-Type':'application/json','X-Nonverba-Account':'1'},
        body:config ? undefined : JSON.stringify(envelope), signal:controller.signal
      });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) throw fail();
      const reader = response.body.getReader(); let total = 0; const parts = [];
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.byteLength;
        if (total > responseLimit(request) * 6 + 2048) { await reader.cancel(); throw fail(); }
        parts.push(result.value);
      }
      const bytes = new Uint8Array(total); let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      const value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
      if (!config && value?.id !== id) throw fail();
      return config ? {id,config:value} : value;
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Account action cancelled.', 'AbortError');
      throw fail();
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  window.addEventListener('pagehide', () => {
    for (const item of [...pending.values()]) item.finish(fail());
  });
  return Object.freeze({
    async available() {
      try { const value = await send(null, undefined, true); return value.config?.enabled === true && value.config?.development_only === true; }
      catch { return false; }
    },
    async request({signal, ...request}) {
      const limit = request.path === proofPath ? 192 * 1024 : 16384;
      if (request.body !== undefined && (typeof request.body !== 'string' || new TextEncoder().encode(request.body).length > limit)) throw fail();
      const value = await send(request, signal);
      if (typeof value?.id !== 'string' || !value.response || !Number.isInteger(value.response.status)
          || value.response.status < 100 || value.response.status > 599 || typeof value.response.body !== 'string'
          || new TextEncoder().encode(value.response.body).length > responseLimit(request)
          || !value.response.headers || typeof value.response.headers !== 'object') throw fail();
      return value.response;
    }
  });
}
