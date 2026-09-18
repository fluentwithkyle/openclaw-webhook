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

---

## ADR-013: Kilo Activation Mechanism — Provider-Controlled HTTP Webhook Trigger

**Status**: CURRENT / IMPLEMENTED (capability) / PROPOSED / TARGET (completion callback)
**Date**: 2026-09-14
**Context**: Kilo is an external Cloud Agent. For automatic activation to have a clear architectural home, the activation mechanism must be verified and distinguished from execution, delivery, verification, orchestration, and transport.
**Decision**: Kilo activation is a confirmed Kilo Cloud Agent HTTP webhook trigger capability (`ARCHITECTURE.md` Section 16.5.6). The repository dispatches authorized ACP commands to Kilo via the `/poc/kilo` Express endpoint (`routes/poc.js`) reading `poc/command.json` and dispatching through `poc/kilo-transport.js` to the `KILO_TRIGGER_URL` configured endpoint. Activation is Kilo-provider-controlled, not repository-controlled or Kilo-execution-controlled.
**Rationale**:
- Kilo activation must have an explicit architectural home that is distinct from execution (Kilo performing the task), delivery (Kilo producing repository changes via commit/push), verification (independent mechanisms verifying delivered state), orchestration (determining authorized subsequent actions), and transport (carrying task or result between components).
- The repository controls when a dispatch request is made (via `/poc/kilo`), but Kilo's actual activation is controlled by the Kilo Cloud Agent provider via its HTTP webhook trigger capability.
- The Kilo completion/callback path (Kilo → repository) is PROPOSED / TARGET. A customer-configurable outbound completion webhook is not established as a documented capability. The orchestration plan's `POST /poc/kilo/callback` endpoint is PROPOSED and must be verified during implementation.
**Consequences**:
- Activation, execution, delivery, verification, orchestration, and transport are architecturally distinct functions.
- Kilo self-report is execution evidence, not independent delivery proof.
- No repository event (issue, commit, workflow run) automatically activates Kilo; activation requires an explicit authorized ACP command dispatched to the Kilo trigger URL.
- The Kilo trigger URL and shared-secret authentication material are credentials and must not be committed, logged, or exposed in documentation or issues.
- AI sessions may be temporary; repository state (commits, diffs, CI results) provides persistent verification independent of Kilo's report.

---

## ADR-014: Security Specialist Architectural Foundation

**Status**: PROPOSED / TARGET (architectural foundation established)
**Date**: 2026-09-12
**Context**: The Security Specialist lane is defined as PROPOSED / TARGET in ARCHITECTURE.md (Sections 12.7 and 17.2). The lane exists only as a high-level description without an activation model, authority model, risk-based activation criteria, or open architectural decisions. Without these, the routing layer (Qwen) and Architect (Gemini) lack the structured basis to determine when a Security Specialist review is required, what authority the specialist holds, or what architectural questions remain unresolved.
**Decision**: Establish the Security Specialist architectural foundation in ARCHITECTURE.md:

- **Activation Model**: Three risk tiers — Mandatory (review required before implementation; triggered by `security_review_required: true` in ACP command, or auth/credential/secrets/trust-boundary/cryptographic changes), Conditional (review triggered when task touches elevated security surface area; triggered by `security_audit_context` with relevant concerns, or webhook/API/persistence/CI-CD/dependency changes), and Advisory (consultation at discretion of routing layer or Architect for general security hygiene).
- **Authority Model**: Advisory Authority (produces Security Audit Report informing Architect and Director; does not authorize or block commits directly), Gatekeeping Authority (for Mandatory-tier tasks, must complete review and produce report before implementation ACP command to Kilo may be issued; Orchestrator enforces gate; does not block for Conditional/Advisory), and No Implementation Authority (does not write production code, modify files, or execute implementation tasks).
- **Risk-Based Activation Criteria**: Tabulated mapping of trigger conditions to tiers (Mandatory/Conditional/Advisory) and gates (blocked until report / consulted in parallel / no gate).
- **Optional Security Fields**: `security_review_required` (boolean) and `security_audit_context` (object with `touch_points`, `risk_indicators`, `requested_focus`, `prior_audit_ref`) added as optional ACP command envelope extensions.

**Rationale**:
- Provides the structured basis for Qwen Router risk classification and activation routing.
- Establishes clear authority boundaries: Security Specialist is advisory/gatekeeping, not implementation.
- Makes activation criteria explicit and machine-evaluable where possible (`security_review_required`).
- Distinguishes Mandatory (hard gate) from Conditional (parallel) from Advisory (optional) to avoid unnecessary blocking while preserving security review where needed.
- Preserves the existing architectural boundary: Security Specialist does not replace, disable, or rewrite existing AI lanes or production code.

