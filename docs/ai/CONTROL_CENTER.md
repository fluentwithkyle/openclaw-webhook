## Control Center

**Derived human-facing dashboard.** This document is a presentation layer.
**docs/ai/STATE.md remains the authoritative current project-state source.**

Designed for Kyle checking the project from a phone.

**Last Updated**: 2026-09-26
**Updated By**: ChatGPT Coordinator — TASK-CHATGPT-DEEPSEEK-DOCUMENTATION-RECONCILE-002
---

## Architectural Note
The project has completed the transition from Kilo Cloud Agent (transitional/legacy) to Gemini Builder (active/target).
- **Coordinator**: ChatGPT
- **Active Builder**: Gemini Builder (merged via commit `8a56fe6`)
- **Legacy Builder**: Kilo (transitioning out)
- **Reviewer**: Gemini Reviewer

---

## Project Status

| **Status** | ACTIVE |
| **Repository** | fluentwithkyle/openclaw-webhook |
| **Branch** | main |
| **Deploy** | Render (Node.js/Express) |
| **Google Adapter** | Google Apps Script |
| **Last Updated** | 2026-09-25 |

Updated By | Kilo — VERIFY_RECONCILE (TASK-KILO-RECONCILE-DEEPSEEK-CHATBOX-LIVE-VALIDATION-001)

---

## Requires Kyle's Attention

