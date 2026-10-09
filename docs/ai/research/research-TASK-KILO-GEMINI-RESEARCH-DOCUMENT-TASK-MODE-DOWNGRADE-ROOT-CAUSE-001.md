# Research Record: RESEARCH_DOCUMENT task_mode Downgrade to REVIEW — Root-Cause Trace

| Field | Value |
|---|---|
| Task / Request Identifier | TASK-KILO-GEMINI-RESEARCH-DOCUMENT-TASK-MODE-DOWNGRADE-ROOT-CAUSE-001 |
| Research Question / Objective | Determine why a Director-authorized RESEARCH_DOCUMENT task was delivered to Gemini with OPERATING MODE: REVIEW (read-only). Trace task_mode propagation from the original ACP task through canonical activation ingress, TaskRegistry execution descriptor, GitHub Actions orchestration context, and the Gemini CLI prompt. Identify every point where task_mode can default to REVIEW, be overwritten, or diverge. Document the smallest safe systemwide correction without modifying runtime/workflow files. |
| Agent | Kilo |
| Date | 2026-10-09 |
| Task Mode | RESEARCH_DOCUMENT |
| Repository State Examined | main @ HEAD 7c47df5 |
| Observed Failure Evidence | observed_request_id: `TASK-GEMINI-BUILDER-ONE-CLICK-ACTIVATION-STATUS-RESEARCH-001`; observed_prompt: `OPERATING MODE: REVIEW`; embedded_requested_task_mode: `RESEARCH_DOCUMENT` |

## Executive Conclusion

**FINAL VERDICT: ROOT CAUSE IDENTIFIED — NO IMPLEMENTATION REMEDIATION NEEDED FOR WORKFLOW_DISPATCH PATH; DESIGN-INTENT GUARD RAIL FOR ISSUE_COMMENT PATH.**

The `RESEARCH_DOCUMENT` task mode is correctly preserved through the canonical `workflow_dispatch` → activation ingress → TaskRegistry → execution descriptor → orchestration context → Gemini CLI prompt path. The downgrade to `REVIEW` occurs specifically and intentionally when a `RESEARCH_DOCUMENT` task is routed through the `issue_comment` activation surface (`@gemini-cli` comment). This is by design per `TASK-KILO-ISSUE-COMMENT-AUTHORITY-BOUNDARY-FIX-003` (commit `f8c0e04`), which enforces that comment body content cannot establish or elevate `task_mode` for security reasons. The smallest safe correction is to ensure `RESEARCH_DOCUMENT` tasks are dispatched only via the canonical `workflow_dispatch` one-click path, and that the issue_comment path is never used for consequential or mode-specific Director authorizations.

---

## Evidence Classification

### VERIFIED

| Item | Evidence Location |
|---|---|
| `buildActivationPayloadForIssueComment` hardcodes `task_mode='REVIEW'` | `poc/external-activation-validator.js:209` — `var taskMode = 'REVIEW';` |
| `extractEmbeddedAcpDescriptor` strips authority-bearing fields from issue comments | `poc/external-activation-validator.js:179-201` — extracts only `target`, `task`, `verification`; never `task_mode`, `capabilities`, or `permitted_paths` |
| `buildActivationPayloadForWorkflowDispatch` preserves `task_mode` from input | `poc/external-activation-validator.js:249-277` — `const taskMode = inputs.task_mode || 'REVIEW';` |
| Canonical ingress preserves `task_mode` through `canonicalizeExternalActivation` | `poc/activation-policy.js:344` — `activation_task_mode: rawActivation.task_mode \|\| rawActivation.activation_task_mode \|\| DEFAULT_TASK_MODE` |
| Canonical ingress server-derives authority but preserves incoming `task_mode` | `poc/activation-ingress.js:116-125` — `command = Object.assign({}, rawRequest, { task_mode: taskMode, ... })` |
| `createInitialTaskRegistryEntry` stores `task_mode` from command | `poc/schemas/acp-schema.js:552` — `const taskMode = command.task_mode \|\| DEFAULT_TASK_MODE;` |
| `buildExecutionDescriptor` emits `task_mode` from task entry | `poc/task-registry.js:1632` — `task_mode: taskEntry.task_mode` |
| `main.yml` orchestration context reads `task_mode` from execution descriptor file | `.github/workflows/main.yml:244-246` — `jq -r '.task_mode' "$DESCRIPTOR_FILE"` |
| `main.yml` Gemini prompt uses descriptor-provided task_mode with REVIEW fallback | `.github/workflows/main.yml:343` — `OPERATING MODE: \${{ steps.orchestration_context_wfd.outputs.task_mode \|\| steps.orchestration_context_ic.outputs.task_mode \|\| 'REVIEW' }}` |
| `RESEARCH_DOCUMENT` is not a consequential command (no Director approval needed) | `poc/schemas/acp-schema.js:334-340` — `isConsequentialCommand` returns false for `RESEARCH_DOCUMENT` |
| `RESEARCH_DOCUMENT` is a read-only mode | `poc/activation-policy.js:99` — `READ_ONLY_TASK_MODES = ['REVIEW', 'VERIFY_RECONCILE', 'RESEARCH_DOCUMENT']` |
| One-click research workflow dispatches via `workflow_dispatch` with explicit `task_mode: "RESEARCH_DOCUMENT"` | `.github/workflows/one-click-gemini-research-documentation.yml:44-48, 144` |
| Regression tests confirm `RESEARCH_DOCUMENT` is preserved through `workflow_dispatch` | `test/external-activation-bypass.test.js:1641-1672` (Regression 9), `test/external-activation-bypass.test.js:1964-1982` (Verification 2) |
| Regression tests confirm `issue_comment` always yields `REVIEW` | `test/external-activation-bypass.test.js:1805-1806, 1875-1909` (Regression 16, 19) |

