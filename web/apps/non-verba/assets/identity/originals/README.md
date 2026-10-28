# Account identity stamps

Owner-selected artwork from 23 October 2026: sage Level 1, mahogany Level 2,
and gray Unverified. These PNGs are the transparent masters the app prepares.
A later redraw was set aside. `preserved/` keeps a copy of the same masters.
They are not bundled in the app.

Run `node tools/build/prepare-participant-branding.mjs --write` from `code/`
inside the managed Linux container to prepare the three 128px transparent WebPs.
Use `--check` to compare the current recipe and masters. Each runtime image must
remain below 8 KiB. The shared participant asset collector and native allowlist
select only those small derivatives. Filenames stay `level-1.webp`,
`level-2.webp`, and `unverified.webp`.

The UI labels these stamps as level targets, not verification receipts.
Earned stamps require the same authoritative eligibility as the corresponding
workflow. Artwork and local photo review grant no identity status.
The gray stamp is the account mark when no level is on record.
It is not a verification receipt or a signed-in account indicator on its own.