1. **Remaining Part 2.1** (authenticated Gemini → Render return path) — PROPOSED / TARGET. Part 2.1b (Gemini workflow dispatch) — IMPLEMENTED / VERIFIED (commit `5f49f99`). Parts 1, 2, 2.1b, and 2.2 are IMPLEMENTED / VERIFIED. Implementation plan: `docs/ai/KILO_GEMINI_ORCHESTRATION_PLAN.md`. Not authorized until you approve.
2. **ChatGPT Control Gate** — Research complete. No implementation authorized or performed. Full research: `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`.
3. **Render Control Gate / Gatekeeper** — **PROPOSED / TARGET** (not implemented). Render is the future technical Control Gate between ChatGPT and repository execution. Layer 1 (Kilo↔Gemini orchestration stabilization) is prerequisite. Full research: `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`.
4. **Apps Script authentication hardening** — BACKLOG. Anonymous web app endpoint accepts CRM writes and Gmail delivery without application-level authentication.
5. **Automated test suite** — **IMPLEMENTED**. 18 test files with 450 tests covering ACP schema, TaskRegistry, Orchestrator, integration, Gemini trigger, Builder trigger, callbacks, polling, verifier, POC, coordinator, chatbox gateway, and verify-reconcile modes.
6. **DeepSeek Coordinator Project** — **HIGH PRIORITY**. Authenticated `POST /poc/coordinator` ingress implemented and verified in `routes/poc.js`. After successful registration, the command is dispatched through the existing Kilo dispatcher via `getDispatcher()` (same mechanism as `/poc/kilo`). Registration failure prevents dispatch; provider identifiers persisted on successful dispatch. 19 coordinator tests pass; 170 total tests pass. (IMPLEMENTED / VERIFIED)
7. **Git completion-signal emitter and Path 2** — Signal emitter implemented (Issue #180, commit `7bec058`): `poc/signal-emitter.js` with `poc/signals/<request_id>.json` artifact. **Path 2 recovery IMPLEMENTED / VERIFIED** (Issue #175, commit `030f888`): `recoverTaskFromGitHub()` reconstructs task context from GitHub issue body when TaskRegistry is absent. **Commit-SHA hardening IMPLEMENTED** (commit `f63211d`). Architectural direction (Issue #172, ADR-016) APPROVED / PROPOSED / TARGET — fully documented. Remaining gap: **live end-to-end validation (GitHub push ↠ Render webhook ↠ Gemini dispatch) NOT verified**; tests use mocks. Test count discrepancy: signal artifact claims 337 regression (total 378); independently verified actual is 369 regression (total 410). See STATE.md for full details.
8. **Chatbox → Render live integration gap** — `CHATBOX_GATEWAY` custom provider configured in Chatbox iOS (OpenAI API Compatible; host `/poc/chatbox`; `CHATBOX_GATEWAY_SECRET` auth boundary in Render). DeepSeek Flash test through OpenRouter succeeded; DeepSeek Flash test under `CHATBOX_GATEWAY` returned `Network Error: Load failed`. `/poc/chatbox` route is implemented (26/26 gateway tests pass); root cause of the live network error is **UNKNOWN**. Investigation questions recorded in STATE.md — next authorized action pending your direction.
9. **DeepSeek Runtime state** — Server-side /poc/deepseek-runtime is IMPLEMENTED / VERIFIED, and live validation established successful read-only Builder dispatch through the existing control-plane path. The asynchronous TaskRegistry/orchestration lifecycle is VERIFIED beyond initial dispatch. Current gap: the runtime returns the dispatch acknowledgement/task identity rather than retrieving the eventual asynchronous result for the ChatBox-facing conversation. A bounded read-only result/status operation through the existing control_plane is PROPOSED / NOT IMPLEMENTED / NOT AUTHORIZED. End-to-end ChatBox success remains unverified.

---

## Active Work

| Task | Status | Owner |
| Gemini Builder transition documentation reconciliation | ACTIVE | Gemini | TASK-GEMINI-RECONCILE-BUILDER-TRANSITION-RESEARCH-PLAN-001 |
|------|--------|-------|
| Persistent AI project state system | IMPLEMENTED | Kilo |
| Kilo External Integration Contract documentation | IMPLEMENTED | Kilo |
| ChatGPT consequential-action stop gate hardening | IMPLEMENTED | ChatGPT | Verified in commit `3ce42ac159dd8c73d7e043d7bc57692f6c5ecde` |
| Kilo ↔ Gemini orchestration backbone — Part 1 Foundation | IMPLEMENTED | Kilo |
| Kilo ↔ Gemini orchestration backbone — Part 2 Automatic Gemini trigger | IMPLEMENTED / VERIFIED | Kilo | Source commit `6c92a9a`, 103/103 tests pass; `handleKiloCompletion` → `trigger_gemini` → `orchestrator.triggerGemini()` → Gemini `running` → `waiting_gemini_callback`; failure/blocked does not trigger |
| Kilo ↔ Gemini orchestration backbone — Part 2.1b Gemini workflow dispatch | IMPLEMENTED / VERIFIED | Kilo | Commit `5f49f99`, 14 tests pass; `poc/gemini-trigger.js` `dispatchGemini()`, `workflow_dispatch` to `main.yml`, `orchestrator.triggerGemini()` |
| Kilo ↔ Gemini orchestration backbone — Part 2.2 Kilo completion/result delivery | IMPLEMENTED / VERIFIED | Kilo | Source commit `2e9355d`, main commit `ebb8e9e`, 133/133 tests pass; Kilo provider ID capture (`session_id`, `message_id`, `invocation_id`), TaskRegistry persistence, idempotent polling, completion/result processing, provider client abstraction, Gemini dispatch after Kilo completion, callback/JSON serialization |
| Automated Kilo delivery verification | IMPLEMENTED | Kilo | Independent verification lane implemented in `poc/kilo-verifier.js`, `.github/workflows/kilo-verification.yml`, `test/kilo-verifier.test.js` |
| Security Specialist architectural foundation | IMPLEMENTED | Kilo | Registered lane in `AGENTS.md`; expanded architecture in `ARCHITECTURE.md` Sections 12.7, 16.3, 17.2; ADR-014; POC `command.json` and `test.js` extended with optional security fields (Issue #38) |
| ChatGPT Control Gate architecture | RESEARCH COMPLETE / PROPOSED / PENDING | Gemini |
| Gemini verification requirements propagation | IMPLEMENTED | Kilo | Verified in commits `736ae3f`, `748ba91`, `53f1a3f`; Gemini independently verified functional |
| Gemini workflow trigger fix | IMPLEMENTED / VERIFIED | Kilo | Restored valid GitHub Actions syntax; fixed `issue_comment` task_mode default routing; regression test `test/workflow-expression.test.js` verified. |
| Gemini result artifact observability | IMPLEMENTED / VERIFIED | Kilo | Artifact persistence + ChatGPT retrieval + non-empty capture VERIFIED (run 35090491295, artifact ID 10444246441, 1120 bytes, commit `793d083`) |
| Render Control Gatekeeper documentation reconciliation | IMPLEMENTED | Kilo | Documentation reconciled: Render = future Control Gate/gatekeeper (PROPOSED/TARGET); Layer 1 → Layer 2 sequencing; Kilo/Gemini architecture protected |
| DeepSeek Coordinator Project establishment | ACTIVE / IMPLEMENTED / VERIFIED | Kilo | HIGH PRIORITY project implemented. Authenticated `POST /poc/coordinator` endpoint in `routes/poc.js`. ACP validation via `validateACPCommand`; registration via `taskRegistry.createTask`; dispatch via existing `getDispatcher()` (same mechanism as `/poc/kilo`). Implementation commits: `5613214` (ingress), `950983a` (dispatch bridge). 19 coordinator tests pass; 170 total tests pass. |
| Chatbox Gateway Ingress | IMPLEMENTED / VERIFIED | Kilo | Authenticated `POST /poc/chatbox` in `routes/poc.js`. OpenAI-compatible request → REVIEW-mode ACP command (read_only, poc/ paths) → `validateACPCommand` → `taskRegistry.createTask` → `getDispatcher()`. Auth: `x-chatbox-gateway-secret` / `CHATBOX_GATEWAY_SECRET` (distinct from all other secrets). Intent preserved in `task` field and `natural_language_intent` field. **Live end-to-end NOT verified** — Chatbox returned `Network Error: Load failed (openclaw-webhook-iz6s.onrender.com)` when sending through `CHATBOX_GATEWAY`; root cause UNKNOWN. Gateway route itself: 26/26 gateway tests pass. Full project suite: 450/450 tests pass across 18 test files. (TASK-KILO-CHATBOX-GATEWAY-IMPLEMENT-001, TASK-KILO-CHATBOX-TARGET-AWARE-DISPATCH-VERIFY-RECONCILE-001) |
| Chatbox target-aware ACP dispatch | IMPLEMENTED / VERIFIED | Kilo | Removed hardcoded `target: 'Kilo'` from `buildChatboxCommand` in `routes/poc.js`; target flows through trusted control path via request body `target` field validated against `VALID_AGENTS` (fail-closed). `createInitialTaskRegistryEntry` in `poc/schemas/acp-schema.js` now sets `current_agent` from `command.target`. Chatbox remains REVIEW/read_only/poc/. Existing target-aware dispatcher in `services/transport-provider.js` routes Kilo→`dispatchKilo`, Gemini Builder→`dispatchBuilder`, unrecognized→BLOCKED. 26/26 chatbox Gateway tests pass; full regression 450/450 tests pass across 18 test files. Merged `kilo/misty-hatch-7j7` (commits `7e46b78`, `e558910`) into `main`. |
| VERIFY_RECONCILE operating mode implementation | IMPLEMENTED / VERIFIED | Kilo | Task mode dispatch: REVIEW (read-only), VERIFY_RECONCILE (4 caps, bounded docs/ai paths), FAILOVER_EXECUTE (5 caps, explicit paths). 238 total tests pass. (Issue #145) |
| Kilo ↔ Gemini post-dispatch result lifecycle repair | IMPLEMENTED / VERIFIED | Kilo | Repaired false-success callback path: `STATUS` now derives from `steps.gemini_run.outcome` instead of hardcoded `"success"`; `RECON_STATUS` follows `determineReconciliationStatus()` contract; callback and artifact steps use `if: always()`; `gemini_output` included in payload. 270 total tests pass. (TASK-KILO-GEMINI-POST-DISPATCH-RESULT-LIFECYCLE-IMPLEMENT-001) |
| Git-based Kilo completion-signal POC (Issue #162) | IMPLEMENTED / VERIFIED | Kilo | Bounded POC: `poc/github-webhook.js` + `POST /poc/github/webhook` route. Git-based Kilo completion signal via GitHub push webhook. Reuses TaskRegistry correlation and `orchestrator.handleKiloCompletion()`. Existing polling/callback/orchestration preserved. Commit `bf68116167454d7c42b85e0ac4d627050a89ffd9`. **Commit-SHA hardening IMPLEMENTED** (commit `f63211d`). **Live validation signal** created (commit `f9d97e5`). **Path 2 recovery IMPLEMENTED / VERIFIED** (commit `030f888`): `recoverTaskFromGitHub()` retrieves task context from GitHub issue body when TaskRegistry is absent; fail-closed on issue absence, request_id mismatch, validation/authorization failure, missing token. Follow-on: signal emitter implemented in Issue #180 (commit `7bec058`). Status: UNDER VALIDATION (live end-to-end not verified). |
| Git-based Kilo completion-signal emitter (Issue #180) | IMPLEMENTED / VERIFIED (UNDER VALIDATION) | Kilo | Commit `7bec058`: `poc/signal-emitter.js` builds, validates via `validateSignal()`, and writes `poc/signals/<request_id>.json` completion signals (success/failure/blocked) with duplicate/conflict prevention. Committed signal artifact at `poc/signals/TASK-KILO-GIT-COMPLETION-SIGNAL-EMITTER-IMPLEMENT-001.json`. Signal emitter focused tests: 41/41 pass. Consumer/relationship verified: emitter sets `commit_sha: null`; consumer assigns authoritative SHA via `head_commit.id` in `buildCompletionReport()`. **Total: 410 tests pass** (369 regression + 41 signal-emitter). Signal artifact's "337 regression / 378 total" claim is INACCURATE (actual: 369 / 410). **Live end-to-end validation NOT verified** — tests use mocks. |
| Git completion-signal Path 2 recovery (Issue #175, plan Issue #172) | IMPLEMENTED / VERIFIED | Kilo | Path 2 implemented: Git/GitHub as durable completion/recovery evidence; TaskRegistry retained as runtime orchestration state; `recoverTaskFromGitHub()` retrieves task context from GitHub issue body when TaskRegistry is absent. Commit `030f888`. ADR-016 updated. Postgres/Redis fallback only if investigation proves Git/GitHub recovery insufficient. Follow-on: signal emitter implemented in Issue #180 (commit `7bec058`). (TASK-KILO-GIT-COMPLETION-SIGNAL-PATH-2-RECOVERY-IMPLEMENTATION-001) |
| Gemini ACP artifact reporting fix (Issue #173) | IMPLEMENTED / VERIFIED | Kilo | Fixed `gemini-acp-report.json` to contain the structured ACP envelope from `callback_payload.json` (with `current_head_sha`) instead of raw Gemini CLI summary **for the `workflow_dispatch` path**. NOTE: `issue_comment` path remained defective (raw Markdown persist step not removed). Fixed by Issue #174. 328 total tests pass. (TASK-KILO-GEMINI-ACP-ARTIFACT-REPORTING-FIX-001) |
| Gemini ACP artifact reporting fix — issue_comment path (Issue #174) | IMPLEMENTED / VERIFIED | Kilo | Unified structured ACP artifact reporting across both trigger paths. Removed raw Markdown persist step; generalized payload step to run for both `workflow_dispatch` and `issue_comment` (`if: always()`); derived `task`/`repository`/`base_branch` from issue_comment context; `request_id` set to `null` when unavailable; unified single artifact upload step. Preserved Render callback (workflow_dispatch-only), `@gemini-cli` triggering, Gemini CLI execution, ACP authorization, recursion-prevention, artifact name/file. 29 tests pass. (TASK-KILO-GEMINI-ACP-ARTIFACT-ISSUE-COMMENT-FIX-002) |
| RESEARCH_DOCUMENT task mode implementation (Issue #198) | IMPLEMENTED / VERIFIED | Kilo | Added `RESEARCH_DOCUMENT` task mode to ACP schema (`poc/schemas/acp-schema.js`); fixed capability set `read_only, modify_files, commit, push`; restricted paths to research/documentation surface; created `docs/ai/research/` directory and `docs/ai/RESEARCH_INDEX.md`; updated `TASK_STANDARD.md`, `KILO_INTEGRATION.md`, `docs/ai/README.md`; first research record created. (TASK-KILO-RESEARCH-DOCUMENTATION-SOP-IMPLEMENT-001) |
| TASK-KILO-GITHUB-WORKFLOW-WRITE-AUTH-AND-GEMINI-DELIVERY-001 | COMPLETED | Kilo | Delivered RESEARCH_DOCUMENT routing to .github/workflows/main.yml (explicit branch, no FAILOVER_EXECUTE fall-through) and recognized RESEARCH_DOCUMENT in GEMINI.md; committed d9298b0 and pushed to origin/main; independently verified on remote main. Prior 048e9b1 push failed because gemini-builder.yml pushes via auto-generated GITHUB_TOKEN (restricted from .github/workflows/* changes); Kilo delivered via owner-scoped token. |
| ChatGPT cold-start / project initialization hardening | COMPLETED | Kilo | Created `docs/ai/CHATGPT_START_HERE.md` as canonical cold-start entry point; added Project Bootstrap / Cold-Start Gate to `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md`; added ACP task-construction hardening; updated `docs/ai/TASK_STANDARD.md` and `docs/ai/README.md`. No production code, workflows, or secrets modified. |
| ChatGPT cold-start bootstrap contract reconciliation | COMPLETED | Kilo | Reconciled the canonical ChatGPT cold-start bootstrap contract: established `docs/ai/CHATGPT_START_HERE.md` as the sole canonical bootstrap contract with the Bootstrap Completion Check, fail-closed result `NOT READY — PROJECT BOOTSTRAP INCOMPLETE`, three non-overlapping phases, explicit dependency chain, and ACP-construction-downstream-of-bootstrap rule; reconciled `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` Section 0 to reference (not duplicate) the canonical contract. No production code, workflows, or secrets modified. |
| ChatGPT bootstrap role & ACP task_name reconciliation | COMPLETED | Kilo | Removed stale Kilo-as-primary-implementer statements across CHATGPT_START_HERE.md, CHATGPT_PROJECT_OPERATING_PROTOCOL.md, TASK_STANDARD.md, README.md (Gemini Builder is the designated Builder; Kilo is an available execution lane for explicitly-targeted tasks). Added mandatory `task_name` field to the canonical ACP task envelope, field ordering, and compliance checklist. Fixed stale task_mode values in the compliance checklist. Preserved all historical Kilo references, bootstrap contract, and authorization gates. No production code, workflows, or secrets modified. (TASK-KILO-CHATGPT-BOOTSTRAP-ROLE-RECONCILE-001) |

---

## Blockers

1. **Apps Script trust boundary** — Hardening required before other reliability work.
2. **Chatbox → Render integration gap (Live)** — Chatbox returned `Network Error: Load failed` when sending through `CHATBOX_GATEWAY` to `/poc/chatbox`. Root cause: **UNKNOWN**. Gateway route implemented (26/26 tests pass); no end-to-end Chatbox → Render request verified as successful. See STATE.md DeepSeek + Chatbox Integration State section for investigation plan.
3. **OpenRouter DeepSeek V4 Pro token/credit issue (Live)** — 131,072-token requests rejected with HTTP 402 despite 8,000-token display. VERIFIED externally observed; not a repository defect.
4. **Legacy abandoned-booking code** — `google-apps-script/AbandonedBookings.js` needs deployment verification before retirement.

---



### DeepSeek Runtime result retrieval boundary

**Current**: VERIFIED live read-only dispatch + VERIFIED asynchronous TaskRegistry/orchestration lifecycle.

**Gap**: the runtime returns dispatch acknowledgement/task identity rather than the eventual task result to the ChatBox-facing conversation.

**Next architectural boundary**: a bounded read-only status/result operation through the existing control_plane — PROPOSED / NOT IMPLEMENTED / NOT AUTHORIZED.
## Next Action

Substantially complete:
- Part 1 Foundation — IMPLEMENTED
- Part 2 (Automatic Gemini trigger after Kilo completion) — IMPLEMENTED / VERIFIED (commit `6c92a9a`, 103/103 tests pass)
- Part 2.1b (Gemini workflow dispatch) — IMPLEMENTED / VERIFIED (commit `5f49f99`, 14 tests)
- Part 2.2 (Kilo completion/result delivery) — IMPLEMENTED / VERIFIED (commit `ebb8e9e`, 133/133 tests pass)
- Security Specialist architectural foundation — IMPLEMENTED
- Gemini verification requirements propagation — IMPLEMENTED / independently verified
- Gemini result artifact observability — IMPLEMENTED / VERIFIED (artifact `gemini-acp-report` / `gemini-acp-report.json`)
- Automated Kilo delivery verification lane — IMPLEMENTED
- VERIFY_RECONCILE operating mode — **IMPLEMENTED / VERIFIED** (238 total tests pass)
- Kilo ↔ Gemini post-dispatch result lifecycle repair — **IMPLEMENTED / VERIFIED** (270 total tests pass; repaired false-success callback path in `main.yml`)
- Chatbox Gateway Ingress — **IMPLEMENTED / VERIFIED** (26 gateway tests pass; 450 total tests pass). **Live end-to-end NOT verified** — Chatbox `Network Error: Load failed` on `/poc/chatbox` when using `CHATBOX_GATEWAY`; root cause UNKNOWN.
- Gemini ACP artifact reporting — issue_comment path unified (Issue #174) — **IMPLEMENTED / VERIFIED** (29 workflow-expression tests pass)
  - Git completion-signal emitter (Issue #180, commit `7bec058`) — **IMPLEMENTED / VERIFIED (UNDER VALIDATION)** (41 emitter tests pass; 77 webhook regression tests pass; 410 total tests pass)
  - RESEARCH_DOCUMENT task mode — **IMPLEMENTED / VERIFIED** (483 total tests pass across 18 test files)

Remaining pending items:
- Remaining Part 2.1 (authenticated Gemini → Render return path) — PROPOSED / TARGET, not yet implemented (Gemini investigation result)
- Full automated Kilo delivery verification integration — PARTIAL / PROPOSED / PENDING; persistence gate remains PROPOSED / TARGET
- **Live end-to-end validation of Git completion-signal flow** — NOT verified. Signal file committed and pushed to `main`, but no evidence of live GitHub push webhook ↠ Render webhook ↠ signal processing ↠ Gemini dispatch. Tests use mocks, not live API calls.
- **Chatbox → Render live integration** — NOT verified. Chatbox returned `Network Error: Load failed` through `CHATBOX_GATEWAY`; root cause UNKNOWN. Investigation plan recorded in STATE.md (9 questions: what Chatbox sends, what `/poc/chatbox` expects/returns, what Chatbox requires, contract comparison, smallest viable path, architectural separation, intended operational path). No implementation authorized.
- **OpenRouter DeepSeek V4 Pro token discrepancy** — VERIFIED externally observed; 131,072-token requests rejected with HTTP 402 despite 8,000-token display. Not a repository defect.
- Render Control Gate — PROPOSED / TARGET (blocked on Layer 1 stabilization)
- ChatGPT Control Gate architecture — RESEARCH COMPLETE / PROPOSED / PENDING

**Current test count**: 483 total tests pass across 18 test files. Builder transition (commit `8a56fe6`).

Layer 1 (Kilo↔Gemini orchestration backbone stabilization/hardening) is the prerequisite for Layer 2 (Render Control Gate).

---

## DeepSeek Coordinator Project (HIGH PRIORITY)

| Field | Detail |
|-------|--------|
| **Project Name** | DeepSeek Coordinator — GitHub-Native AI Control Plane Integration |
| **Priority** | HIGH |
| **Current Status** | ACTIVE / IMPLEMENTED / VERIFIED |
| **Objective** | Connect DeepSeek's natural-language coordination to the existing GitHub-native ACP control plane via Direct ACP |
| **Agreed Architecture** | DeepSeek emits canonical ACP JSON directly → Authenticated `POST /poc/coordinator` → Existing ACP validator (`validateACPCommand`) + TaskRegistry (`taskRegistry.createTask`) → Existing Kilo dispatcher (`getDispatcher()`) → Existing Kilo execution path → GitHub verification → DeepSeek → Chatbox. Documented in `ARCHITECTURE.md` Section 16.6. |
| **Current Gap** | **CLOSED / IMPLEMENTED** — Authenticated `POST /poc/coordinator` ingress implemented in `routes/poc.js`, authenticated via `x-deepseek-coordinator-secret` / `DEEPSEEK_COORDINATOR_SECRET`, validated via `validateACPCommand`, registered via `taskRegistry.createTask`. After successful registration, dispatched through the existing Kilo dispatcher via `getDispatcher()` (same mechanism as `/poc/kilo`). Registration failure prevents dispatch. Provider identifiers persisted on successful dispatch. Implementation commit `950983a` (dispatch bridge) on top of `5613214` (initial ingress). |
| **Relevant Components** | `poc/schemas/acp-schema.js`, `poc/task-registry.js`, `poc/orchestrator.js`, `services/transport-provider.js`, `routes/poc.js`, `.github/workflows/main.yml`, `poc/command.json`, `test/coordinator.test.js` |
| **Next Concrete Action** | None — Coordinator ingress fully implemented and verified |
| **Authorization State** | Implementation authorized and executed via ACP task TASK-KILO-DEEPSEEK-COORDINATOR-INGRESS-IMPLEMENT-001 (capabilities: inspect, modify, test, commit, push). Commit and push to main authorized. |
| **Details** | See `docs/ai/STATE.md` → DeepSeek Coordinator Project section |
| **Test Results** | 19/19 coordinator tests pass. 170 total tests pass (20 schema, 17 task-registry, 18 orchestrator, 11 integration, 14 Gemini trigger, 23 Gemini callback, 15 Kilo callback, 10 Kilo polling, 18 Kilo verifier, 5 POC, 19 coordinator). |
| **Bounded OpenRouter Runtime** | **IMPLEMENTED / UNDER VALIDATION** — authenticated `POST /poc/deepseek-runtime` (`services/deepseek-runtime.js`, route `routes/poc.js:773`) hosts the OpenRouter-compatible model/tool loop, exposes exactly one intent-only `control_plane` tool, derives REVIEW ACP authority server-side (target: Gemini Builder; capabilities: read_only; permitted paths: poc/), and calls the existing authenticated `/poc/coordinator`. Server-side secrets: `OPENROUTER_API_KEY`, `DEEPSEEK_COORDINATOR_SECRET`; route auth: `CHATBOX_GATEWAY_SECRET`. Render environment configured for OpenRouter/DeepSeek operation (`OPENROUTER_MODEL` = `deepseek/deepseek-v4-flash`). Chatbox custom provider configured toward `/poc/deepseek-runtime`; connection check reported successful. **Live end-to-end NOT VERIFIED** — normal Chatbox chat requests were not observed in Render request logs. Streaming compatibility (runtime returns non-streaming JSON; Chatbox SSE handler expects streamed response) is an unresolved concern, not a confirmed root cause. See STATE.md "DeepSeek Runtime Live Validation Status" section. |

---

## Chatbox Gateway Project

| Field | Detail |
|-------|--------|
| **Project Name** | Chatbox Gateway — Authenticated Non-Authorizing Ingress |
| **Priority** | MEDIUM |
| **Current Status** | IMPLEMENTED / VERIFIED |
| **Objective** | Connect Chatbox iOS (via OpenRouter → DeepSeek, OpenAI-compatible) to the existing canonical ACP control plane via an authenticated, non-authorizing ingress that preserves natural-language intent |
| **Agreed Architecture** | Authenticated `POST /poc/chatbox` → OpenAI-compatible validation → REVIEW-mode ACP command construction (read_only, poc/ paths) → `validateACPCommand` → `taskRegistry.createTask` → `getDispatcher()` (same mechanism as `/poc/kordinator` and `/poc/kilo`). No parallel authorization, orchestration, or dispatch system. |
| **Authentication** | Header `x-chatbox-gateway-secret`; env var `CHATBOX_GATEWAY_SECRET`; fail-closed; distinct from `KILO_CALLBACK_SECRET`, `GEMINI_CALLBACK_SECRET`, `DEEPSEEK_COORDINATOR_SECRET`, `ACP_POC_TRIGGER_SECRET` |
| **Authorization Boundary** | Chatbox is an authenticated, NON-AUTHORIZING ingress. The gateway issues only REVIEW-mode ACP commands (read_only, poc/ paths). It does NOT grant modify_files, commit, push, or FAILOVER_EXECUTE. Classification/authorization belongs to the trusted Coordinator/orchestration/ACP layer. |
| **Relevant Components** | `routes/poc.js` (implementation), `test/chatbox-gateway.test.js` (tests), `docs/ai/CHATBOX_ACP_ARCHITECTURE_RECORD.md` (architecture record), `docs/ai/ARCH_DECISIONS.md` (ADR-015) |
| **Next Concrete Action** | None — Chatbox gateway fully implemented and verified |
| **Authorization State** | Implementation authorized and executed via ACP task TASK-KILO-CHATBOX-GATEWAY-IMPLEMENT-001 (capabilities: inspect, modify_files, run_tests, commit, push). Commit and push to main authorized. |
| **Test Results** | 23/23 Chatbox gateway tests pass. 259 total tests pass. |
| **Remaining Unknowns** | Qwen Router classification/trigger (UNKNOWN), Security Specialist callback mechanism (UNKNOWN), Security Audit Report persistence mechanism (UNKNOWN) |

---

## Key References

- **Architecture:** ARCHITECTURE.md (authoritative for intended architecture)
- **State:** docs/ai/STATE.md (authoritative current project state)
- **Decisions:** docs/ai/ARCH_DECISIONS.md (ADR-001 through ADR-017)
- **Task History:** docs/ai/TASK_LOG.md
- **Cold Start:** docs/ai/CHATGPT_START_HERE.md (canonical bootstrap contract — fresh-instance entry point)
- **Docs:** docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md