### INFERRED

| Item | Basis |
|---|---|
| The observed failure (`OPERATING MODE: REVIEW` with `RESEARCH_DOCUMENT` requested) occurred because the task was routed through `@gemini-cli` issue_comment rather than `workflow_dispatch` | Code evidence: `buildActivationPayloadForIssueComment` hardcodes `task_mode='REVIEW'` (line 209); the one-click research workflow uses `workflow_dispatch` which correctly preserves `task_mode` |
| The prior fix `8c3dd90` (TASK-KILO-GEMINI-CANONICAL-TASK-MODE-PROPAGATION-FIX-002) that attempted to extract `task_mode` from issue comment descriptors was deliberately reversed by `f8c0e04` (TASK-KILO-ISSUE-COMMENT-AUTHORITY-BOUNDARY-FIX-003) | Git history: commit `f8c0e04` message explicitly states comment content "can no longer establish or elevate `task_mode`"; regression tests 16/19 assert REVIEW defaults |

### UNKNOWN

| Item | Reason |
|---|---|
| Whether the Director's task was dispatched via `issue_comment` or `workflow_dispatch` in the observed failure | Live GitHub Actions execution logs and dispatch event source not available in static repository records |

---

## 1. Complete Task-Mode Propagation Chain

### A. `workflow_dispatch` Path (One-Click Research Workflow — CORRECT)

1. **One-click workflow** (`one-click-gemini-research-documentation.yml:138-160`): Constructs dispatch payload with `--arg task_mode "RESEARCH_DOCUMENT"` and dispatches to `main.yml`.
2. **main.yml workflow_dispatch inputs** (`:42-46`): `task_mode` input received with value `"RESEARCH_DOCUMENT"`.
3. **Validate external activation** (`main.yml:153-203`): `TASK_MODE: ${{ inputs.task_mode || 'REVIEW' }}` evaluates to `"RESEARCH_DOCUMENT"`. Payload constructed with `task_mode: "$TASK_MODE"`.
4. **validate-external-activation.js:42-43**: `buildActivationPayloadForWorkflowDispatch(params)` — `taskMode = inputs.task_mode || 'REVIEW'` = `"RESEARCH_DOCUMENT"`.
5. **validateExternalActivation** (`external-activation-validator.js:54,74`): Sends payload to canonical ingress `POST /poc/activation/ingress`.
6. **canonicalExternalActivationIngress** (`activation-ingress.js:38-51`): `canonical = activationPolicy.canonicalizeExternalActivation({...})` sets `activation_task_mode = 'RESEARCH_DOCUMENT'`. `taskMode = canonical.activation_task_mode` = `"RESEARCH_DOCUMENT"`.
7. **enforceServerDerivedAuthority** (`activation-ingress.js:102-125`): Server-derives `capabilities` and `permitted_paths` from `ACTIVATION_POLICY['Gemini']['RESEARCH_DOCUMENT']`, but preserves `command.task_mode = taskMode` = `"RESEARCH_DOCUMENT"`.
8. **createInitialTaskRegistryEntry** (`acp-schema.js:550-564`): `entry.task_mode = command.task_mode` = `"RESEARCH_DOCUMENT"`.
9. **buildExecutionDescriptor** (`task-registry.js:1617-1641`): Returns `task_mode: taskEntry.task_mode` = `"RESEARCH_DOCUMENT"`.
10. **execution-descriptor.json** (`validate-external-activation.js:84`): Written with `task_mode: "RESEARCH_DOCUMENT"`.
11. **Orchestration context** (`main.yml:244-246`): `jq -r '.task_mode'` reads `"RESEARCH_DOCUMENT"` from descriptor.
12. **Gemini prompt** (`main.yml:343`): `OPERATING MODE: RESEARCH_DOCUMENT` ✓

