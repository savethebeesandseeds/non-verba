// SPDX-License-Identifier: AGPL-3.0-only
// Isolated platform orchestration. Rust decides privacy policy; this adapter owns
// resource teardown, callback fencing and illustrative local authority leases.
export class WorkPrivacyController {
  constructor({engine, accountId = 'synthetic-account', state, devices = ['this-device', 'second-device'],
    clock, onChange = () => {}, persist = () => {}} = {}) {
    if (!engine?.json) throw new Error('A Rust policy engine is required.');
    this.engine = engine;
    this.clock = clock ?? {seconds: () => Math.floor(Date.now() / 1000),
      setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
      clearTimeout: id => globalThis.clearTimeout(id)};
    this.state = state ?? {account_id: accountId, state: 'hold', revision: 0, updated_at: this.clock.seconds()};
    this.onChange = onChange;
    this.persist = persist;
    this.devices = new Map(devices.map(deviceId => [deviceId, {device_id: deviceId, online: true,
      state: {...this.state}, operations: new Map(), status: 'stopped', observed_at: this.clock.seconds(),
      acknowledged_revision: this.state.revision, generation: 0}]));
    this.queue = Promise.resolve();
    this.closed = false;
    this.sequence = 0;
    this.pendingStops = 0;
    this.policyFailed = false;
  }

  policy(method, input) { return this.engine.json(method, JSON.stringify(input)); }
  device(id) {
    const device = this.devices.get(id);
    if (!device) throw new Error('Unknown inspection device.');
    return device;
  }
  notify() { this.onChange(this.snapshot()); }
  resourceStatus(device) {
    const operations = [...device.operations.values()];
    return operations.some(op => op.cleanupError) ? 'failed' : operations.some(op => !op.active) ? 'pending'
      : operations.length ? 'active' : 'stopped';
  }
  snapshot() {
    return {state: {...this.state}, simulation: true, account_wide_protection: false,
      devices: [...this.devices.values()].map(device => ({device_id: device.device_id, online: device.online,
        revision: device.acknowledged_revision, status: device.online ? device.status : 'unreachable',
        observed_at: device.online ? device.observed_at : null,
        local_state: device.state.state, operation_count: device.operations.size,
        operations: [...device.operations.values()].map(op => ({operation_id: op.id, sensor: op.sensor,
          purpose: op.purpose, expires_at: op.expiresAt, active: op.active, cleanup_error: op.cleanupError ?? null}))}))};
  }

