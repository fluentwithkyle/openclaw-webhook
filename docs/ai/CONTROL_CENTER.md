# Control Center

**Derived human-facing dashboard.** This document is a presentation layer.
**docs/ai/STATE.md remains the authoritative current project-state source.**

Designed for Kyle checking the project from a phone.

---

## Project Status

| | |
|---|---|
| **Status** | ACTIVE |
| **Repository** | fluentwithkyle/openclaw-webhook |
| **Branch** | main |
| **Deploy** | Render (Node.js/Express) |
| **Google Adapter** | Google Apps Script |
| **Last Updated** | 2026-09-18 |

---

## Requires Kyle's Attention

1. **Remaining Part 2.1** (authenticated Gemini → Render return path) — PROPOSED / TARGET. Part 2.1b (Gemini workflow dispatch) — IMPLEMENTED / VERIFIED (commit `5f49f99`). Parts 1, 2, 2.1b, and 2.2 are IMPLEMENTED / VERIFIED. Implementation plan: `docs/ai/KILO_GEMINI_ORCHESTRATION_PLAN.md`. Not authorized until you approve.
2. **ChatGPT Control Gate** — Research complete. No implementation authorized or performed. Full research: `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`.
3. **Render Control Gate / Gatekeeper** — **PROPOSED / TARGET** (not implemented). Render is the future technical Control Gate between ChatGPT and repository execution. Layer 1 (Kilo↔Gemini orchestration stabilization) is prerequisite. Full research: `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`.
4. **Apps Script authentication hardening** — BACKLOG. Anonymous web app endpoint accepts CRM writes and Gmail delivery without application-level authentication.
5. **No automated test suite** — Changes verified by manual review only.
6. **DeepSeek Coordinator Project** — **HIGH PRIORITY**. Authenticated `POST /poc/coordinator` ingress implemented and verified in `routes/poc.js`. After successful registration, the command is dispatched through the existing Kilo dispatcher via `getDispatcher()` (same mechanism as `/poc/kilo`). Registration failure prevents dispatch; provider identifiers persisted on successful dispatch. 19 coordinator tests pass; 170 total tests pass. (IMPLEMENTED / VERIFIED)

---

## Active Work

| Task | Status | Owner |
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
| Chatbox Gateway Ingress | IMPLEMENTED / VERIFIED | Kilo | Authenticated `POST /poc/chatbox` in `routes/poc.js`. OpenAI-compatible request → REVIEW-mode ACP command (read_only, poc/ paths) → `validateACPCommand` → `taskRegistry.createTask` → `getDispatcher()`. Auth: `x-chatbox-gateway-secret` / `CHATBOX_GATEWAY_SECRET` (distinct from all other secrets). Intent preserved in `task` field and `natural_language_intent` field. 23 gateway tests pass; 259 total tests pass. (TASK-KILO-CHATBOX-GATEWAY-IMPLEMENT-001) |
| VERIFY_RECONCILE operating mode implementation | IMPLEMENTED / VERIFIED | Kilo | Task mode dispatch: REVIEW (read-only), VERIFY_RECONCILE (4 caps, bounded docs/ai paths), FAILOVER_EXECUTE (5 caps, explicit paths). Schema, ACP engine, gemini-trigger, orchestrator, workflow all updated. Reconciliation model added. 238 total tests pass. (Issue #145) |

---

## Blockers

1. **Apps Script trust boundary** — Hardening required before other reliability work.
2. **No automated test suite** — All changes verified by manual review.
3. **Legacy abandoned-booking code** — `google-apps-script/AbandonedBookings.js` needs deployment verification before retirement.

---

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
- Chatbox Gateway Ingress — **IMPLEMENTED / VERIFIED** (23 gateway tests pass; 259 total tests pass)

Remaining pending items:
- Remaining Part 2.1 (authenticated Gemini → Render return path) — PROPOSED / TARGET, not yet implemented (Gemini investigation result)
- Full automated Kilo delivery verification integration — PARTIAL / PROPOSED / PENDING; persistence gate remains PROPOSED / TARGET
- Render Control Gate — PROPOSED / TARGET (blocked on Layer 1 stabilization)
- ChatGPT Control Gate architecture — RESEARCH COMPLETE / PROPOSED / PENDING

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
- **Decisions:** docs/ai/ARCH_DECISIONS.md (ADR-001 through ADR-015)
- **Task History:** docs/ai/TASK_LOG.md
- **Issue:** [fluentwithkyle/openclaw-webhook#56](https://github.com/fluentwithkyle/openclaw-webhook/issues/56)
- **Docs:** docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md