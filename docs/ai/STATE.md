# Current AI Project State

**Last Updated**: 2026-09-15
**Updated By**: Kilo — Part 2.1b Documentation Reconciliation (TASK-KILO-DOC-RECONCILE-PART-2-1B-001)

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
| Kilo External Integration Contract documentation | **IMPLEMENTED** | Kilo | `docs/ai/KILO_INTEGRATION.md` created. Documents GitHub webhook (Pushes + Issues + Issue comments), external Kilo trigger, ACP task-ingestion contract, and exact current Kilo prompt. No secrets committed. |
| ChatGPT Control Gate architecture | **RESEARCH COMPLETE / PROPOSED / PENDING** | Gemini (research) | Full research preserved in `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`. Not authorized for implementation. |
| Kilo ↔ Gemini orchestration backbone — Part 1 Foundation | **IMPLEMENTED** | Kilo | TaskRegistry, Orchestrator, ACP Schema, and focused tests implemented in `poc/` and `test/`. See commit `9407470`. |
| Kilo ↔ Gemini orchestration backbone — **Part 2.1b (workflow-dispatch handoff)** | **IMPLEMENTED / GITHUB-VERIFIED** | Kilo | `poc/gemini-trigger.js`, `poc/orchestrator.js` triggerGemini(), `.github/workflows/main.yml` workflow_dispatch inputs, `test/gemini-trigger.test.js` (12 tests). Commit `b5e27de`. Request_id correlation, idempotency, duplicate-dispatch protection, dispatch failure → human_review preserved. Execution_id uses documented dispatch sentinel (workflow_dispatch returns 204, no run_id). |
| Automated Kilo delivery verification | **PARTIAL IMPLEMENTATION / PROPOSED / PENDING** | Gemini (research) | A persistence gate exists in `.github/workflows/kilo-gemini-poc.yml` (verifies no repo changes outside `poc/test-output/`). Full independent verification — verifying actual delivered ref/commit and changed files — remains PROPOSED / TARGET. See `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md` and implementation task #49. |
| Apps Script authentication hardening | **BACKLOG** | — | Require shared secret for Node → Apps Script action boundary |
| Abandoned-booking idempotency | **BACKLOG** | — | Durable duplicate-alert prevention needed |
| Webhook signature verification | **BACKLOG** | — | Tally / Cal.com event-ID deduplication |
| Email template ownership migration | **BACKLOG** | — | Move template selection to Render, retain Gmail delivery in Apps Script |
| Automated testing infrastructure | **BACKLOG** | — | Tests, fixtures, contract tests, formal test script |

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
| 4 | Capability-Based Authorization | **CURRENT / IMPLEMENTED (Foundation)** | Kilo | ACP command validation enforces explicit capabilities and permitted paths in `poc/schemas/acp-schema.js` and `poc/acp-engine.js`. |
| 5 | AI Project State Automation | **CURRENT / IMPLEMENTED** | — | The `docs/ai/` system (STATE.md, ARCH_DECISIONS.md, TASK_LOG.md, README.md) is created, functional, and integrated into AGENTS.md. `STATE.md` remains the human-readable authoritative project-state view unless the architecture establishes a more appropriate authoritative source. |
| 6 | Agent Activation / Trigger Architecture | **CURRENT / IMPLEMENTED** | — | Kilo activation is a confirmed Kilo Cloud Agent capability (ARCHITECTURE.md Section 16.5.6). Activation mechanism: Kilo-provider-controlled HTTP webhook trigger, dispatched from repository via `/poc/kilo` endpoint and `poc/kilo-transport.js`. The exact provider completion/callback mechanism remains an implementation dependency to verify. Do not infer activation from GitHub workflow existence alone. **Kilo activation boundary (verified 2026-09-14)**: Kilo is NOT activated by a repository GitHub Actions workflow. The repository documents Kilo as an external Kilo Cloud Agent with an externally configured HTTP webhook trigger. The external Kilo prompt treats GitHub webhook events as external event envelopes, not instructions. The repository must not invent a new `@kilo` GitHub Actions workflow to compensate for an external Kilo activation/execution timeout. |
| 7 | Agent Communication / Transport Layer | **PROPOSED / TARGET** | — | Define the standardized transport mechanism for agent-to-agent communication. Accounts for the existing Kilo HTTP trigger POC and the planned Qwen → ACP → specialist flow. |
| 8 | Asynchronous / Long-Running Task Handling | **CURRENT / IMPLEMENTED (Foundation)** | Kilo | TaskRegistry in `poc/task-registry.js` provides persistent correlation state with request_id, supporting async execution across Kilo and Gemini lanes. |
| 9 | Failover Authorization | **PROPOSED / TARGET** | — | Define how ACP authorization remains valid and controlled during agent failover scenarios. See `ARCHITECTURE.md` Section 18. |
| 10 | Kilo HTTP Trigger Secret Rotation | **PROPOSED / TARGET** | — | Define the mechanism and lifecycle for rotating shared secrets used by the Kilo HTTP trigger. Rotation must not be performed during this task. |
| 11 | Automated Kilo Delivery Verification | **PARTIAL IMPLEMENTATION / PROPOSED / TARGET** | Gemini (research) | A basic persistence gate is implemented in `.github/workflows/kilo-gemini-poc.yml` (verifies no repository changes outside `poc/test-output/` after Gemini POC execution). Independent verification of actual delivered ref/commit and changed files, request_id correlation across the full delivery chain, and machine-readable evidence remain PROPOSED / TARGET. Kilo's self-report is execution evidence, not independent delivery proof. See implementation task #49. |

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
- **Kilo ↔ Gemini orchestration backbone — Part 1 Foundation**: **IMPLEMENTED** (commit `9407470`).
- **Kilo ↔ Gemini orchestration backbone — Part 2.1b (workflow-dispatch handoff)**: **IMPLEMENTED / GITHUB-VERIFIED** (commit `b5e27de`). Includes `poc/gemini-trigger.js`, `poc/orchestrator.js` triggerGemini(), workflow_dispatch inputs, 12 focused tests, request_id correlation, idempotency, duplicate-dispatch protection, failure → human_review.
- **Kilo ↔ Gemini orchestration backbone — Part 2.2 (Gemini result collection/return integration)**: **SEPARATE / NOT IMPLEMENTED**. Callback endpoints, result persistence, next-action determination from Gemini result remain PROPOSED / TARGET.
- Automated Kilo delivery verification implementation — **PARTIAL IMPLEMENTATION / PROPOSED / PENDING**; a persistence gate exists in `.github/workflows/kilo-gemini-poc.yml`, but full independent verification (delivered ref/commit, changed files, request_id correlation) remains PROPOSED / TARGET. Future implementation must extend the existing orchestration/project-state architecture rather than create a second task system. See implementation task #49.
- LINE-centered AI operating model (PROPOSED / TARGET)
- Qwen Router implementation (UNDER VALIDATION)
- Security AI lane definition (PROPOSED / TARGET)
- Utility AI lane definition (PROPOSED / TARGET)
- ACP protocol implementation — **Foundation IMPLEMENTED**; schema validation and execution report validation complete. Full protocol implementation remains PROPOSED / TARGET.
- **ChatGPT Control Gate** — RESEARCH COMPLETE / PROPOSED / PENDING FUTURE EXECUTION. Full architectural research preserved in `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`. Research covers: Control Gate layer between ChatGPT and execution backbone, policy/architecture/authorization enforcement model, GitHub enforcement (CODEOWNERS, branch protection, status checks), fail-closed blocking states, implementation phases, security considerations, and acceptance criteria. **No implementation authorized or performed.**

