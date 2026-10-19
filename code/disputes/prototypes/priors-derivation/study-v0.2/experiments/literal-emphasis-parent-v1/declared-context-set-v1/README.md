# Declared context set — PROTOTYPE / UNADOPTED

`createDeclaredContextSet({source,normalized_text,focal,attachments,limits?})`
returns immutable `{artifact,metadata}`. `verifyDeclaredContextSet({artifact,...})`
checks the same supplied inputs independently, without calling the creator.
The only import outside this folder is builtin `node:crypto`.

The source identifies contract, extraction-source SHA, normalized UTF16 length
and normalized-text SHA. `declaredContextSourceIdentity(source)` supplies the
identity required on every node. Each node has an ID, positive codepoint-safe
`range:{start,end,sha256}`, reviewer-declared role and opaque
`annotation_ref:{path,sha256,bytes}`. The focal role is `FOCAL`. Nodes retain the
focal first and attachments in supplied order, with their exact individual
source slices. Disjoint, adjacent or overlapping ranges remain separate; they
are never concatenated, merged, sorted or treated as source adjacency.

Hard limits are 2,097,152 source UTF16 units, 32 attachments and 262,144 combined
artifact/metadata UTF8 JSON bytes (two-space JSON plus newline). Limits may only
be lowered. Errors return no partial artifact. Inputs must be plain bounded JSON;
this validator is not a sandbox for executable objects or proxies.

Roles and annotation references are supplied declarations. Their authenticity,
actual reading, governing scope, legal effect and semantic sufficiency are not
established. `context_adequate` stays null, authority stays `NONE`, and no accepted
runtime representation, inference, quality clearance or adoption is granted.
This comparator changes no extractor, baseline, reader or production input.

Run only inside the existing managed Linux container, using a narrowly transferred
copy of these two modules: `node --test context-set.test.mjs`. The seven groups
use internally authored synthetic text; no corpus, model or counter is required.

## Executed checkpoint — 18 October 2026

All seven synthetic groups passed in the managed container, with an independent
source review. An exposed consulting-agreement case then retained its unchanged
focal and nine previously frozen normalized witness spans as ten separate nodes.
Independent artifact readback passed: 7,509 UTF16 units across the nodes and
6,368 unique source units, with overlaps disclosed. Five reviewer-declared
requirement sets remain declarations. This assembly called no tokenizer or model
and created no native representation. Its context adequacy remains null.

[Original reading, observed input omission and exact artifact references](../../../README.md#consulting-agreement-original-and-declared-context-comparator--prototype--18-october-2026)
are recorded in the study checkpoint. All source-quality holds remain open.
