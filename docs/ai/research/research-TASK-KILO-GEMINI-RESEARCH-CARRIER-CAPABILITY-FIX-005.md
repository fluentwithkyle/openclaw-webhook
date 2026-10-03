# Research Record

## Task / Request Identifier

`TASK-KILO-GEMINI-RESEARCH-CARRIER-CAPABILITY-FIX-005` (merge commit `dfbde47358959abde885a671f7f6307c574cd116`; fix commit `c5000deaf25d91632bcff67934a28c0859537abc`).

## Research Question / Objective

Determine whether the completed `TASK-KILO-GEMINI-RESEARCH-CARRIER-CAPABILITY-FIX-005` (merge commit `dfbde47`) reliably and durably resolves the RESEARCH_DOCUMENT activation capability derivation failure, and document the evidence basis, corrected behavior, test coverage, and any residual gaps. This is a post-implementation research/documentation record, not an implementation task.

## Agent

Kilo (via the `TASK-KILO-GEMINI-RESEARCH-CARRIER-CAPABILITY-FIX-005` ACP task, `task_mode: RESEARCH_DOCUMENT`).

## Date

2026-10-03.

## Task Mode

`RESEARCH_DOCUMENT` (server-derived capabilities: `read_only`, `modify_files`, `commit`, `push`; server-derived permitted paths: `docs/ai/research/`, `docs/ai/RESEARCH_INDEX.md`, `docs/ai/TASK_LOG.md`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/README.md`, `docs/ai/ARCH_DECISIONS.md`, `poc/schemas/acp-schema.js`, `test/schema.test.js`).

## Scope Examined

- **Fix commit diff** (`git show c5000de`): `poc/activation-policy.js`, `poc/schemas/acp-schema.js`, `test/activation-policy.test.js` (3 files changed, +74/-19).
- **Current repository HEAD** (`dfbde47`): `poc/activation-policy.js` (420 lines), `poc/schemas/acp-schema.js` (869 lines, `isConsequentialCommand` at lines ~287+, `RESEARCH_DOCUMENT_CAPABILITIES` at lines ~120).
- **Test files**: `test/activation-policy.test.js` (65 tests, all passing), `test/schema.test.js` (49 tests, all passing).
- **Workflows inspected**: `.github/workflows/one-click-gemini-research-documentation.yml`, `.github/workflows/one-click-gemini-builder-smoke.yml`, `.github/workflows/one-click-gemini-builder-callback-correlation.yml`, `main.yml`, `gemini-builder.yml`.
- **Documentation inspected**: `AGENTS.md`, `ARCHITECTURE.md` (§16.6 §995-996), `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/RESEARCH_INDEX.md`, `docs/ai/TASK_LOG.md`.

## Findings

### VERIFIED — Capability Derivation Fix

| Field | Value |
|-------|-------|
| Fix commit | `c5000deaf25d91632bcff67934a28c0859537abc` |
| Merge commit | `dfbde47358959abde885a671f7f6307c574cd116` on `main` |
| File changed (3) | `poc/activation-policy.js`, `poc/schemas/acp-schema.js`, `test/activation-policy.test.js` |
| Lines changed | +74 / -19 |

**Problem (verified from diff):**
The `enforceServerDerivedAuthority(command)` function in `poc/activation-policy.js` previously validated that the incoming `command.authorization.capabilities` array contained every capability in the server-derived `entry.required_capabilities` set. For `RESEARCH_DOCUMENT`, the server-derived capability set is `['read_only', 'modify_files', 'commit', 'push']` (poc/activation-policy.js:9). The one-click research workflow (`one-click-gemini-research-documentation.yml`) submits an activation command whose `authorization.capabilities` include `inspect`, `inspect_repository`, `inspect_github_actions` (research-specific capabilities) rather than the canonical `read_only`. Under the old enforcement, this produced a `MISSING_SERVER_DERIVED_CAPABILITY` error for `read_only`, causing RESEARCH_DOCUMENT activation to fail closed — blocking all Gemini research-documentation tasks.

**Correction (verified from diff):**
1. `poc/activation-policy.js`: Removed the capability-by-capability validation loop in `enforceServerDerivedAuthority`. The function now returns the server-derived `capabilities` set from the activation policy entry without comparing against (or rejecting based on) the incoming command's `authorization.capabilities`. Server-derived authority is still authoritative over the final command (poc/activation-policy.js:377-396). Also exported `getAuthorizedPathsForMode` for test/schema access.
2. `poc/schemas/acp-schema.js`: Simplified `isConsequentialCommand(command)` to return `true` only for `BUILDER` and `FAILOVER_EXECUTE` task modes. The previous logic incorrectly classified RESEARCH_DOCUMENT as consequential based on capability or path-prefix checks; RESEARCH_DOCUMENT is now non-consequential (no Director approval required) (poc/schemas/acp-schema.js:287+).
3. `test/activation-policy.test.js`: Replaced the old "missing capabilities fail closed" test with "derives server capabilities regardless of incoming capabilities"; added two new RESEARCH_DOCUMENT capability-derivation tests.

### VERIFIED — Server-Derived Authority Preserved

The fix preserves server-derived authority over capabilities and paths:
- `RESEARCH_DOCUMENT_CAPABILITIES = ['read_only', 'modify_files', 'commit', 'push']` (poc/activation-policy.js:9).
- `RESEARCH_DOCUMENT_PATHS = ['docs/ai/research/', 'docs/ai/RESEARCH_INDEX.md', 'docs/ai/TASK_LOG.md', 'docs/ai/STATE.md', 'docs/ai/CONTROL_CENTER.md', 'docs/ai/README.md', 'docs/ai/ARCH_DECISIONS.md', 'poc/schemas/acp-schema.js', 'test/schema.test.js']` (poc/activation-policy.js:12).
- `deriveServerAuthority(agent, taskMode)` returns `entry.required_capabilities` and `entry.permitted_paths` (poc/activation-policy.js:363-375).
- The activation ingress (`canonicalExternalActivationIngress`) overrides the command's capabilities and paths with server-derived values: "server-derived capabilities override command capabilities" and "server-derived permitted_paths override command paths" are verified test cases.

**Authority boundary is intact**: The model (Gemini) cannot supply authority-bearing fields. `SERVER_DERIVED_AUTHORITY_FIELDS` = `['task_mode', 'authorization', 'constraints', 'repository', 'base_branch', 'target', 'workflow_stage']` (poc/activation-policy.js:257-265). Any externally claimed value that conflicts with server-derived authority fails closed via `isAuthorityConflict`.

### VERIFIED — RESEARCH_DOCUMENT Task Mode Is Non-Consequential

Post-fix, `isConsequentialCommand` returns `true` only for `BUILDER` and `FAILOVER_EXECUTE`. RESEARCH_DOCUMENT requires no Director approval, consistent with the `task_mode: RESEARCH_DOCUMENT` declaration in the one-click research workflow task body and the RESEARCH_DOCUMENT activation-policy entry having `requires_activation: false` (poc/activation-policy.js:76-80).

### VERIFIED — Test Coverage

**Test execution results (run on 2026-10-03 from current main HEAD `dfbde47`):**

| Test file | Tests | Pass | Fail |
|-----------|-------|------|------|
| `test/activation-policy.test.js` | 65 | 65 | 0 |
| `test/schema.test.js` | 49 | 49 | 0 |

**New RESEARCH_DOCUMENT capability-derivation tests (both pass):**
1. `Authority enforcement - RESEARCH_DOCUMENT derives read_only from policy` — verifies `enforceServerDerivedAuthority` returns `valid: true` with exactly 4 capabilities (`read_only`, `modify_files`, `commit`, `push`) and returns `RESEARCH_DOCUMENT_PATHS` as `permitted_paths`.
2. `Ingress - RESEARCH_DOCUMENT with non-standard capabilities derives server set` — verifies `canonicalExternalActivationIngress` succeeds and the final command has exactly 4 server-derived capabilities including `read_only`.

**Pre-existing test counts (not modified by the fix commit):**
- `test/external-activation-procedure.test.js`: 30 tests, 30 pass, 0 fail.
- `test/external-activation-bypass.test.js`: 66 tests, 66 pass, 0 fail.
- `test/phase-transition-gate.test.js`: 22 tests, 22 pass, 0 fail.

### VERIFIED — One-Click Research Workflow Alignment

`.github/workflows/one-click-gemini-research-documentation.yml` (workflow_dispatch trigger, `task_mode: RESEARCH_DOCUMENT`, capabilities `inspect / inspect_repository / inspect_github_actions / modify_files / commit / push`). The fix aligns the server-derived capability derivation with this workflow's declared capabilities, so activation no longer fails on the `read_only` mismatch.

### INFERRED — Pre-Fix Failure Mode (not directly observed, inferred from diff + test replacement)

Before `c5000de`, a RESEARCH_DOCUMENT activation from the one-click workflow would fail at `enforceServerDerivedAuthority` with `MISSING_SERVER_DERIVED_CAPABILITY` for `read_only`, because the workflow submits `inspect`-prefixed capabilities while the server expects `read_only`. The old `isConsequentialCommand` may also have classified RESEARCH_DOCUMENT as consequential (due to the `modify_files`/`commit`/`push` capability check), potentially requiring Director approval for a documentation task. Both are corrected by `c5000de`. This is classified INFERRED because the failure was not independently reproduced live (no live Render/Gemini run available in this environment); it is derived from code-path analysis of the diff.

## Conclusions

1. **The fix is correct and complete.** Commit `c5000de` (merged as `dfbde47`) removes the incoming-capability validation that caused RESEARCH_DOCUMENT to fail on the `read_only`/`inspect` mismatch, simplifies `isConsequentialCommand` to exclude RESEARCH_DOCUMENT, and adds two targeted tests. All affected tests pass (65/65, 49/49).
2. **Server-derived authority is preserved, not weakened.** The final command always carries the server-derived `RESEARCH_DOCUMENT_CAPABILITIES` set and `RESEARCH_DOCUMENT_PATHS`; the incoming command's capabilities are overridden, not merged. Authority-conflict detection on `SERVER_DERIVED_AUTHORITY_FIELDS` remains active.
3. **RESEARCH_DOCUMENT is correctly non-consequential.** It does not require Director approval, matching the one-click research workflow's design.
4. **No production runtime, workflow, or secret changes were made.** The fix is confined to `poc/` (authorization policy) and `test/` (policy tests). No GitHub Actions workflow files were modified.

## Unresolved Questions / Blockers

- **UNKNOWN — Live end-to-end activation of the RESEARCH_DOCUMENT one-click workflow.** No live Render server or Gemini CLI run was available in this environment to confirm the full `workflow_dispatch → canonicalExternalActivationIngress → RESEARCH_DOCUMENT → commit/push to docs/ai/research/` round-trip. The fix is statically verified via code inspection and unit tests; runtime behavior is inferred.
- **INFERRED — Strategic-alignment test suite.** `test/strategic-alignment.test.js` requires the `axios` module which is not installed in this environment (`Cannot find module 'axios'`). This is a pre-existing environment/test-dependency issue unrelated to the capability fix and was not modified.

## Relevant Repository Files / Interfaces

| File | Role |
|------|------|
| `poc/activation-policy.js` | Defines `RESEARCH_DOCUMENT_CAPABILITIES`, `RESEARCH_DOCUMENT_PATHS`, `enforceServerDerivedAuthority`, `deriveServerAuthority`, `getAuthorizedPathsForMode`, `SERVER_DERIVED_AUTHORITY_FIELDS` |
| `poc/schemas/acp-schema.js` | `isConsequentialCommand`, `RESEARCH_DOCUMENT_CAPABILITIES` constant, `validateCapabilitiesForMode`, `validatePermittedPathsForMode`, `validateAuthorization` |
| `test/activation-policy.test.js` | 65 tests incl. 2 new RESEARCH_DOCUMENT capability-derivation tests |
| `test/schema.test.js` | 49 tests incl. `validateCapabilitiesForMode` and `validatePermittedPathsForMode` RESEARCH_DOCUMENT cases |
| `.github/workflows/one-click-gemini-research-documentation.yml` | One-click research workflow using `task_mode: RESEARCH_DOCUMENT` (not modified by fix) |
| `ARCHITECTURE.md` §16.6 | Authoritative roadmap: Phase 3 COMPLETE/CONVERGED, Phase 4 PROPOSED/TARGET |

## Implementation Implications / Recommended Next Action

- The RESEARCH_DOCUMENT activation capability derivation failure is resolved at `main` HEAD (`dfbde47`).
- Recommended next action: when a live Render server + Gemini CLI environment is available, dispatch `TASK-KILO-GEMINI-RESEARCH-ONE-CLICK-ACTIVATION-VERIFY-RECONCILE-001` to perform runtime verification of the one-click RESEARCH_DOCUMENT workflow end-to-end.
- Recommended follow-up research (as proposed by the one-click research workflow task): `TASK-GEMINI-WORKFLOW-VALIDATION-MACHINE-ENFORCEMENT-RESEARCH-001` (machine enforcement of GitHub Actions workflow validity).

## Verification / Evidence Basis

| Evidence | Classification | Source |
|----------|---------------|--------|
| Fix commit `c5000de` diff applied at `main` HEAD `dfbde47` | VERIFIED | `git show c5000de` |
| `enforceServerDerivedAuthority` returns `valid: true` with server-derived capabilities; no incoming-capability rejection | VERIFIED | `poc/activation-policy.js:377-396` (post-fix) |
| `RESEARCH_DOCUMENT_CAPABILITIES = ['read_only', 'modify_files', 'commit', 'push']` | VERIFIED | `poc/activation-policy.js:9` |
| `RESEARCH_DOCUMENT_PATHS` includes `docs/ai/research/`, `docs/ai/RESEARCH_INDEX.md`, `docs/ai/TASK_LOG.md`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/README.md`, `docs/ai/ARCH_DECISIONS.md`, `poc/schemas/acp-schema.js`, `test/schema.test.js` | VERIFIED | `poc/activation-policy.js:12` |
| `isConsequentialCommand` returns `true` only for `BUILDER` and `FAILOVER_EXECUTE` | VERIFIED | `poc/schemas/acp-schema.js` post-fix |
| `getAuthorizedPathsForMode('RESEARCH_DOCUMENT')` exported and used | VERIFIED | `poc/activation-policy.js:26-31`, `:406` |
| `test/activation-policy.test.js`: 65 passed, 0 failed | VERIFIED | `node test/activation-policy.test.js` (2026-10-03) |
| `test/schema.test.js`: 49 passed, 0 failed | VERIFIED | `node test/schema.test.js` (2026-10-03) |
| New test: "Authority enforcement - RESEARCH_DOCUMENT derives read_only from policy" passes | VERIFIED | `test/activation-policy.test.js` |
| New test: "Ingress - RESEARCH_DOCUMENT with non-standard capabilities derives server set" passes | VERIFIED | `test/activation-policy.test.js` |
| `external-activation-procedure.test.js`: 30 passed, 0 failed | VERIFIED | `node test/external-activation-procedure.test.js` (2026-10-03) |
| `external-activation-bypass.test.js`: 66 passed, 0 failed | VERIFIED | `node test/external-activation-bypass.test.js` (2026-10-03) |
| `phase-transition-gate.test.js`: 22 passed, 0 failed | VERIFIED | `node test/phase-transition-gate.test.js` (2026-10-03) |
| `git diff --check` (post-fix state on `main`) | VERIFIED | `git diff --check` (clean) |
| Server-derived authority overrides externally claimed capabilities | VERIFIED | `test/activation-policy.test.js` test "server-derived capabilities override command capabilities" |
| Authority-conflict detection on `SERVER_DERIVED_AUTHORITY_FIELDS` | VERIFIED | `poc/activation-policy.js:257-295` |
| One-click research workflow declares `task_mode: RESEARCH_DOCUMENT` | VERIFIED | `.github/workflows/one-click-gemini-research-documentation.yml` |
| No workflow files modified by fix commit | VERIFIED | `git show --stat c5000de` (3 files: activation-policy.js, acp-schema.js, activation-policy.test.js) |
| Pre-fix failure mode (read_only mismatch → MISSING_SERVER_DERIVED_CAPABILITY) | INFERRED | Derived from code-path analysis of the removed capability-validation loop in the diff |
| Live end-to-end RESEARCH_DOCUMENT activation round-trip | UNKNOWN | No live Render/Gemini runtime available in this environment |
| `strategic-alignment.test.js` axios module-not-found | INFERRED | Pre-existing environment test-dependency issue; unrelated to this fix |

## Roadmap Alignment

- **authoritative_roadmap**: `ARCHITECTURE.md` §16.6 (lines 995-996); `docs/ai/STATE.md`; `docs/ai/DEESEEK_COORDINATOR_LIFECYCLE_ENFORCEMENT_ROADMAP.md`.
- **current_phase**: Phase 3 — Autonomous Coordination Loop; **COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED**.
- **next_phase**: Phase 4 — Scaled Conversational Orchestration & Cross-Task Lineage Navigation; **PROPOSED / TARGET** (pending `TASK-CHATGPT-PHASE-4-TRANSITION-EXTERNAL-ACTIVATION-FOUNDATION-VERIFY-RECONCILE-001` durable transition evidence).
- **phase_completion_status**: Phase 3 complete/converged; Phase 4 transition evidence partially established (external-activation foundation commit `2136c44` verified; coordinator TaskRegistry identity and signed Director transition provenance NOT established — BLOCKED).
- **relevant_prior_work**: `TASK-GEMINI-DEEPSEEK-TASK-MODE-CAPABILITY-ROUTING-RESEARCH-001` (2026-10-01) established the RESEARCH_DOCUMENT capability routing matrix; `TASK-KILO-EXTERNAL-ACTIVATION-ARCHITECTURE-RESOLUTION-RESEARCH-001` resolved the canonical external activation sequence; `TASK-KILO-GEMINI-RESEARCH-ONE-CLICK-END-TO-END-CARRIER-REPAIR-004` (commit `52e12d2`) established the one-click research carrier chain.
- **proposed_task_classification**: B — Enabling/Foundation Work (restores RESEARCH_DOCUMENT activation capability derivation; prerequisite for research-documentation one-click workflow runtime verification).
- **roadmap_requirement_addressed**: Server-derived authority boundary hardening for RESEARCH_DOCUMENT task mode (prevents capability-mismatch activation failures while preserving server authority over capabilities, paths, and consequentiality).
- **prerequisites_satisfied**: Activation-policy module, ACP schema, RESEARCH_DOCUMENT task mode, one-click research workflow contract, and canonical external activation ingress are all present and verified on `main` at `dfbde47`.
- **phase_unlock_or_advancement**: This research record establishes the static verification basis for RESEARCH_DOCUMENT capability derivation. Live runtime verification (proposed `TASK-KILO-GEMINI-RESEARCH-ONE-CLICK-ACTIVATION-VERIFY-RECONCILE-001`) is the next required step. No Phase 4 transition is performed by this record.
- **alignment_conclusion**: PASS — bounded research/documentation foundation work. The fix is confined to `poc/` authorization policy and `test/` policy tests; no production runtime, workflow, secret, or architectural-authority changes. Server-derived authority, TaskRegistry, dispatcher/orchestrator, Kyle authorization, and single-control-plane architecture are all preserved.
