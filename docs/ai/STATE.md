# Current AI Project State

**Last Updated**: 2026-09-19
**Updated By**: Kilo — IMPLEMENT / VERIFY_RECONCILE

---

## Project Status: ACTIVE

**Repository**: `fluentwithkyle/openclaw-webhook`
**Default Branch**: `main`
**Production Deployment**: Render (Node.js/Express webhook listener)
**Google Adapter**: Google Apps Script (versioned in `google-apps-script/`)

---

## Active Tasks

| Task | Status | Owner | Notes |
|------|--------|-------|-------|
| Persistent AI project state system | **IMPLEMENTED** | Kilo | `docs/ai/` system created and `AGENTS.md` updated |
| Kilo External Integration Contract documentation | **IMPLEMENTED** | Kilo | `docs/ai/KILO_INTEGRATION.md` documents GitHub webhook (Pushes + Issues + Issue comments), external Kilo trigger, ACP task-ingestion contract, and exact current Kilo prompt. The exact current Kilo prompt has been updated to the externally configured prompt supplied by Kyle. The documented prompt now includes convergence-based autonomous recovery (ALLOW EXPLORATION, STOP ON NON-CONVERGENCE), same-execution durable completion, timeout/interruption continuation, and self-wake authority (continuation-only, does not create new authorization). ACP remains the authorization boundary. The prompt itself remains externally configured. No secrets committed. The exact rate-limit condition `Assistant request was rate limited` is documented in Section 6.7; the broken Section 7.4 reference has been corrected to Section 6.7 and Section 7 of the verbatim prompt. |
| ChatGPT Control Gate architecture | **RESEARCH COMPLETE / PROPOSED / PENDING** | Gemini (research) | Full research preserved in `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`. Not authorized for implementation. |
| ChatGPT Protocol Stop Gate hardening (Section 14) | **IMPLEMENTED / VERIFIED** | Kilo | Section 14 consequential-action stop gate hardened in `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` (commit `3ce42ac159dd8c73d7e043d7bc57692f6c5ecde`). Documentation reconciliation: `CONTROL_CENTER.md` reconciled in commit `da6a1a48190072049abc85b333cb4dfbd56f3ced`; `STATE.md` and `TASK_LOG.md` reconciled in this task. |
| Kilo ↔ Gemini orchestration backbone — Part 1 Foundation | **IMPLEMENTED** | Kilo | TaskRegistry, Orchestrator, ACP Schema, and focused tests implemented in `poc/` and `test/`. See commit `9407470`. |
| Kilo ↔ Gemini orchestration backbone — Part 2 Automatic Gemini trigger after Kilo completion | **IMPLEMENTED / VERIFIED** | Kilo | Automatic Gemini trigger in `/poc/kilo/callback` and `poc/kilo-polling.js` after successful Kilo completion. `handleKiloCompletion` → `next_action='trigger_gemini'` → `orchestrator.triggerGemini()` → Gemini state `running` → `next_action='waiting_gemini_callback'`. Kilo failure/blocked does not trigger Gemini. Source commit `6c92a9a223cc58f8f85f052c8d2168424938b46c`. 103/103 tests pass (20 schema, 17 task-registry, 18 orchestrator, 11 integration, 14 Gemini trigger, 23 Gemini callback). `git diff --check` clean. |
| Kilo ↔ Gemini orchestration backbone — Part 2.2 Kilo completion/result delivery | **IMPLEMENTED / VERIFIED** | Kilo | Kilo provider identifier capture (`session_id`, `message_id`, `invocation_id`), provider identifier persistence in TaskRegistry, idempotent Kilo completion polling, Kilo completion/result processing, provider client abstraction and mock provider, task-registry persistence, Gemini dispatch after Kilo completion, callback and JSON serialization behavior, relevant schema, registry, orchestrator, trigger, integration, callback, and polling tests. Source commit `2e9355d549f4c9379820476ef660cea3e274e560`, integrated main commit `ebb8e9e2e5beaeec5691d0667a659da0922928b3`, 133/133 tests pass. |
| Gemini verification requirements propagation | **IMPLEMENTED** | Kilo | Verification field flows ACP command → TaskRegistry → orchestrator → gemini-trigger → GitHub Actions → Gemini reviewer prompt. Implemented in commit `736ae3faf4d4ea75b22df8b85a6186dcdde91f59`; artifact persistence in `748ba91722ecbad6aaeaca5a084384862aabb6df`; prompt fix in `53f1a3fbd5c2fd0777397a0a139614d1fe92ba05`. Gemini independently verified functional. |
| Automated Kilo delivery verification | **IMPLEMENTED** | Kilo | Independent delivery verification lane implemented in `poc/kilo-verifier.js`, `.github/workflows/kilo-verification.yml`, `test/kilo-verifier.test.js`. Verifies commit identification, changed files, authorized file scope, request_id correlation, git diff --check, and idempotency. Triggers on push to main and pull request events. Kilo's self-report remains execution evidence, not independent delivery proof. |
| Security Specialist architectural foundation | **IMPLEMENTED** | Kilo | Registered lane in `AGENTS.md`; expanded architecture in `ARCHITECTURE.md` Sections 12.7, 16.3, 17.2; added ADR-014; three open architectural decisions documented; POC `command.json` and `test.js` extended with optional security fields (Issue #38) |
| Render Control Gatekeeper documentation reconciliation | **IMPLEMENTED** | Kilo | Documentation reconciled to explicitly record Render as future technical Control Gate / gatekeeper, machine-enforced boundary, Layer 1 → Layer 2 sequencing, and Kilo/Gemini architecture protection. See `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`. No implementation performed. |
| DeepSeek Coordinator Project establishment | **ACTIVE / IMPLEMENTED / VERIFIED** | Kilo | HIGH PRIORITY project implementing the authenticated `POST /poc/coordinator` endpoint. DeepSeek Coordinator ingress implemented in `routes/poc.js` using existing ACP validation (`poc/schemas/acp-schema.js`) and TaskRegistry (`poc/task-registry.js`). After successful registration, the command is dispatched through the existing Kilo dispatcher via `getDispatcher()` (same mechanism as `/poc/kilo`). Authentication via `x-deepseek-coordinator-secret` header (env: `DEEPSEEK_COORDINATOR_SECRET`), distinct from `KILO_CALLBACK_SECRET` and `GEMINI_CALLBACK_SECRET`. Registration failure prevents dispatch; provider identifiers persisted on successful dispatch. 19 coordinator tests pass; 170 total tests pass (20 schema, 17 task-registry, 18 orchestrator, 11 integration, 14 Gemini trigger, 23 Gemini callback, 15 Kilo callback, 10 Kilo polling, 18 Kilo verifier, 5 POC, 19 coordinator). (TASK-KILO-DEEPSEEK-COORDINATOR-INGRESS-IMPLEMENT-001, commit `950983a`) |
| VERIFY_RECONCILE operating mode implementation | **IMPLEMENTED / VERIFIED** | Kilo | Task mode dispatch added to ACP schema (`poc/schemas/acp-schema.js`) and engine (`poc/acp-engine.js`): REVIEW (read-only, existing behavior), VERIFY_RECONCILE (read_only + modify_files + commit + push capabilities; bounded docs/ai path scope), FAILOVER_EXECUTE (all 5 capabilities, explicit paths). `task_mode`, `capabilities`, `permitted_paths` fields added to ACP command and task registry entry. Reconciliation model added (status, changed_files, commit_sha) with `determineReconciliationStatus()`. Gemini workflow `.github/workflows/main.yml` updated with mode-aware prompt, `task_mode`/`capabilities`/`permitted_paths` inputs, `contents: write` permission, and reconciliation reporting in callback payload. `poc/gemini-trigger.js`, `poc/orchestrator.js`, `poc/command.json` updated to pass mode context through dispatch. 238 total tests pass (20 schema, 17 task-registry, 18 orchestrator, 11 integration, 14 Gemini trigger, 23 Gemini callback, 15 Kilo callback, 10 Kilo polling, 18 Kilo verifier, 5 POC, 19 coordinator, 52 verify-reconcile, 16 poc/test.js); `git diff --check` clean. (Issue #145). Independent verification by Gemini performed in TASK-GEMINI-VERIFY-RECONCILE-PROCEDURE-HARDENING-001. |
| Chatbox Gateway Ingress | **IMPLEMENTED / VERIFIED (Gemini Independently Verified)** | Kilo | Authenticated `POST /poc/chatbox` ingress implemented in `routes/poc.js` following the DeepSeek Coordinator Direct ACP pattern. Authenticates via `x-chatbox-gateway-secret` header (env: `CHATBOX_GATEWAY_SECRET`), dedicated and distinct from all other gateway secrets (`KILO_CALLBACK_SECRET`, `GEMINI_CALLBACK_SECRET`, `DEEPSEEK_COORDINATOR_SECRET`, `ACP_POC_TRIGGER_SECRET`). Accepts OpenAI-compatible requests (`model` + `messages`), extracts and preserves natural-language intent, builds a bounded REVIEW-mode ACP command (`read_only` capability, `poc/` permitted paths), validates via existing `validateACPCommand`, registers via existing `taskRegistry.createTask`, and dispatches via existing `getDispatcher()`. The gateway does NOT independently grant elevated capabilities (`modify_files`, `commit`, `push`, `FAILOVER_EXECUTE`). Intent is preserved in the ACP `task` field and `natural_language_intent` structured field for downstream trusted control-plane classification. 23 focused gateway tests pass; all existing regression tests pass (259 total). (TASK-KILO-CHATBOX-GATEWAY-IMPLEMENT-001) |
| Kilo ↔ Gemini post-dispatch result lifecycle repair | **IMPLEMENTED / VERIFIED** | Kilo | Repaired false-success path in `.github/workflows/main.yml`: callback payload now reflects actual Gemini execution result via `steps.gemini_run.outcome` instead of hardcoded `status: "success"`. Added `gemini_result` step with `if: always()` to determine STATUS/VERIFICATION_STATUS/BLOCKER_MSG/RECON_STATUS from real outcome; callback and artifact persistence steps now use `if: always()`. Callback payload now includes `gemini_output`. RECON_STATUS conditional on VERIFICATION_STATUS=PASS per `determineReconciliationStatus()` contract. 9 new workflow-expression tests + 3 new gemini-callback tests; all 270 total tests pass. (TASK-KILO-GEMINI-POST-DISPATCH-RESULT-LIFECYCLE-IMPLEMENT-001) |
| Apps Script authentication hardening | **BACKLOG** | — | Require shared secret for Node → Apps Script action boundary |
| Abandoned-booking idempotency | **BACKLOG** | — | Durable duplicate-alert prevention needed |
| Webhook signature verification | **BACKLOG** | — | Tally / Cal.com event-ID deduplication |
| Email template ownership migration | **BACKLOG** | — | Move template selection to Render, retain Gmail delivery in Apps Script |
| Automated testing infrastructure | **BACKLOG** | — | Tests, fixtures, contract tests, formal test script |

---

## Kilo ↔ Gemini Post-Dispatch Result Lifecycle Repair — Reconciliation Status

**Task**: TASK-KILO-GEMINI-POST-DISPATCH-RESULT-LIFECYCLE-IMPLEMENT-001 (EXECUTE mode, base branch `main`)

**Status**: **IMPLEMENTED / VERIFIED**

**Objective**: Repair the false-success path in `.github/workflows/main.yml` where the Gemini callback payload was hardcoded to `status: "success"` and `RECON_STATUS="COMPLETED"` regardless of actual Gemini execution outcome.

**Implementation**:
- Added "Determine Gemini execution result" step (`steps.gemini_result`) that reads `steps.gemini_run.outcome` and sets `gemini_status` (SUCCESS/FAILURE), `verification_status` (PASS/FAIL), `blocker_message`, and `recon_status` based on the real outcome
- `RECON_STATUS` now follows `determineReconciliationStatus()` contract: VERIFY_RECONCILE + PASS → COMPLETED; VERIFY_RECONCILE + FAIL → SKIPPED; other modes → SKIPPED
- Added `if: always()` to artifact persistence steps (`Persist Gemini result as artifact`, `Upload Gemini result artifact`)
- Added `if: always()` to `Prepare callback payload` and `Send callback to Render` steps
- `STATUS` now derives from `steps.gemini_result.outputs.gemini_status` instead of hardcoded `"success"`
- Added `gemini_output` field to callback payload containing the actual CLI output
- Callback is now sent even on Gemini execution failure (`if: always()`)

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
2. **No automated test suite** — Changes verified by manual review only.
3. **Legacy abandoned-booking code** — `google-apps-script/AbandonedBookings.js` exists but architectural status unclear; needs deployment verification before retirement.

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

## Agent Roles (Current)

| Role | Agent | Status |
|------|-------|--------|
| Director / Final Authority | Kyle | **ACTIVE** |
| Primary Builder / Implementer / Tester | Kilo | **ACTIVE** |
| Architect / Planner / Reviewer | Gemini | **ACTIVE** |
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

Authority boundaries remain unchanged:
- Kyle — Director / Final Authorization Authority
- ChatGPT — Coordinator / Verification Layer
- Kilo — Builder / Implementer / Tester
- Gemini — Architect / Planner / Reviewer
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
│   ├── command.json              # POC ACP command fixture
│   ├── main.js                   # POC entry point
│   ├── test.js                   # POC unit tests
│   ├── mock-kilo-provider.js     # Mock Kilo provider for testing
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
