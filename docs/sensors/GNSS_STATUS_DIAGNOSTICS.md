# Optional satellite-status diagnostics

This unsigned diagnostic observes Android satellite status alongside an existing native GPS collection. It helps investigate sessions where GPS location callbacks arrive but the separate raw-measurement callback stream remains empty. It is not sensor evidence, an authenticated satellite measurement, or a replacement for a raw-GNSS requirement.

## Module boundaries and lifecycle

- `NativeGnssStatusCollector.kt` owns one AndroidX `GnssStatusCompat.Callback`, registered on the native session main Handler using `LocationManagerCompat.registerGnssStatusCallback`. It does not start another location request, request full tracking, change settings or add permissions.
- `NativeGnssStatusDiagnostics.kt` bounds and summarizes the latest callback independently of Android. Registration does not manufacture a satellite observation. A new callback clears the previous observation before its fields are read; an unreadable callback remains missing rather than making old satellite data look fresh.
- `NativeLocation.kt` owns the collector and diagnostics for each GPS session. Its existing detach path stops the optional callback on ready/frozen, timeout, cancellation, lifecycle pause, error and completion. A session-authority check ignores callbacks after cancellation even before queued cleanup runs. Stop is idempotent; registration, parsing and cleanup failures remain optional diagnostic state.
- The status object appears only in the native status response as `gnss_status_diagnostics` with `unsigned: true`. It never enters `buildTrace`, the Rust proof schema, the signing operation, eligibility counts or raw-GNSS quality checks. A fresh session starts with fresh counters.
- `location-platform.js` allowlists fields and validates bounds, count consistency and C/N0 ordering. `location-ui.js` renders a separate `location-satellite-status` paragraph within the existing progress panel, retained after failed runs. Browser collection and older native bridges simply omit this paragraph.

## Interpretation

The fields are registration result/API, active observation state, status callback count, last callback receipt time relative to the session, unreadable callback count, cleanup failure flag, satellites reported, satellites marked used in the receiver's latest fix, finite C/N0 minimum/mean/maximum and constellation counts. No coordinates, satellite IDs, ephemeris, raw observations, keys or arbitrary error strings are included.

The displayed age is time from receipt of the status callback to the native snapshot. It is not the satellite measurement epoch or proof of a current RF signal. A stopped collector retains its last observation and is labelled stopped. `used_in_fix_count` is Android's report about the receiver's latest fix, not a claim that the same satellites underlie an admitted Non-verba sample.

Counts are bounded to 256 satellites per callback and one million callbacks/errors per session. Overlarge or unreadable callbacks leave the latest satellite summary missing. C/N0 values outside the documented finite 0–63 dB-Hz range are excluded and counted; zero valid values yields an unavailable summary. Constellation identifiers outside the documented set enter the `unknown` bucket. The UI does not infer RF quality, hardware support, authenticity or successful raw collection from these values.

An observed satellite-status stream with used-in-fix satellites and zero raw callbacks narrows the investigation to separate delivery/support paths; it does not diagnose a particular firmware defect. No status callback is also inconclusive. Raw-required sessions still fail if raw evidence is absent. On API30 the existing AndroidX raw registration remains in place; no hidden full-tracking request or deprecated direct-registration fallback was added.

## Validation on 28 September 2026

All checks ran inside the existing Debian `non-verba-dev` container. Retained logs and exact commands: `code/artifacts/qa/gnss-status-diagnostics-20260928/results.json`.

- `node --test test/location-adapter-tests.mjs`: 33 passed. New cases cover failed-run retention, optional registration failure with an otherwise ready native collection, malformed/private fields, absent versus observed-zero satellites, inconsistent C/N0/counts, future receipt times and the phone reader's 512-character bound.
- `bash crates/nonverba-android/tests/run-native-session-guards.sh`: 188 pure checks passed, including 50 new status checks for bounds, nonfinite C/N0, stale-value clearing, immutable snapshots, post-stop callbacks, session isolation and saturated counters.
- `node --check /workspace/web/src/location-ui.js`: passed.
- The new collector and pure diagnostics compiled against cached Android API36 and AndroidX Core1.16.0 jars with the existing Linux Kotlin compiler; exact retained invocation is `compile-collector.sh`, output `collector-compile.log` in the QA directory. This did not build an APK.

These are deterministic boundary checks and API compilation, not physical satellite or raw-GNSS validation. Installation, runtime registration, vendor behavior, physical RF conditions and phone lifecycle cleanup remain for the parent task's next device run.

