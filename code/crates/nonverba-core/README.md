# Non-verba shared Rust core

The same Rust crate runs in a browser worker and in the Android application's local WebView. C2PA 0.91.0 creates and verifies standard embedded JPEG Content Credentials; this crate adds a requester challenge assertion and a pixel watermark. It does not implement COSE or the C2PA container itself.

## JavaScript API

Initialize the wasm-bindgen module once, in a worker. Timestamps are JavaScript numbers containing integer Unix seconds. JSON outputs are strings; callers must parse them. Invalid input rejects or throws a string.

| Export | Result |
| --- | --- |
| `create_identity()` | JSON with `version`, `private_key_pkcs8_b64`, `certificate_pem`, `fingerprint` |
| `identity_fingerprint(identity_json)` | SHA-256 hex digest of the actual leaf certificate's DER bytes |
| `create_challenge(requester, task, now_secs, lifetime_secs)` | JSON challenge; lifetime is 1–86,400 seconds |
| `validate_challenge(challenge_json, now_secs)` | Validated, normalized JSON challenge; rejects expired or future challenges |
| `validate_location(location_json, challenge_json, capture_time_secs)` | Validated, normalized JSON location; shares the signing validation |
| `await seal_image(jpeg_bytes, challenge_json, identity_json, now_secs, location_json)` | `Uint8Array` containing a JPEG with standard Exif GPS and an embedded C2PA manifest; location is required |
| `await verify_image(jpeg_bytes, expected_challenge_json, expected_device_fingerprint, now_secs)` | JSON verification report |
| `extract_watermark(jpeg_bytes)` | JSON with `id`, `confidence`, and `authenticity_proven: false` |

Identity creation generates a fresh ES256 key for this installation and a fresh local issuer; no signing key is shipped in the app. The OS/browser layer must encrypt the returned identity before persistence. The software signing key is accessible in process memory. This is not a hardware-attested or non-exportable signing key.

A challenge contains `version: 1`, `id` (nonce in lowercase hex), `nonce` (32 random bytes in unpadded base64url), `requester`, `task`, `issued_at`, and `expires_at`. The requester must preserve its originally issued challenge and the expected device fingerprint independently of received image metadata. Accepting a reply also requires an atomic one-time challenge ledger and an acceptance deadline in the requester application. Historical verification deliberately remains possible after challenge expiry.

The manifest assertion label remains `org.nonverba.capture` (C2PA omits the optional `.v1` label suffix); the assertion payload now has `version: 2`. Its data includes the exact challenge, claimed capture time, fingerprint, capture ID, watermark algorithm and lookup ID, location, and SHA-256 of the watermarked JPEG including Exif before C2PA embedding. The SDK's standard hard binding verifies the exported JPEG's image data and Exif metadata; the pre-embedding digest is not the hash of the final file.

`verified` requires these five `checks` to be true: `c2pa_integrity`, `challenge_match`, `device_match`, `capture_time_in_window`, and `capture_not_in_future`. Version 2 also requires `location_metadata_valid: true`: the signed fix must be valid and its standard Exif GPS fields must agree. Legacy version 1 captures without location remain historically verifiable with `capture.location: null` and `checks.location_metadata_valid: null`, explicitly indicating no location was recorded. Other version/location combinations fail. The device fingerprint is derived from the active manifest's actual signing certificate and compared to both the pinned expected fingerprint and the signed assertion. The report always separately returns `certificate_trusted: false`, `hardware_attested: false`, `camera_freshness_proven: false`, and `location_authenticity_proven: false`. Raw SDK validation results are included in `validation`.

The signature binds the image to an unpredictable requester nonce. It demonstrates that signing happened after that nonce became available, under the assumption the requester did not reveal it earlier. It does not establish when the camera sensor observed the scene, whether the scene was staged, or whether the device clock was accurate. Stronger claims require a trusted capture pipeline, attestation, and external time evidence.

## GPS metadata

Every new capture requires a device location acquired after challenge issuance and at most 30 seconds before the claimed capture time. A maximum one-second future tolerance accommodates whole-second capture timestamps. The strict input schema is:

