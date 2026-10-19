# Terminal native capacity diagnostic — PROTOTYPE / UNADOPTED

Actual diagnostic completed on 19 October 2026, using the authenticated source
and both pinned tokenizers. The complete 329-character node requires 3,771
tokens on each model. Its last codepoint requires 144 tokens both with and
without terminal events; the zero-output terminal events alone require two
special tokens. All eight counts were independently recounted. Terminal events
therefore do not explain this case's forward-search failure. This establishes
neither a complete fitting partition nor a minimum-capacity impossibility.

The prior fixed geometry failed on its final 329-character node after completing
two partial windows. This diagnostic distinguishes terminal annotation cost from
the node's source-text cost before another search strategy is considered.

Four fixed probes compare the complete terminal node, its last codepoint with
terminal events, the same codepoint without terminal events, and the zero-output
terminal events alone. The omission contrast is diagnostic only. Every emitted
encoding must reconstruct its exact declared source and retain its original
native encoding hash. Each model receives eight counts, including separate
recounts. No search, monotonicity, minimum-capacity proof or candidate adoption
is claimed. Neither an encoded fragment nor a token count is an actual source
reading or an adequacy judgment.

The admitted finite run finished in about 1.435 seconds with 236,048,384 bytes of
sampled process-tree RSS. Independent ROOT readback verified all eleven output
hashes. It displayed no source text and performed no model inference. The closed
cumulative record retains 40,844 planning counts, 246 recounts, 745,387.036 ms of
reserved elapsed time and 35,210,896 reserved output bytes. These conservative
reservations are not refunded. The old search pools stay closed; no source
recipe, gate, model window or context hold changes.