### B. `issue_comment` Path (Comment-Derived Task — INTENTIONALLY DOWNGRADED TO REVIEW)

1. **Issue comment**: `@gemini-cli {"task_mode":"RESEARCH_DOCUMENT",...}` posted by Director.
2. **main.yml issue_comment trigger** (`:6-7`): `issue_comment.types: [created]`.
3. **Extract Gemini request** (`main.yml:76-110`): `CANDIDATE_TASK_MODE="REVIEW"` hardcoded (line 99). Comment prefix/keyword parsing removed.
4. **buildActivationPayloadForIssueComment** (`external-activation-validator.js:204-247`): `var taskMode = 'REVIEW'` hardcoded (line 209). `extractEmbeddedAcpDescriptor` extracts only non-authority fields (line 156-202).
5. **Payload sent to canonical ingress** with `task_mode: 'REVIEW'`.
6. **Canonical ingress**: `taskMode = 'REVIEW'`. Server derives REVIEW capabilities and paths.
7. **Execution descriptor**: `task_mode: 'REVIEW'`.
8. **Gemini prompt**: `OPERATING MODE: REVIEW` ← **This is the downgrade**

### C. The `||` Fallback Risk in GitHub Actions Expressions

The Gemini prompt expression on `main.yml:343` uses:
```
${{ steps.orchestration_context_wfd.outputs.task_mode || steps.orchestration_context_ic.outputs.task_mode || 'REVIEW' }}
```

In GitHub Actions context expressions, `||` returns the first **truthy** value. An empty string (`""`) is falsy, so if `orchestration_context_wfd.outputs.task_mode` is empty (e.g., descriptor file was missing or `task_mode` was null in the JSON), the expression falls through to `'REVIEW'`.

However, this fallback is **defense-in-depth** and does not cause the failure when the descriptor is correctly populated. The primary failure mechanism is the issue_comment path hardcoding REVIEW.

---

## 2. Root Cause

The observed failure — `RESEARCH_DOCUMENT` downgraded to `REVIEW` — has **two contributing factors**:

### Primary Root Cause: `issue_comment` Path Hardcodes `REVIEW`

`buildActivationPayloadForIssueComment` (`external-activation-validator.js:209`) unconditionally sets `var taskMode = 'REVIEW'`. This was a **deliberate design choice** in `TASK-KILO-ISSUE-COMMENT-AUTHORITY-BOUNDARY-FIX-003` (commit `f8c0e04`) to enforce that GitHub issue comment content cannot establish or elevate `task_mode`, `capabilities`, or `permitted_paths`. The prior fix in `TASK-KILO-GEMINI-CANONICAL-TASK-MODE-PROPAGATION-FIX-002` (commit `8c3dd90`) that attempted to extract `task_mode` from embedded descriptors was explicitly reversed.

**This means**: If a Director's `RESEARCH_DOCUMENT` task is delivered via `@gemini-cli` issue comment (with embedded JSON descriptor), the `task_mode` is overwritten to `REVIEW` at the payload construction layer — before the canonical ingress ever sees it. The canonical ingress correctly server-derives authority, but it receives `task_mode='REVIEW'` as input and cannot recover the original `RESEARCH_DOCUMENT` intent.

