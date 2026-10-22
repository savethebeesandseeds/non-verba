# Non-verba-dev UI

This application exposes requester, operator and verifier tools for camera,
audio, location and signing-key enrollment. It is a development and verification
surface, with explicit evidence and physical-device limits; it is separate from
the [Non-verba participant application](../non-verba/README.md).

`src/` is the shared UI source for the browser and Non-verba-dev APK. Android
bundles these HTML, CSS and JavaScript files in a WebView; its native host lives
in `code/android/app/` with package ID `org.nonverba.camera`. Browser and Android
adapters provide their respective platform capabilities.

Source lives in `src/camera/`, `src/audio/`, `src/location/`, `src/keys/` and
`src/common/`. The browser build retains the flat `web/dist/index.html`,
`camera-set.html`, `audio.html`, `location.html`, `live-location.html` and
`key-enrollment.html` entries. Browser
inspection entries are built alongside them from `inspections/`. Android selects
only the developer entries and their dependencies into `web/dist-android/`.

See the [web architecture](../../README.md), [sensor usage and limits](../../../docs/sensors/README.md)
and [Android build guide](../../../code/android/README.md). Builds run inside the
managed container.
