Non-verba camera, audio and location {{VERSION}} - development preview
Try demo in Live audio evidence needs no operator ID or pairing. Click Start demo recording to use the actual microphone/speaker. Demo status is signed into the request.
Extract the archive, then run: node code/tools/serve.mjs
Open http://127.0.0.1:4173 in a current browser. Do not open index.html directly from disk.
Photo processing is local. Live audio is sent directly to the paired requester; no public relay is configured.
Open the Live audio evidence link for manual pairing on the same LAN, continuous recording, and signed C2PA WAV export.
Audio uses fresh requester challenges every two seconds, raw48kHz audio, and experimental20.25/20.75kHz probes. Device support requires a successful speaker test.
Keep the requester original receipt separately. It is required to verify the signed WAV and received audio chunks.
C2PA binds an image to a local software key and challenge. It does not attest camera hardware or scene freshness.
Keep original signed JPEGs. Pixel watermarks are recovery hints, not authentication.
New captures require location permission and include GPS coordinates, fix time, and accuracy in signed EXIF/C2PA metadata.
Location proof can be requested alone or with a photo. Keep the original request, separately trusted location key ID, and exported proof JSON. Combined photo requests require both the final JPEG and its matching proof.
Try demo on the location page uses actual location updates without an operator ID. Demo status is signed. Browser location has no native sensor or hardware attestation.
Live location receipt pairs before releasing its fresh challenge and retains a COSE-signed requester arrival receipt. Keep all three files and both independently trusted key IDs.
The Android APK adds native raw GNSS, Camera2 and AAudio collectors. This browser distribution preserves its software collection profile and cannot satisfy native-required policies.
Key enrollment creates separate Android signing identities without replacing existing keys. Verify enrollment on an independent requester using the original request, observed arrival time, pinned app certificate and fresh authenticated Google trust/revocation data. Select an enrolled key only after that verification.
Rust appraise_location, appraise_image, appraise_camera_location and appraise_audio apply explicit caller-retained policies after actual signature verification. Their with_context variants can additionally validate Android key attestation against the actual artifact signer and recompute GPS L1 positions from signed raw observations and separately pinned navigation data.
The shared evidence_session Rust/WASM API and agent-requester.js controller bind signed requests, exact final artifact arrivals, policy and local one-time acceptance for all four evidence types. Live audio uses this API; the other interactive pages retain their individual workflows and ledgers.
Live audio pairing requires independently exchanged requester and operator IDs. It releases a fresh signed request only after connection. Completion includes final WAV verification and a signed requester arrival receipt. Save the received WAV and final receipt bundle; imported verification does not accept evidence. Policy v2 can explicitly require monitored Android audio.
RINEX3 GPS LNAV import pins independently obtained navigation bytes and selects a bounded capture window. New native microphone captures require Android API29 recording-configuration monitoring, with privacy-sensitive input verified on API30+.
Attestation describes key-generation state, not the current app or physical sensor origin. Position recomputation checks mathematical consistency, not satellite authenticity or resistance to forged radio signals. Private-test enrollment roots never establish hardware trust. Real phone validation remains required.
