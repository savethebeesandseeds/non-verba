# Regulatory boundary and production requirements

Official sources checked on 26 September 2026. This document records the intended boundary and outstanding implementation work. It is not a legal opinion or certification that a deployment is lawful.

## Intended use

This protocol is a reference computation for minimum **labour remuneration** within a qualifying collective agreement. Its price-and-time variables do not define every working condition or determine employment status. A successful calculation does not authorize a marketplace to enforce it.

Norway's Competition Authority says it follows the EU approach when enforcing the Norwegian Competition Act. Its guidance concerns solo self-employed people working alone and negotiating pay and working conditions with purchasing counterparties; it expressly excludes fixing consumer prices. A changing formula is still coordination, so variability is no exemption. See the [Authority's announcement](https://konkurransetilsynet.no/solo-self-employed-may-now-negotiate-collectively/?lang=en).

The [EU Guidelines, 2022/C 374/02](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=celex%3A52022XC0930%2802%29) distinguish:

- Section 3: certain agreements involving people comparable to workers fall outside Article 101 TFEU, including specified economic dependence, work alongside employees, and digital labour platform relationships.
- Section 4: a Commission non-intervention policy for specified bargaining imbalances or legislative routes. This is a distinct basis, not blanket exemption.

Paragraphs 2 and 18 require primarily personal labour; asset exploitation or resale alone is outside scope. Paragraph 14 permits direct group negotiation, subject to national law and practice. Paragraphs 16–19 limit preparatory coordination to what is necessary and proportionate for qualifying bargaining and require applicable criteria when negotiating and concluding an agreement. Consumer-price coordination, market allocation and hiring restrictions are outside the described protection. Paragraph 10 preserves other laws and employment-status questions.

## What must exist before production enforcement

These are project requirements for a future integration, not features proved by accepting caller-supplied records:

1. **A reviewed relationship.** Establish actual worker identity, no-employees status where applicable, the personal labour supplied, and the relevant eligibility route. Record who assessed the scope, supporting evidence, jurisdiction and review dates. Assess the body's authority to bind members and the validity of direct participation under applicable law. A signature, membership claim or software flag proves none of this alone.
2. **A bounded agreement.** Name the purchasing counterparty, covered Operators, task definition/version, region, jurisdiction and currency. Keep incompatible scopes separate. A global pool must not silently set every Requester's rates. Scope boundaries must not allocate customers or territories among Operators.
3. **Agreement to dynamic amendments.** Obtain member authorization and counterparty assent to the formula, data inputs, decay rule, update procedure, effective dates and limits. A computed result can become binding only under that agreed mechanism; otherwise it remains a bargaining proposal. Preserve accepted assignments and provide a readable calculation and contest process.
4. **An authenticated completion ledger.** One genuine completed assignment earns one vote, with equal initial weight. Verify who performed it and when; prevent replay, duplicate accounts, invented jobs and artificial task splitting. Correction and appeal must address disputed completions. Caller-supplied identifiers and timestamps are not that ledger.
5. **Member control and documented effects.** Completion frequency deliberately affects aggregate influence; age decay does not make influence equal per person. Explain this before adoption, including the effects on newcomers, leave and access to work. These voting choices are project governance choices, not rules mandated by the cited guidance. Do not infer consent to cast a vote merely from task completion.
6. **A complete remuneration contract.** Define covered time, measurement, additional work, expenses, deductions, payment deadlines and dispute handling outside the minimal arithmetic. Preserve applicable mandatory pay, safety and other protections. Do not let an estimated duration conceal unpaid overruns or fees erode the applicable remuneration floor. This protocol does not authorize supply quotas, restrictions on hiring, or retaliation against members.

## Privacy and retention

Keep personal hourly settings, identity evidence and individual ballots access-controlled. Public accountability can expose the formula and aggregate outcomes without publishing individual membership. Define the processing purpose, lawful basis, access rules, retention periods and correction process before collecting real records. Vote decay is not a retention policy: old records can remain personal data after they stop influencing the result. Trade-union membership receives special-category protection under GDPR; pseudonymous identifiers do not automatically make data anonymous. See [GDPR Articles 5, 6 and 9](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679).

Reassess this boundary when the counterparties, work, jurisdiction, governance or data processing change. The reference library can validate numerical and scope consistency; operational verification and enforceability require the surrounding system and a review of the actual arrangement.