```json
{
  "latitude": 47.4979,
  "longitude": 19.0402,
  "accuracy_m": 12,
  "altitude_m": null,
  "altitude_accuracy_m": null,
  "timestamp_ms": 1790251202375,
  "source": "device-geolocation"
}
```

Latitude and longitude are finite WGS84 degrees in `[-90,90]` and `[-180,180]`; accuracy is finite and nonnegative meters. Optional altitude is finite meters above the WGS84 ellipsoid; optional altitude accuracy is finite and nonnegative and requires an altitude. Millisecond timestamps are nonnegative safe integers, with an Exif-representable UTC year (1970–9999). Unknown fields and other sources are rejected. To fit TIFF unsigned rationals, accuracy and absolute altitude cannot exceed 4,294,967,295 meters. Optional altitude keys may be omitted and normalize to `null`.

Watermark re-encoding occurs first. A standard Exif APP1 segment is then inserted before hashing and C2PA signing. It contains ExifVersion 3.1, GPSVersionID 2.3, hemisphere references and degrees/minutes/seconds, WGS-84 datum, UTC GPS date and time including milliseconds, horizontal positioning error, and altitude/reference when supplied. Coordinates retain microarcsecond resolution; ordinary accuracy and altitude values retain millimeter resolution. The exact original device report, including altitude accuracy, remains in the signed capture assertion. There is no second custom GPS sidecar or unsigned metadata edit after signing.

Exif 3.0 corrected GPSAltitudeRef `0`/`1` to positive/negative ellipsoidal height, matching W3C Geolocation; sea-level height uses `2`/`3`. Older viewers can still label `0`/`1` as sea level. Verification parses the actual Exif through the independent `kamadak-exif` library and checks semantic equality to the signed location, so a correctly signed but inconsistent GPS record fails. GPS fixes remain device reports: OS geolocation can use GNSS, network positioning, or simulated input, and the signature does not prove the device's physical location.

## Watermark

Pixels are watermarked before signing. `org.nonverba.dct-qim.v1` is an experimental 64-bit lookup identifier with packet validation and repeated DCT embedding. It is not a registered C2PA soft-binding algorithm. It can help associate metadata-stripped images with a retained original; it never substitutes for C2PA integrity verification. See `watermark.rs` for limits and tested transformations. Input JPEG pixels must already have the correct display orientation.

## Verification

```text
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo build --locked --release --target wasm32-unknown-unknown -p nonverba-core
```

The native verifier accepts a JPEG, the original challenge JSON, and the device's independently obtained certificate fingerprint (or the exported device ID text file):

```text
cargo run --locked -p nonverba-core --example verify -- photo.jpg challenge.json device-id.txt
```

It prints the JSON report and exits with code `0` when all verification checks pass, `1` for a failed verification, and `2` for an input or execution error. It uses the current system clock, reads no signing keys, and does not alter the photo or a requester's acceptance ledger. A correct historical signature remains verifiable after the challenge expires; acceptance as a new reply is a separate requester operation.

Tests cover challenge expiry, malformed challenges, nonce uniqueness, C2PA round-trip verification, JPEG-byte and Exif-coordinate tampering, signed Exif/assertion disagreement, malformed/stale/future/missing fixes, legacy location absence, standard GPS parsing (hemispheres, zero and negative altitude, millisecond UTC timestamp, accuracy), challenge substitution, device substitution, absent pins, identity fingerprint corruption, watermark extraction, JPEG recompression, and malformed/oversized images.

Implementation references: [C2PA Rust SDK](https://docs.rs/c2pa/0.91.0/c2pa/), [C2PA technical specification](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification), [C2PA soft-binding registry](https://github.com/c2pa-org/softbinding-algorithm-list), [rcgen custom signing-key interface](https://docs.rs/rcgen/0.14.10/rcgen/trait.SigningKey.html), [W3C Geolocation](https://www.w3.org/TR/geolocation/), [CIPA Exif 3.1](https://www.cipa.jp/std/documents/download_e.html?CIPA_DC-008-2026-E), and [ExifTool's GPS tag definitions](https://github.com/exiftool/exiftool/blob/master/lib/Image/ExifTool/GPS.pm).
