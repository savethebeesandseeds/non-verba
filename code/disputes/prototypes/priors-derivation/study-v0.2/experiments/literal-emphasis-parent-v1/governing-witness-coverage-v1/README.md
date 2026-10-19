# Governing Witness Coverage — PROTOTYPE / UNADOPTED

This small, pure geometry component follows the completed Matched Context Windows
experiment. A tokenizer can fit an arm into many windows while a qualification
and the clause it governs remain far apart. This component measures that
placement once a reader has explicitly supplied witness intervals.

The input contains a declared source identity, an arm range, one window plan,
positive-length witness ranges and named conjunctions of required witnesses.
All coordinates are half-open UTF16 offsets in the original normalized document.
Each invocation concerns one case, scope, tokenizer and form. It does not pool
cases or forms, reconstruct source text, or decide which clauses govern others.

A complete plan must tile its arm exactly with ordered, disjoint windows. Each
window carries a declared token count within 256. Under that rule, every window
intersecting any required witness interval is necessary, so the minimum subset
can be computed directly without a combinatorial search. One-window placement
requires one window to contain every witness in the conjunction.

The result distinguishes:

- Full, partial or absent witness inclusion in the arm, with missing intervals.
- Complete witness coverage by the declared complete plan's windows.
- Placement of all required witnesses inside one window.
- The exact necessary window subset when full coverage is possible.

A witness extending outside the arm makes full coverage impossible within that
arm. Visible intersections remain diagnostics; they are not a successful full
witness. A missing or held plan makes window coverage unavailable or unknown.
It does not prove that some other plan is infeasible. Resource failures remain
typed failures rather than shortened successful results.

These are **source-free structural calculations**. Supplied source identities,
range hashes, token counts and reviewer annotations are declarations until a
separate custody layer authenticates their actual artifacts and reading records.
No semantic adequacy, governing-scope, source-quality, materiality, coding,
candidate-freeze or first-prior authority is granted.

Actual use must bind the annotations to a named source and reading receipt,
preserve the exact independently recounted window-plan identity, and check the
original normalized coordinate mapping. Paragraph labels alone are not offsets.
No actual witness offsets have been inferred or entered in this component.

The existing ten materiality holds, fresh100/29 protection, formal coding,
missing-exhibit limitation and full 15,000-record study remain unresolved.