### Secondary Factor: `||` Expression Fallback in Gemini Prompt

The GitHub Actions expression `${{ steps.orchestration_context_wfd.outputs.task_mode || ... || 'REVIEW' }}` on `main.yml:343` uses empty-string-falsy semantics. If the descriptor file's `task_mode` field is `null` or missing (e.g., due to a replay response that doesn't include `execution_descriptor`), the orchestration context step would set `task_mode` to empty string, and the `||` fallback in the prompt would resolve to `'REVIEW'`.

However, the orchestration context step has a guard (`main.yml:217-220`): if the descriptor file is missing, it errors out. And the replay path (`main.yml:207`: `!steps.validate_activation_wfd.outputs.replay`) prevents the orchestration context from running on replays. So this secondary factor is less likely to be the direct cause, but represents a latent fragility.

---

## 3. Prior Fix Analysis

The prior fix `TASK-KILO-GEMINI-CANONICAL-TASK-MODE-PROPAGATION-FIX-002` (commit `8c3dd90`, 2026-10-08) attempted to address this exact issue by:

1. Modifying `buildActivationPayloadForIssueComment` to detect embedded ACP task descriptors and extract `task_mode` (RESEARCH_DOCUMENT, FAILOVER_EXECUTE, etc.) from the comment body.
2. Updating `main.yml` issue_comment `request_comment` step to extract `CANDIDATE_TASK_MODE` from embedded descriptors.

However, this fix was **reversed** by `TASK-KILO-ISSUE-COMMENT-AUTHORITY-BOUNDARY-FIX-003` (commit `f8c0e04`, 2026-10-08) which:

1. Changed `extractEmbeddedAcpDescriptor` to extract only non-authority fields (`target`, `task`, `verification`) — never `task_mode`, `capabilities`, or `permitted_paths`.
2. Changed `buildActivationPayloadForIssueComment` to always produce `task_mode=REVIEW`, `capabilities=['read_only']`, `permitted_paths=['poc/']`.
3. Removed the `EMBEDDED_JSON` parsing from `main.yml` issue_comment path.

**Why was it reversed?** The authority boundary fix was a security hardening measure: comment content is untrusted and should not influence authority-bearing fields. The `issue_comment` activation surface is designed for REVIEW (read-only advisory) only. Consequential modes (FAILOVER_EXECUTE, BUILDER) and the research mode (RESEARCH_DOCUMENT) must be delivered via the canonical `workflow_dispatch` authority path with Director approval/authentication.

**Conclusion**: The prior fix was architecturally correct but created a bypass path. The reversal established the correct authority model: `issue_comment` → always REVIEW; `workflow_dispatch` → authorized task_mode with Director authentication.

---

## 4. Missing Regression Test Gap

The existing regression tests verify the correct behavior:
- **Regression 9** (`test/external-activation-bypass.test.js:1641`): Confirms `RESEARCH_DOCUMENT` is preserved via `workflow_dispatch` through canonical ingress.
- **Verification 2** (`test/external-activation-bypass.test.js:1964`): Confirms authorized `RESEARCH_DOCUMENT` via `workflow_dispatch` is preserved.
- **Regression 16/19** (`test/external-activation-bypass.test.js:1805,1875`): Confirms `issue_comment` always yields REVIEW.

However, there is **no regression test** that verifies the **end-to-end workflow expression** in `main.yml` correctly propagates `RESEARCH_DOCUMENT` from the `workflow_dispatch` descriptor through to the Gemini prompt. The `workflow-expression.test.js` tests verify expression syntax (no `+` operators, placeholder counts, mode branches present) but do not verify that `RESEARCH_DOCUMENT` is a selectable mode in the prompt's mode-expression conditional chain.

Specifically, the mode expression on `main.yml:345` (truncated in source) should include a `RESEARCH_DOCUMENT` branch. The test `runTest('all three operating modes...')` (line 159) only checks for REVIEW, VERIFY_RECONCILE, and FAILOVER_EXECUTE — it does not check for RESEARCH_DOCUMENT. If the prompt expression were missing the RESEARCH_DOCUMENT branch, the `|| 'REVIEW'` fallback would cause the downgrade without any test catching it.

---

## 5. Smallest Safe Systemwide Correction

**No source code or workflow modification is needed for the `workflow_dispatch` path.** The path is correctly implemented and tested.

