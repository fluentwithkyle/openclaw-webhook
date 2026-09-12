# Architectural Decisions Record

**Format**: ADR-style (Title, Status, Context, Decision, Rationale, Consequences)
**Authority**: `ARCHITECTURE.md` remains authoritative for overall architecture. This file records significant decisions and rationale for persistent AI project context.

---

## ADR-001: Render Owns Business Logic; Apps Script Is Google Adapter

**Status**: ACCEPTED — CURRENT / IMPLEMENTED
**Date**: 2026-08-31 (initial architecture)
**Context**: The system integrates Tally, Cal.com, Google Sheets, Gmail, and LINE. Business decisions must be centralized and not leak into Google-specific operations.
**Decision**: Render / Node.js owns all business decisions, lifecycle logic, workflow orchestration, CRM decisions, and notification content. Google Apps Script is strictly a Google-specific adapter for Sheets reads/writes and Gmail delivery.
**Rationale**: Keeps business rules in one place (Render), testable and versioned. Apps Script remains lightweight and replaceable. Prevents logic duplication and drift.
**Consequences**:
- All lifecycle transitions decided in Render.
- Apps Script receives action payloads, executes Google operations, returns results.
- No business logic in Apps Script (e.g., no independent CRM updates, no lifecycle decisions).

---

## ADR-002: Google Sheets as Current CRM

**Status**: ACCEPTED — CURRENT / IMPLEMENTED
**Date**: 2026-08-31
**Context**: Need a simple, accessible CRM for client records, intake context, package, credits, schedule state, booking data.
**Decision**: Use Google Sheets as the CRM backend, accessed via Apps Script adapter. 22-column Clients sheet covers identity, intake, package, credits, schedule, booking/cancellation, questions.
**Rationale**: Low operational overhead, familiar interface for human operators, integrates with Gmail/LINE via Apps Script.
**Consequences**:
- Render determines values; Apps Script performs physical writes.
- CRM schema changes require coordinated Render + Apps Script updates.
- Not a long-term scalable database; future migration may be needed.

---

## ADR-003: Abandoned-Booking Workflow Moved to Render

**Status**: ACCEPTED — CURRENT / IMPLEMENTED (code) — DEPRECATED ARCHITECTURALLY (legacy Apps Script version)
**Date**: 2026-09 (migration)
**Context**: Legacy `google-apps-script/AbandonedBookings.js` independently detected abandoned bookings, changed CRM data, and attempted to notify Render — violating "Render owns lifecycle decisions."
**Decision**: Implement abandoned-booking detection and recovery in Render (`workflows/abandonedBooking.js`). Legacy Apps Script version retained in repo but architecturally deprecated.
**Rationale**: Restores architectural boundary. Render detects elapsed > 30 min, updates CRM via Apps Script, sends LINE alert.
**Consequences**:
- Legacy Apps Script trigger must be verified disabled before removal.
- Current Render workflow has reliability gap: LINE alert sent before CRM update completes (duplicate-alert risk).
- Idempotency work required.

---

## ADR-004: Apps Script Trust Boundary Requires Hardening

**Status**: ACCEPTED — CURRENT / IMPLEMENTED (gap identified) — HARDENING REQUIRED
**Date**: 2026-09
**Context**: Apps Script web app deployed as anonymous, executed as deploying user. Accepts action payloads for CRM writes and Gmail delivery without application-level authentication.
**Decision**: Highest-priority hardening: require server-side shared secret, stored in Render env vars and Apps Script Script Properties. Authenticate before action routing. Remove hard-coded production endpoint fallback. Standardize responses.
**Rationale**: Prevents unauthorized CRM writes and email sends. Incremental fix — does not require Apps Script architecture redesign.
**Consequences**:
- Blocks other reliability work until complete (idempotency, standardized responses depend on authenticated boundary).
- Apps Script deployment may remain anonymously reachable; application-level auth is the boundary.

---

## ADR-005: AI Development System — Specialist Lanes with ACP Boundary

**Status**: PROPOSED / TARGET
**Date**: 2026-09 (architecture review)
**Context**: Multiple AI agents (Gemini, Kilo, planned Qwen, Security AI, Utility AI) need defined roles, explicit authorization, and structured handoffs.
**Decision**: Define specialist lanes: Gemini (Architect/Reviewer), Kilo (Builder/Implementer/Tester), Qwen (Router), Security AI, Utility AI. Formalize Agent Command Protocol (ACP) as structured envelope for task handoff with explicit capabilities, permitted paths, verification requirements.
**Rationale**: Prevents scope creep, credential leakage, silent authority expansion. Makes AI execution auditable and bounded.
**Consequences**:
- ACP is documentary only until implemented and validated.
- Kilo remains primary execution agent; commit/push only with explicit ACP authorization.
- GitHub Actions may serve as ephemeral AI execution plane (PROPOSED / TARGET).
- No production business logic moves into AI lanes.

---

## ADR-006: Persistent AI Project State in Repository

