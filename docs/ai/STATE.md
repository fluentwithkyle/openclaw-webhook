# Current AI Project State

**Last Updated**: 2026-09-23
**Updated By**: Kilo — FAILOVER_EXECUTE (TASK-KILO-RESEARCH-DOCUMENTATION-SOP-IMPLEMENT-001)

---

## Project Status: ACTIVE (Transitional)

**Repository**: `fluentwithkyle/openclaw-webhook`

**Architectural State**: Transition complete from Kilo Cloud Agent (transitional/legacy) to Gemini Builder (active).
- Gemini Builder is the active architectural lane for runtime repository implementation (commit `8a56fe6`).
- Kilo Cloud Agent is the legacy Builder/Implementer/Tester lane (transitioning out).
- Gemini Reviewer remains the independent review lane.
- ChatGPT serves as the project coordinator and control/verification layer.
- GitHub serves as the durable source of truth.
**Default Branch**: `main`
**Production Deployment**: Render (Node.js/Express webhook listener)
**Google Adapter**: Google Apps Script (versioned in `google-apps-script/`)

---

## Active Tasks

| Task | Status | Owner | Notes |
|------|--------|-------|-------|
| Kilo ↔ Gemini post-commit test remediation | **COMPLETED** | Kilo | Fixed orchestrator syntax error (missing `function determineNextAction` declaration), fixed `getOrchestrationState` test, updated `poc/github-webhook.js` to handle `trigger_builder` flow (calls `triggerGeminiBuilder` after Kilo success), updated stale `trigger_gemini` assertions in github-webhook/kilo-callback/kilo-polling tests. 237/289 tests verified post-remediation in pre-Builder state (347 total after Path 2 recovery); **450/450 tests pass across 18 test files** at commit `8a56fe6` (including `gemini-builder-trigger.test.js` with 9 tests). |
| Gemini Builder execution infrastructure | **IMPLEMENTED / VERIFIED** | Gemini Builder | Complete test coverage: `gemini-builder-trigger.test.js` (9 tests), Builder callback tests (3 in gemini-callback), Builder lifecycle tests in orchestrator, schema tests for BUILDER mode, workflow-expression tests for `gemini-builder.yml`. All 9 Builder-trigger tests pass; full suite: **450/450 tests pass across 18 test files**. Implementation commit `f1e21ec`; tests commit `53dfa23`; merged via `8a56fe6`. |
| Persistent AI project state system | **IMPLEMENTED** | Kilo | `docs/ai/` system created and `AGENTS.md` updated |
| Kilo External Integration Contract documentation | **IMPLEMENTED** | Kilo | `docs/ai/KILO_INTEGRATION.md` documents GitHub webhook (Pushes + Issues + Issue comments), external Kilo trigger, ACP task-ingestion contract, and exact current Kilo prompt. The exact current Kilo prompt has been updated to the externally configured prompt supplied by Kyle. The documented prompt now includes convergence-based autonomous recovery (ALLOW EXPLORATION, STOP ON NON-CONVERGENCE), same-execution durable completion, timeout/interruption continuation, and self-wake authority (continuation-only, does not create new authorization). ACP remains the authorization boundary. The prompt itself remains externally configured. No secrets committed. The exact rate-limit condition `Assistant request was rate limited` is documented in Section 6.7; the broken Section 7.4 reference has been corrected to Section 6.7 and Section 7 of the verbatim prompt. |
| ChatGPT Control Gate architecture | **RESEARCH COMPLETE / PROPOSED / PENDING** | Gemini (research) | Full research preserved in `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`. Not authorized for implementation. |
| ChatGPT Protocol Stop Gate hardening (Section 14) | **IMPLEMENTED / VERIFIED** | Kilo | Section 14 consequential-action stop gate hardened in `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` (commit `3ce42ac159dd8c73d7e043d7bc57692f6c5ecde`). Documentation reconciliation: `CONTROL_CENTER.md` reconciled in commit `da6a1a48190072049abc85b333cb4dfbd56f3ced`; `STATE.md` and `TASK_LOG.md` reconciled in this task. |
| Chatbox target-aware ACP dispatch | **IMPLEMENTED / VERIFIED** | Kilo | Removed hardcoded `target: 'Kilo'` from `buildChatboxCommand` in `routes/poc.js`; target now flows through the trusted control path via request body `target` field validated against `VALID_AGENTS` (fail-closed on missing/invalid). `createInitialTaskRegistryEntry` in `poc/schemas/acp-schema.js` now sets `current_agent` from `command.target`. Chatbox remains REVIEW/read_only/poc/. Existing target-aware dispatcher in `services/transport-provider.js` routes Kilo→`dispatchKilo`, Gemini Builder→`dispatchBuilder`, unrecognized→BLOCKED. Fixed invalid target casing in `test/verify-reconcile.test.js` (`'KILO'`→`'Kilo'`). 26/26 chatbox Gateway tests, 28/28 schema tests, 52/52 verify-reconcile tests pass; full regression 450+ tests pass. Merged `kilo/misty-hatch-7j7` (commits `7e46b78`, `e558910`) into `main`. |
| Kilo ↔ Gemini orchestration backbone — Part 1 Foundation | **IMPLEMENTED** | Kilo | TaskRegistry, Orchestrator, ACP Schema, and focused tests implemented in `poc/` and `test/`. See commit `9407470`. |
| Kilo ↔ Gemini orchestration backbone — Part 2 Automatic Gemini trigger after Kilo completion | **IMPLEMENTED / VERIFIED** | Kilo | Automatic Gemini trigger in `/poc/kilo/callback` and `poc/kilo-polling.js` after successful Kilo completion. `handleKiloCompletion` → `next_action='trigger_gemini'` → `orchestrator.triggerGemini()` → Gemini state `running` → `next_action='waiting_gemini_callback'`. Kilo failure/blocked does not trigger Gemini. Source commit `6c92a9a223cc58f8f85f052c8d2168424938b46c`. 103/103 tests pass (20 schema, 17 task-registry, 18 orchestrator, 11 integration, 14 Gemini trigger, 23 Gemini callback). `git diff --check` clean. |
| Kilo ↔ Gemini orchestration backbone — Part 2.2 Kilo completion/result delivery | **IMPLEMENTED / VERIFIED** | Kilo | Kilo provider identifier capture (`session_id`, `message_id`, `invocation_id`), provider identifier persistence in TaskRegistry, idempotent Kilo completion polling, Kilo completion/result processing, provider client abstraction and mock provider, task-registry persistence, Gemini dispatch after Kilo completion, callback and JSON serialization behavior, relevant schema, registry, orchestrator, trigger, integration, callback, and polling tests. Source commit `2e9355d549f4c9379820476ef660cea3e274e560`, integrated main commit `ebb8e9e2e5beaeec5691d0667a659da0922928b3`, 133/133 tests pass. |
| Gemini verification requirements propagation | **IMPLEMENTED** | Kilo | Verification field flows ACP command → TaskRegistry → orchestrator → gemini-trigger → GitHub Actions → Gemini reviewer prompt. Implemented in commit `736ae3faf4d4ea75b22df8b85a6186dcdde91f59`; artifact persistence in `748ba91722ecbad6aaeaca5a084384862aabb6df`; prompt fix in `53f1a3fbd5c2fd0777397a0a139614d1fe92ba05`. Gemini independently verified functional. |
| Automated Kilo delivery verification | **IMPLEMENTED** | Kilo | Independent delivery verification lane implemented in `poc/kilo-verifier.js`, `.github/workflows/kilo-verification.yml`, `test/kilo-verifier.test.js`. Verifies commit identification, changed files, authorized file scope, request_id correlation, git diff --check, and idempotency. Triggers on push to main and pull request events. Kilo's self-report remains execution evidence, not independent delivery proof. |
| Security Specialist architectural foundation | **IMPLEMENTED** | Kilo | Registered lane in `AGENTS.md`; expanded architecture in `ARCHITECTURE.md` Sections 12.7, 16.3, 17.2; added ADR-014; three open architectural decisions documented; POC `command.json` and `test.js` extended with optional security fields (Issue #38) |
| Render Control Gatekeeper documentation reconciliation | **IMPLEMENTED** | Kilo | Documentation reconciled to explicitly record Render as future technical Control Gate / gatekeeper, machine-enforced boundary, Layer 1 → Layer 2 sequencing, and Kilo/Gemini architecture protection. See `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`. No implementation performed. |
| DeepSeek Coordinator Project establishment | **ACTIVE / IMPLEMENTED / VERIFIED** | Kilo | HIGH PRIORITY project implementing the authenticated `POST /poc/coordinator` endpoint. DeepSeek Coordinator ingress implemented in `routes/poc.js` using existing ACP validation (`poc/schemas/acp-schema.js`) and TaskRegistry (`poc/task-registry.js`). After successful registration, the command is dispatched through the existing Kilo dispatcher via `getDispatcher()` (same mechanism as `/poc/kilo`). Authentication via `x-deepseek-coordinator-secret` header (env: `DEEPSEEK_COORDINATOR_SECRET`), distinct from `KILO_CALLBACK_SECRET` and `GEMINI_CALLBACK_SECRET`. Registration failure prevents dispatch; provider identifiers persisted on successful dispatch. 19 coordinator tests pass; 170 total tests pass (20 schema, 17 task-registry, 18 orchestrator, 11 integration, 14 Gemini trigger, 23 Gemini callback, 15 Kilo callback, 10 Kilo polling, 18 Kilo verifier, 5 POC, 19 coordinator). (TASK-KILO-DEEPSEEK-COORDINATOR-INGRESS-IMPLEMENT-001, commit `950983a`) |
| VERIFY_RECONCILE operating mode implementation | **IMPLEMENTED / VERIFIED** | Kilo | Task mode dispatch added to ACP schema (`poc/schemas/acp-schema.js`) and engine (`poc/acp-engine.js`): REVIEW (read-only, existing behavior), VERIFY_RECONCILE (read_only + modify_files + commit + push capabilities; bounded docs/ai path scope), FAILOVER_EXECUTE (all 5 capabilities, explicit paths). `task_mode`, `capabilities`, `permitted_paths` fields added to ACP command and task registry entry. Reconciliation model added (status, changed_files, commit_sha) with `determineReconciliationStatus()`. Gemini workflow `.github/workflows/main.yml` updated with mode-aware prompt, `task_mode`/`capabilities`/`permitted_paths` inputs, `contents: write` permission, and reconciliation reporting in callback payload. `poc/gemini-trigger.js`, `poc/orchestrator.js`, `poc/command.json` updated to pass mode context through dispatch. 238 total tests pass (20 schema, 17 task-registry, 18 orchestrator, 11 integration, 14 Gemini trigger, 23 Gemini callback, 15 Kilo callback, 10 Kilo polling, 18 Kilo verifier, 5 POC, 19 coordinator, 52 verify-reconcile, 16 poc/test.js); `git diff --check` clean. (Issue #145). Independent verification by Gemini performed in TASK-GEMINI-VERIFY-RECONCILE-PROCEDURE-HARDENING-001. |
| Kilo → Gemini Completion Handoff — Polling Path Closure | **IMPLEMENTED / VERIFIED** | Kilo | Closed polling path gaps so Kilo completions are delivered via repository-controlled polling. Three fixes: (1) `poc/task-registry.js` `updateAgentResult` preserves `provider_session_id`/`provider_message_id`/`provider_invocation_id` via spread merge instead of overwriting; (2) `poc/orchestrator.js` `handleKiloCompletion` extracts `execution_id` from `report.result.execution_metadata.invocation_id` (guaranteed string per ACP schema); (3) `routes/poc.js` transitions task PENDING → SELECTED → PLANNED → EXECUTING after successful dispatch (`/kilo`, `/chatbox`, `/coordinator`) so `poc/kilo-polling.js` picks up tasks. Provider IDs remain sufficient for polling path (used as identifiers in `getCompletionStatus`, as fallbacks for report `invocation_id`/`run_id`). EXECUTING transition follows valid state-machine path. 237 tests pass. Commit `90de87d`. |
| Kilo ↔ Gemini post-dispatch result lifecycle repair | **IMPLEMENTED / VERIFIED** | Kilo | Repaired false-success path in `.github/workflows/main.yml`: callback payload now reflects actual Gemini execution result via `steps.gemini_run.outcome` instead of hardcoded `status: "success"`. Added `gemini_result` step with `if: always()` to determine STATUS/VERIFICATION_STATUS/BLOCKER_MSG/RECON_STATUS from real outcome; callback and artifact persistence steps now use `if: always()`. Callback payload now includes `gemini_output`. RECON_STATUS conditional on VERIFICATION_STATUS=PASS per `determineReconciliationStatus()` contract. 9 new workflow-expression tests + 3 new gemini-callback tests; all 270 total tests pass. (TASK-KILO-GEMINI-POST-DISPATCH-RESULT-LIFECYCLE-IMPLEMENT-001) |
| Kilo → Gemini End-to-End System Test (Issue #161) | **EXECUTING (Kilo phase)** | Kilo | SYSTEM TEST (TASK-KILO-GEMINI-END-TO-END-SYSTEM-TEST-001). Exercises the existing Kilo → repository-controlled polling → TaskRegistry → handleKiloCompletion() → orchestrator.triggerGemini() → Gemini workflow_dispatch → Gemini execution → callback path end-to-end. Authorized change: `docs/ai/STATE.md` only. |
| Gemini ACP artifact reporting fix (Issue #173) — Independent Verification | **IMPLEMENTED / VERIFIED** | Gemini | Independently verified Kilo's implementation (commit `72ad118`). Confirmed structured artifact `gemini-acp-report.json` correctly derives from `callback_payload.json` (containing `current_head_sha` from `$GITHUB_SHA`), artifact upload restrictions applied, and all verification requirements met. (TASK-GEMINI-ACP-ARTIFACT-REPORTING-FIX-VERIFY-RECONCILE-001, commit `72ad118`) |
| Gemini ACP artifact reporting fix (Issue #173) | **IMPLEMENTED / VERIFIED** | Kilo | Fixed defect where `gemini-acp-report.json` artifact contained raw Gemini CLI summary instead of the structured ACP envelope. Changes to `.github/workflows/main.yml`: (1) Added `current_head_sha` field (sourced from `$GITHUB_SHA`) to `callback_payload.json` jq construction; (2) Added `cp callback_payload.json gemini-acp-report.json` in the callback payload step so the artifact file syncs with the authoritative structured envelope; (3) Restricted first Upload step to `issue_comment` only (preserves raw summary artifact for ad-hoc requests — NOTE: the `issue_comment` path was left unchanged in Issue #173; the separate "Persist Gemini result as artifact" step continued to write raw `steps.gemini_run.outputs.summary` to `gemini-acp-report.json` for `issue_comment` triggers; this remaining defect was fixed by Issue #174); (4) Added final Upload step for `workflow_dispatch` that persists the structured ACP envelope as the `gemini-acp-report` artifact. The persisted artifact now contains request_id, agent, status, task, repository, base_branch, current_head_sha, changed_files, verification, result, commit, push, blockers. All 328 tests pass. (TASK-KILO-GEMINI-ACP-ARTIFACT-REPORTING-FIX-001) |
| Gemini ACP artifact reporting fix — issue_comment path (Issue #174) | **IMPLEMENTED / VERIFIED** | Gemini | Independently verified Kilo's implementation (commit `1842f58`). Confirmed structured artifact `gemini-acp-report.json` correctly derives from structured ACP payload (unified across trigger paths), raw Markdown artifact persistence removed, and all verification requirements met. Live validation: NOT PERFORMED. (TASK-GEMINI-ACP-ARTIFACT-ISSUE-COMMENT-VERIFY-RECONCILE-002, commit `1842f58`) |
| Git-based Kilo completion-signal POC (Issue #162) | **IMPLEMENTED / VERIFIED** | Kilo | Bounded POC implementing Git-based Kilo completion signal via GitHub push webhook. Implemented `poc/github-webhook.js` (HMAC-SHA256 signature verification, repository/branch/path/request_id validation, signal artifact fetch, delivery-id + task-level idempotency, explicit recursion preventing excluding Gemini reconciliation commits) and `POST /poc/github/webhook` route. Reuses existing TaskRegistry correlation and `orchestrator.handleKiloCompletion()`. Existing polling, callback, verification, and Kilo→Gemini orchestration preserved. Implementation commit: `bf68116167454d7c42b85e0ac4d627050a89ffd9`. **Commit-SHA hardening IMPLEMENTED** (commit `f63211d`, TASK-KILO-GIT-COMPLETION-SIGNAL-COMMIT-SHA-HARDENING-002): resolved the self-referential defect. **Live validation signal** (commit `f9d97e5`). **Path 2 recovery IMPLEMENTED / VERIFIED** (TASK-KILO-GIT-COMPLETION-SIGNAL-PATH-2-RECOVERY-IMPLEMENTATION-001): when TaskRegistry state is absent, `recoverTaskFromGitHub()` retrieves the authoritative ACP task from the GitHub issue body (correlated by exact `request_id`), validates via `validateACPCommand` + `validateAuthorization`, requires commit/push capabilities for execution path authorization, rehydrates via `taskRegistry.rehydrateTask()`, then continues through the existing Kilo-completion → Gemini flow. Fail-closed on GitHub issue absence, request_id mismatch, validation/authorization failure, and missing token. Test count: 77/77 focused tests pass (58 original + 6 commit-SHA hardening + 13 Path 2 recovery), 270 regression tests pass, 347 total tests pass. Independent verification by Gemini performed in TASK-GEMINI-PATH-2-TASKREGISTRY-RECOVERY-IMPLEMENTATION-VERIFY-RECONCILE-001. Follow-on: signal emitter implemented in Issue #180 (commit `7bec058`) — see active task entry above. |
| Git-based Kilo completion-signal emitter (Issue #180) | **IMPLEMENTED / VERIFIED (UNDER VALIDATION)** | Kilo | Commit `7bec058`: `poc/signal-emitter.js` builds, validates via `validateSignal()` from `poc/github-webhook.js`, and writes `poc/signals/<request_id>.json` completion signals (success/failure/blocked) with duplicate/conflict prevention. Committed signal artifact at `poc/signals/TASK-KILO-GIT-COMPLETION-SIGNAL-EMITTER-IMPLEMENT-001.json` (`commit_sha: null`, `push: true`). Signal emitter focused tests: 41/41 pass (`test/signal-emitter.test.js`). Existing github-webhook regression tests: 77/77 pass. Consumer/emitter relationship verified via code inspection: emitter sets `commit_sha: null`; consumer assigns authoritative SHA via `head_commit.id` in `buildCompletionReport(signal, headCommitSha)` (consistent with commit-SHA hardening commit `f63211d`). Test count discrepancy: signal artifact claims 337 regression across 12 suites (total 378) but actual regression count is 369 across 16 test suites (total 410); the reported 379-test result is NOT verified against available evidence. Live end-to-end validation (GitHub push ↠ Render webhook ↠ Gemini dispatch): NOT verified — tests use mocks, not live API calls. `git diff --check` clean. No protected files modified. |
| Apps Script authentication hardening | **BACKLOG** | — | Require shared secret for Node → Apps Script action boundary |
| Abandoned-booking idempotency | **BACKLOG** | — | Durable duplicate-alert prevention needed |
| Webhook signature verification | **BACKLOG** | — | Tally / Cal.com event-ID deduplication |
| Email template ownership migration | **BACKLOG** | — | Move template selection to Render, retain Gmail delivery in Apps Script |
| Automated testing infrastructure | **BACKLOG** | — | Tests, fixtures, contract tests, formal test script |
| Git completion-signal Path 2 architectural direction (Issue #172) | **IMPLEMENTED / VERIFIED** | Kilo | Path 2 implemented: Git/GitHub as durable completion/recovery evidence with TaskRegistry as runtime orchestration state. When TaskRegistry state is absent (`taskRegistry.getTask(requestId)` returns null), `poc/github-webhook.js` `recoverTaskFromGitHub()` retrieves the authoritative ACP task from the GitHub issue body (correlated by exact `request_id`), validates it via `validateACPCommand` + `validateAuthorization`, requires commit/push capabilities for the execution path, rehydrates a TaskRegistry entry via `taskRegistry.rehydrateTask()`, then continues through the existing Kilo-completion → Gemini flow. Fail-closed on GitHub issue absence, request_id mismatch, validation/authorization failure, and missing token. ADR-016 updated to record implementation status. 347 total tests pass (77 github-webhook + 270 regression). |
| RESEARCH_DOCUMENT task mode implementation (Issue #198, TASK-KILO-RESEARCH-DOCUMENTATION-SOP-IMPLEMENT-001) | **IMPLEMENTED / VERIFIED** | Kilo | Added `RESEARCH_DOCUMENT` as a new runtime-valid task mode in `poc/schemas/acp-schema.js` (`VALID_TASK_MODES`). Required fixed capability set: `read_only`, `modify_files`, `commit`, `push` (exact match enforced; `run_tests` not permitted). Authorized paths restricted to research/documentation surface: `docs/ai/research/`, `docs/ai/RESEARCH_INDEX.md`, `docs/ai/TASK_LOG.md`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/README.md`, `docs/ai/ARCH_DECISIONS.md`, plus `poc/schemas/acp-schema.js` and `test/schema.test.js`. Removed `RESEARCH` from `TASK_STANDARD.md` (it was never a runtime schema mode — pure documentation removal, no production path breaks). Created `docs/ai/research/` directory, `docs/ai/RESEARCH_INDEX.md` index, and first research record. Updated `KILO_INTEGRATION.md`, `docs/ai/README.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/TASK_LOG.md`. `prefix matching` added to `validatePermittedPathsForMode` for directory paths (backward compatible). Tests: 46 schema + 67 verify-reconcile pass; full suite 483 tests pass across 18 test files. Research record: `docs/ai/research/research-TASK-KILO-RESEARCH-DOCUMENTATION-SOP-IMPLEMENT-001.md`. |

## Gemini Builder Transition Status

| Capability | Status | Notes |
|------------|--------|-------|
| Gemini Builder execution infrastructure | **COMPLETED / VERIFIED** | `.github/workflows/gemini-builder.yml` created with `GEMINI_BUILDER_API_KEY`; `gemini-acp-report` artifact, git commit/push, and callback to Render in same execution. Implementation commit `f1e21ec`; tests commit `53dfa23`; merged via `8a56fe6`. |
| Gemini Builder modify/commit/push | **COMPLETED / VERIFIED** | BUILDER mode with `read_only,modify_files,run_tests,commit,push` capabilities; commit and push step in workflow. |
| Separate Builder/Reviewer identities | **COMPLETED / VERIFIED** | Builder uses `GEMINI_BUILDER_API_KEY` / `BUILDER_CALLBACK_SECRET` / `RENDER_BUILDER_CALLBACK_URL`; Reviewer uses `GEMINI_API_KEY` / `GEMINI_CALLBACK_SECRET` / `RENDER_GEMINI_CALLBACK_URL`. |
| ACP/provider independence | **COMPLETED / VERIFIED** | Builder dispatch does not require `kilo_execution_id`; `builder_execution_id` input added to both workflows. |
| Builder dispatch without Kilo prerequisite | **COMPLETED / VERIFIED** | `poc/gemini-builder-trigger.js` dispatches `gemini-builder.yml` without `kilo_execution_id` required; `validateDispatchInputs` does not require `kilo_execution_id`. |
| Orchestrator Builder lifecycle | **COMPLETED / VERIFIED** | `canTriggerGeminiBuilder`, `triggerGeminiBuilder`, `handleGeminiBuilderCompletion` added; Kilo completion triggers Builder; Builder completion triggers Reviewer. |
| Builder callback route | **COMPLETED / VERIFIED** | `POST /poc/builder/callback` with `x-builder-callback-secret` authentication; `/poc/builder/dispatch` for direct ACP → Builder dispatch. |
| Task registry builder slot | **COMPLETED / VERIFIED** | `builder` slot added to task registry entry and `updateAgentResult`. |

---


**Issue**: #172
**Task**: TASK-KILO-GIT-COMPLETION-SIGNAL-PATH-2-RECOVERY-IMPLEMENTATION-001
**Status**: IMPLEMENTED / VERIFIED
**ADR**: ADR-016 in `docs/ai/ARCH_DECISIONS.md` (updated from APPROVED/PROPOSED/TARGET to record implementation)

### Context

The Git-based Kilo completion-signal POC (Issue #162, commit `bf68116`) is **IMPLEMENTED / VERIFIED (UNDER VALIDATION)**. The self-referential commit-SHA defect was **RESOLVED** by commit `f63211d` (TASK-KILO-GIT-COMPLETION-SIGNAL-COMMIT-SHA-HARDENING-002). A controlled live-validation signal exists (commit `f9d97e5`).

**Previously**: The Git completion-signal processing path (`poc/github-webhook.js` `processSignalFile()`) had a hard dependency on **ephemeral TaskRegistry state**. When `taskRegistry.getTask(requestId)` returned `null` (TaskRegistry state lost), the signal was rejected at the `registry` stage, even though all durable evidence of the task existed in Git/GitHub.

**Now implemented**: Path 2 recovery breaks this hard dependency. When TaskRegistry state is absent, `recoverTaskFromGitHub()` retrieves the authoritative ACP task from the GitHub issue body (correlated by exact `request_id`), validates it, rehydrates a TaskRegistry entry, then continues through the existing Kilo-completion → Gemini flow.

### Durable Evidence vs. Runtime Orchestration State

| Layer | Role | Implementation | Durability |
|-------|------|---------------|------------|
| **Git/GitHub** | Durable completion/recovery evidence | Signal artifact `poc/signals/<request_id>.json`; GitHub push webhook; GitHub issue body (ACP task); Git commit metadata | Durable — persisted in GitHub |
| **TaskRegistry** | Runtime orchestration state | `poc/task-registry.js` → `poc/task-registry.json` (local file) | Ephemeral — lost on container restart |

### Path 2 (Implemented)

Use **Git/GitHub as durable completion/recovery evidence** while **retaining TaskRegistry as runtime orchestration state**. When TaskRegistry state is absent, **reconstruct task context from durable Git/GitHub evidence** (Git-derived recovery/rehydration) rather than rejecting the signal.

**Recovery flow**:
1. `processSignalFile()` detects TaskRegistry state absent (`getTask` returns null)
2. `recoverTaskFromGitHub(requestId, token)` searches GitHub issues by title (exact `request_id`), fetches the issue body
3. `parseACPCommandFromIssueBody()` parses the ACP Envelope, Capabilities, permitted paths, Objective, and Verification from the issue body markdown
4. `validateACPCommand()` validates the recovered command as an ACP command
5. `validateAuthorization()` validates task_mode, capabilities, and permitted_paths
6. Execution-path authorization check: requires `commit` and `push` capabilities
7. `taskRegistry.rehydrateTask()` constructs the minimum valid TaskRegistry entry and transitions PENDING → SELECTED → PLANNED → EXECUTING
8. `processSignalFile()` continues through the existing completion/orchestration path (`buildCompletionReport` → `orchestrator.handleKiloCompletion` → `orchestrator.triggerGemini`)

**Path 1 (not selected)**: External durable persistence (Postgres/Redis) to make TaskRegistry itself durable. Deferred per Solution Simplicity Gate — Path 2 reuses the existing Git evidence layer without new infrastructure.

### Normal path (TaskRegistry present — preserved)

```
Kilo completes → Kilo commit/push → GitHub push event → POST /poc/github/webhook
→ signal artifact detected → TaskRegistry correlation → orchestrator.handleKiloCompletion()
→ orchestrator.triggerGemini() → GitHub workflow_dispatch → Gemini
```

### Recovery path (TaskRegistry absent — IMPLEMENTED)

```
Kilo completes → Kilo commit/push → GitHub push event → POST /poc/github/webhook
→ signal artifact detected → TaskRegistry absent → recoverTaskFromGitHub()
   → fetch GitHub issue by request_id → parse ACP command from issue body
   → validateACPCommand + validateAuthorization + execution-path cap check
   → taskRegistry.rehydrateTask() (PENDING → SELECTED → PLANNED → EXECUTING)
   → orchestrator.handleKiloCompletion() → orchestrator.triggerGemini() → Gemini
```

### Security Boundary (Enforced)

Discovering a `request_id` in a Git signal is **task identity evidence, not authorization**. Recovery does not grant authorization from `request_id` discovery. The recovered ACP task must:
- Pass `validateACPCommand` (all required fields present)
- Pass `validateAuthorization` (valid task_mode, capabilities, permitted_paths)
- Have exact `request_id` correlation with the signal
- Authorize the execution path (include `commit` and `push` capabilities)

If any check fails, recovery fails closed and the signal is rejected. Authorization remains governed by the ACP command envelope, not by task identity recovery.

### Preserved

Existing Kilo → Gemini lifecycle, polling (`poc/kilo-polling.js`), callback (`POST /poc/kilo/callback`), Kilo HTTP trigger dispatch (`POST /poc/kilo`), ACP authorization boundary, and specialist lane boundaries (Gemini, Security AI, Utility AI) are all preserved. Path 2 does not replace or bypass TaskRegistry — it adds a recovery path into it.

---

## Git-Based Kilo Completion-Signal Emitter (Issue #180) — IMPLEMENTED / VERIFIED (UNDER VALIDATION)

**Issue**: #180
**Task**: TASK-KILO-GIT-COMPLETION-SIGNAL-EMITTER-IMPLEMENT-001
**Status**: IMPLEMENTED / VERIFIED (UNDER VALIDATION)
**Commit**: `7bec05817e9209bf934d6f73babccdcfe93492c5` on `main`

**Objective**: Implement the Kilo completion-signal emitter identified by Gemini research. At Kilo task completion, the emitter creates a durable Git evidence file at `poc/signals/<request_id>.json` containing the completion signal, which is then committed and pushed to `main` so the existing GitHub push webhook consumer (`poc/github-webhook.js`) can correlate the completion and trigger the existing Gemini handoff.

**Implementation verified**:
- `poc/signal-emitter.js` (185 lines) — `buildSignal()` constructs a compliant completion signal envelope with `commit_sha: null` (the emitter does not know its own commit SHA; the consumer assigns the authoritative SHA from `head_commit.id`); `validateSignalConformance()` calls `validateSignal()` from `poc/github-webhook.js` to enforce the existing consumer contract; `checkForConflict()` enforces duplicate/conflicting signal prevention; `emitCompletionSignal()` validates, checks conflicts, and writes the signal file.
- `poc/signals/TASK-KILO-GIT-COMPLETION-SIGNAL-EMITTER-IMPLEMENT-001.json` (39 lines) — committed signal artifact containing a `status: "success"` signal with `commit_sha: null`, `push: true`, and verification claims.
- `test/signal-emitter.test.js` (468 lines) — 41 focused tests covering signal construction, contract conformance, file writing, duplicate/conflict prevention, path regex consistency, and end-to-end integration with the consumer's `findSignalFiles()` and `validateSignal()`.

**Consumer/emitter relationship — VERIFIED via code inspection**:
- Emitter writes `commit_sha: null` (poc/signal-emitter.js:36). Consumer assigns authoritative SHA via `buildCompletionReport(signal, headCommitSha)` where `headCommitSha = head_commit.id` from the GitHub push event (poc/github-webhook.js:265-282). This is consistent with commit `f63211d` commit-SHA hardening.
- Signal path regex and `findSignalFiles()` in the consumer are consistent with the emitter's file write location (`poc/signals/<request_id>.json`).
- `validateSignal()` in the consumer is imported by the emitter, ensuring the signal conforms to the consumer's validation contract before it is written.

**Test verification — VERIFIED (with discrepancy noted)**:
- Signal emitter focused tests: **41/41 pass** (`test/signal-emitter.test.js`).
- Existing github-webhook regression tests: **77/77 pass**.
- Total across all test suites: **410 tests pass** (369 regression + 41 signal-emitter), distributed across 17 test files:
  - `test/schema.test.js` (20), `test/task-registry.test.js` (18), `test/orchestrator.test.js` (19), `test/integration.test.js` (11), `test/gemini-trigger.test.js` (14), `test/gemini-callback.test.js` (23), `test/kilo-callback.test.js` (15), `test/kilo-polling.test.js` (10), `test/kilo-verifier.test.js` (18), `test/verify-reconcile.test.js` (52), `test/github-webhook.test.js` (77), `test/coordinator.test.js` (19), `test/chatbox-gateway.test.js` (23), `test/workflow-expression.test.js` (29), `test/signal-emitter.test.js` (41), `poc/test.js` (16), `test/run-poc-tests.js` (5).
- **Test count discrepancy**: The committed signal artifact (`poc/signals/TASK-KILO-GIT-COMPLETION-SIGNAL-EMITTER-IMPLEMENT-001.json`) claims "337 total tests across 12 suites" for regression (total 378). The independently verified actual regression count is 369 across 16 test files (total 410). The "379-test result" referenced in Issue #181 does not match either the artifact's 378 or the actual 410. The discrepancy is not reconciled — likely a counting error in Kilo's original test run.

**Live end-to-end validation — NOT VERIFIED**:
- The signal artifact was committed and pushed to `main` in commit `7bec058`, but this does not prove the full end-to-end flow (GitHub push webhook ↠ Render webhook ↠ signal processing ↠ Gemini dispatch) was exercised.
- All signal-emitter tests use mock fetch and file-system interactions, not live GitHub API calls.
- The existing live validation signal (`TASK-KILO-GIT-COMPLETION-SIGNAL-LIVE-VALIDATION-002.json`, commit `f9d97e5`) committed and pushed a signal file but did not independently verify webhook consumer processing.
- Live end-to-end validation remains an outstanding validation requirement.

**`git diff --check` — clean (no whitespace errors).**

**Protected files — none modified**: `AGENTS.md`, `GEMINI.md`, `ARCHITECTURE.md`, production code (`index.js`, `routes/poc.js`), GitHub workflows (`.github/workflows/*.yml`), `openclaw-render.json` — all unchanged by commit `7bec058`.

---

## Kilo → Gemini End-to-End System Test — Task Record

**Task**: TASK-KILO-GEMINI-END-TO-END-SYSTEM-TEST-001 (EXECUTE mode, base branch `main`, GitHub Issue #161)

**Status**: **EXECUTING (Kilo phase complete)**

**Objective**: System-validation task exercising the current Kilo → repository-controlled polling → TaskRegistry → `handleKiloCompletion()` → `orchestrator.triggerGemini()` → Gemini `workflow_dispatch` → Gemini execution → result artifact/callback path end-to-end. Authorized change: `docs/ai/STATE.md` only.

**Authorized change made**: Added this test-task state record to `docs/ai/STATE.md` identifying `TASK-KILO-GEMINI-END-TO-END-SYSTEM-TEST-001`. Active Tasks table row added. Header `Last Updated`/`Updated By` updated.

**Verification (Kilo phase)**:
1. All 259 existing tests pass (23 chatbox-gateway, 19 coordinator, 23 gemini-callback, 14 gemini-trigger, 11 integration, 15 kilo-callback, 10 kilo-polling, 18 kilo-verifier, 19 orchestrator, 20 schema, 18 task-registry, 52 verify-reconcile, workflow-expression, POC).
2. `git diff --check` clean.
3. Final diff contains only the authorized `docs/ai/STATE.md` change.

**Lifecycle evidence (Kilo phase)**:
- Kilo execution completed: **VERIFIED** — Kilo executed this authorized ACP task and made the authorized STATE.md change.
- Kilo completion delivered to orchestration: **UNKNOWN** (downstream via repository-controlled polling).
- Repository-controlled polling/completion processing: **VERIFIED (implementation present)** — `poc/kilo-polling.js` `pollKiloCompletion`/`processKiloCompletion` implemented; 10 polling + 15 callback tests pass.
- TaskRegistry recognition: **VERIFIED (implementation present)** — `request_id`-keyed persistence; `getTasksByStatus` used by polling.
- Orchestrator recognition: **VERIFIED (implementation present)** — `handleKiloCompletion()` → `next_action='trigger_gemini'` → `orchestrator.triggerGemini()`; integration tests pass.
- Gemini dispatch acceptance: **VERIFIED (implementation present)** — `gemini-trigger.js` dispatches via `workflow_dispatch`; 14 trigger tests pass.
- Gemini workflow execution: **UNKNOWN** (downstream GitHub Actions; outside Kilo execution boundary).
- Gemini result artifact/callback processing: **VERIFIED (implementation present)** — false-success path repaired (commit `892386d`, 23 callback + 9 workflow-expression tests pass).
- Complete Kilo → Gemini end-to-end result: **UNKNOWN** (requires downstream Gemini execution).

Kilo reports execution completion separately from downstream orchestration/Gemini completion. Downstream lifecycle state is inferred from implementation presence (VERIFIED), not from live execution observation (UNKNOWN) — only verified against the repository/runtime where available.

---

## Kilo ↔ Gemini Post-Dispatch Result Lifecycle Repair — Reconciliation Status

**Task**: TASK-KILO-GEMINI-POST-DISPATCH-RESULT-LIFECYCLE-IMPLEMENT-001 (EXECUTE mode, base branch `main`)

**Status**: **IMPLEMENTED / VERIFIED (Independently Verified by Gemini 2026-09-19)**

**Objective**: Repair the false-success path in `.github/workflows/main.yml` where the Gemini callback payload was hardcoded to `status: "success"` and `RECON_STATUS="COMPLETED"` regardless of actual Gemini execution outcome.

**Implementation**:
- Added "Determine Gemini execution result" step (`steps.gemini_result`) that reads `steps.gemini_run.outcome` and sets `gemini_status` (SUCCESS/FAILURE), `verification_status` (PASS/FAIL), `blocker_message`, and `recon_status` based on the real outcome
- `RECON_STATUS` now follows `determineReconciliationStatus()` contract: VERIFY_RECONCILE + PASS → COMPLETED; VERIFY_RECONCILE + FAIL → SKIPPED; other modes → SKIPPED
- Added `if: always()` to artifact persistence steps (`Persist Gemini result as artifact`, `Upload Gemini result artifact`)
- Added `if: always()` to `Prepare callback payload` and `Send callback to Render` steps
- `STATUS` now derives from `steps.gemini_result.outputs.gemini_status` instead of hardcoded `"success"`
- Added `gemini_output` field to callback payload containing the actual CLI output
- Callback is now sent even on Gemini execution failure (`if: always()`)

**Independent Verification (Gemini 2026-09-19)**:
- Verified commit `892386da746ed2e0df829aef6039d906929a2940` exists on `main`.
- Confirmed repair of false-success callback path via `steps.gemini_run.outcome` usage in `main.yml`.
- Verified `if: always()` on callback/artifact steps ensures delivery on Gemini failure.
- Verified callback payload correctly includes `gemini_output`.
- Independent verification PASS: The implementation resolves the false-success condition.

**Verification**:
1. 9 new workflow-expression tests pass (23 tests in suite)
2. 3 new gemini-callback tests pass (23 tests in suite)
3. All regression test suites pass: schema (20), task-registry (17), orchestrator (18), integration (11), gemini-trigger (14), gemini-callback (23), kilo-callback (15), kilo-polling (10), kilo-verifier (18), verify-reconcile (52), poc/test.js (16), coordinator (19) = 270 total
4. `git diff --check` clean
5. No secrets/credentials introduced

**Protected files preserved**: AGENTS.md, ARCHITECTURE.md, GEMINI.md, `codex-builder.yml`, `kilo-gemini-poc.yml`, `kilo-verification.yml`, all production code (`index.js`, `routes/poc.js`, `poc/*.js`, `workflows/abandonedBooking.js`)

---

## Architectural Standardization Audit Items

Items identified by the latest Gemini audit. These are architectural/project-tracking
items, **not** authorization to implement the architecture. None of these items
represent implemented functionality.

| # | Item | Classification | Owner | Notes |
|---|------|----------------|-------|-------|
| 1 | ACP Protocol Standardization | **CURRENT / IMPLEMENTED (Foundation)** | Kilo | ACP schema validation implemented in `poc/schemas/acp-schema.js`. Validates ACP command envelope, execution reports, and task registry entries. |
| 2 | ACP Router / Dispatcher | **PROPOSED / TARGET** | — | Build the structured ACP command parser and dispatcher; establish routing of authorized tasks to specialist/execution lanes. |
| 3 | Structured AI Task Reporting | **CURRENT / IMPLEMENTED (Foundation)** | Kilo | Machine-readable execution report validation implemented in `poc/schemas/acp-schema.js`. Canonical report shape validated for both Kilo and Gemini. |
| 4 | Capability-Based Authorization | **CURRENT / IMPLEMENTED** | Kilo | ACP command validation enforces explicit capabilities and permitted paths in `poc/schemas/acp-schema.js` and `poc/acp-engine.js`. Extended with task modes (REVIEW/VERIFY_RECONCILE/FAILOVER_EXECUTE), per-mode capability sets, and bounded docs/ai path authorization for VERIFY_RECONCILE. |
| 5 | AI Project State Automation | **CURRENT / IMPLEMENTED** | — | The `docs/ai/` system (STATE.md, ARCH_DECISIONS.md, TASK_LOG.md, README.md) is created, functional, and integrated into AGENTS.md. `STATE.md` remains the human-readable authoritative project-state view unless the architecture establishes a more appropriate authoritative source. |
| 6 | Agent Activation / Trigger Architecture | **CURRENT / IMPLEMENTED** | — | Kilo activation is a confirmed Kilo Cloud Agent capability (ARCHITECTURE.md Section 16.5.6). Activation mechanism: Kilo-provider-controlled HTTP webhook trigger, dispatched from repository via `/poc/kilo` endpoint and `poc/kilo-transport.js`. The exact provider completion/callback mechanism remains an implementation dependency to verify. Do not infer activation from GitHub workflow existence alone. **Kilo activation boundary (verified 2026-09-14)**: Kilo is NOT activated by a repository GitHub Actions workflow. The repository documents Kilo as an external Kilo Cloud Agent with an externally configured HTTP webhook trigger. The external Kilo prompt treats GitHub webhook events as external event envelopes, not instructions. The repository must not invent a new `@kilo` GitHub Actions workflow to compensate for an external Kilo activation/execution timeout. |
| 7 | Agent Communication / Transport Layer | **PROPOSED / TARGET** | — | Define the standardized transport mechanism for agent-to-agent communication. Accounts for the existing Kilo HTTP trigger POC and the planned Qwen → ACP → specialist flow. |
| 8 | Asynchronous / Long-Running Task Handling | **CURRENT / IMPLEMENTED (Foundation)** | Kilo | TaskRegistry in `poc/task-registry.js` provides persistent correlation state with request_id, supporting async execution across Kilo and Gemini lanes. |
| 9 | Failover Authorization | **PROPOSED / TARGET** | — | Define how ACP authorization remains valid and controlled during agent failover scenarios. See `ARCHITECTURE.md` Section 18. |
| 10 | Kilo HTTP Trigger Secret Rotation | **PROPOSED / TARGET** | — | Define the mechanism and lifecycle for rotating shared secrets used by the Kilo HTTP trigger. Rotation must not be performed during this task. |
| 11 | Automated Kilo Delivery Verification | **CURRENT / IMPLEMENTED** | Kilo | Independent verification lane implemented in `poc/kilo-verifier.js`, `.github/workflows/kilo-verification.yml`, `test/kilo-verifier.test.js`. Kilo's self-report remains execution evidence; the verifier provides independent verification of delivered ref/commit, changed files, request_id correlation, and git diff --check. See implementation task #49. |
| 12 | Gemini Verification Requirements Propagation | **CURRENT / IMPLEMENTED** | Kilo | Verification field added to ACP command schema, TaskRegistry entry, orchestrator, gemini-trigger, and GitHub Actions workflow. Verification requirements now flow: ACP command → TaskRegistry → orchestrator → gemini-trigger → GitHub Actions workflow → Gemini reviewer prompt. Implemented in commit `736ae3faf4d4ea75b22df8b85a6186dcdde91f59`; artifact persistence in `748ba91722ecbad6aaeaca5a084384862aabb6df`; prompt fix in `53f1a3fbd5c2fd0777397a0a139614d1fe92ba05`. Gemini independently verified functional. |

---

## Current Blockers

1. **Apps Script trust boundary** — Anonymous web app endpoint accepts CRM writes and Gmail delivery without application-level authentication. Hardening required before other reliability work.
2. **Chatbox → Render integration gap (Live)** — Chatbox returned `Network Error: Load failed (openclaw-webhook-iz6s.onrender.com)` when sending a message through `CHATBOX_GATEWAY` to `POST /poc/chatbox`. Root cause: **UNKNOWN**. This is an observed live test result, not a verified repository defect. The `/poc/chatbox` route is implemented and 26/26 gateway tests pass, but no end-to-end Chatbox → Render request is verified as successful. See the DeepSeek + Chatbox Integration State section above for the required investigation plan.
3. **OpenRouter DeepSeek V4 Pro token/credit issue (Live)** — OpenRouter test requests for DeepSeek V4 Pro request up to 131,072 tokens despite the Chatbox editor displaying 8,000 Max Output Tokens, and are rejected with HTTP 402 due to insufficient OpenRouter credits. **VERIFIED externally observed**; not a repository defect (no repository code controls Chatbox max-token behavior or OpenRouter credit allocation).
4. **Automated test suite** — **IMPLEMENTED**. 450/450 tests pass across 18 test files (correcting the prior stale entry). See Task Status above.
5. **Legacy abandoned-booking code** — `google-apps-script/AbandonedBookings.js` exists but architectural status unclear; needs deployment verification before retirement.

---

## Upcoming / Backlog Items

### High Priority (Post-Hardening)
- Implement shared-secret authentication for Node → Apps Script boundary
- Add idempotency keys to abandoned-booking workflow
- Standardize Apps Script response handling

### Medium Priority
- Complete webhook signature verification for Tally and Cal.com
- Resolve duplicate `sendClientEmail` in Code.js and Email.js
- Build automated testing infrastructure

### DeepSeek + Chatbox Integration (Pending Investigation)
- **What does Chatbox actually send?** — Capture the actual HTTP request (method, URL/path, auth header, body, model field, messages structure, max-token behavior) when using `CHATBOX_GATEWAY`. (Investigation Q1)
- **What does `/poc/chatbox` expect vs. return?** — Document the exact request contract and confirm whether the success response is an OpenAI chat-completion response or an ACP task-dispatch acknowledgement. (Investigation Q2, Q3, Q4)
- **Contract mismatch analysis** — Compare the Chatbox OpenAI-compatible provider contract with the current `/poc/chatbox` implementation to determine whether the intended bridge already exists or whether there is a contract mismatch. (Investigation Q5, Q6)
- **Intended operational path validation** — Determine whether the intended path `Chatbox → OpenRouter → DeepSeek → authenticated control-plane bridge → ACP → Gemini Builder/Kilo → GitHub` is realized, and document any verified deviation. (Investigation Q8)
- **OpenRouter credit resolution** — Resolve the 131,072-token vs. 8,000-displayed discrepancy and the resulting HTTP 402 rejection for DeepSeek V4 Pro.

### Lower Priority / Architectural
- Kilo ↔ Gemini orchestration backbone implementation — **Part 1 Foundation IMPLEMENTED**; **Part 2 Automatic Gemini trigger after Kilo completion IMPLEMENTED / VERIFIED** (source commit `6c92a9a`, 103/103 tests pass); **Part 2.2 Kilo completion/result delivery IMPLEMENTED / VERIFIED** (source commit `2e9355d`, main commit `ebb8e9e`, 133/133 tests pass); see `docs/ai/KILO_GEMINI_ORCHESTRATION_PLAN.md`. Part 2.1b (Gemini workflow dispatch) IMPLEMENTED / VERIFIED (commit `5f49f99`, 14 Gemini trigger tests pass); remaining Part 2.1 items (authenticated Gemini return path to Render) remain PROPOSED / TARGET per `KILO_GEMINI_ORCHESTRATION_PLAN.md`.
- Automated Kilo delivery verification — **IMPLEMENTED / VERIFIED**; a persistence gate still exists in `.github/workflows/kilo-gemini-poc.yml`, and the independent Kilo delivery verification lane (`poc/kilo-verifier.js`, `.github/workflows/kilo-verification.yml`, `test/kilo-verifier.test.js`) provides full independent verification (delivered ref/commit, changed files, authorized file scope, request_id correlation, git diff --check, idempotency). Triggers on push to main and pull request events; 18 tests pass; `git diff --check` clean. Future extension may build on the existing orchestration/project-state architecture rather than create a second task system. See implementation task #49.
- Gemini verification requirements propagation — **IMPLEMENTED**; verification field flows ACP command → TaskRegistry → orchestrator → gemini-trigger → GitHub Actions → Gemini reviewer prompt. Independent Gemini verification confirmed.
- LINE-centered AI operating model (PROPOSED / TARGET)
- Qwen Router implementation (UNDER VALIDATION)
- Security AI lane definition (**PROPOSED / TARGET** — architectural foundation established per Issue #38)
- Utility AI lane definition (PROPOSED / TARGET)
- ACP protocol implementation — **Foundation IMPLEMENTED**; schema validation and execution report validation complete. Full protocol implementation remains PROPOSED / TARGET.
- **ChatGPT Control Gate** — RESEARCH COMPLETE / PROPOSED / PENDING FUTURE EXECUTION. Full architectural research preserved in `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`. Research covers: Control Gate layer between ChatGPT and execution backbone, policy/architecture/authorization enforcement model, GitHub enforcement (CODEOWNERS, branch protection, status checks), fail-closed blocking states, implementation phases, security considerations, and acceptance criteria. **No implementation authorized or performed.**
- **Render Control Gate / Gatekeeper** — PROPOSED / TARGET architecture component. **Not currently implemented.** Render's future role is specifically a machine-enforced authorization and policy boundary between ChatGPT and repository execution. The Control Gate is intended to determine whether an AI-originated repository action is authorized to proceed. Responsibilities include: policy compliance, architectural alignment, explicit Kyle authorization, target existence and authorization, permitted paths/scope, permitted capabilities, ACP schema validity, fail-closed handling of invalid/unauthorized requests, request correlation and auditability through `request_id`, prevention of execution outside authorized ACP scope, secret/credential exclusion, preservation of repository/GitHub safeguards. Status: Control Gate research complete; Control Gate architecture PROPOSED / TARGET; Control Gate implementation not implemented; Control Gate enforcement not currently active. Layer 1 (existing Kilo↔Gemini orchestration backbone stabilization/hardening) is prerequisite. Layer 2 (Render Control Gate introduction) is future work after Layer 1. Existing Kilo/Gemini architecture is protected and must not be redesigned or replaced.

---

## Render Control Gate / Gatekeeper — Architectural Target (PROPOSED / TARGET)

This section records the intended future execution boundary as documented in the completed Control Gate research (`docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`) and the current reconciliation task.

### Future Execution Boundary

```
ChatGPT
    ↓
Render Control Gate / Gatekeeper (PROPOSED / TARGET)
    ↓
Validated / Authorized Existing Orchestration Boundary
    ↓
Existing ACP / TaskRegistry / Orchestrator
    ↓
Existing Kilo / Gemini Activation
    ↓
Execution
    ↓
Existing Callbacks / Results / Delivery Verification
```

### Control Gate Responsibilities (PROPOSED / TARGET)

The documentation must accurately capture the researched intended responsibilities:

- **Policy compliance** — Validates requests against CHATGPT_POLICY.md and operational procedures
- **Architectural alignment** — Validates scope against ARCHITECTURE.md rules and boundaries
- **Explicit Kyle authorization** — Verifies Kyle has explicitly authorized the task in current repository context
- **Target existence and authorization** — Verifies requested repository targets exist or are permitted to be created
- **Permitted paths / scope** — Enforces `permitted_paths` allow-list from ACP command
- **Permitted capabilities** — Enforces explicit capabilities (read_only, modify_files, commit, push, run_tests)
- **ACP schema validity** — Validates ACP command envelope against versioned schema
- **Fail-closed handling** — Rejects invalid or unauthorized requests under all failure conditions
- **Request correlation and auditability** — Correlates all actions through `request_id`
- **Prevention of execution outside authorized ACP scope** — Blocks any operation not covered by granted capabilities
- **Secret / credential exclusion** — Filters all request payloads to guarantee no credentials pass through
- **Preservation of repository/GitHub safeguards** — Maintains CODEOWNERS, branch protection, status checks

The Gate passes only a validated and authorized task into the existing execution architecture.

### Two-Layer Sequence (CRITICAL)

#### LAYER 1 — FIRST (Prerequisite)

The existing Kilo↔Gemini execution architecture must first be stabilized, reconciled, and hardened **at its existing boundaries**.

Layer 1 includes the existing work around:
- ACP schema / engine
- TaskRegistry
- Orchestrator
- Kilo transport
- Gemini trigger
- Existing Kilo activation
- Existing Gemini activation
- Callbacks / completion handling
- `request_id` correlation
- Execution reporting
- Delivery verification
- Part 2
- Part 2.1
- Part 2.2
- Authenticated machine-readable Gemini return path to Render

Layer 1 is the prerequisite for Layer 2.

**This task does NOT implement Layer 1.**

#### LAYER 2 — AFTER LAYER 1

Once Layer 1 is stable, the future Render Control Gate is introduced upstream:

```
ChatGPT
    ↓
Render Control Gate
    ↓
Validated / Authorized Existing Orchestration Boundary
    ↓
Existing ACP / TaskRegistry / Orchestrator
    ↓
Existing Kilo / Gemini Activation
    ↓
Execution
    ↓
Existing Callbacks / Results / Delivery Verification
```

The Control Gate integrates with the existing architecture.
It does **not** replace the Kilo↔Gemini architecture.

### Critical Architectural Protection

The following must be preserved and must NOT be redesigned, replaced, migrated, or reinterpreted:

- Kilo activation path
- Gemini activation path
- GitHub Actions integration
- ACP
- TaskRegistry
- Orchestrator
- Kilo transport
- Gemini trigger
- Callback paths
- `request_id` correlation
- Part 2.2 return path
- Delivery verification

An earlier discussion considered `workflow_dispatch` as a possible GitHub handoff mechanism.

**Do not establish `workflow_dispatch` as a new architectural requirement.**

If `workflow_dispatch` exists in current implementation, document it only as verified current implementation-specific behavior.

Do not replace the existing activation architecture with it.

### Status Summary

- Control Gate research: **COMPLETE**
- Control Gate architecture: **PROPOSED / TARGET**
- Control Gate implementation: **NOT IMPLEMENTED**
- Control Gate enforcement: **NOT CURRENTLY ACTIVE**
- Layer 1: **PREREQUISITE** (must stabilize/harden first)
- Layer 2: **FUTURE WORK** (after Layer 1)
- Existing Kilo/Gemini architecture: **PROTECTED**

Do not describe the Control Gate as currently implemented or operational.

---

## DeepSeek + Chatbox Integration State (Current)

**Status**: Configuration complete; live end-to-end bridge NOT yet verified.
**Updated By**: Kilo — VERIFY_RECONCILE (TASK-KILO-DEEPSEEK-CHATBOX-PROGRESS-LOG-VERIFY-RECONCILE-001)

### State Classification Convention

All entries below use one of four status labels to distinguish evidence classes:

- **VERIFIED repository state** — Present and confirmed in current repository code or Git state.
- **VERIFIED externally observed** — Confirmed by an authorized agent inspecting live external configuration/testing (Chatbox UI, OpenRouter dashboard, live test output). Not repository code.
- **INFERRED** — Reasoned from verified facts but not directly confirmed by code inspection or external observation.
- **UNKNOWN** — Not yet determined; requires investigation.

### Current Operational Path (Externally Observed)

**VERIFIED externally observed** — Chatbox iOS currently reaches DeepSeek via OpenRouter using an OpenAI-compatible interface:

```
Chatbox iOS → OpenRouter → DeepSeek
```

This existing path is **not** the repository's `/poc/chatbox` gateway ingress. The repository DeepSeek Coordinator ingress is the separate `POST /poc/coordinator` endpoint (`routes/poc.js`), documented in `ARCHITECTURE.md` Section 16.6 and ADR-016 of `ARCH_DECISIONS.md`.

### CHATBOX_GATEWAY Custom Provider Configuration (Externally Observed)

**VERIFIED externally observed** — Kyle created a separate Chatbox custom provider named `CHATBOX_GATEWAY` to bridge Chatbox directly to the repository's Render-hosted ingress:

| Field | Value |
|-------|-------|
| **API Mode** | OpenAI API Compatible |
| **API Host** | `https://openclaw-webhook-iz6s.onrender.com` |
| **API Path** | `/poc/chatbox` |
| **Preview endpoint** | `https://openclaw-webhook-iz6s.onrender.com/poc/chatbox` |

**Note**: The `API Host` and `Preview endpoint` values are observed Render deployment URLs. They are recorded here as configuration observations and must not be treated as secret values. The Render environment variable `CHATBOX_GATEWAY_SECRET` is configured as the gateway authentication boundary. **The secret value is NOT recorded anywhere in this documentation.**

### DeepSeek V4 Pro Model Configuration (Externally Observed)

**VERIFIED externally observed** — DeepSeek V4 Pro was configured in Chatbox under the `CHATBOX_GATEWAY` provider:

| Field | Value |
|-------|-------|
| **Model ID** | `deepseek/deepseek-v4-pro` |
| **Nickname** | DeepSeek V4 Pro |
| **Model Type** | Chat |
| **Context Window** | 1,048,576 |
| **Max Output Tokens (displayed in editor)** | 8,000 |
| **Reasoning** | enabled |
| **Tool use** | enabled |

**Important distinction**: Configuring `deepseek/deepseek-v4-pro` under `CHATBOX_GATEWAY` does **NOT** mean Chatbox is using the existing OpenRouter connection. The `CHATBOX_GATEWAY` provider endpoint routes requests to the repository's Render-hosted `/poc/chatbox` route, which is a separate ingress from OpenRouter. The model identifier is configured at the Chatbox provider level, but the network path is distinct from the OpenRouter path.

### OpenRouter Token Discrepancy (Externally Observed Integration Issue)

**VERIFIED externally observed** — Despite the Chatbox editor displaying a Max Output Tokens setting of 8,000 for DeepSeek V4 Pro, OpenRouter test requests for DeepSeek V4 Pro are still actually requesting up to **131,072 tokens** (max) and are rejected with **HTTP 402** because the available OpenRouter credits are insufficient for that requested maximum.

This is recorded as an **observed Chatbox/OpenRouter configuration integration issue**, not a repository defect. No code in the repository controls Chatbox's max-token behavior or OpenRouter's credit allocation. Repository evidence does not establish that this discrepancy is a repository-side defect.

### DeepSeek Flash — OpenRouter Path Verification (Externally Observed)

**VERIFIED externally observed** — DeepSeek Flash was successfully tested through the existing OpenRouter provider in Chatbox and returned a response. This verifies the external path:

```
Chatbox → OpenRouter → DeepSeek Flash  (VERIFIED — returned a response)
```

### DeepSeek Flash Under CHATBOX_GATEWAY — Live Test Result (Externally Observed)

**VERIFIED externally observed** — DeepSeek Flash was then selected under `CHATBOX_GATEWAY` and a message was sent. Chatbox returned:

```
API Error: Error from Custom OpenAI: Network Error: Load failed (openclaw-webhook-iz6s.onrender.com)
```

This is recorded as the **current observed live Chatbox → Render test result**. **Do NOT claim this error establishes its root cause.** The root cause is not determined by this task and requires the investigation outlined below.

### Repository-Verified Implementation State of `/poc/chatbox`

The current repository implementation of `/poc/chatbox` (`routes/poc.js`) is an authenticated Chatbox gateway and includes the following repository-verified behavior:

- **Authentication boundary**: `authenticateChatboxGateway` middleware authenticates the caller via the `x-chatbox-gateway-secret` request header checked against `process.env.CHATBOX_GATEWAY_SECRET`. Fail-closed: missing or invalid secret returns HTTP 401. This env var is the authentication boundary for the gateway. (`routes/poc.js:92-103`)
- **OpenAI-compatible request-shape validation**: requires `model` (string), `messages` (array, non-empty), each message must contain `role` and `content`, and at least one `user` message must be present to preserve intent. (`routes/poc.js:609-655`)
- **User-message validation and intent preservation**: `buildChatboxCommand` extracts user-message content from `messages` and joins it as natural-language intent, rejecting requests with no user-message content. (`routes/poc.js:105-114`)
- **ACP command construction**: `buildChatboxCommand` builds a bounded ACP command in `REVIEW` mode with `read_only` capability and `poc/` permitted paths; preserves natural-language intent in the `task` field and a `natural_language_intent` structured field. (`routes/poc.js:105-151`)
- **ACP validation**: the constructed command is validated via `validateACPCommand` from `poc/schemas/acp-schema.js`. (`routes/poc.js:669`)
- **TaskRegistry registration**: validated commands are registered via `taskRegistry.createTask`. (`routes/poc.js:680`)
- **Dispatch through the existing dispatcher**: dispatched via `getDispatcher()` from `services/transport-provider.js`, the same mechanism used by `/poc/kilo` and `/poc/coordinator`. (`routes/poc.js:699`)
- **Target-aware dispatch**: `buildChatboxCommand` reads `target` from the request body and validates it against `VALID_AGENTS` (`['Kilo', 'Gemini', 'Gemini Builder']`) with fail-closed behavior. The previous hardcoded `target: 'Kilo'` was removed. (`routes/poc.js:116-129`; `poc/schemas/acp-schema.js:32`)
- **Chatbox remains a non-authorizing REVIEW / read_only / poc/ ingress**: the gateway issues only REVIEW-mode ACP commands and does NOT grant `modify_files`, `commit`, `push`, or `FAILOVER_EXECUTE`. (`routes/poc.js:134-139`)
- **CHATBOX_GATEWAY_SECRET as authentication boundary**: confirmed as the env-var/header boundary, distinct from `KILO_CALLBACK_SECRET`, `GEMINI_CALLBACK_SECRET`, `DEEPSEEK_COORDINATOR_SECRET`, and `ACP_POC_TRIGGER_SECRET`. (`routes/poc.js:94`)

### Critical Contract Distinction

The documentation must not assume `/poc/chatbox` is a complete OpenAI-compatible model-completion service. The following four concerns are **distinct** and must be preserved:

1. **Accepting an OpenAI-compatible request format** — `POST /poc/chatbox` accepts an OpenAI-shaped request body (`model` + `messages`). VERIFIED in repository code.
2. **The response actually returned by `/poc/chatbox`** — On dispatch SUCCESS, the route returns HTTP 202 with a JSON task-dispatch acknowledgement (`request_id`, `status`, `stage`, `execution_initiated`, `task_status`, `current_agent`, `next_agent`). It does **NOT** return an OpenAI-compatible `chat-completion` response with `choices` / `delta` streaming tokens. This is repository-verified behavior, not an inference.
3. **Dispatching an ACP task** — The route constructs and dispatches a REVIEW-mode ACP command (`read_only`, `poc/` paths) through the existing control plane. VERIFIED in repository code.
4. **Providing an actual AI-model completion response** — `/poc/chatbox` does NOT provide an AI-model completion response. It dispatches an ACP task. Whether or not an AI-model completion is ultimately produced is determined by downstream orchestration (Kilo/Gemini), which is outside the `/poc/chatbox` route itself.

**VERIFIED repository fact**: The current `/poc/chatbox` success response is an ACP task-dispatch acknowledgement, **not** an OpenAI-compatible chat-completion response.

### Test Status (Repository-Verified)

**VERIFIED repository state** — Current test suite (HEAD `bf532c7`):
- `test/chatbox-gateway.test.js`: 26/26 tests pass (includes tests for missing target → 400, invalid target → 400, Gemini Builder target passthrough, fail-closed auth)
- All 450 tests pass across 18 test files (per commit `8a56fe6` and subsequent target-aware dispatch commits `7e46b78`, `e558910`, `bf532c7`)

### Required Next Investigation Plan

The following investigation questions must be answered before further DeepSeek integration work can proceed. These are recorded as explicit next steps; **no implementation is authorized by this reconciliation task**.

1. **What does Chatbox actually send?**
   Determine the actual HTTP request Chatbox sends when using `CHATBOX_GATEWAY`, including: HTTP method; URL/path; authentication header; request body; `model` field; `messages` structure; relevant OpenAI-compatible parameters; max-token behavior. Do not infer the actual request solely from Chatbox's UI settings.

2. **What does `/poc/chatbox` currently expect?**
   Inspect the actual route and validation behavior and document its current request contract.

3. **What does `/poc/chatbox` currently return?**
   Inspect the actual success and failure response bodies and status codes. Determine whether its successful response is an OpenAI-compatible chat-completion response or an ACP/task-dispatch acknowledgement.

4. **What does Chatbox require from an OpenAI-compatible custom provider?**
   Determine the relevant request/response contract required by Chatbox's Custom OpenAI provider, particularly what response structure it expects after sending a chat-completion request.

5. **Does the existing `/poc/chatbox` implementation already provide the intended bridge?**
   Compare the Chatbox contract with the current `/poc/chatbox` implementation. Determine whether the existing implementation already bridges the intended architecture or whether there is a contract mismatch.

6. **If there is a mismatch, identify the smallest viable integration path.**
   Do not redesign the architecture automatically. First determine whether the existing components can be composed with a minimal change or configuration adjustment.

7. **Preserve the intended architectural separation:**
   - DeepSeek/OpenRouter = model/reasoning layer;
   - Render/OpenClaw = authenticated control-plane / ACP execution layer;
   - GitHub = source of truth and execution infrastructure.

8. **Determine whether the intended operational path is:**
   ```
   Chatbox → OpenRouter → DeepSeek → authenticated control-plane bridge → ACP → Gemini Builder/Kilo → GitHub
   ```
   Document any verified deviation from this intended path.

9. **Do not authorize implementation changes as part of this task.**
   The output of this reconciliation is the reconciled project state and investigation plan for the next authorized action.

### Architectural Separation (Intended)

The intended separation of concerns is:

- **DeepSeek/OpenRouter** = model/reasoning layer (provides model completions).
- **Render/OpenClaw** = authenticated control-plane / ACP execution layer (validates, registers, dispatches authorized ACP tasks; Chatbox remains a non-authorizing ingress).
- **GitHub** = source of truth and execution infrastructure (durable commits, workflow execution, verification).

Any future Chatbox → Render integration work must preserve this separation.

### Current Integration Gap

**UNKNOWN root cause**: Chatbox returned `Network Error: Load failed` when sending a message through `CHATBOX_GATEWAY` to `https://openclaw-webhook-iz6s.onrender.com/poc/chatbox`. The root cause is undetermined. No Chatbox gateway request is considered end-to-end verified merely because the provider is configured.

**Open questions (root cause for the Network Error)**:
- Did Chatbox actually reach the Render endpoint (DNS, TLS, connectivity)?
- Did the request reach the `authenticateChatboxGateway` middleware (header present and matching)?
- Did the request pass OpenAI-compatible shape validation?
- Did the request reach `buildChatboxCommand` / `validateACPCommand`?
- Was the task registered in TaskRegistry?
- Was the command dispatched through `getDispatcher()`?
- Is the Render deployment reachable and healthy?
- Was there a timeout, authentication rejection, or application error?

These must be answered by the investigation plan above (questions 1–4 and 8) before any integration change is authorized.

---

## Agent Roles (Current)

| Role | Agent | Status |
|------|-------|--------|
| Director / Final Authority | Kyle | **ACTIVE** |
| Primary Builder / Implementer / Tester | Gemini Builder | **ACTIVE** (transition complete) |
| Architect / Planner / Reviewer | Gemini | **ACTIVE** |
| Execution Agent (available lane) | Kilo | **ACTIVE** (available for tasks that explicitly target it) |
| Router | Qwen | **PLANNED** (UNDER VALIDATION) |
| Security Specialist | — | **PROPOSED / TARGET** (architectural foundation established) |
| Utility Specialist | — | **PROPOSED** |
| Orchestrator (optional) | OpenClaw | **PROPOSED** |

---

## Key Architectural Boundaries (Current)

- **Render / Node.js**: Business decisions, lifecycle logic, webhook processing, workflow orchestration, CRM decisions, notification content
- **Google Apps Script**: Google-specific execution (Sheets reads/writes, Gmail delivery)
- **GitHub Actions**: NOT production server; ephemeral AI execution plane only (PROPOSED / TARGET)
- **LINE**: Communication/notification channel only (not business-rules engine)

---

## Open Architectural Decisions (Security Specialist)

The following three decisions remain **OPEN** as of the Security Specialist architectural foundation implementation (Issue #38). They are explicitly **PROPOSED / TARGET** and not implemented.

| # | Decision | Status | Notes |
|---|----------|--------|-------|
| 1 | Qwen Router Trigger Logic Refinement | **OPEN** | Exact logic for Mandatory/Conditional/Advisory classification not finalized. Rule engine vs model-based classifier vs hybrid undecided. Ownership of rule set TBD. |
| 2 | Security Audit Report Persistence Mechanism | **OPEN** | Format, storage location, retrieval mechanism in `docs/ai/` not defined. Candidates: dedicated directory, `STATE.md`/`ARCH_DECISIONS.md` integration, external artifact store. Schema, versioning, retention, searchability, ACP correlation open. |
| 3 | Security Specialist Callback Mechanism to Orchestrator | **OPEN** | Mechanism for returning Security Audit Report and signaling gate completion not defined. Candidates: ACP report extension, webhook/callback, polling, file-based signal. Sync vs async, timeout/retry, correlation with pending ACP command open. |

These decisions are documented to preserve open state and prevent premature closure. They will be resolved through future authorized architectural work.

---

## Agent Session Operating Principle (Established 2026-09-15)

**Agent session memory is ephemeral. Durable project state resides in GitHub and the appropriate persistent orchestration state.**

This principle applies to all AI agents operating in this repository (Kilo, Gemini, and any future agents):

- **Ephemeral execution**: Each agent execution session (Kilo cloud container, GitHub Actions workflow run, etc.) is independent and transient. No session state, conversation history, or working memory persists between executions.
- **No cross-session continuity**: Agents do not retain context from prior executions, issue comments, or conversations. Each task invocation starts with a clean environment.
- **GitHub as durable source of truth**: All meaningful implementation work (code, documentation, configuration) must be committed and pushed to GitHub during the same authorized execution that produces it. Do not rely on future agent sessions to complete persistence.
- **TaskRegistry for orchestration correlation**: The `poc/task-registry.js` TaskRegistry provides durable `request_id`-keyed state for tracking async execution across agent lanes. It supplements but does not replace GitHub as the source of truth for implemented artifacts.
- **Same-execution persistence**: Implementation tasks must be sized to complete, verify, commit, and push in one execution. Larger work must be decomposed into independently durable checkpointed tasks.
- **Recovery from GitHub**: If an execution fails or times out, recovery is performed by inspecting the current GitHub state and TaskRegistry, not by resuming an agent session.

This principle is documented in detail in `docs/ai/KILO_INTEGRATION.md` Section 13 (Kilo External Agent Operating Model) and enforced through `docs/ai/TASK_STANDARD.md` Section 5 (Persistence Expectations for Implementation Tasks).

Authority boundaries:
- Kyle — Director / Final Authorization Authority
- ChatGPT — Coordinator / Verification Layer
- Gemini Builder — Primary Builder / Implementer / Tester (uses `GEMINI_BUILDER_API_KEY`)
- Kilo — Execution Agent (available lane for explicitly targeted tasks)
- Gemini — Architect / Planner / Reviewer (uses `GEMINI_API_KEY`)
- GitHub — Durable Repository Source of Truth

---

## Repository Structure (Current)

```
openclaw-webhook/
├── index.js                      # Express app, routes, scheduler
├── workflows/
│   └── abandonedBooking.js       # Render-side abandoned-booking workflow
├── services/
│   ├── appsScript.js             # Render → Apps Script client
│   ├── cal.js                    # Cal.com event handling
│   ├── lineService.js            # LINE notifications
│   ├── tally.js                  # Tally form processing
│   └── transport-provider.js     # Transport provider abstraction for POC
├── google-apps-script/           # Apps Script adapter (versioned)
│   ├── Code.js                   # doPost, action routing
│   ├── CRM.js                    # Sheets operations
│   ├── Email.js                  # Gmail delivery
│   ├── AbandonedBookings.js      # LEGACY (architecturally deprecated)
│   ├── Utilities.js              # JSON response helper
│   ├── projects.txt              # Apps Script project IDs (versioned)
│   └── appsscript.json           # Manifest
├── poc/                          # Proof-of-concept orchestration foundation
│   ├── acp-engine.js             # ACP validation and execution
│   ├── kilo-transport.js         # Kilo HTTP trigger transport
│   ├── task-registry.js          # Correlated task state persistence
│   ├── orchestrator.js           # Provider-independent orchestration policy
│   ├── gemini-trigger.js         # GitHub Actions workflow_dispatch integration
│   ├── kilo-polling.js           # Idempotent Kilo completion/result polling
│   ├── kilo-verifier.js          # Independent Kilo delivery verification
│   ├── github-webhook.js         # Git-based Kilo completion-signal POC receiver
│   ├── signal-emitter.js         # Kilo completion-signal emitter (Issue #180)
│   ├── command.json              # POC ACP command fixture
│   ├── main.js                   # POC entry point
│   ├── test.js                   # POC unit tests
│   ├── mock-kilo-provider.js     # Mock Kilo provider for testing
│   ├── signals/                  # Durable Git-backed completion signal artifacts
│   │   ├── TASK-KILO-GIT-COMPLETION-SIGNAL-EMITTER-IMPLEMENT-001.json
│   │   └── TASK-KILO-GIT-COMPLETION-SIGNAL-LIVE-VALIDATION-002.json
│   ├── schemas/
│   │   └── acp-schema.js         # ACP/task contract validation
│   └── test-transport.js         # Mock transport for testing
├── routes/
│   └── poc.js                    # POC endpoints (/poc/kilo)
├── test/                         # Focused tests for orchestration foundation
│   ├── schema.test.js
│   ├── task-registry.test.js
│   ├── orchestrator.test.js
│   ├── integration.test.js
│   ├── gemini-trigger.test.js
│   ├── gemini-callback.test.js
│   ├── kilo-callback.test.js
│   ├── kilo-polling.test.js
│   ├── kilo-verifier.test.js
│   ├── verify-reconcile.test.js
│   ├── github-webhook.test.js
│   ├── signal-emitter.test.js
│   ├── coordinator.test.js
│   ├── chatbox-gateway.test.js
│   ├── workflow-expression.test.js
│   ├── mock-kilo-transport.js
│   └── run-poc-tests.js
├── docs/
│   ├── ai/                       # AI project state (THIS DIRECTORY)
│   │   ├── README.md             # Operating instructions for the AI project-state system
│   │   ├── STATE.md              # Current live project state (mutable)
│   │   ├── ARCH_DECISIONS.md     # Architectural decisions (ADR-style)
│   │   ├── TASK_LOG.md           # Append-only historical task record
│   │   ├── TASK_STANDARD.md      # Canonical AI task request standard
│   │   ├── KILO_INTEGRATION.md   # Kilo external integration contract (GitHub webhook + trigger + ACP)
│   │   ├── KILO_GEMINI_ORCHESTRATION_PLAN.md  # Kilo/Gemini orchestration backbone plan
│   │   ├── CHATGPT_CONTROL_GATE_RESEARCH.md  # ChatGPT Control Gate research (PROPOSED)
│   │   ├── CHATGPT_PROJECT_OPERATING_PROTOCOL.md  # ChatGPT operating protocol
│   │   ├── CONTROL_CENTER.md     # Derived human-facing presentation layer
│   │   └── GEMINI_WORKFLOW_REGISTRATION_INCIDENT_2026-09-16.md  # Gemini workflow registration incident resolution record
│   └── openclaw-codex-phase-1.md
├── ARCHITECTURE.md               # Authoritative architecture
├── AGENTS.md                     # Kilo operating instructions
├── GEMINI.md                     # Gemini instructions
├── README.md                     # Project readme
├── package.json
├── .github/
│   └── workflows/
│       ├── main.yml              # Gemini Architect and Reviewer workflow
│       ├── kilo-gemini-poc.yml   # Disposable Kilo↔Gemini POC workflow
│       ├── kilo-verification.yml # Independent Kilo delivery verification workflow
│       └── codex-builder.yml     # Codex builder workflow (external app)
├── ai-models/
│   ├── README.md                 # AI models documentation
│   └── qwen-loader.js            # Qwen model loader
└── openclaw-render.json
```

---

## Verification Requirements for Current Work

- `git status --short --branch` — only intended files changed
- `git diff --check` — no whitespace errors
- No secrets in new documentation
- `AGENTS.md` clearly references `docs/ai/` system
- Distinction between CURRENT/IMPLEMENTED and PROPOSED/TARGET maintained
- Security Specialist registered in `AGENTS.md` Section 4
- Security Specialist architecture expanded in `ARCHITECTURE.md` Sections 12.7, 16.3, 17.2
- ACP schema extended with optional `security_review_required` and `security_audit_context` fields
- Three open architectural decisions (Security Specialist) documented in `STATE.md` and `ARCHITECTURE.md`
- ADR-014 added to `docs/ai/ARCH_DECISIONS.md`
- Kilo delivery verification lane implemented in `poc/`, `.github/workflows/`, and `test/`
