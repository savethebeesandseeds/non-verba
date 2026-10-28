// SPDX-License-Identifier: AGPL-3.0-only
// Silent-only enhancement for an explicit sign-in action. Passwords never leave
// this action except through the existing authenticated sign-in adapter.
export function createPasswordManagerSignIn({scope = globalThis, normalizeIdentifier, signIn} = {}) {
  if (typeof normalizeIdentifier !== 'function' || typeof signIn !== 'function') {
    throw new TypeError('Identifier normalization and sign-in are required.');
  }
  let epoch = 0, pending = null;
  const cancel = () => { epoch++; pending?.abort(); pending = null; };
  return Object.freeze({
    cancel,
    async trySignIn(identifier, {isCurrent = () => true} = {}) {
      cancel();
      const credentials = scope.navigator?.credentials;
      if (scope.isSecureContext !== true || typeof scope.PasswordCredential !== 'function'
          || typeof credentials?.get !== 'function') return false;
      let expected;
      try { expected = normalizeIdentifier(identifier); } catch { return false; }
      if (typeof expected !== 'string' || !expected || !isCurrent()) return false;
      const captured = epoch, controller = new AbortController();
      pending = controller;
      const current = () => captured === epoch && !controller.signal.aborted && isCurrent();
      let credential = null, password = null;
      try {
        // Never ask the browser to open a credential chooser. If it requires
        // interaction, silent mediation returns null and the password step stays.
        // Fence late results even if an implementation ignores AbortSignal.
        const aborted = new Promise(resolve => controller.signal.addEventListener('abort', () => resolve(null), {once:true}));
        try {
          credential = await Promise.race([
            Promise.resolve(credentials.get({password:true, mediation:'silent', signal:controller.signal})), aborted
          ]);
        } catch { return false; }
        if (!current() || credential?.type !== 'password' || typeof credential.id !== 'string') return false;
        let actual;
        try { actual = normalizeIdentifier(credential.id); } catch { return false; }
        if (actual !== expected) return false;
        password = credential.password;
        if (typeof password !== 'string' || password.length > 1024 || !current()) return false;
        const passwordBytes = new TextEncoder().encode(password).length;
        if (passwordBytes < 8 || passwordBytes > 1024) return false;
        await signIn({identifier, password});
        return current();
      } finally {
        password = null; credential = null;
        controller.abort();
        if (pending === controller) pending = null;
      }
    }
  });
}
