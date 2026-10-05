# Camera quality guidance, version 1

The independent Rust `camera_quality` module measures the supplied JPEG's
resolution, exposure distribution and regional sharpness indicators. The
browser's **Verify → Image quality guidance** panel calls the same Rust code
through WASM. Choose the actual delivered JPEG, analyze it, and optionally save
its separate quality record. Signature verification can be performed separately.
No sensor, signing key or original challenge is needed for pixel measurements.

These measurements provide guidance while task-specific thresholds are
uncalibrated. Dark scenes, highlights and plain surfaces may be correct results.
A gradient score cannot establish useful subject detail, focus, motion, physical
conditions or responsibility. Quality analysis does not change capture,
verification or successful-measurement acceptance.

## Analysis and record

The public Rust/WASM entry points are `camera_quality_profile()` and
`analyze_camera_quality(jpeg_bytes, profile_json)`. Native Rust callers can use
`analyze_camera_quality_typed`. The default profile is version 1,
`nonverba-camera-quality-profile`, with metric profile
`jpeg-rgb8-zune-tenengrad-v1` and no selected subject region.

Each `nonverba-camera-quality-report` contains:

- SHA-256 of the complete supplied JPEG, including its metadata and manifests.
- The complete normalized analysis profile and its SHA-256. This hash uses
  compact Rust JSON in declared field order; input whitespace is not retained.
- Encoded and oriented dimensions, EXIF orientation and versioned processing rules.
- Full-frame, up to four nonempty fixed grid regions, and an optional
  subject region. Each region retains its own measurements and availability.
- Exposure sample count, 256-bin encoded-luminance histogram, minimum, maximum, range and
  near-black/near-white counts; integer sharpness sums and sample denominators
  at scales 1, 2 and 4.

`guidance_only` is true; `satisfies_successful_measurement` and
`authenticity_proven` are false. The record is unsigned. Its hashes allow
comparison with the image and profile, but do not authenticate the record.
Recompute from the exact delivered JPEG and independently selected profile
before relying on its measurements. A quality JSON file cannot substitute for
a signed photo, GPS proof or failed-attempt certificate.

The current analysis profile is a separate inspection input. It is not included
in existing signed requests or camera assertions. A future enforced quality
contract must bind its metric version, subject region and calibrated requirements
to the original signed request and evidence, preserving historical verification.
This version adds no quality-based payment, penalty or acceptance rule.

## Versioned pixel rules

The decoder is pinned `zune-jpeg` 0.5.15 with `zune-core` 0.5.3, strict JPEG
parsing and RGB8 output. RGB, YCbCr and grayscale inputs are supported; CMYK and
other color spaces are rejected. ICC color management is not applied. Decoded
RGB is encoded color, not calibrated scene luminance or linear light.

One EXIF record before the first image scan is allowed. Primary-IFD orientation
1 through 8 is applied; absent orientation means 1. Malformed, wrongly typed,
duplicate or out-of-range orientations are rejected. Subject coordinates use
the oriented image: integer left/top origin and positive width/height, entirely
inside the image. The optional subject is analyzed separately so background
detail cannot replace its measurements.

Encoded luminance is `(77*R + 150*G + 29*B + 128) / 256`, rounded down with integer
arithmetic. Near-black values are 0–5 and near-white values are 250–255 inclusive.
Those bins describe pixel values, not exposure pass/fail thresholds.

The grid splits each axis at `floor(axis / 2)`. Nonempty tiles cover the frame.
Each region is downsampled independently with nonoverlapping integer box means,
rounded half up; incomplete right/bottom blocks are omitted. Scale 1 is unchanged.
No neighboring region contributes to subject measurements.

Sharpness is the sum of `gx² + gy²` from unnormalized 3×3 Sobel gradients at
interior centers, without border padding. Reports retain sums and denominators
rather than a rounded overall score. No available 3×3 center gives
`insufficient-data`; zero measured gradient energy gives `insufficient-texture`.
The latter includes patterns invisible to this operator, such as Nyquist
checkerboards. A nonzero result is `measured`, without a calibrated focus or
usability verdict. Noise, processing and detailed backgrounds can affect it.

Processing changes require a new metric-profile version. Post-decode metric
arithmetic is integer and reproducible for identical pixels. The pinned JPEG
decoder can use architecture-specific optimizations; the off-device corpus
checks exact native/WASM agreement on tested forms. This is not a guarantee of
identical decoding on every architecture or every valid JPEG.

## Bounds and validation

Inputs are limited to 32 MiB, 8,192 pixels per axis, 12 million decoded pixels,
100 progressive scans and a 4,096-byte profile. Header dimensions and oriented
subject bounds are checked before RGB pixel allocation. These bounds limit
input and work; they are not a strict total-memory cap because progressive
coefficients, decoder scratch and processing buffers also require memory.

The [dated validation record](VALIDATION.md#camera-quality-guidance--5-october-2026)
separates mathematical tests, exact native/WASM fixture agreement, browser
behavior and physical validation. Synthetic fixtures are explicitly synthetic,
including the software-signed C2PA sample. This version's phone deployment,
real-device quality calibration, motion/gyro evidence, audio quality and
simultaneous multi-camera acquisition remain separate work.

A subsequent [single-photo compatibility check](VALIDATION.md#one-photo-camera-quality-compatibility--5-october-2026)
used the already verified installed camera app. Its 12-million-pixel signed JPEG
passed original-challenge and independently retained camera-key verification;
off-device native Rust and WASM produced exactly equal quality reports. This
checks one real delivered file, without calibrating usability or deploying the
new quality UI to the phone.

Nine subsequent browser checks reused that same saved JPEG through the built
quality panel and real Rust/WASM Worker. Whole-image, geometric-region and
one-pixel edge results matched native expectations; JSON downloads preserved
the displayed report bytes. Invalid regions cleared guidance without enabling
acceptance. The original image stayed unchanged and no new capture was needed.

The original approved USB helper now has a separate `ExportCameraQuality`
action for explicitly saved unsigned quality records. It accepts only the
image-hash filename, bounded report bytes and guidance-only shape; retrieval
does not authenticate the report or verify its measurements. Recompute against
independently retained image/profile bytes. See the
[deployment preparation record](VALIDATION.md#camera-quality-phone-deployment-preparation--5-october-2026)
for package verification and remaining phone/parser coverage.