## Primary API references

- [AndroidX LocationManagerCompat](https://developer.android.com/reference/androidx/core/location/LocationManagerCompat): supported status Handler registration/unregistration; Android R compatibility guidance for raw measurement delivery.
- [AndroidX GnssStatusCompat](https://developer.android.com/reference/androidx/core/location/GnssStatusCompat): satellite count, constellation, used-in-fix and antenna C/N0 fields and bounds.
- [Android GnssStatus](https://developer.android.com/reference/android/location/GnssStatus): status semantics; `usedInFix` refers to the latest position fix.
- [Android raw GNSS tools](https://developer.android.com/develop/sensors-and-location/sensors/gnss): independent GnssLogger comparison and distinctions among raw measurement capabilities.


## Raw field rejection detail — 29 September 2026

A later raw-required session received one actual raw callback and immediately failed existing clock/measurement field checks. It had no GPS sample or satellite-status callback before that failure, so earlier satellite snapshots cannot explain it. The raw receiver is now observed delivering data; admissible raw evidence remains unproven.

Derived Rust check reports now optionally include bounded fixed field/reason/count diagnostics, generated by a separate private module without changing admission predicates. Android retains the failed check object before throwing. Two separately bounded unsigned UI paragraphs distinguish clock and measurement field failures; values, coordinates, satellite IDs and raw observations are excluded. This is distinct from satellite-status telemetry above and does not confer new verification credit. Existing continuity, coverage and partial-lock errors retain their aggregate diagnostics. Details, 14 Rust and 40 adapter checks, and implementation limits are in `code/artifacts/qa/raw-field-diagnostics-20260929-note.md`. Physical field-specific inspection follows installation of the updated build.


The updated APK was installed and field-specific failure retention was physically observed at 10:11 UTC: clock bias and elapsed-realtime uncertainty policy failures, and two code-type format failures. One raw epoch was delivered before rejection; no proof was produced. Exact field values were not exported. The coordinate-free observation and original request are linked in `code/artifacts/device-acceptance/raw-gnss-field-rejection-20260929.json`. This validates diagnostic delivery, not admission or raw position accuracy.


## Present empty code types — 29 September 2026

The latest physical run on acquisition build 20260929T103607Z reports three
present but empty code types and two clock uncertainty fields above the requested
limit. It produced no proof. Exact unsigned observations and the limits of matching
them to a saved request are in
code/artifacts/device-acceptance/raw-gnss-present-empty-20260929.json.

The [Android API documentation](https://developer.android.com/reference/kotlin/android/location/GnssMeasurement#getCodeType())
uses UNKNOWN for an unknown code type. The
[AOSP GNSS 2.0 HAL contract](https://android.googlesource.com/platform/hardware/interfaces/+/aedfe936ef5cdcf38cbcbac5bcf43f5a5363ddc5/gnss/2.0/IGnssMeasurementCallback.hal)
also specifies UNKNOWN. The
[AOSP framework setter/reset implementation](https://android.googlesource.com/platform/frameworks/base/+/734f18c/location/java/android/location/GnssMeasurement.java)
sets the presence flag when copying a value, and resets the value to UNKNOWN when
clearing it. The
[AOSP HAL translation](https://android.googlesource.com/platform/frameworks/base/+/f0390ffcebea/services/core/jni/gnss/GnssMeasurementCallback.cpp)
copies HAL code strings into that setter.

Those sources support keeping empty-present values distinct from optional
absence. They do not prove which firmware/framework component produced this
phone's empty strings. No source or RF provenance is authenticated by this
diagnostic. Build 20260929T120251Z retained empty values but excluded them from
basic satellite qualification. Its physical run received58 callbacks and produced
no proof:57 candidate epochs had too few qualifying satellites. The last snapshot
included13 empty-code notes. See the quiet checkpoint at12:25 UTC.

A subsequent code audit found that basic raw qualification already accepts absent
and UNKNOWN signal codes. It checks distinct satellite IDs, synchronization,
clock continuity and uncertainty; it does not establish a specific signal identity.
The source correction therefore treats empty codes equivalently for that basic
qualification, retaining their exact bytes and an explicit unknown-identity note.
Duplicate checks and distinct-satellite counting remain in force. Nonempty malformed
codes remain rejected. Independent position calculation still requires exact GPS
L1 C/A identification; unknown codes cannot satisfy that stronger profile. This
latest correction is not installed, and physical success remains unproven.
