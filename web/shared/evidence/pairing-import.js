// SPDX-License-Identifier: AGPL-3.0-only
// Bounded exception only for an explicitly clicked pre-challenge answer import.
// An actual pagehide always cancels; this never resumes a challenge or sensor.
export class PairingFileImport {
  #session; #deadline = 0; #confirmed = false; #timer;
  constructor({current, cancel, native = () => !!globalThis.NativeVault, hidden = () => document.hidden}) {
    Object.assign(this, {current, cancel, native, hidden});
  }
  begin() {
    const session=this.current();
    if (!session || session.role!=='requester' || session.phase!=='pairing' || session.connected) return;
    this.clear(); session.prepareAnswerImport(); this.#session=session;this.#deadline=Date.now()+60000;
    this.#timer=setTimeout(()=>{this.clear();this.cancel('Pairing answer import exceeded its one-minute limit.');},60000);
  }
  nativeEvent(active) { if (active===true && this.valid()) this.#confirmed=true; }
  valid() { const value=this.current();return !!this.#session && this.#session===value && value.phase==='pairing' && !value.connected && Date.now()<this.#deadline; }
  permitsPause() { return this.valid() && (!this.native() || this.#confirmed); }
  async foreground() {
    while (this.hidden()) {
      if (!this.permitsPause()) throw new Error('Pairing answer import was cancelled.');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if (!this.valid()) throw new Error('Pairing answer import was cancelled.');
  }
  clear() { clearTimeout(this.#timer);this.#session=undefined;this.#deadline=0;this.#confirmed=false; }
}
