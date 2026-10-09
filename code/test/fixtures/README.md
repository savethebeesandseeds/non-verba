# Camera session source fixture

`camera-session.hex.txt` contains an unsigned, synthetic 640 × 480 RGB JPEG.
The hex representation preserves the JPEG bytes. It carries no C2PA manifest,
native camera metadata, identity or physical-device claim. Session tests sign
fresh evidence from these pixels using the Rust/WASM implementation.

Generated on 8 October 2026 with `BufferedImage.TYPE_INT_RGB` and the existing
Linux JDK's `ImageIO.write(image, "jpeg", output)`. Each pixel is:

```text
R = 48 + floor(x / 4) mod 160
G = 48 + floor(y / 3) mod 160
B = 100
```

This is the same authored ramp used by `CameraJniSmoke.kt`, saved before any
signature or watermark. The Node session tests now read this bounded source
fixture instead of depending on an earlier ignored JNI QA artifact.