  // Stop the initiating device immediately, before any asynchronous policy or
  // propagation response. The shared state is changed only by Rust below.
  transition(action, {deviceId = 'this-device', expectedRevision = this.state.revision,
    authorizedController = true, deliberate = true} = {}) {
    if (this.closed) return Promise.reject(new Error('Inspection controller is closed.'));
    if (action !== 'clock_in') { this.pendingStops++; void this.stopDevice(deviceId, action); }
    const run = async () => {
      const decision = await this.policy('work_privacy_transition', {now_secs: this.clock.seconds(),
        state: this.state, command: {account_id: this.state.account_id, action,
          expected_revision: expectedRevision, authorized_controller: authorizedController, deliberate}});
      if (!decision.accepted) { this.notify(); return decision; }
      this.policyFailed = false;
      this.state = {...decision.state};
      this.persist({...this.state});
      for (const device of this.devices.values()) {
        if (!device.online) continue;
        device.state = {...this.state};
        void this.stopDevice(device.device_id, action);
      }
      this.notify();
      return decision;
    };
    const result = this.queue.then(run).catch(error => { this.policyFailed = true; throw error; }).finally(() => {
      if (action !== 'clock_in') this.pendingStops--;
      this.notify();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  async stopOperation(deviceId, operationId, reason = 'cancelled') {
    const device = this.device(deviceId), operation = device.operations.get(operationId);
    if (!operation) return true;
    // Fencing is synchronous, even when the physical adapter takes time to close.
    operation.active = false;
    device.status = this.resourceStatus(device);
    operation.abort.abort(reason);
    this.clock.clearTimeout(operation.timer);
    if (operation.stopping) return operation.stopping;
    operation.stopping = (async () => {
      try {
        // Permission acquisition may still be pending. Never acknowledge a
        // stopped device until a late resource has been obtained and closed.
        if (operation.acquisition) {
          try { operation.resource = await operation.acquisition; } catch {}
        }
        const confirmed = operation.resource ? await operation.resource.close(reason) : true;
        if (confirmed === false || operation.resource?.stopped?.() === false)
          throw new Error('Resource has not confirmed shutdown.');
        device.operations.delete(operationId);
        device.status = this.resourceStatus(device);
        device.observed_at = this.clock.seconds();
        device.acknowledged_revision = device.state.revision;
        return true;
      } catch (error) {
        operation.cleanupError = String(error?.message || error);
        operation.stopping = null;
        device.status = 'failed';
        device.observed_at = this.clock.seconds();
        return false;
      } finally { this.notify(); }
    })();
    this.notify();
    return operation.stopping;
  }

  stopDevice(deviceId, reason = 'stopped') {
    const device = this.device(deviceId);
    device.generation++;
    device.status = device.operations.size ? 'pending' : 'stopped';
    const stop = Promise.all([...device.operations.keys()].map(id => this.stopOperation(deviceId, id, reason)));
    this.notify();
    return stop.then(results => {
      if (!results.every(Boolean)) device.status = 'failed';
      else device.status = this.resourceStatus(device);
      device.observed_at = this.clock.seconds();
      if (device.status === 'stopped') device.acknowledged_revision = device.state.revision;
      this.notify();
    });
  }

  async connect(deviceId, online) {
    const device = this.device(deviceId);
    device.online = online;
    if (online) {
      device.state = {...this.state};
      await this.stopDevice(deviceId, 'reconnect requires new operation authority');
    }
    // A disconnected simulated device keeps its bounded local lease. Its expiry
    // is not represented as an observed remote shutdown acknowledgment.
    this.notify();
  }

  async authorize({deviceId, operationId, sensor, purpose, explicitConsent = false,
    deliberate = false, leaseSecs = 30, accountId = this.state.account_id}) {
    const device = this.device(deviceId), now = this.clock.seconds(), revision = device.state.revision;
    const grant = {account_id: accountId, device_id: deviceId, operation_id: operationId,
      revision, issued_at: now, expires_at: now + leaseSecs};
    const input = {now_secs: now, account_id: accountId, device_id: deviceId,
      operation_id: operationId, sensor, purpose, state: device.state, authority: null, auth_camera: null};
    if (purpose === 'authentication') input.auth_camera = {...grant, deliberate, status: 'active'};
    else input.authority = {...grant, purpose, sensors: [sensor], explicit_consent: explicitConsent};
    const decision = await this.policy('work_privacy_assess', input);
    return {decision, input, expiresAt: grant.expires_at, revision};
  }

  async startSensor(options, resourceFactory) {
    if (this.closed) throw new Error('Inspection controller is closed.');
    if (this.pendingStops || this.policyFailed) throw new Error('A privacy stop or unresolved policy decision blocks new operations.');
    const device = this.device(options.deviceId), generation = device.generation;
    if (!device.online) throw new Error('Unknown control connectivity: new operation blocked.');
    if ([...device.operations.values()].some(op => op.cleanupError)) throw new Error('Resolve pending resource cleanup first.');
    const id = options.operationId ?? `inspection-${++this.sequence}`;
    if (device.operations.has(id)) throw new Error('Operation is already registered.');
    const authorization = await this.authorize({...options, operationId: id});
    if (!authorization.decision.allowed_for_simulation) throw new Error(authorization.decision.reason);
    if (this.closed || generation !== device.generation || authorization.revision !== device.state.revision || !device.online)
      throw new Error('Operation authority changed while requesting access.');
    if (this.clock.seconds() >= authorization.expiresAt) throw new Error('Operation authority expired before acquisition.');
    if (device.operations.has(id)) throw new Error('Operation is already registered.');
    const operation = {id, active: true, sensor: options.sensor, purpose: options.purpose,
      expiresAt: authorization.expiresAt, abort: new AbortController(), resource: null};
    device.operations.set(id, operation);
    device.status = 'active';
    const current = () => operation.active && !this.closed && this.clock.seconds() < operation.expiresAt
      && device.operations.get(id) === operation;
    operation.acquisition = Promise.resolve().then(() => {
      if (!current() || operation.abort.signal.aborted) throw new Error('Operation was revoked before acquisition.');
      return resourceFactory({current, signal: operation.abort.signal, operationId: id, expiresAt: operation.expiresAt});
    });
    operation.timer = this.clock.setTimeout(() => {
      void this.stopOperation(options.deviceId, id, 'expired');
    }, Math.max(0, (operation.expiresAt - this.clock.seconds()) * 1000));
    this.notify();
    try {
      const resource = await operation.acquisition;
      if (!resource?.close) throw new Error('A resource must expose confirmed cleanup.');
      operation.resource = resource;
      if (!current()) {
        await this.stopOperation(options.deviceId, id, 'late resource after cancellation');
        throw new Error('Operation was cancelled while acquiring its resource.');
      }
      return {operationId: id, current, signal: operation.abort.signal, resource,
        close: reason => this.stopOperation(options.deviceId, id, reason), authorization};
    } catch (error) {
      await this.stopOperation(options.deviceId, id, 'failed');
      throw error;
    }
  }

  async expireAuthorities() {
    await Promise.all([...this.devices.values()].flatMap(device => [...device.operations.values()]
      .filter(op => op.expiresAt <= this.clock.seconds()).map(op => this.stopOperation(device.device_id, op.id, 'expired'))));
  }

  async summary(deviceId = 'this-device') {
    const device = this.device(deviceId);
    return this.policy('work_privacy_assess', {now_secs: this.clock.seconds(), account_id: this.state.account_id,
      device_id: deviceId, operation_id: 'inspection-summary', sensor: 'other', purpose: 'diagnostics',
      state: this.state, authority: null, auth_camera: null,
      devices: this.snapshot().devices.map(({device_id, revision, status, observed_at}) => ({device_id, revision, status, observed_at}))});
  }

  async close(reason = 'lifecycle loss') {
    this.closed = true;
    await Promise.all([...this.devices.keys()].map(id => this.stopDevice(id, reason)));
  }
}