**Consequences**:
- The Security Specialist remains PROPOSED / TARGET for activation until the Qwen Router implements the trigger logic (see Open Architectural Decisions below).
- Three open architectural decisions are recorded: (1) Qwen Router Trigger Logic Refinement, (2) Security Audit Report Persistence Mechanism, and (3) Security Specialist Callback Mechanism to Orchestrator. These are explicitly PROPOSED / TARGET and must not be claimed as resolved.
- The optional ACP security fields (`security_review_required`, `security_audit_context`) are added to the schema illustration but do not alter the current mandatory ACP contract.
- `poc/command.json` and `poc/test.js` updated to include and validate the optional security fields with backward-compatible tests.
- No production code, workflows, services, or agent implementation behavior is modified by this decision.

---

## ADR-015: Chatbox Gateway — Authenticated Non-Authorizing Ingress into Existing ACP Control Plane

**Status**: IMPLEMENTED / VERIFIED (research complete; gateway implemented and verified)
**Date**: 2026-09-18
**Context**: Chatbox iOS provides phone-based natural-language access to the AI control plane via OpenRouter → DeepSeek using an OpenAI-compatible interface. The long-term objective is to allow the owner (Kyle) to communicate high-level desired outcomes from a phone and have the existing AI control plane translate that intent into legitimate planning, implementation, testing, review, and deployment work. The existing repository already has a canonical Coordinator ingress (implemented via `POST /poc/coordinator` for DeepSeek), ACP validation, TaskRegistry, orchestrator, and Kilo/Gemini execution lanes. MCP investigation established that Chatbox iOS does not provide the desktop-style MCP tool-execution loop, so a direct remote-MCP approach is not viable. The Chatbox gateway ingress has been implemented following this established Direct ACP pattern.

**Decision**:
- Chatbox must be an **authenticated, non-authorizing ingress / translation layer**. The gateway authenticates the caller and preserves the user's natural-language intent, then submits the request into the **existing** control plane (following the Direct ACP pattern established by the DeepSeek Coordinator ingress).
- The gateway must **NOT** independently grant: `modify_files`, `commit`, `push`, arbitrary `permitted_paths`, `FAILOVER_EXECUTE`, or other elevated capabilities.
- Authorization classification (REVIEW / VERIFY_RECONCILE / FAILOVER_EXECUTE, capabilities, permitted paths) belongs to the **trusted Coordinator / orchestration / ACP layer**, not to the Chatbox ingress.
- A **two-stage authorization model** applies: Stage 1 — Ingress (authenticate, preserve intent, submit to control plane, do not escalate); Stage 2 — Authorization / orchestration (classify, determine ACP mode, determine capabilities and permitted paths, issue/validate the authorized ACP command, dispatch to the appropriate specialist).
- A permanent REVIEW-only policy for Chatbox is rejected: REVIEW is the initial bounded state for an unverified request, not the permanent capability ceiling of the phone interface.
- The gateway must not become a second authorization system. It must not create a parallel orchestration path, a second task registry, or a separate control plane.
- The Chatbox authentication mechanism is resolved: a dedicated `x-chatbox-gateway-secret` header (env: `CHATBOX_GATEWAY_SECRET`), providing a credential boundary distinct from `KILO_CALLBACK_SECRET`, `GEMINI_CALLBACK_SECRET`, `DEEPSEEK_COORDINATOR_SECRET`, and `ACP_POC_TRIGGER_SECRET`.
- The remaining unresolved architectural items (exact Qwen Router classification/trigger implementation, exact Security Specialist callback mechanism, exact Security Audit Report persistence mechanism) remain **UNKNOWN** and must not be silently resolved.

**Rationale**:
- Preserves user intent without allowing natural-language input itself to grant authority.
- Prevents the phone interface from being reduced to a read-only terminal (rejecting permanent REVIEW-only).
- Leverages the existing implemented Coordinator ingress pattern rather than building a parallel control plane.
- Keeps FAILOVER_EXECUTE as an exceptional, security-gated mode that the gateway cannot grant directly.
- Aligns with existing ADR-005 (Specialist Lanes with ACP Boundary), ADR-009 (No Secrets in Documentation), ADR-011 (OpenClaw Independence), and ADR-014 (Security Specialist Architectural Foundation).

**Consequences**:
- The Chatbox gateway is **IMPLEMENTED / VERIFIED** in `routes/poc.js` as `POST /poc/chatbox`.
- This decision records the architectural contract that the implementation followed.
- The existing DeepSeek Coordinator ingress (`POST /poc/coordinator`) remains the proven reference pattern for the Chatbox ingress; the Chatbox gateway reuses the same `validateACPCommand`, `taskRegistry.createTask`, and `getDispatcher()` path.
- The Chatbox authentication mechanism is resolved as a dedicated header/env boundary; the three remaining unresolved architectural items (Qwen Router trigger logic, Security Specialist callback, Security Audit Report persistence) remain open and are tracked in `docs/ai/STATE.md`.
- No separate orchestration system, second task registry, parallel authorization architecture, or new dependencies were introduced.
- The gateway issues only REVIEW-mode ACP commands (read_only capability, poc/ permitted paths); it does not grant elevated capabilities directly from natural-language input.
- A detailed research record is preserved in `docs/ai/CHATBOX_ACP_ARCHITECTURE_RECORD.md`.