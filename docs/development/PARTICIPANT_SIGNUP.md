# Participant signup

The shared browser/APK account UI uses a centered, width-bounded column. Entry
starts with Email or username and Continue. Usernames accept an optional `@`,
normalize ASCII case and follow the same unique account-handle rules as signup.
Continue opens the password step locally for every well-formed selector. It
does not check account existence, send mail or reveal a username's contact.
Password authentication accepts email or the public handle; unknown or incorrect
credentials receive the same generic denial. The confirmed contact is exposed
only through successful authentication and validated current account context.
Ordinary sign-in does not require a new email code.

Create account is an explicit email-only path. It retains the operation-owned
eight-character email challenge before enrollment, with exact retry identity
and clearing on Back or a changed selector. Recovery still requires a recovery
code plus separate email proof. Preview email remains mocked in the selected
development environment; copying or using a code does not confirm it.
Public handles use a separate selector from opaque internal OIDC login names.
The existing password, PKCE, current-account binding and device proof remain
mandatory for sign-in. No anonymous username-to-email lookup or username-only
account creation is exposed.

Signup shows the confirmed email first with a muted gray readonly background.
It remains selectable and keyboard accessible, followed by Username and Password.
The username field has a fixed `@` prefix. Typing or pasting a leading `@`
keeps exactly one visible prefix; the API retains its bare canonical username.

New accounts use a canonical unique username: 3–30 ASCII letters, numbers or
underscores, starting with a letter, normalized to lowercase. It is separate from
opaque login, principal and protocol-key identifiers. The confirmed email is
readonly in the form. The service also requires the original confirmed entry
capability bound to that exact email, so editing request JSON cannot substitute
another contact. Both Requester and Operator roles are enabled by default;
account roles do not authorize work, identity decisions, signatures or sensing.

Once the confirmed entry and terms are ready, Create account stays available.
Clicking it focuses an invalid username or password and explains the correction,
without clearing the draft or sending an enrollment request. Hyphenated names
explicitly suggest underscores. Valid details with no agreement open full terms;
agreement alone does not submit the account. The button remains disabled while
busy or without the required service, confirmed entry or pinned document.

## New-password guidance

The five-segment bar is local guidance, not an entropy estimate. Empty is level
0; refused short, common, account-derived, sequence or repeating passwords are
level 1. Otherwise 8–19 Unicode characters are level 2, 20–23 level 3, 24–31
level 4 and 32 or more level 5, with a bounded UTF-8 input size. No character-class
mixture is mandatory. Enrollment and recovery require level 2 or higher on both
client and service. The owner selected the eight-character floor on 22 October
2026. Login/deletion shape checks allow these new shorter credentials and retain
compatibility with historical multibyte credentials; authentication still
requires the server's password-hash match.

Weak-password feedback identifies the actual reason: too short, a common
password, repeated characters/patterns, a letter/number/keyboard sequence, or a
password based on the username/email. Each suggests a concrete correction,
including unrelated words. The inline hint updates while typing, is announced
politely and remains visible when Create account refuses the field. This is a
wording improvement; accepted passwords, thresholds and backend policy are
unchanged. A password longer than eight characters can still fail these rules.

