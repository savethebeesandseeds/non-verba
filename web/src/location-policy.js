// SPDX-License-Identifier: AGPL-3.0-only
// Request presets only. Rust validates every policy before collection/signing.
// Both standalone location and camera composition use the same explicit options.
// Preserve the older omitted-mode API; new UI defaults live in request-presets.js.
export function locationPolicy(mode = 'browser-or-native', durationMs = 10000) {
  if (!['browser-or-native', 'native-required', 'native-gnss', 'raw-gnss'].includes(mode)) {
    throw new Error('Unknown location collection requirement.');
  }
  if (!Number.isSafeInteger(durationMs) || durationMs < (mode === 'raw-gnss' ? 2000 : 5000) || durationMs > 15000) {
    throw new Error('Unsupported location observation duration.');
  }
  const native = mode !== 'browser-or-native';
  const policy = {
    profile: native ? 'native-required' : 'browser-or-native',
    required_provider: ['native-gnss', 'raw-gnss'].includes(mode) ? 'gnss' : 'any',
    duration_ms: durationMs, min_samples: 3, max_accuracy_m: 100,
    max_fix_age_ms: 5000, max_delivery_delay_ms: 3000, max_finalization_delay_ms: 30000, max_speed_mps: 100
  };
  if (mode === 'raw-gnss') policy.raw_gnss = {
    version: 1, mode: 'required', min_epochs: 3, min_satellites: 4,
    max_epoch_gap_ms: 2500, max_time_uncertainty_ns: 100000,
    // Task-scale allowance, not a measured phone specification: 100 ms is
    // one tenth of the nominal 1 s cadence, separate from observation duration.
    // Actual reported uncertainty still consumes age, span and delivery budgets.
    max_elapsed_realtime_uncertainty_ns: 100000000,
    max_pseudorange_rate_uncertainty_mps: 20
  };
  return policy;
}

// Display the actual signed policy, including older requests without a separate allowance.
const seconds = value => Number.isSafeInteger(value) && value >= 0 ? String(value / 1000) + " s" : "unknown";
export function locationTimingSummary(policy) {
  if (!policy) return "Location timing limits: unknown.";
  const finalization = policy.max_finalization_delay_ms == null
    ? "last fix at most " + seconds(policy.max_fix_age_ms) + " old when sealed (no separate signing allowance)"
    : "sealing within " + seconds(policy.max_finalization_delay_ms) + " after collection ends";
  let summary = "Location timing: fixes at most " + seconds(policy.max_fix_age_ms) + " old at collection; provider delivery at most " + seconds(policy.max_delivery_delay_ms) + "; " + finalization + ".";
  if (policy.raw_gnss) {
    const raw = policy.raw_gnss;
    const milliseconds = (value, maximum) => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= maximum ? String(value / 1000000) + ' ms' : 'unknown';
    const receiver = milliseconds(raw.max_time_uncertainty_ns, 1000000);
    summary += raw.max_elapsed_realtime_uncertainty_ns == null
      ? ' Raw clock uncertainty: shared legacy limit ' + receiver + '.'
      : ' Raw clock uncertainty: receiver/satellite limit ' + receiver + '; Android clock alignment limit ' + milliseconds(raw.max_elapsed_realtime_uncertainty_ns, 100000000) + '. Reported alignment uncertainty consumes timing allowances.';
  }
  return summary;
}
export function locationSealingSummary(evidence) {
  const end = evidence?.trace?.ended_at_ms, seal = evidence?.sealed_at_ms;
  const valid = Number.isSafeInteger(end) && end >= 0 && Number.isSafeInteger(seal) && seal >= end;
  return "Reported delay from collection end to seal entry: " + (valid ? ((seal - end) / 1000).toFixed(2) + " s" : "unknown") + ". Device clock; not requester arrival time.";
}