**Status**: ACCEPTED — CURRENT / IMPLEMENTED (this system)
**Date**: 2026-09-12
**Context**: AI agents previously relied on transient conversation memory. Need durable, repository-resident project state for context, decisions, and history.
**Decision**: Create `docs/ai/` with `README.md` (operating rules), `STATE.md` (current state), `ARCH_DECISIONS.md` (decision record), `TASK_LOG.md` (historical task log). Integrate into `AGENTS.md` so future agents discover and use it.
**Rationale**: Repository is the durable source of truth. Survives session boundaries. Enables agent continuity without conversation memory.
**Consequences**:
- Agents must read relevant `docs/ai/` files before planning work.
- Kilo updates `STATE.md` and `TASK_LOG.md` after authorized completed work.
- No secrets in any `docs/ai/` file.
- Distinction between authoritative architecture (`ARCHITECTURE.md`), current state (`STATE.md`), decisions (`ARCH_DECISIONS.md`), and history (`TASK_LOG.md`) must be clear.

---

## ADR-007: LINE as Notification Channel, Not Control Plane (Current)

**Status**: ACCEPTED — CURRENT / IMPLEMENTED
**Date**: 2026-08-31
**Context**: LINE used for operational notifications (booking alerts, recovery alerts, cancellations).
**Decision**: LINE remains a communication/notification channel. Not the business-rules engine. Future architecture may expand LINE into Kyle's natural-language control interface (PROPOSED / TARGET), but Render remains business-logic boundary.
**Rationale**: Separates notification delivery from business logic. Allows future expansion without architectural breach.
**Consequences**:
- Current LINE service (`services/lineService.js`) sends operational notifications only.
- Future control-plane work must preserve Render boundary.

---

## ADR-008: GitHub Actions as Ephemeral AI Execution Plane (Not Production)

**Status**: PROPOSED / TARGET
**Date**: 2026-09
**Context**: AI tasks need execution environments. GitHub Actions provides temporary runners.
**Decision**: GitHub Actions may launch AI tasks, run specialists, analyze repo, make changes, run tests, return results. Must NOT become production server, authoritative CRM, owner of business rules, or replacement for Render workflows.
**Rationale**: Leverages existing CI infrastructure for AI execution. Ephemeral nature requires persistent task state outside individual jobs (hence `docs/ai/` and ACP correlation IDs).
**Consequences**:
- Persistent state in `docs/ai/` and Git commits.
- Secrets managed via GitHub Actions secrets, not in repo.
- Production workflows stay on Render.

---

## ADR-009: No Secrets in Documentation or AI Context

**Status**: ACCEPTED — CURRENT / IMPLEMENTED (policy)
**Date**: 2026-08-31 (ongoing)
**Context**: AI agents process repository content. Documentation and AI context must not leak credentials.
**Decision**: Never include API keys, access tokens, webhook secrets, passwords, private keys, credentials, or sensitive production values in `ARCHITECTURE.md`, `AGENTS.md`, `GEMINI.md`, `docs/ai/`, or any documentation. Use existing secret-management mechanisms (Render env vars, Apps Script Script Properties, GitHub Actions secrets).
**Rationale**: Prevents accidental exposure through AI training data, logs, or repository history.
**Consequences**:
- AI agents receive only capabilities necessary for task.
- Cross-system calls use explicit auth (mechanism TBD during ACP design).
- Documentation describes architecture without sensitive values.

---

## ADR-010: Qwen Router Under Validation

**Status**: UNDER VALIDATION
**Date**: 2026-09
**Context**: Need lightweight router/task dispatcher to classify requests and route to specialist lanes (Gemini, Security AI, Utility AI).
**Decision**: Qwen is candidate router. Must not be primary implementer, architecture authority, security authority, or replacement for Gemini/Kilo. Must not bypass ACP or issue unrestricted shell/Git instructions. Model size decision pending validation.
**Rationale**: Offloads routing from higher-reasoning models. Enables specialist focus.
**Consequences**:
- Do not claim larger Qwen model implemented unless verified.
- Qwen → ACP → Kilo boundary documented in `ARCHITECTURE.md` Section 16.4.
- Boundary does not depend on OpenClaw (ADR-011).

---

## ADR-011: OpenClaw Independence from Qwen → ACP → Specialist Boundary

**Status**: PROPOSED / TARGET
**Date**: 2026-09
**Context**: OpenClaw provides orchestration/mediation. Qwen → ACP → specialist execution boundary must work without OpenClaw.
**Decision**: OpenClaw may eventually provide transport, message routing, event orchestration, LINE integration, automated invocation. Must not alter ACP command contract or become prerequisite for Qwen → specialist boundary.
**Rationale**: Keeps execution boundary testable and replaceable. OpenClaw is pluggable orchestration layer.
**Consequences**:
- Production capabilities ↔ ACP ↔ Orchestration layer separation maintained.
- OpenClaw can remain central, narrow, be replaced, or become optional without redesigning production system.

---

## ADR-012: Failover Must Preserve ACP Contract and Authorization

**Status**: PROPOSED / TARGET
**Date**: 2026-09
**Context**: Specialist or builder AI may become unavailable. Failover must not silently expand permissions or bypass controls.
**Decision**: Failover preserves original task, authorized scope, repository, target branch, ACP authorization, verification, reporting. Replacement specialist must have explicitly defined role and appropriately authorized ACP command. No silent fallback. Human escalation if all paths unavailable.
**Rationale**: Safety and auditability. Prevents permission drift during failures.
**Consequences**:
- Execution report must identify which AI executed, whether failover occurred, why, what changed, verification, commit/push state, blockers.
- Clearly distinguish implemented vs proposed failover.
- No failover implementation during this task.