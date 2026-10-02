# GPS L1 C/A independent position consistency

`verify_location_position(proof, original_request, expected_pin, expected_asset,
navigation_json, position_policy_json, now_secs)` re-verifies the existing COSE
location proof, then recomputes each retained raw GNSS epoch without using the
operator's latitude, longitude, altitude or precomputed solver report. It is a
separate optional verifier; the original location proof and raw-readiness APIs
retain their existing meanings.

This profile tests mathematical agreement. A compromised receiver or operator can
fabricate a mutually consistent set of observations. Successful recomputation does
not authenticate satellites, establish the origin of radio signals, attest the
collection path, or prove physical location. It also does not supply an independent
trusted clock. Requester-observed deadlines and replay reservations remain separate.

## Inputs and trust boundary

The immutable original request, location SPKI fingerprint, optional asset binding,
navigation bytes and position policy must come from independently retained verifier
inputs. Never extract them from an operator's claimed verification result.

The API takes seven arguments; `expected_asset` is serialized JSON, normally `null`.
Navigation JSON is capped at 256 KiB and contains at most 128 LNAV records. Policy
JSON is capped at 4 KiB. Existing location proof limits still apply. All input
objects reject unknown fields. The exact schema is in `model.rs`.

Navigation requires `version: 1`, `type: "nonverba-gps-lnav"`, a `source` object
with a label `id` and original source-file `sha256`, four Klobuchar `alpha` and
`beta` coefficients under `ionosphere`, and an `ephemerides` array. Source labels
and source hashes disclose provenance; they do not authenticate it. Policy
`nav_sha256` pins SHA-256 of the exact supplied UTF-8 JSON bytes, including whitespace.
The verifier must acquire and validate navigation data through its own trusted
process. The separate [RINEX 3 importer](importer/README.md) normalizes an
independently pinned source file and selects a bounded capture-time subset. Neither
the importer nor this verifier downloads data or authenticates a provider.

Ephemerides use SI units and radians, expanded GPS week numbers, decoded LNAV
parameters, explicit health, URA, transmission time, IODE and IODC. `gps_week`
belongs to `toe_s`; other times are resolved to its neighboring week. Only the
ordinary four-hour fit interval is supported; unhealthy, future-transmitted,
stale, duplicate or unsupported records are rejected or excluded. The epoch must
be within two hours of the orbit reference and within four hours of transmission.
The clock reference must also be within two hours of the epoch; a current orbit
cannot authorize extrapolating an old clock polynomial. Candidate validity and age
are checked on corrected GPS system transmit time, after applying the candidate's
satellite clock and group delay. This prevents clock correction from admitting a
future or stale record at a validity boundary. Importers must resolve week rollover
and supply radians; RINEX already contains radians and must not be multiplied by pi.
Precise orbits, almanacs and other constellations are outside this version's scope.

Position policy has no inferred defaults. It specifies the exact navigation digest,
GPS-minus-UTC offset in seconds, minimum satellite count (6–32), code-time
uncertainty, PDOP, absolute code residual, normalized residual RMS, horizontal and
vertical claim differences, and maximum fix-to-solution epoch distance. The caller
must maintain the GPS/UTC offset for the capture date. `now_secs` retains historical
proof-verification semantics; this API alone never authorizes a current action.

## Computation and acceptance

The solver selects only identified GPS L1 C/A (`code_type: "C"`, nominal L1 carrier)
with code lock, resolved GPS TOW, no millisecond ambiguity, C/N0 at least 18 dB-Hz,
and sufficient timestamp precision. Each GPS SVID contributes at most one
measurement. Other signals do not silently substitute for the selected signal.
Raw GNSS readiness is necessary but does not imply position readiness.

Clock subtraction uses integer nanoseconds before conversion to floating point.
Per-measurement `TimeOffsetNanos` is added to receiver time, following Android's
measurement contract. Pseudoranges are resolved across the GPS week boundary.
The clock's GPS epoch must agree within one second with the signed acquisition
epoch; that compares two device claims and is not external time authentication.

The implementation propagates LNAV orbits, applies broadcast clock polynomial,
relativity and L1 group delay, iterates signal time to system transmit time, and
includes first-order Earth rotation. Atmospheric corrections are broadcast
Klobuchar and standard-atmosphere Saastamoinen at fixed 70% relative humidity.
These are approximate models, not measured local weather or ionospheric truth.

Weighted least squares solves ECEF position and one receiver-clock bias using
bounded, reorthogonalized QR. No reported coordinates seed the solution. A rough
solution determines a fixed ten-degree elevation mask; the refined solution must
retain that mask. At least six satellites are required after deterministic signal
and elevation filtering, providing residual redundancy. Weighting includes code
timestamp uncertainty, broadcast URA, a five-metre code-model floor and atmospheric
model allowances. No satellite is removed because its residual is inconvenient.
This is not certified RAIM, a statistical protection level or an accuracy guarantee.

