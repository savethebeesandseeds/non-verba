// SPDX-License-Identifier: AGPL-3.0-only
const filename = 'non-verba-recovery-codes.txt';
export function recoveryCodesText(codes) {
  if (!Array.isArray(codes) || codes.length !== 8 || new Set(codes).size !== 8
      || !codes.every(code => typeof code === 'string' && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(code))) {
    throw new Error('Recovery codes are unavailable in this page.');
  }
  const rows = Array.from({length:4},(_,row) => `${codes[row*2]}  ${codes[row*2+1]}`);
  return `Non-verba recovery codes\n\n${rows.join('\n')}\n\nKeep these codes private. Each code can be used once.\nA successful recovery replaces this set.\n`;
}

export function createRecoveryExport({document = window.document, host = window} = {}) {
  const native = host.nonverbaRecoveryExport, urls = new Map();
  let pending = null;
  const failure = () => new Error('Download could not start. Try again.');
  if (native?.postMessage) native.onmessage = event => {
    if (typeof event.data !== 'string' || event.data.length > 256) return;
    let value; try { value = JSON.parse(event.data); } catch { return; }
    if (!pending || !value || typeof value !== 'object' || Object.keys(value).length !== 2
        || value.id !== pending.id || !['saved','cancelled','failed'].includes(value.status)) return;
    pending.finish(value.status);
  };
  function release(url) {
    clearTimeout(urls.get(url)); urls.delete(url); host.URL.revokeObjectURL(url);
  }
  function cancel() {
    if (pending) pending.abort();
    for (const url of [...urls.keys()]) release(url);
  }
  host.addEventListener('pagehide',cancel);
  return Object.freeze({cancel, async save(codes,{signal} = {}) {
    const content = recoveryCodesText(codes);
    if (signal?.aborted) return 'cancelled';
    if (pending) throw failure();
    if (!native?.postMessage && host.location?.origin === 'https://appassets.androidplatform.net') throw failure();
    if (native?.postMessage) {
      const id = host.crypto.randomUUID();
      return new Promise((resolve,reject) => {
        const abort = () => {
          try { native.postMessage(JSON.stringify({id,cancel:true})); } catch {}
          finish('cancelled');
        };
        const timer = setTimeout(abort,120000);
        function finish(status) {
          if (pending?.id !== id) return;
          pending = null; clearTimeout(timer); signal?.removeEventListener('abort',abort);
          if (status === 'failed') reject(failure()); else resolve(status);
        }
        pending = {id,finish,abort}; signal?.addEventListener('abort',abort,{once:true});
        try { native.postMessage(JSON.stringify({id,content})); } catch { finish('failed'); }
      });
    }
    let url, link;
    try {
      url = host.URL.createObjectURL(new host.Blob([content],{type:'text/plain;charset=utf-8'}));
      link = document.createElement('a'); link.href = url; link.download = filename; link.hidden = true;
      document.body.append(link); urls.set(url,setTimeout(() => release(url),1000)); link.click();
      return 'started';
    } catch { if (url) release(url); throw failure(); }
    finally { link?.remove(); }
  }});
}