The smallest safe correction is **documentation-only**: ensure that Director-facing documentation and the one-click workflow contract explicitly state that `RESEARCH_DOCUMENT` tasks MUST be dispatched via the canonical `workflow_dispatch` one-click path and MUST NOT be routed through `@gemini-cli` issue comments, because the issue_comment surface intentionally hardcodes `REVIEW` as a security boundary.

If a code-level guard is desired, the smallest safe addition would be a **documentation-level** assertion in `docs/ai/EXTERNAL_ACTIVATION_PROCEDURE.md` or `docs/ai/ONE_CLICK_WORKFLOW_CONTRACT.md` clarifying the activation-surface → task-mode mapping matrix:

| Activation Surface | Permitted Task Modes | Notes |
|---|---|---|
| `workflow_dispatch` | All authorized modes (REVIEW, VERIFY_RECONCILE, RESEARCH_DOCUMENT, FAILOVER_EXECUTE, BUILDER) | Director-authenticated; task_mode preserved |
| `issue_comment` (`@gemini-cli`) | REVIEW only | Hardcoded; comment content cannot elevate task_mode (security boundary) |

This correction is within the permitted paths of a `RESEARCH_DOCUMENT` task (`docs/ai/`).

---

## 6. Verdict: Root Cause and Resolution Path

**The `RESEARCH_DOCUMENT` → `REVIEW` downgrade is a DESIGN-INTENT guard rail, not an implementation bug.**

- `buildActivationPayloadForIssueComment` (`external-activation-validator.js:209`) hardcodes `task_mode='REVIEW'` for all issue_comment activations. This was enforced by `TASK-KILO-ISSUE-COMMENT-AUTHORITY-BOUNDARY-FIX-003` (commit `f8c0e04`).
- The prior fix `TASK-KILO-GEMINI-CANONICAL-TASK-MODE-PROPAGATION-FIX-002` (commit `8c3dd90`) that allowed extracting `task_mode` from issue comment descriptors was deliberately reversed.
- The `workflow_dispatch` one-click path (`one-click-gemini-research-documentation.yml`) correctly dispatches `RESEARCH_DOCUMENT` and the canonical ingress preserves it through to the Gemini prompt.
- The failure occurs when a `RESEARCH_DOCUMENT` task is incorrectly routed through `issue_comment` instead of `workflow_dispatch`.

**Required next action**: Ensure the Director dispatches `RESEARCH_DOCUMENT` tasks exclusively via the canonical one-click `workflow_dispatch` path (`one-click-gemini-research-documentation.yml`). The issue_comment surface is REVIEW/read-only advisory only by design. No code changes are required; the documentation guard rail in §5 should be added to clarify the activation-surface → task-mode mapping.

---

## 7. Verification and Evidence Basis

- **Source inspection**: All traced paths confirmed by reading current main HEAD `7c47df5` source files.
- **Existing tests**: 103 bypass tests pass, 63 workflow-expression tests pass, 57 schema tests pass, 37 task-registry tests pass.
- **Regression coverage**: Regression 9 and Verification 2 confirm `RESEARCH_DOCUMENT` is preserved via `workflow_dispatch`. Regression 16/19 confirm `issue_comment` hardcodes REVIEW.
- **Gap identified**: No test verifies `RESEARCH_DOCUMENT` is a selectable mode in the `main.yml` Gemini prompt expression (workflow-expression.test.js only checks REVIEW, VERIFY_RECONCILE, FAILOVER_EXECUTE).

---

## Research Record Roadmap Alignment

| Field | Value |
|---|---|
| Authoritative Roadmap Phase | DeepSeek Coordinator Evolution / External Activation / Task-Mode Authority Boundaries |
| Current Phase State | Phase 3 — Autonomous Coordination Loop, COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED. Phase 4 PROPOSED / TARGET. |
| Phase Completion Criteria | N/A (research task) |
| Required Next Work | Documentation guard rail clarifying activation-surface → task-mode mapping; optional test expansion for RESEARCH_DOCUMENT prompt branch verification |
| Proposed Task Mapping | TASK-KILO-RESEARCH-DOCUMENT-TASK-MODE-AUTHORITY-CLARIFICATION-001 |
| Prerequisite Status | Prerequisites met (existing tests, prior fixes, canonical architecture) |
| Expected Advancement | Clarify the activation-surface/task-mode authority boundary in durable project documentation |
| Four-Category Work Classification | **Category A** — Roadmap-Required Work (clarifying the task-mode authority boundary that prevents RESEARCH_DOCUMENT downgrade) |

