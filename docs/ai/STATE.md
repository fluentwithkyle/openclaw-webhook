# Current AI Project State

**Last Updated**: 2026-09-14
**Updated By**: Kilo — Part 1 Kilo ↔ Gemini Orchestration Foundation implementation (TASK-KILO-GEMINI-ORCHESTRATION-PART-1-FOUNDATION-001)

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
| ChatGPT Control Gate architecture | **RESEARCH COMPLETE / PROPOSED / PENDING** | Gemini (research) | Full research preserved in `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`. Not authorized for implementation. |
| Kilo ↔ Gemini orchestration backbone — Part 1 Foundation | **IMPLEMENTED** | Kilo | TaskRegistry, Orchestrator, ACP Schema, and focused tests implemented in `poc/` and `test/`. See commit `TBD`. |
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
| 6 | Agent Activation / Trigger Architecture | **CURRENT / IMPLEMENTED** | — | Kilo activation is a confirmed Kilo Cloud Agent capability (ARCHITECTURE.md Section 16.5.6). Activation mechanism: Kilo-provider-controlled HTTP webhook trigger, dispatched from repository via `/poc/kilo` endpoint and `poc/kilo-transport.js`. The exact provider completion/callback mechanism remains an implementation dependency to verify. Do not infer activation from GitHub workflow existence alone. |
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
- Kilo ↔ Gemini orchestration backbone implementation — **Part 1 Foundation IMPLEMENTED**; see `docs/ai/KILO_GEMINI_ORCHESTRATION_PLAN.md`. Part 2 (Gemini triggering and callback integration) remains PROPOSED / TARGET.
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