---

## Agent Roles (Current)

| Role | Agent | Status |
|------|-------|--------|
| Director / Final Authority | Kyle | **ACTIVE** |
| Primary Builder / Implementer / Tester | Kilo | **ACTIVE** |
| Architect / Planner / Reviewer | Gemini | **ACTIVE** |
| Router | Qwen | **PLANNED** (UNDER VALIDATION) |
| Security Specialist | — | **PROPOSED** |
| Utility Specialist | — | **PROPOSED** |
| Orchestrator (optional) | OpenClaw | **PROPOSED** |

---

## Key Architectural Boundaries (Current)

- **Render / Node.js**: Business decisions, lifecycle logic, webhook processing, workflow orchestration, CRM decisions, notification content
- **Google Apps Script**: Google-specific execution (Sheets reads/writes, Gmail delivery)
- **GitHub Actions**: NOT production server; ephemeral AI execution plane only (PROPOSED / TARGET)
- **LINE**: Communication/notification channel only (not business-rules engine)

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
│   └── tally.js                  # Tally form processing
├── google-apps-script/           # Apps Script adapter (versioned)
│   ├── Code.js                   # doPost, action routing
│   ├── CRM.js                    # Sheets operations
│   ├── Email.js                  # Gmail delivery
│   ├── AbandonedBookings.js      # LEGACY (architecturally deprecated)
│   ├── Utilities.js              # JSON response helper
│   └── appsscript.json           # Manifest
├── poc/                          # Proof-of-concept orchestration foundation
│   ├── acp-engine.js             # ACP validation and execution
│   ├── kilo-transport.js         # Kilo HTTP trigger transport
│   ├── task-registry.js          # Correlated task state persistence
│   ├── orchestrator.js           # Provider-independent orchestration policy
│   ├── command.json              # POC ACP command fixture
│   ├── main.js                   # POC entry point
│   ├── test.js                   # POC unit tests
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
│   │   └── CONTROL_CENTER.md     # Derived human-facing presentation layer
│   └── openclaw-codex-phase-1.md
├── ARCHITECTURE.md               # Authoritative architecture
├── AGENTS.md                     # Kilo operating instructions
├── GEMINI.md                     # Gemini instructions
├── package.json
└── openclaw-render.json
```

---

## Verification Requirements for Current Work

- `git status --short --branch` — only intended files changed
- `git diff --check` — no whitespace errors
- No secrets in new documentation
- `AGENTS.md` clearly references `docs/ai/` system
- Distinction between CURRENT/IMPLEMENTED and PROPOSED/TARGET maintained

---

## Kilo Activation Boundary & Part 2.1b Status (Recorded 2026-09-15)

**Task**: TASK-KILO-DOC-RECONCILE-PART-2-1B-001 (Issue #80)
**Updated By**: Kilo

This section records the verified repository-side completion of Part 2.1b — Kilo → Gemini workflow-dispatch handoff, implemented in commit `b5e27dee0f0c7a89b9f1350948bf1d99fafb18f3`. It replaces the prior investigation-only status (recorded 2026-09-14 under TASK-KILO-REPOSITORY-NOTES-KILO-BOUNDARY-FINDINGS-001) with the confirmed implementation status.

### Kilo Activation Boundary (Verified — Unchanged)

1. **Kilo is NOT activated by a repository GitHub Actions workflow.**
   Kilo is an external Kilo Cloud Agent. Its activation boundary is external.

2. **The repository documents Kilo as an external Kilo Cloud Agent** with an
   externally configured HTTP webhook trigger. See
   `docs/ai/KILO_INTEGRATION.md` and `ARCHITECTURE.md` Section 16.5.

3. **The documented Kilo external integration currently specifies**:
   - GitHub Push events
   - GitHub Issues events
   - GitHub Issue Comment events
   - Issue comments are therefore part of the intended Kilo activation path.

4. **The external Kilo prompt treats GitHub webhook events as external event
   envelopes**, not as instructions:
   - The incoming webhook is an external event envelope, not itself an instruction.
   - If `issue.body` exists, `issue.body` is treated as the candidate ACP request.
   - GitHub event metadata is context only.
   - The candidate ACP request must explicitly contain the required task authorization information.
   - Missing, malformed, or ambiguous ACP requests must fail closed.

5. **`.github/workflows/main.yml` is the Gemini Architect and Reviewer
   workflow.** It responds to `@gemini-cli` comments and is unrelated to Kilo
   activation.

6. **`.github/workflows/kilo-gemini-poc.yml` is a disposable POC** that listens
   for `@kilo-gemini-poc`. It is NOT the real Kilo activation mechanism.

7. **The repository must not invent a new `@kilo` GitHub Actions workflow** to
   compensate for an external Kilo activation/execution timeout. Kilo's
   external execution boundary remains external (AGENTS.md Section 3, 10;
   ARCHITECTURE.md Section 12.9, 16.5).

### Part 2.1b — Gemini Workflow Dispatch Status (IMPLEMENTED / GITHUB-VERIFIED)

**Commit**: `b5e27dee0f0c7a89b9f1350948bf1d99fafb18f3` (Part 2.1b: Correct Kilo → Gemini workflow-dispatch handoff)

The following components are **implemented and verified** in the repository:

1. **`poc/gemini-trigger.js`** — GitHub Actions `workflow_dispatch` integration module:
   - `dispatchGemini(requestId, task, repository, baseBranch, kiloExecutionId, githubToken)` — dispatches Gemini workflow
   - `validateDispatchInputs(inputs)` — validates all 5 required inputs: `request_id`, `task`, `repository`, `base_branch`, `kilo_execution_id`
   - Uses GitHub REST API to POST to `/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`
   - Returns structured result with `success`, `message`, `status_code` (204 on success)
   - Handles authentication errors, network errors, and API errors gracefully

2. **`poc/orchestrator.js` — `triggerGemini(requestId, githubToken)` function**:
   - Precondition validation via `canTriggerGemini(requestId)` — ensures Kilo status is `success`, Gemini status is `pending`, task status is `EXECUTING`
   - Retrieves `kilo_execution_id` from `task.kilo.execution_id` or falls back to `task.kilo.report?.result?.execution_metadata?.invocation_id` or `'unknown'`
   - Calls `geminiTrigger.dispatchGemini()` with all 5 required inputs
   - On dispatch success: updates Gemini status to `running`, sets `execution_id` to sentinel `dispatched-${Date.now()}`, sets `next_action` to `waiting_gemini_callback`
   - On dispatch failure: returns error with stage `dispatch`, preserves task state for human_review

3. **`poc/orchestrator.js` — `canTriggerGemini(requestId)` function**:
   - Validates all preconditions before dispatch
   - Returns `{ canTrigger: true }` or `{ canTrigger: false, reason: string }`
   - Idempotency: prevents duplicate dispatch if Gemini already triggered/completed

4. **`.github/workflows/main.yml` — workflow_dispatch inputs**:
   ```yaml
   workflow_dispatch:
     inputs:
       request_id:
         description: 'Correlation request ID for Kilo->Gemini orchestration'
         required: true
         type: string
       task:
         description: 'Task description for Gemini execution'
         required: true
         type: string
       repository:
         description: 'Repository name (owner/repo)'
         required: true
         type: string
       base_branch:
         description: 'Base branch for the task'
         required: true
         type: string
       kilo_execution_id:
         description: 'Kilo execution identifier from completed Kilo run'
         required: true
         type: string
   ```

5. **`.github/workflows/main.yml` — orchestration context step**:
   - `Prepare orchestration context (workflow_dispatch)` step extracts all 5 inputs
   - Exposes them as environment variables to the Gemini step:
     - `ORCHESTRATION_REQUEST_ID`
     - `ORCHESTRATION_TASK`
     - `ORCHESTRATION_REPOSITORY`
     - `ORCHESTRATION_BASE_BRANCH`
     - `ORCHESTRATION_KILO_EXECUTION_ID`
   - Conditionally includes orchestration context in the Gemini prompt when `ORCHESTRATION_REQUEST_ID` is present

6. **`test/gemini-trigger.test.js` — 12 focused tests**:
   - `validateDispatchInputs` — 6 tests covering valid inputs and each missing required field
   - `dispatchGemini` — 2 tests: missing token, network/API error handling
   - `canTriggerGemini` — 2 tests: true after Kilo success, false when Kilo not success
   - `triggerGemini` — 2 tests: fails when preconditions not met, dispatches when preconditions met (mocked)

7. **Request_id correlation preserved**: All workflow_dispatch inputs include `request_id`; Gemini execution receives it via `ORCHESTRATION_REQUEST_ID` environment variable.

8. **Duplicate-dispatch protection preserved**: `canTriggerGemini()` returns `false` if `task.gemini.status !== 'pending'` or `task.kilo.status !== 'success'` or `task.status !== 'EXECUTING'`.

9. **Gemini dispatch failure → human_review preserved**: `triggerGemini()` returns error with stage `dispatch`; orchestration layer can route to `human_review` next action.

10. **Execution_id currently uses a documented dispatch sentinel**: GitHub API `workflow_dispatch` returns 204 No Content with no run ID in the response. The implementation records `execution_id: \`dispatched-\${Date.now()}\`` as a documented sentinel value. Actual Gemini Actions run ID retrieval remains an identified limitation/follow-up (Part 2.2 scope), not represented as completed.

