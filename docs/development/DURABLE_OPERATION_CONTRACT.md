# Durable operation contract

Reserved 28 October 2026. This file is the place for a frozen contract on
operation identity, exact-input idempotency, conflict handling, and
lost-response lookup. No contract is frozen. Lookup and retry must not create
a new signature, a renewed challenge, or an invented closure. Concurrent
acceptance is not resolved here. Multi-device scope and ledger authority are
not stated. This note grants no consent from a lost response.
