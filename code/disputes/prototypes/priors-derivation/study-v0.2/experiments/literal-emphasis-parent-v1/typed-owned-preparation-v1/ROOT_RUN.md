# Typed Owned Preparation v1 — PROTOTYPE / UNADOPTED

The outer entry is `run.mjs`. It captures builtins and binds its private stdout
and stderr before importing project code. It authenticates a finite ROOT run
plan and frozen snapshot files. `orchestration.mjs` implements the complete
SOURCE_FREE attempt; `observer.mjs` independently observes each supervisor.
There is no actual contract, real tokenizer, reader or quality authority here.

The order is A, supervisor exit and close events, exact actor/group absence,
external A output readback and private checkpoint, a durable B_PREPARE stop,
materialization of selected fictional sources and twelve fictional artifact
files, B, and external B readback. The final ROOT terminal remains pending
until a separate invocation witnesses ROOT's own exit and rechecks its files.
ROOT never certifies its own exit. Its inherited process group is not claimed
as exclusively owned; only the detached supervisor group is checked absent.

All outputs remain under the newly admitted RUN QA root. No namespace is
reused after failure. The shared capacity walker counts the whole existing RUN,
including these outputs, without following links or subtracting old attempts.
The retained preparation reservation is 126,894,957 bytes. Three failed owned
attempts add 6,302,910 bytes and at least 130,000 ms. The first lacked a journal
directory; the second delivered an unregistered lease. The third completed A
and its external checkpoint, then reached its 4 MiB cap during B. All remain
HELD. The explicit v4 synthetic budget is 144 MiB cumulative, 8 MiB for a fresh
root and 8,192 journal rows. Historical and actual-input budgets remain as
recorded. Cumulative active time stays within the original 180,000 ms.
The 7,672 failed counter calls and 968 windows remain charged; their full totals
also conservatively reduce each prospective stream's remaining allowance.
ROOT prepares directories before spawning, guards IPC sends and requires the
current registered birth for leases and registration acknowledgements.
RSS is sampled across ROOT and every registered live actor. An actor registered
during a capacity walk is included in the subsequent RSS observation; a lease
cannot use an older registry generation. Stale or unknown observations hold the
attempt. These are sampled limits rather than OS containment.

The SOURCE_FREE successor uses Node v22.23.3 with `--max-old-space-size=256`
and `--disable-proto=throw --experimental-vm-modules`. This is its own frozen source epoch. It does not
change the original actual runtime flags, B's combined 32 MiB decoded input
budget, its 32 MiB stored case limit, or the actual reader's decode limit.
Complete 69-case accounting includes 67 available focals and two unavailable
controls. An available failure is never recast as a control or replaced.

Source authoring and in-memory controls alone do not prove an owned run. The
finite preparation catalogue, independent review, managed test outputs,
source freeze, explicit SOURCE_FREE admission and actual terminal readbacks
must be retained before reporting that outcome. Any subsequent actual-source
or real-model admission requires its own concrete review.