All retained epochs must solve and meet policy. Every signed OS fix must have a
nearby solution, with consistent horizontal coordinates and, when reported,
ellipsoidal altitude. Horizontal comparison uses the chord between the coordinates
projected onto the WGS84 ellipsoid; the allowed threshold is at most 10 km. This
avoids tangent-plane antipodal ambiguities while closely approximating local ground
distance. Missing altitude remains disclosed and cannot establish vertical agreement.

The report separates `evidence_verified`, `nav_digest_match`,
`independent_position_recomputed`, `consistency_passed`, and
`reported_location_consistent`. `verified` requires all these dimensions. Per-epoch
solutions, clock bias, PDOP, satellite residuals and exclusions remain visible.
Exclusion reasons survive even when too few satellites remain or a subsequent
observation is malformed, so unsuccessful recomputation retains its diagnostics.
`satellite_authentication_verified`, `navigation_source_authenticated`,
`collection_attested`, `physical_location_proven` and `clock_trusted` remain false.
Legacy raw-check `independent_position_recomputed` remains false because only this
separate report has the independently supplied inputs needed to perform that check.

## Independent test oracle

`rtklib-reference.json` and `rtklib-rollover-reference.json` contain synthetic input
parameters and observations made
by unmodified [RTKLIB](https://github.com/tomojitakasu/RTKLIB) at commit
`71db0ffa0d9735697c6adfd06fdf766d0e5ce807`. The generator is
`code/test/rtklib-oracle.c`. The pinned upstream source digests and attribution
are retained in the [fixture notice](../../../../../../LICENSES/RTKLIB-fixtures-notice.txt).
The original Windows generation procedure is retired.

The oracle uses RTKLIB's `eph2pos`, `geodist`, `ionmodel` and `tropmodel`, never
Non-verba propagation or solver code. It generates 32 synthetic ephemerides,
nine visible GPS satellites and eleven epochs in each fixture for a known Budapest
coordinate,
120 m ellipsoidal height and +75 m receiver clock bias. Timestamp quantization is
explicit. The second fixture starts 20 ms into a new GPS week: its first signal
transmissions and its navigation reference times are in the previous week.
Tests compare independently produced satellite ECEF/clock, range,
azimuth/elevation and atmospheric delays, then solve signed records against the
known receiver coordinate. These are mathematical fixtures, not captured phone
observations, independently surveyed field trials or a physical-device benchmark.

Attack cases cover wrong pins, changed requests/assets, altered signatures,
untrusted navigation changes, stale or unhealthy navigation, expanded-week errors,
signed false and antipodal coordinates, isolated code outliers, insufficient
satellites, unsupported signals, excessive timestamp uncertainty, degenerate
geometry, PDOP, receiver-clock offset, GPS/UTC disagreement and signed
per-measurement offsets. Unknown fields, duplicate ephemerides and size limits
are rejected. A valid signed fix with a mismatched altitude or unmatched epoch
also fails, even when every other fix agrees. Public archived receiver data and
physical Android trials remain additional validation work; they are not implied
by these tests.

Inside the managed Linux container, validate the retained numerical fixtures
from `code` with `cargo test --locked -p nonverba-core rtklib`.
This checks the retained oracle outputs against the current solver; it does not
regenerate the independent oracle. A Linux regeneration launcher remains future
work. Do not install or invoke a Windows compiler to reproduce these fixtures.
Earlier Windows generation runs retained their source provenance, generator
hash, executable and comparison report in local QA directories. Their retired
launcher required `-UpdateFixture` for deliberate fixture revisions. There is
no current regeneration launcher. A future Linux procedure must preserve the
pinned independent source, explicit revision review and comparison evidence.

## Normative and implementation references

- [IS-GPS-200N](https://archive.gps.gov/technical/icwg/IS-GPS-200N.pdf):
  Table 20-IV orbit equations; 20.3.3.3.3 satellite clock and group delay;
  20.3.3.4.3.1 fit intervals; 20.3.3.5.2.5 ionosphere model.
- [Android GnssClock](https://developer.android.com/reference/android/location/GnssClock)
  and [GnssMeasurement](https://developer.android.com/reference/android/location/GnssMeasurement):
  receiver clock, signal time and per-measurement timing semantics.
- [IGS RINEX 3.05](https://files.igs.org/pub/data/format/rinex305.pdf):
  tables A5/A6 define the supported external navigation importer fields.
- [GNSS-SDR PVT](https://gnss-sdr.org/docs/sp-blocks/pvt/):
  independent descriptions of single-point positioning and error models.

Multi-frequency, multi-constellation inter-signal biases, carrier-phase processing,
velocity/Doppler consistency, navigation-message authentication and anti-spoofing
RF measurements require separate profiles and tests. Existing ADR and pseudorange
rate fields are retained in the proof but are not used by this position solver.