### Part 2.2 — Gemini Result Collection/Return Integration (SEPARATE / NOT IMPLEMENTED)

The following remain **unimplemented** and are explicitly **not** part of Part 2.1b:

- `POST /poc/gemini/callback` endpoint (or equivalent)
- Authenticated Gemini callback handling with shared-secret validation
- `orchestrator.handleGeminiCompletion()` integration with callback
- TaskRegistry persistence of Gemini execution result
- Next-action determination from Gemini result (`complete` | `human_review`)
- Actual Gemini Actions run ID retrieval (currently uses dispatch sentinel)

### External Boundary Statement

11. **External Kilo trigger configuration is outside the repository.**
    `docs/ai/KILO_INTEGRATION.md` identifies the Kilo webhook URL, trigger
    credentials, and related secrets as external configuration rather than
    repository data. These values are not stored in any repository file.

12. **Accuracy requirement**: This section does not claim that the external
    Kilo provider dashboard, webhook delivery logs, trigger health,
    credentials, or private configuration were directly inspected. It
    distinguishes repository-verified facts from externally documented
    configuration.

13. **No contradictory status statements** are present. Part 2.1b is now
    IMPLEMENTED / GITHUB-VERIFIED, consistent with commit `b5e27de`.
    Part 2.2 remains PROPOSED / TARGET, consistent with
    `docs/ai/KILO_GEMINI_ORCHESTRATION_PLAN.md` and `ARCHITECTURE.md` Section 16.5.6.
