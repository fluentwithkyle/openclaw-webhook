# Current AI Project State

**Last Updated**: 2026-09-12
**Updated By**: Kilo — tracked architectural standardization audit items from Gemini audit (Issue #35)

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
| Kilo ↔ Gemini orchestration backbone | **PROPOSED / PENDING KYLE APPROVAL** | — | Implementation plan: `docs/ai/KILO_GEMINI_ORCHESTRATION_PLAN.md`; this document does not authorize implementation |
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
| 1 | ACP Protocol Standardization | **PROPOSED / TARGET** | — | Formalize the ACP schema; establish the authoritative ACP specification; transition the existing POC toward a standardized protocol. See `ARCHITECTURE.md` Section 16.3. |
| 2 | ACP Router / Dispatcher | **PROPOSED / TARGET** | — | Build the structured ACP command parser and dispatcher; establish routing of authorized tasks to specialist/execution lanes. |
| 3 | Structured AI Task Reporting | **PROPOSED / TARGET** | — | Define a standardized machine-readable task completion/reporting format suitable for automated parsing and orchestration. See `docs/ai/KILO_GEMINI_ORCHESTRATION_PLAN.md` Section 6. |
| 4 | Capability-Based Authorization | **PROPOSED / TARGET** | — | Standardize explicit capabilities and permitted paths for ACP commands; establish authorization requirements for agent-to-agent task handoffs. |
| 5 | AI Project State Automation | **PROPOSED / TARGET** | — | Establish a structured, machine-readable mechanism for maintaining project/task state. `docs/ai/STATE.md` remains the human-readable authoritative project-state view unless the architecture establishes a more appropriate authoritative source. |
| 6 | Agent Activation / Trigger Architecture | **PROPOSED / TARGET** | — | Define standardized triggering events for agent activation and handoffs; track the mechanism by which one agent determines that another agent should be activated. |
| 7 | Agent Communication / Transport Layer | **PROPOSED / TARGET** | — | Define the standardized transport mechanism for agent-to-agent communication. Accounts for the existing Kilo HTTP trigger POC and the planned Qwen → ACP → specialist flow. |
| 8 | Asynchronous / Long-Running Task Handling | **PROPOSED / TARGET** | — | Define how tasks exceeding normal HTTP request lifetimes are represented, persisted, resumed, and reported. See `ARCHITECTURE.md` Section 15.3. |
| 9 | Failover Authorization | **PROPOSED / TARGET** | — | Define how ACP authorization remains valid and controlled during agent failover scenarios. See `ARCHITECTURE.md` Section 18. |
| 10 | Kilo HTTP Trigger Secret Rotation | **PROPOSED / TARGET** | — | Define the mechanism and lifecycle for rotating shared secrets used by the Kilo HTTP trigger. Rotation must not be performed during this task. |

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
- Kilo ↔ Gemini orchestration backbone implementation — PROPOSED / TARGET; see `docs/ai/KILO_GEMINI_ORCHESTRATION_PLAN.md`
- LINE-centered AI operating model (PROPOSED / TARGET)
- Qwen Router implementation (UNDER VALIDATION)
- Security AI lane definition (PROPOSED / TARGET)
- Utility AI lane definition (PROPOSED / TARGET)
- ACP protocol implementation (PROPOSED / TARGET)

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
