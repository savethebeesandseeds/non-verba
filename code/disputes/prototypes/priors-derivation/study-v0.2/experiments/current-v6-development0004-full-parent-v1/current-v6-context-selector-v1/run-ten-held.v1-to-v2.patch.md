--- run-ten-held.mjs
+++ run-ten-held-v2.mjs
@@ -4,1 +4,1 @@
-const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000',Q=R+'/qa/current-v6-context-selector-ten-held-20261019-v1',B='/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code';
+const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000',Q=R+'/qa/current-v6-context-selector-ten-held-20261019-v2',B='/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code';
@@ -28,1 +28,1 @@
- check(scope_result.source_sha256===METHOD&&same(absolute(scope_result.body_receipt),PINS.body_only)&&scope_result.counts?.body===200&&scope_result.counts?.adverse_findings_retained===10&&scope_result.new_actual_readings===0&&scope_result.current200_supporting_review_assembled===false&&scope_result.materiality_holds_cleared===0&&scope_result.source_quality_gate_pass===false,'SELECTOR_TRIAL_CURRENT_SCOPE_RESULT');
+ check(scope_result.source_sha256===METHOD&&same(absolute(scope_result.body_receipt),PINS.body_only)&&scope_result.counts?.body===200&&scope_result.counts?.adverse_findings_retained===10&&scope_result.counts?.new_actual_readings===0&&scope_result.current200_supporting_review_assembled===false&&scope_result.materiality_holds_cleared===0&&scope_result.source_quality_gate_pass===false,'SELECTOR_TRIAL_CURRENT_SCOPE_RESULT');
