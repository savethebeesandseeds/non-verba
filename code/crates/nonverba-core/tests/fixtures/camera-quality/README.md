# Camera quality JPEG fixture

`progressive-dri-420.hex.txt` is the exact 479-byte synthetic JPEG from
`zune-jpeg` 0.5.15, `src/mcu_prog.rs`, test
`test_progressive_dri_420_color`. Hex text changes the representation only;
the decoded JPEG bytes are unchanged.

The upstream fixture is a 16 × 16 progressive JPEG with 4:2:0 chroma subsampling
and DRI restart markers. Its source image is an RGB ramp: R = x × 16,
G = y × 16, B = 128. It tests the decoder's color handling and reproducible
quality measurements outside a physical device. It is synthetic test input,
not a capture or signed sensor evidence.

Upstream: [zune-image](https://github.com/etemesi254/zune-image), package
`zune-jpeg` 0.5.15. The source file carries `Copyright (c) 2023` and offers
MIT, Apache-2.0 or Zlib licensing. This unchanged fixture is distributed under
the Zlib option; the complete upstream notice is in
[LICENSE-ZLIB.txt](LICENSE-ZLIB.txt). The package identifies its author as
Caleb (`etemesicaleb@gmail.com`); the license credits the zune-image developers.
