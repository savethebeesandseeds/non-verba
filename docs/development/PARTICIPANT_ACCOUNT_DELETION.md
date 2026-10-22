# Repeatable test accounts and participant phone update

Implemented 22 October 2026. The owner requested a way to delete a local account
and repeat onboarding, plus installation of the latest participant APK on the
connected phone. Email remains mocked; no real email or production erasure policy
was enabled.

## Delete and register again

While signed in, open Settings and choose **Delete test account**. Type the current
email and password, then explicitly confirm. Editing either input clears that
review. Cancellation clears the controls, and entering the account screen stops
capture and discards transient identity images.

Deletion is restricted to the current authenticated reserved test contact in
mock mode. The service rechecks current session authority, password, typed email
and deliberate action under its account lock. A successful receipt signs out the
client and frees the original email for a new registration. Old sessions, keys,
recovery factors and pending enrollment authority cannot reopen the account or
claim its reused email. New registration receives fresh account/principal IDs;
it inherits no previous identity or work authority.

This closes the account with a tombstone. Historical attributed records, private
operation history and backups remain, as explained on the confirmation screen.
It is not a storage purge or a guarantee that previous copies are erased.

If a response is lost, the client clears local session authority and shows an
unconfirmed result. **Check original deletion** reads only that original secret-
bound operation after token revocation. It neither retries the mutation nor
accepts a caller-selected account. Missing or mismatched status stays unknown.
Operation secrets/passwords never enter app URLs, history, logs or persistent
browser storage. Pending lookup details live only in the open page.

## Checks and phone scope

The existing managed application container passed 56 focused account/relay/
workspace/package checks and 27 Chromium groups. Cases cover wrong email/password,
fresh deliberate review, cancellation, exact receipts, lost reply/status lookup,
late response fencing, photo cleanup and same-email registration with new IDs.
The running local service passed the shared client's mock confirmation, sign-in,
recovery, deliberate deletion with an intentionally lost reply, original status
lookup and fresh same-email registration. Only freshly created owned test
fixtures were closed; unrelated accounts and records were preserved.

An authoritative expired-session refusal clears the signed-in presentation;
a wrong-password refusal preserves the current account for a corrected review.

The selected eleven-file runtime is 172,328/196,608 bytes. Participant assembly/
lint, snapshot export and independent inspection of the exact USB-bound copy
passed against the retained signer. The approved USB helper installed the final
2,611,782-byte update with app data preserved and read back the exact inspected
APK hash. It granted no camera permission. The existing USB-only port 4173 reverse
supplies the debug account relay; this selects no LAN or wireless debugging path.

The phone displayed the updated Home and Settings. The initial Home hierarchy
exposed only its WebView, requiring one visual check to open Settings. Settings
and the account screens then exposed semantic control IDs. Opening account entry
and using **Check connection** reported the local service connected, mock email
enabled and account creation/sign-in available. No credentials were entered.
The final session-expiry correction was rebuilt, independently inspected and
installed with matching hash readback; prior captures and reports were preserved.
After this final replacement Android displayed a system overlay. The helper
refused further inspection; dismissal/unlocking remains with the owner. The
earlier app display and USB service connection are bounded observations, not a
claim of a completed onboarding run on the final installation.

Installation/readiness observations are recorded separately from physical camera,
face guidance, Android lifecycle and complete phone-onboarding acceptance. No
personal document/face was acquired or uploaded by this validation. The
[capture contract](PARTICIPANT_CAPTURE.md) and its pending identity decision/
protected-custody limits remain in force.