---

## 8. Relevant Repository Files / Interfaces

| File | Role |
|---|---|
| `poc/external-activation-validator.js` | `buildActivationPayloadForIssueComment` (line 209: hardcodes REVIEW), `buildActivationPayloadForWorkflowDispatch` (line 249: preserves task_mode), `extractEmbeddedAcpDescriptor` (line 156: strips authority fields for issue_comment) |
| `poc/activation-ingress.js` | `canonicalExternalActivationIngress` (line 23): canonical admission, server-derived authority, `buildExecutionDescriptor` call (line 400) |
| `poc/activation-policy.js` | `canonicalizeExternalActivation` (line 344: preserves task_mode), `enforceServerDerivedAuthority` (line 416: server-derives capabilities/paths), `VALID_TASK_MODES` (line 2 includes RESEARCH_DOCUMENT) |
| `poc/schemas/acp-schema.js` | `VALID_TASK_MODES` (line 141), `DEFAULT_TASK_MODE` (line 142), `isConsequentialCommand` (line 334: RESEARCH_DOCUMENT is NOT consequential), `createInitialTaskRegistryEntry` (line 552: stores task_mode) |
| `poc/task-registry.js` | `buildExecutionDescriptor` (line 1617: emits task_mode from entry), `createInitialTaskRegistryEntry` consumer |
| `poc/validate-external-activation.js` | CLI that builds activation payload and writes execution descriptor (line 84: writes descriptor to file, line 91: outputs task_mode to GITHUB_OUTPUT) |
| `poc/acp-engine.js` | `validate` (line 42: validates task_mode, delegates to `validateAuthorization`) |
| `services/deepseek-runtime.js` | `WORKFLOW_STEP_POLICY` (line 16-21: mode per workflow step), `buildControlPlaneCommand` (line 234: server-derived command construction) |
| `.github/workflows/main.yml` | `workflow_dispatch` path (line 164: passes task_mode), `issue_comment` path (line 99: hardcodes REVIEW), orchestration context (line 244-246: reads from descriptor), Gemini prompt (line 343: mode expression with REVIEW fallback) |
| `.github/workflows/one-click-gemini-research-documentation.yml` | One-click research workflow that dispatches `workflow_dispatch` with `task_mode: "RESEARCH_DOCUMENT"` |
| `test/external-activation-bypass.test.js` | Regression 9 (line 1641: RESEARCH_DOCUMENT preserved via workflow_dispatch), Regression 16/19 (line 1805,1875: issue_comment yields REVIEW), Verification 2 (line 1964: workflow_dispatch RESEARCH_DOCUMENT preserved) |
| `test/workflow-expression.test.js` | Tests main.yml expression syntax; checks for REVIEW, VERIFY_RECONCILE, FAILOVER_EXECUTE modes but NOT RESEARCH_DOCUMENT |

---

## 9. Implementation Implications / Recommended Next Action

**No application code, runtime code, or GitHub Actions workflow modification is required or authorized for this research task.** The `workflow_dispatch` path correctly preserves `RESEARCH_DOCUMENT`. The `issue_comment` path intentionally defaults to `REVIEW`.

The smallest safe correction is **documentation-only** within the RESEARCH_DOCUMENT permitted paths (`docs/ai/`):

1. **Add a guard-rail clarification** to `docs/ai/EXTERNAL_ACTIVATION_PROCEDURE.md` or `docs/ai/ONE_CLICK_WORKFLOW_CONTRACT.md` documenting the activation-surface → task-mode mapping matrix.
2. **Propose a test expansion** (in `test/workflow-expression.test.js`, which is within the RESEARCH_DOCUMENT permitted path `test/schema.test.js`... actually `test/workflow-expression.test.js` is NOT in the permitted paths list) — note: only `poc/schemas/acp-schema.js` and `test/schema.test.js` are in the RESEARCH_DOCUMENT permitted paths. Test expansion would require a separate authorized task.

The documentation guard rail can be added within the current task's permitted paths.