The length emphasis and blocklist approach are informed by
[NIST's password guidance](https://pages.nist.gov/800-63-4/sp800-63b.html) and the
[OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
This small custom rule set is not a comprehensive breached-password corpus or a
claim of standards compliance.

## Account terms

Hero 2 authored the full account-only draft in
`web/apps/non-verba/src/account-terms.js`: ID `nonverba-account-terms`, version
`0.1.0-draft.1`. Signup has one checkbox sentence with an inline underlined
**account terms** link. The full document view identifies Draft and the version;
signup omits that separate version line. The strength bar likewise omits a
visible numeric level, retaining its accessible value and color progression.
Agreement starts unchecked. Opening the link does not toggle the checkbox.
Activating the signup checkbox by mouse, Space or its label also opens the
document without changing agreement. Only the checkbox at the end of the complete document synchronizes the signup
agreement. Checking it returns through the shared Back action; unchecking it
withdraws agreement and leaves the document open. It stays disabled without a
loaded pinned document and confirmed enrollment entry. Back without checking
does not accept terms. Reading terms and going Back preserves the signup draft
only in the open page's memory. Leaving that pair
clears the confirmed email capability and secret controls.

Agreement to the same document survives username/password edits, local
validation and a refused username submission. Submitted passwords still clear.
Withdrawal, changed/unavailable terms or leaving the signup/terms context reset
the choice; edits do not silently withdraw it. A service report of changed terms
reloads and revalidates the authoritative document before another attempt.

The content is canonical JSON in RFC 8785 key order. SHA-256 covers its exact
UTF-8 bytes without a BOM or trailing newline; digest metadata is excluded. The
service supplies its authoritative document and hash. The client compares full
content and hash with the bundled document before submission, and the enrollment
checksum includes the accepted terms identity, version and digest. A changed or
unavailable document blocks signup. The private service retains the full
immutable canonical snapshot and the account's attributable agreement record.

This is a development draft. It names no selected contracting operator,
jurisdiction or covered countries and supplies no public adoption or real-person
identity assurance. It does not bundle identity-document, face, sensor, marketing
or work-contract consent. Hero 2 retains the unresolved legal/adoption work.

## Recovery codes and download

Enrollment confirmation and successful recovery now generate eight independent
32-byte random codes. **Show recovery codes** reveals them in two columns and
four rows; showing them again retains the same set. **Download recovery codes**
exports those exact eight as `non-verba-recovery-codes.txt`, including before
reveal. There is no saved-code checkbox or download requirement for Continue.

Recovery still requires one current code plus separate email confirmation and
a new password. Success retires the entire old set, including unused members,
revokes prior sessions and key authorization, and creates eight fresh codes.
Existing accounts' single recovery keys remain valid until a deliberate recovery;
the additive backend migration does not rotate them or split one key into codes.

Codes remain only in the open page's memory until navigation, cancellation or
page exit clears them. They are absent from public state snapshots, history and
persistent web storage. The service retains member hashes and an ordered-set
retry commitment, never plaintext codes. Uncertain confirmation/recovery retries
reuse the exact pending set and retrieve only its receipt.

Browser export uses a short-lived Blob URL and reports **Download started**;
it cannot confirm where a browser saved the file. Android uses an origin- and
main-frame-scoped message bridge and the system text-file picker, reporting
**File saved** only after the selected document stream has closed successfully.
Cancellation, navigation, expiry and late callbacks are fenced. Pending native
content and the tracked worker copy have a two-minute memory lease. Revocation
wipes both before provider cleanup, and a blocked open cannot obtain a late copy.
There is no cache, logging or storage permission. The user-selected file remains
in its selected storage until the user removes it. Physical Android picker/device
acceptance remains untested.

## Packaging and verification

One shared collector supplies browser tests, preview and APK packaging. The
current fifteen-file closure includes the reusable attestation tool, its
browser-key module, account terms and recovery-export adapter within a 296 KiB
runtime guard. The explicit increase from 280 KiB covers the eight-code display,
export adapter and native handoff; it adds one shared asset and no dependency.
Image and APK guards remain 8 KiB per
SVG/WebP and 8 MiB respectively; release notices are counted separately. Native
and relay networking allow only the fixed account-terms GET endpoint in addition
to the existing selected account operations.

Focused checks exercise centered layouts, readonly email, all password levels,
fixed-prefix typing, paste and caret edits, username correction, canonical terms substitution refusal, complete terms/Back
draft retention, clipboard success/refusal/cancellation, and existing
authentication, device, recovery and deletion behavior. These checks use
synthetic contacts and keep passwords and session tokens out of URLs, history,
diagnostics and persistent web storage. Execution results are recorded in
[validation](VALIDATION.md#centered-signup-and-account-terms--22-october-2026).
