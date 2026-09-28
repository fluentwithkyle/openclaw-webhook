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

---

## ADR-016: Git Completion Signal Path 2 — Git/GitHub as Durable Evidence with TaskRegistry as Runtime Orchestration State

**Status**: APPROVED / IMPLEMENTED / VERIFIED (architectural direction approved and implemented by TASK-KILO-GIT-COMPLETION-SIGNAL-PATH-2-RECOVERY-IMPLEMENTATION-001, Issue #175)
**Date**: 2026-09-20 (direction) → 2026-09-21 (implementation)
**Task**: TASK-KILO-GIT-COMPLETION-SIGNAL-PATH-2-RECOVERY-IMPLEMENTATION-001

### Context

The Git-based Kilo completion-signal POC (Issue #162, commit `bf68116`) is **IMPLEMENTED / VERIFIED (UNDER VALIDATION)**. It allows Kilo to emit a durable completion signal as a Git artifact (`poc/signals/<request_id>.json`) committed and pushed to `main`, which Render receives via a GitHub push webhook (`POST /poc/github/webhook`) in `routes/poc.js`, validates (HMAC-SHA256 signature, repository/branch/ref, request_id, signal schema), and delegates to the existing TaskRegistry correlation and `orchestrator.handleKiloCompletion()` path.

The self-referential commit-SHA defect identified during POC implementation was **RESOLVED** by commit `f63211d` (TASK-KILO-GIT-COMPLETION-SIGNAL-COMMIT-SHA-HARDENING-002): `validateSignal()` now allows `commit_sha` to be absent, null, or empty (rejecting only when a non-empty value mismatches the authoritative `head_commit.id`); `buildCompletionReport(signal, headCommitSha)` accepts and assigns the authoritative `headCommitSha`; `processSignalFile()` passes `headCommit.id` as the authoritative commit SHA.

A controlled live-validation signal artifact exists at `poc/signals/TASK-KILO-GIT-COMPLETION-SIGNAL-LIVE-VALIDATION-002.json` (commit `f9d97e5`).

**Previous architectural defect (now resolved)**: The Git completion-signal processing path retained a hard dependency on **ephemeral TaskRegistry state**. In `poc/github-webhook.js` `processSignalFile()` (lines 339–349), when `taskRegistry.getTask(requestId)` returns `null`, the signal was rejected at the `registry` stage with `error: 'Unknown request_id - not found in TaskRegistry'`. The TaskRegistry (`poc/task-registry.js`) persists to a local file (`poc/task-registry.json`) within the Render container. If that state is lost — for example, a Render container restart without persistent volume mount, deployment replacement, or file-system loss — the TaskRegistry entry was absent, and a valid, durable Git completion signal **could not be correlated or processed**, even though all durable evidence of the task exists in Git/GitHub.

**Resolution (Path 2 implementation — TASK-KILO-GIT-COMPLETION-SIGNAL-PATH-2-RECOVERY-IMPLEMENTATION-001)**: `processSignalFile()` now attempts Git-derived recovery via `recoverTaskFromGitHub()` when TaskRegistry state is absent, before rejecting. This breaks the hard dependency: when TaskRegistry state is lost, the Git completion path falls back to Git-derived recovery from GitHub issue evidence rather than rejecting the signal. When TaskRegistry state exists, the existing normal path is preserved unchanged.

### Decision

**Path 2 is the selected architectural direction** for resolving the Git completion-signal durability problem.

Path 2: Use **Git/GitHub as the durable completion/recovery evidence** layer while **retaining TaskRegistry as runtime orchestration state**. When TaskRegistry state is absent, **reconstruct task context from durable Git/GitHub evidence** (Git-derived recovery/rehydration) rather than rejecting the signal.

This is contrasted with the alternative:

**Path 1 (not selected as the first direction)**: External durable persistence (Postgres/Redis) to make TaskRegistry itself durable, eliminating the loss scenario by making the runtime state durable.

The Solution Simplicity Gate is satisfied: Path 2 reuses the existing Git evidence layer already established by the POC rather than introducing new infrastructure. External durable persistence (Path 1) is deferred until investigation proves it necessary (see Escalation Condition).

**Status distinction**: Path 2 is **APPROVED / IMPLEMENTED / VERIFIED**. The recovery/rehydration mechanism is **IMPLEMENTED** via `recoverTaskFromGitHub()` in `poc/github-webhook.js` and `rehydrateTask()` in `poc/task-registry.js`. The existing Git completion-signal mechanism (signal artifact, webhook, correlation, orchestrator delegation) **IS IMPLEMENTED (UNDER VALIDATION)** — unchanged. This ADR documents the architectural direction and records its implementation.

### Durable Evidence vs. Runtime Orchestration State

| Layer | Role | Current Implementation | Durability |
|-------|------|----------------------|------------|
| **Git/GitHub** | Durable completion/recovery evidence | Signal artifact at `poc/signals/<request_id>.json`; GitHub push webhook delivery; Git commit metadata | Durable — persisted in GitHub |
| **TaskRegistry** | Runtime orchestration state | `poc/task-registry.js` persisted to `poc/task-registry.json` (local file) | Ephemeral — lost on container restart without persistent volume |

**Key distinction**: Git/GitHub provides the durable evidence that a task exists and completed. TaskRegistry provides the runtime orchestration correlation state (task lifecycle, current agent, next action, capabilities, permitted paths). These are distinct concerns that must not be conflated.

### Target Lifecycle

**Normal path** (TaskRegistry state present — current implemented behavior):

```
Kilo completes authorized work
    → Kilo commit/push to main
    → GitHub push event
    → Route: POST /poc/github/webhook
    → Git signal artifact (poc/signals/<request_id>.json) detected
    → TaskRegistry correlation (taskRegistry.getTask(request_id))
    → orchestrator.handleKiloCompletion(requestId, report)
    → orchestrator.triggerGemini(requestId) → GitHub workflow_dispatch → Gemini
```

**Recovery path** (TaskRegistry state absent — IMPLEMENTED):

```
Kilo completes authorized work
    → Kilo commit/push to main
    → GitHub push event
    → Route: POST /poc/github/webhook
    → Git signal artifact (poc/signals/<request_id>.json) detected
    → TaskRegistry absent (state lost)
    → recoverTaskFromGitHub(requestId, token):
        • Search GitHub issues by title (exact request_id)
        • Fetch issue body (the ACP task envelope)
        • parseACPCommandFromIssueBody(): extract ACP Envelope, Capabilities,
          permitted paths from Required Implementation Areas, Objective, Verification
        • validateACPCommand(): validate recovered task as ACP command
        • validateAuthorization(): validate task_mode, capabilities, permitted_paths
        • Execution-path authorization check: require commit + push capabilities
        • taskRegistry.rehydrateTask(): construct minimal TaskRegistry entry,
          transition PENDING → SELECTED → PLANNED → EXECUTING
    → processSignalFile continues through existing completion/orchestration path:
        buildCompletionReport(signal, headCommit.id)
        → orchestrator.handleKiloCompletion(requestId, report)
        → orchestrator.triggerGemini(requestId) → GitHub workflow_dispatch → Gemini
```

The recovery path must preserve the existing orchestrator, state machine, and Kilo→Gemini handoff. The TaskRegistry remains the normal runtime state mechanism; recovery is the fallback when it is absent.

### TaskRegistry as Runtime State (Not Replacement Target)

TaskRegistry should remain the normal runtime orchestration state mechanism rather than being replaced by Git. TaskRegistry provides:

- Task lifecycle state (PENDING → SELECTED → PLANNED → EXECUTING → VERIFIED → COMPLETE)
- Current agent and next agent tracking
- Capabilities and permitted paths per task
- Verification requirements propagation
- Idempotency guards (kilo.status / gemini.status)

Git/GitHub does not replace these runtime functions. Git/GitHub provides the durable evidence for recovery **into** TaskRegistry. The recovery path rehydrates TaskRegistry state from durable Git/GitHub evidence; it does not bypass TaskRegistry.

### The Git Completion Path Must Not Retain a Hard Dependency on Ephemeral TaskRegistry State

The Git completion path must not retain a hard dependency on ephemeral TaskRegistry state. `processSignalFile()` previously required `taskRegistry.getTask(requestId)` to return a non-null task; if absent, the signal was rejected at the `registry` stage. Path 2 **has resolved** this: when TaskRegistry state is absent, `processSignalFile()` now falls back to Git-derived recovery via `recoverTaskFromGitHub()` before rejecting. When TaskRegistry state exists, the existing normal path is preserved unchanged.

### Resolved Implementation Question

**What minimum task state is required for safe reconstruction, and where can the authoritative ACP task/authorization context be recovered from?**

Resolved during implementation (TASK-KILO-GIT-COMPLETION-SIGNAL-PATH-2-RECOVERY-IMPLEMENTATION-001):

1. **Minimum recoverable task fields**: The TaskRegistry entry (`poc/schemas/acp-schema.js` `TASK_REGISTRY_REQUIRED_FIELDS`) requires: `request_id`, `parent_request_id`, `originator`, `current_agent`, `next_agent`, `repository`, `base_branch`, `task`, `status`, `created_at`, `updated_at`, `kilo`, `gemini`, `next_action`, `verification`. All of these are deterministically reconstructed via `createInitialTaskRegistryEntry(command)` (which sets defaults for `parent_request_id`, `current_agent`, `next_agent`, `status`, timestamps, `kilo`, `gemini`, `next_action`) combined with fields parsed from the ACP command envelope (`repository`, `base_branch`, `task`, `task_mode`, `verification`, `originator`). The state is then transitioned to `EXECUTING` via `taskRegistry.rehydrateTask()`.

2. **Authoritative ACP task/authorization recovery source**: The **GitHub issue body** is the authoritative source. `recoverTaskFromGitHub()` searches GitHub issues by title matching the exact `request_id`, fetches the issue body, and `parseACPCommandFromIssueBody()` parses the ACP Envelope (key-value pairs), Capabilities (list items), permitted paths (from Required Implementation Areas backtick-quoted paths), Objective (task description), and Verification sections. The signal artifact provides identity correlation (signal `request_id`) and commit evidence but does NOT provide authorization — authorization comes from the recovered ACP command.

3. **Authorization vs. identity boundary**: The recovered task context establishes task identity and context. Authorization is re-derived from the ACP command envelope, not from the `request_id` discovery. `validateACPCommand()` and `validateAuthorization()` enforce ACP schema and authorization rules. An additional execution-path check requires `commit` and `push` capabilities (since Kilo committed and pushed the completion signal). If the ACP command cannot be recovered, does not correlate exactly by `request_id`, fails ACP validation, fails authorization validation, or does not authorize the execution path, recovery fails closed.

### Security Boundary: request_id Is Identity Evidence, Not Authorization

**Discovering a `request_id` in a Git completion signal is task identity evidence, not authorization.**

The recovery path must preserve the ACP authorization boundary established in `ARCHITECTURE.md` Section 16.5.2:

- Successful authentication of the Kilo trigger does NOT authorize arbitrary repository activity.
- The ACP command must explicitly establish: permitted repository paths, permitted capabilities, task scope, verification requirements, reporting requirements.
- A valid authorization token/capability never grants unrestricted access beyond the explicitly listed capabilities.
- Recovery must not grant authorization merely from discovery of a `request_id` in Git history or from recovered task metadata.

The recovery path reconstructs task **state** (identity, context, prior status), not task **authorization**. Authorization remains governed by the original ACP command. If the ACP command cannot be recovered from durable evidence, the recovery path must fail closed rather than proceed without authorization.

### Why Render Deployment Delay Is Insufficient

A Render deployment timing/delay is **not** considered a fundamental solution to this durability problem.

The architectural defect is not a timing problem — it is a **state durability** problem. Render deployment delay only changes **when** the Git signal is processed; it does not establish **whether** the required TaskRegistry state is durably available. If the TaskRegistry state is lost (container restart, file-system loss), delaying the processing of the Git signal does not recover the state. The signal would still be rejected at the `registry` stage.

Delay therefore does not address the root cause: the historical hard dependency of Git-signal processing on ephemeral runtime state. Path 2 has resolved this by adding a recovery path that reconstructs TaskRegistry state from Git/GitHub evidence when the ephemeral state is absent. Only making the state itself durable (either by recovering it from Git evidence per Path 2, or by introducing external durable persistence per Path 1) addresses the defect.

### Solution Simplicity Conclusion

Do **not** introduce Postgres/Redis (or any external durable persistence) unless investigation proves that the required task or authorization state cannot be safely and deterministically recovered from Git/GitHub evidence.

Path 2 is the simplest viable solution that addresses the defect: the durable evidence layer (Git/GitHub) already exists via the POC signal artifact and webhook. The recovery path extends the existing Git evidence to also carry task-context reconstruction, without introducing new infrastructure. External durable persistence is an escalation that must be justified by evidence that Git/GitHub recovery is insufficient.

### External-Persistence Fallback (Escalation Condition)

External durable persistence (Postgres/Redis) becomes justified **only if** investigation establishes that:

- The required task state needed for safe reconstruction cannot be deterministically recovered from Git/GitHub evidence, **and**
- The required ACP task/authorization context cannot be authoritatively recovered from the durable Git evidence (e.g., GitHub issue body, commit metadata, signal artifact), **and**
- This insufficiency is demonstrated through validation of the Git-derived recovery model.

Path 2 must be attempted and validated first. External persistence is the fallback, not the default.

### Implementation Phase (Completed)

IMPLEMENTED by TASK-KILO-GIT-COMPLETION-SIGNAL-PATH-2-RECOVERY-IMPLEMENTATION-001 (Issue #175):

1. Established the minimum recoverable TaskRegistry state: all `TASK_REGISTRY_REQUIRED_FIELDS` deterministically reconstructed via `createInitialTaskRegistryEntry(command)` + state transitions to `EXECUTING`.
2. Validated the recovery model: implemented and tested the Git-derived recovery/rehydration path with 19 new tests covering normal path, recovery path, rejection cases, idempotency, commit-SHA behavior, and no regression.
3. Implemented with ACP authorization: changes scoped to `poc/github-webhook.js`, `poc/task-registry.js`, `poc/schemas/acp-schema.js` (used, not modified), and `test/github-webhook.test.js`.

### Preserved Boundaries

This architectural direction preserves:

- **Kilo → Gemini lifecycle**: The existing completion flow (TaskRegistry correlation → `orchestrator.handleKiloCompletion()` → `orchestrator.triggerGemini()` → GitHub Actions `workflow_dispatch` → Gemini execution → callback/result processing). Recovery rehydration inserts before `handleKiloCompletion()` only when TaskRegistry is absent; when present, the existing path is unchanged.
- **Existing polling mechanism**: `poc/kilo-polling.js` repository-controlled polling path.
- **Existing callback mechanism**: `POST /poc/kilo/callback` endpoint and `poc/kilo-verifier.js` independent verification lane.
- **Existing Kilo HTTP trigger dispatch**: `POST /poc/kilo` route dispatching to Kilo via `getDispatcher()`.
- **ACP authorization boundary**: Authorization remains governed by the ACP command envelope, not by task identity recovery.
- **Specialist lane boundaries**: Gemini (Architect/Reviewer), Security AI (Security Specialist), Utility AI (General Utility Specialist) remain distinct; the Kilo↔Gemini orchestration backbone is not replaced.

### Consequences

- Path 2 is **APPROVED / IMPLEMENTED / VERIFIED**. The recovery/rehydration mechanism is **implemented** via `recoverTaskFromGitHub()` in `poc/github-webhook.js` and `rehydrateTask()` in `poc/task-registry.js`.
- The existing Git completion-signal mechanism remains **IMPLEMENTED / UNDER VALIDATION** (commit `bf68116`), with the commit-SHA defect **resolved** by `f63211d`.
- The architectural defect (hard dependency on ephemeral TaskRegistry state) is **resolved** — the recovery path now breaks the hard dependency while preserving TaskRegistry as the normal runtime state mechanism.
- The Git completion-signal POC test count is **77/77 focused tests pass** (58 original + 6 commit-SHA hardening + 13 Path 2 recovery), 270 regression tests pass, 347 total tests pass. The prior STATE.md/ARCH_DECISIONS.md entries stating the recovery mechanism is "not implemented" are **reconciled** by this implementation.
- This decision aligns with ADR-005 (Specialist Lanes with ACP Boundary), ADR-006 (Persistent AI Project State), ADR-013 (Kilo Activation Mechanism), and ADR-015 (Chatbox Gateway).

---

## ADR-017: DeepSeek Control-Plane Tool-Execution via a Trusted Server-Side Execution Runtime

### Status

**PROPOSED / TARGET** — Research documented. Implementation NOT authorized by this task. The decision records the architectural direction; the runtime and `control_plane` tool are not yet implemented.

### Date

2026-09-23

### Context

The goal is to allow DeepSeek (reached from Chatbox on a phone via OpenRouter) to perform authorized control-plane operations, such as requesting a Builder/Kilo task, through a narrowly scoped `control_plane` tool.

The repository already provides a DeepSeek control-plane ingress via **Direct ACP** (`POST /poc/coordinator`, `routes/poc.js:772`, `ARCHITECTURE.md` Section 16.6): DeepSeek emits canonical ACP JSON directly to the coordinator, which runs `validateACPCommand` → `taskRegistry.createTask` → `getDispatcher()` → Kilo/Builder. This is the **current, implemented** path.

The research question was whether DeepSeek could instead drive control-plane operations through OpenRouter's tool-calling interface. Investigation established:

- A model (including DeepSeek via OpenRouter) **never executes its own tool calls over the network**. The model returns a structured `tool_calls` request; the application that hosts the model interaction executes the requested tool and returns the result (OpenRouter official documentation, `https://openrouter.ai/docs`).
- OpenRouter is a model/API provider-routing proxy. It returns model outputs (including `tool_calls`) but does **not** execute this project's custom `control_plane` function.
- Chatbox was not to be treated as the arbitrary HTTP tool executor (that would invert the trust boundary).
- A repository-wide search confirmed **no** existing OpenRouter/DeepSeek tool-execution implementation exists in source code (no `OPENROUTER_API_KEY`, no `tool_calls` handling, no `@openrouter/agent`, no MCP, no `execution runtime`, no `control_plane` symbol). (See `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-CONTROL-PLANE-RESEARCH-DOCUMENT-001.md` Section 15.)

### Decision

A future, explicitly-scoped implementation task (not this research task) may introduce a single new trusted component: a **server-side execution runtime** that hosts the DeepSeek/OpenRouter tool-calling loop and exposes a narrow `control_plane` tool. The runtime:

- Is the **executor** of `control_plane` tool calls (the model decides *when*; the runtime executes *how*), not a replacement for DeepSeek and not a second control plane.
- Translates the validated tool request into a canonical ACP command and authenticates `POST /poc/coordinator` using the **server-side** secret (`x-deepseek-coordinator-secret` / `DEEPSEEK_COORDINATOR_SECRET`), never a model-supplied value.
- Feeds the **existing** ACP boundary (`validateACPCommand` → `TaskRegistry.createTask` → `getDispatcher()` → Kilo/Builder) — reusing `poc/schemas/acp-schema.js`, `poc/acp-engine.js`, `poc/task-registry.js`, `services/transport-provider.js`.
- Retains server-side authority over endpoint, authentication, ACP construction (`task_mode`, `capabilities`, `permitted_paths`), target, validation, and execution policy (bounded loop, iteration limits, safe logging).
- Exposes `control_plane(...)` — **not** a generic `http_post(url, headers, body)` primitive.

This decision does **not** approve implementation. It constrains any future implementation to the boundary above and explicitly forbids the prohibited items in the Consequences.

### Rationale

- The tool-calling protocol is by design application-side: the model cannot reach `/poc/coordinator` itself. Without a server-side runtime hosting the loop, DeepSeek has no trusted executor for a `control_plane` tool.
- Reusing `/poc/coordinator` (Direct ACP) as the single control-plane boundary avoids a parallel orchestrator/TaskRegistry/dispatcher and preserves ACP authorization as the authoritative boundary.
- DeepSeek must not receive coordinator secrets, GitHub/Render credentials, arbitrary HTTP, unrestricted filesystem access, or unrestricted ACP capabilities. The runtime is the trusted validation/translation layer between untrusted model output and the trusted coordinator.
- The narrow `control_plane` tool (vs. generic HTTP) ensures the model cannot dictate endpoint, authentication, target, capabilities, or paths — the runtime determines those.
- Simplicity: a minimal application-side OpenRouter tool loop over `POST /api/v1/chat/completions` (with `max_iterations`, argument validation, ACP construction, and authenticated coordinator submission) satisfies the functional requirement without introducing an additional agent framework. The OpenRouter Agent SDK adds multi-model/MCP/streaming/ stop-condition facilities that are not required for this narrow requirement; MCP is, per OpenRouter's documentation, a build-time data-retrieval facility for assistants, not a control-plane runtime.

### Consequences

- **Not implemented by this decision**: server-side execution runtime; OpenRouter integration in the repository; `control_plane` tool definition/schema; runtime endpoint/interface and deployment topology; Chatbox production integration with the future runtime. These require a separate, explicitly-authorized implementation task (capabilities, permitted paths, verification) — they are **not** authorized under `RESEARCH_DOCUMENT`.
- **Current DeepSeek path unchanged**: Direct ACP (`POST /poc/coordinator`) remains the implemented, verified DeepSeek control-plane path. The future tool-calling runtime is a **complementary, future** ingress that submits to the SAME coordinator; it does not replace Direct ACP.
- **Prohibited** (no exceptions): a second `TaskRegistry`; a second orchestrator (`poc/orchestrator.js` remains sole); a second dispatcher (`getDispatcher()` remains sole); a parallel control plane; a generic unrestricted HTTP executor; any bypass around ACP validation (`poc/acp-engine.js` / schema `validateAuthorization`); model-supplied secrets, credentials, capabilities, endpoints, targets, or paths.
- **Security boundary**: DeepSeek receives only the narrow `control_plane` tool interface; all secrets, credentials, and ACP authority remain server-side.
- This decision aligns with ADR-005 (Specialist Lanes with ACP Boundary), ADR-006 (Persistent AI Project State), ADR-010 (Qwen Router Activation), ADR-015 (Chatbox Gateway), and ADR-016 (Git Completion-Signal Path 2 Recovery).

---

## ADR-018: DeepSeek Coordinator Evolution Retains the Existing Authority Chain

### Status

**APPROVED ARCHITECTURAL DIRECTION / IMPLEMENTED FOUNDATION / PROPOSED TARGET.**
The bounded runtime foundation is implemented on current main; full conversational
coordination is not yet implemented.

### Context

Current main contains `services/deepseek-runtime.js`, a ChatBox-facing OpenRouter
runtime with one model-facing `control_plane` tool. It server-derives ACP authority for
its narrow `request_task` operation and provides a namespace-constrained, sanitized
`get_task` observation operation. Earlier research records correctly described a
pre-runtime target, but cannot describe current main as though the runtime did not
exist. The project needs a durable next-phase boundary without creating a competing
control plane.

### Decision

DeepSeek is the conversational reasoning/coordinator intelligence, not an authority
layer. The runtime remains a bounded model-facing interface plus server-side policy
enforcement. ACP remains the sole command validation/authorization/registration and
dispatch contract; TaskRegistry remains durable task state; the existing
orchestrator/dispatcher remains the lifecycle; GitHub remains durable project truth;
and Kyle retains final authorization authority.

Future coordinator expansion must use a small set of strongly typed, server-policy
operations mapped to existing ACP modes, capabilities, paths, targets, verification
requirements, and human authorization gates. It must use bounded state-driven
continuation and durable TaskRegistry/specialist evidence, explicitly distinguish task
completion from independently verified outcome, and escalate unresolved decisions to
Kyle.

### Consequences

- No second control plane, TaskRegistry, orchestrator, dispatcher, generic HTTP
  executor, direct repository/GitHub access, arbitrary path/capability, or
  model-generated authority is permitted.
- Current `request_task` and `get_task` are foundation capabilities only; they do not
  implement workflow decomposition, specialist selection/activation, evidence
  interpretation, verification/reconciliation orchestration, or full outcome
  reporting.
- Phase 0 must define the minimal coordinator contract, policy, evidence projection,
  failure/blocked handling, and Kyle authorization gates before runtime expansion.
- A future capability registry, if justified, is policy representation only—not a
  replacement authority system.


---

## ADR-019: Phase 1 DeepSeek Coordinator Observation Uses Existing ACP Authority

### Status

**IMPLEMENTED / VERIFIED** (Phase 0 contract and Phase 1 observation only). Later coordinator capabilities remain **PROPOSED / TARGET**.

### Context

The implemented runtime already offers bounded `request_task` and `get_task` behavior,
but required a formal, testable representation of its capability, authority,
observation, and lifecycle boundaries without adding a second control plane.

### Decision

The runtime exports a structured Phase 1 policy that permits only intent-level
`request_task` and namespace-constrained `get_task`. Server policy derives every
authority-bearing ACP field and coordinator authentication context. Its safe task
projection reports identity, all eight lifecycle states, lineage, agents, next action,
execution/results, evidence counts/categories, verification, failure/blocked state,
and sanitized specialist evidence. It explicitly
separates execution completion (`AGENT_REPORT`) from verified outcome, which remains
controlled by existing ACP `INDEPENDENT_VERIFICATION` transition rules.

### Consequences

- ACP, TaskRegistry, and the existing orchestrator/dispatcher remain the sole
  authorization, registration, and lifecycle mechanisms; Kyle remains final authority.
- The model cannot grant paths, targets, task modes, capabilities, commits, pushes, or
  authentication/authorization context. Consequential capabilities remain excluded.
- Request-ID prefix validation is not session isolation or session binding.
- Phase 2+ workflow decomposition, specialist selection, and execution operations are
  **NOT IMPLEMENTED** and require future authorized ACP-backed
  policy work.

---

## ADR-020: Bounded Result-Driven Continuation Reuses Task Observation

### Status

**IMPLEMENTED / STATICALLY VERIFIED; RUNTIME EXECUTION BLOCKED**

### Context

The runtime already had one model-facing `control_plane`, bounded `get_task` observation, and lineage-constrained continuation. It needed a minimal same-execution way for a completed specialist result to inform the next bounded model decision without treating specialist output as authority or creating polling, callbacks, queues, or another state store.

### Decision

The existing `get_task` handler remains the sole result-observation path. It attaches a server-derived continuation classification based only on current TaskRegistry lifecycle, cancellation/supersession lineage, and `INDEPENDENT_VERIFICATION` evidence; it also reports whether the task was submitted during the current runtime execution. After successful `request_task` submission, the runtime automatically invokes that same observation projection once for the submitted request and returns it in the existing tool result. Only a `COMPLETE` task with independent-verification evidence is eligible. The runtime records that observed classification locally for the bounded loop, rechecks current TaskRegistry facts, then calls the existing `validateLineageForCreate()` before any child submission.

### Rationale

This supplies sanitized result context to DeepSeek automatically in the existing `request_task` tool message while retaining the current loop, task identity, TaskRegistry, projection, dispatcher, orchestrator, and ACP boundary. The single immediate observation is not polling and local same-execution correlation avoids a new persistence mechanism.

### Consequences

- `request_task` and `get_task` remain the only model-facing operations, and `MAX_TOOL_ITERATIONS` remains exactly 3.
- FAILED, BLOCKED, CANCELLED, SUPERSEDED, missing, invalid, active, and insufficiently verified results cannot progress a continuation.
- Result content, specialist reports, evidence, lineage, and tool output grant no authority; Director authorization remains required for consequential Builder or FAILOVER_EXECUTE work.
- Cross-request result delivery, workflow decomposition, automated specialist activation, and full conversational coordination remain **PROPOSED / TARGET**.

---

## ADR-021: Roadmap Alignment Gate — Mandatory Governance to Prevent Phase Drift

### Status

**ACCEPTED — CURRENT / IMPLEMENTED (documentation)**

### Date

2026-09-28

### Context

The DeepSeek Coordinator project drifted from its established Phase 0–3 roadmap into an open-ended sequence of observation increments (Increment 4.1–4.9) despite existing governance controls. Research record `docs/ai/research/research-TASK-GEMINI-COORDINATOR-ROADMAP-GOVERNANCE-FAILURE-PREVENTION-RESEARCH-001.md` (TASK-GEMINI-COORDINATOR-ROADMAP-GOVERNANCE-FAILURE-PREVENTION-RESEARCH-001) identified the root cause as the **absence of a mandatory Roadmap Phase Progression Gate**: existing controls govern *how* tasks execute, but none required proposed work to prove its necessity against the active roadmap phase before task generation. Contributing causes included the "identify the smallest/highest-value next capability" wording pattern that induces local micro-optimization, and siloed technical verification that checked ACP correctness without enforcing an architectural roadmap gate.

### Decision

Adopt the **Roadmap Alignment Gate** as a mandatory governance requirement across the task-generation and research-documentation controls:

1. **`docs/ai/TASK_STANDARD.md`** (Section 3.1) — Adds a mandatory Roadmap Alignment Gate requiring the coordinator/task author to establish, before proposing substantive work: the authoritative roadmap, current roadmap phase, phase completion status, relevant prior work, prerequisites satisfied, proposed task mapping, expected phase advancement/unlock, and alignment conclusion.

2. **`docs/ai/TASK_STANDARD.md`** (Section 3.2) — Each research record under `docs/ai/research/` must contain a mandatory `## Roadmap Alignment` section with the required auditable fields.

3. **`docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md`** (Section 2.5) — Adds the Roadmap Alignment Decision Gate to the ChatGPT Coordinator protocol before approving any task generation or work selection. The Coordinator must establish authoritative roadmap → current phase → phase completion → required next work → proposed task mapping → prerequisite status → expected phase advancement, and classify proposed work as A (Roadmap-Required), B (Enabling/Foundation), C (Optional Optimization), or D (Premature Capability Expansion).

4. **Work classification** — Proposed work must be classified as:
   - **A — Roadmap-Required Work**: Directly implements an explicit requirement of the current incomplete roadmap phase. *(Permitted)*
   - **B — Enabling/Foundation Work**: Required technical foundation before a roadmap phase can be started. *(Permitted with documented justification)*
   - **C — Optional Optimization**: Improves an existing feature without advancing roadmap phases. *(Prohibited if the current phase has unfulfilled prerequisites)*
   - **D — Premature Capability Expansion**: Implements features of a future phase while an earlier phase is incomplete. *(Strictly Prohibited)*

5. **Prohibited wording** — The pattern "identify the single smallest/highest-value next capability" is prohibited from overriding the governing roadmap.

### Rationale

- Reuses existing documentation and task-standard controls (`TASK_STANDARD.md`, `CHATGPT_PROJECT_OPERATING_PROTOCOL.md`, research records) without inventing a new runtime governance service, code subsystem, or second control plane.
- Makes roadmap alignment auditable from the durable repository record rather than dependent on conversational context.
- Prevents recurrence of the Increment 4.1–4.9 failure mode: when Phase 0 is incomplete, Phase 1/2/3 optimization or capability tasks cannot be selected merely because they are technically useful or locally high-value.
- Permits genuinely required Enabling/Foundation Work when justified by documented dependency.
- Preserves Kyle as final authorization authority, ACP as the sole authority boundary, TaskRegistry as durable task state, and the existing dispatcher/orchestrator as execution authority.

### Consequences

- The gate is mandatory for coordinator task generation and research-record production. A fail-closed result (`status: blocked`) is returned when the gate cannot be satisfied.
- No runtime, application, or architectural behavior changes are introduced. The gate is governance/documentation only.
- The authoritative roadmap (Phase 0 → Phase 1 → Phase 2 → Phase 3 progression in `ARCHITECTURE.md` §16.6) remains unchanged.
- Future coordinator task generation is directed toward Phase 0 Coordinator Contract completion before any further Phase 1/2/3 capability expansion.
- This decision aligns with ADR-005 (Specialist Lanes with ACP Boundary), ADR-006 (Persistent AI Project State), ADR-018 (DeepSeek Coordinator Evolution Retains Existing Authority Chain), and ADR-019 (Phase 1 Observation Uses Existing ACP Authority).

## ADR-023: Phase 0 Coordinator Contract Reconciliation

**Status**: IMPLEMENTED / AWAITING INDEPENDENT VERIFICATION

**Context**: The authoritative roadmap identifies Phase 0 as partially complete and
requires a formal Coordinator Contract reconciliation. The completed research record
incorrectly described `CANCELLED` and `SUPERSEDED` as ACP lifecycle states and risked
confusing broad TaskRegistry lineage behavior with the narrower DeepSeek continuation
policy.

**Decision**: The runtime contract explicitly limits model-facing operations to
`request_task` and `get_task`, with all authority-bearing ACP fields derived by server
policy. ACP lifecycle states are limited to `PENDING`, `SELECTED`, `PLANNED`,
`EXECUTING`, `VERIFIED`, `COMPLETE`, `BLOCKED`, and `FAILED`. `CANCELLED` and
`SUPERSEDED` remain existing TaskRegistry lineage/control semantics. `AGENT_REPORT`
is execution evidence only; `INDEPENDENT_VERIFICATION` gates verified outcomes.
DeepSeek continuation requires prior bounded observation, `COMPLETE`, independent
verification, and valid TaskRegistry lineage, while generic registry lineage behavior
remains unchanged.

**Consequences**: No new control plane, TaskRegistry, dispatcher, state store, or
consequential Coordinator operation is introduced. Technical completion remains
separate from independent verification, roadmap convergence, and Kyle's phase
transition decision.

---

## ADR-022: Canonical Strategic-State Projection and Fail-Closed Alignment

**Status**: IMPLEMENTED / VERIFIED (governance evaluator and deterministic regression coverage)

**Context**: ADR-021 made roadmap alignment mandatory but left it largely procedural.
The systemic-failure research was advisory and incorrectly claimed the Phase 0–3
roadmap was simply complete. Current `ARCHITECTURE.md` §16.6 instead establishes
Phase 0 as partially complete and requiring reconciliation, Phase 1 as essentially
complete, Phase 2 as substantially built/in progress, and Phase 3 as a future target.

**Decision**: `STATE.md` is formalized as the authoritative current strategic state;
`docs/ai/strategic-state.json` is its versioned machine-readable projection, subordinate
to `STATE.md`. `poc/strategic-alignment.js` evaluates proposals against that projection
and fails closed unless a proposal maps to the active phase's authoritative unresolved
requirement, proves prerequisites, uses matching A/B classification, and declares
advancement and convergence. It distinguishes alignment from authorization, execution,
independent verification, and convergence. Convergence escalates a phase transition to
Kyle rather than creating another local increment.

**Consequences**: This reuses existing repository governance and introduces no runtime
executor, queue, TaskRegistry, dispatch path, or authority. Research and agent output
remain advisory. Tests cover off-roadmap work, future-phase work, stale/self-attested
state, completed requirements, missing state, the 4.1–4.9/4.10 replay, and convergence.


### ADR-022 Implementation Follow-up — Production Enforcement

The evaluator is enforced at the existing DeepSeek runtime `request_task` command
construction boundary, before ACP coordinator submission. The runtime validates the
projection SHA-256 against `STATE.md`, derives the requirement mapping and its
advancement/convergence facts from authoritative state, and blocks before TaskRegistry
or dispatch on any failure. This adds no execution authority: an aligned result remains
pending existing Director/ACP authorization.
