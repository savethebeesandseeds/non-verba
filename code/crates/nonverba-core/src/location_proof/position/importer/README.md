# Independent RINEX 3 GPS-LNAV import

`import_gps_lnav_rinex(rinex_text, source_id, expected_source_sha256,
window_start_unix_secs, window_end_unix_secs, gps_utc_offset_s)` is a separate
Rust/WASM function. It returns JSON containing `navigation_json`,
`navigation_sha256`, and `import_report`. The resulting navigation bytes and digest
can be retained as independent inputs to `verify_location_position` and agent
appraisal. Import success does not mean that any phone observation has been checked.

The requester or verifier supplies the source-file pin, UTC acquisition window and
GPS-minus-UTC offset independently. Do not let an operator's proof select these
inputs. SHA-256 covers the exact original uncompressed text bytes, including line
endings, before parsing. The output `source.sha256` retains that digest;
`navigation_sha256` covers the exact emitted JSON bytes. A source URL is a label.
HTTPS retrieval or a retained digest is not satellite authentication. Both
`navigation_source_authenticated` and `satellite_authentication_verified` remain
false, including for files obtained from IGS/BKG.

## Supported profile and bounds

The parser follows [IGS RINEX 3.05](https://files.igs.org/pub/data/format/rinex305.pdf),
sections 4.1.1, 6.4 and 6.8 and tables A5/A6. It accepts RINEX versions 3.00–3.05,
GPS or mixed navigation headers, fixed-width finite numbers using E/e/D/d
exponents, LF or CRLF, and omitted trailing blank columns. It preserves radians,
metres for accuracy, and continuous GPS weeks as encoded in RINEX. It does not
reinterpret radians as semicircles, accuracy as a URA index, or weeks modulo 1024.

- Input: at most 16 MiB of uncompressed ASCII, 80 columns per line, 1,024 header
  lines, and 32,768 navigation records. Gzip decompression is external.
- Window: finite UTC seconds within supported expanded GPS weeks, in increasing
  order, spanning at most one hour. A disclosed two-second margin covers the
  solver's bounded receiver-clock displacement, propagation and time rounding.
- Output: at most 128 healthy four-hour GPS LNAV records and 256 KiB of navigation
  JSON. All potentially applicable records whose orbit/clock/transmission validity
  intersects the window are retained, sorted by satellite/week/TOE. An oversized
  subset fails; it is never silently truncated or selected using claimed location.
- GPSA and GPSB ionosphere coefficients are required. Identical repetitions are
  accepted; conflicting models fail and require explicit external resolution.
  Known non-GPS ionosphere headers and time-system corrections are disclosed as
  ignored, since the position profile is GPS-only. GPS leap seconds, when present,
  must match the independently supplied offset. Differing future/past leap-second
  transition headers fail; no offset is inferred from operator data.
- GPS TOC calendar dates are GPST, not UTC. They must agree with the expanded TOE
  week. Transmission values may cross a week boundary exactly as RINEX specifies;
  they are checked relative to TOE before normalization. The unknown transmission
  sentinel is never reduced modulo a week into a plausible time.
- Unhealthy GPS records, unsupported/unknown fit intervals, accuracy above 100 m,
  unknown transmission times and records outside the capture window are excluded
  with separate counts. Required orbit/clock fields are still validated on
  excluded records. Missing required fields, invalid dates, nonfinite numbers,
  fractional integer fields and incompatible IODE/IODC fail the whole import.
- Identical selected records are deduplicated. Conflicting records sharing
  satellite/week/TOE fail, including differing transmission times; the importer
  never chooses a convenient version silently.

Mixed files can contain Galileo, BeiDou, QZSS, NavIC, GLONASS and SBAS records.
Their dates, finite numeric fields and continuation structure are parsed, then
their records are counted and skipped. GLONASS has four record lines through
3.04 and five in 3.05. No non-GPS orbit, clock or physical consistency is verified.
Unsupported satellite systems, header labels or record framing fail. RINEX 2/4,
CNAV, precise orbits, almanacs and automatic provider selection are outside scope.

The importer does not establish ionosphere model authenticity or validity for a
particular capture beyond the source chosen by the caller. The final position
verifier repeats all navigation validation and checks its independent JSON pin;
an import report is never accepted as a proof substitute.

## Reproducible external-file validation

`igs-2026270-excerpt.rnx` consists of the original 103 header lines followed by
the first record for each GPS SVID and the first record of each other constellation
from the public [IGS/BKG day-270 navigation file](https://igs.bkg.bund.de/root_ftp/IGS/BRDC/2026/270/BRDC00IGS_R_20262700000_01D_MN.rnx.gz).
The selected lines retain their original characters and LF endings. This is a
navigation-file parser fixture, not captured Android evidence or a receiver test.

| Retained artifact | SHA-256 |
| --- | --- |
| Downloaded `.rnx.gz` | `f6e526808c833507142f2da6b458e0c467d02d7986c4dc8bf6019ebc98dc4e15` |
| Complete uncompressed source | `bb97b96492ec3639de90dedc57d38b3439805aaa7098d0615bcf591a0762e89c` |
| Committed 399-line excerpt | `626044960321d5730074f257283b208a8ce8248f138d8084cf32d87d569344e8` |

The complete source is preserved under ignored `code/artifacts/qa/rinex-import/`.
Explicit validation imported its 23,618 records (449 GPS) and selected 64 GPS
ephemerides for 2026-09-27 00:00:00–00:00:30 UTC with GPS-UTC offset 18 seconds.
Other systems were counted and skipped; all 385 remaining GPS records lay outside
that window. No physical sensor measurements were used in this check.

Ordinary tests use the committed excerpt and cover field mapping, exact byte
hashing, negative transmission-time rollover, mixed framing, unsupported states,
model/ephemeris conflicts, malformed data and the 128-record boundary. To repeat
the complete-file check from `code` after independently retaining the exact file:

```powershell
$env:NONVERBA_RINEX_FILE = (Resolve-Path ./artifacts/qa/rinex-import/BRDC00IGS_R_20262700000_01D_MN.rnx).Path
$env:NONVERBA_RINEX_SHA256 = 'bb97b96492ec3639de90dedc57d38b3439805aaa7098d0615bcf591a0762e89c'
cargo test --offline --locked -p nonverba-core complete_external_daily_archive -- --ignored --nocapture
```

The external archive test is explicitly ignored in normal runs because its 11 MiB
input is not committed. It does not download or replace files. Physical Android
raw observations, surveyed-position trials, RF spoofing tests and multi-band
processing remain separate validation and development work.
