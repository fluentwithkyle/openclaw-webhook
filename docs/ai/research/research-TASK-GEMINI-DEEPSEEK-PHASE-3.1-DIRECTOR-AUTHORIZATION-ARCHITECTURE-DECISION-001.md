# Research Record: DeepSeek Phase 3.1 Director Authorization Architecture Decision

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-PHASE-3.1-DIRECTOR-AUTHORIZATION-ARCHITECTURE-DECISION-001 |
| Research Question / Objective | Resolve the currently UNKNOWN trusted Director-authorization architecture required before consequential DeepSeek-coordinated execution can be implemented, making the architectural decision concrete enough for a subsequent Codex implementation task without inventing a new trust relationship while preserving ACP/control-plane architecture and the verified Phase 3 bounded DeepSeek boundary. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-09-27 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope of this Task | Research and architectural documentation ONLY. No implementation of production authorization code or changes outside authorized research/documentation paths is authorized. |

---

## Executive Summary

Phase 1 (`get_task` observation projection), Phase 2 (bounded parent lineage via `parent_request_id` under server-derived REVIEW/read_only authority), and Phase 3 (bounded autonomous continuation with `MAX_TOOL_ITERATIONS = 3`, prior `get_task` observation, COMPLETE parent, and `INDEPENDENT_VERIFICATION` evidence) are fully implemented and verified in the repository.

However, consequential execution (such as invoking `BUILDER` or `FAILOVER_EXECUTE` task modes, granting capabilities like `modify_files`, `run_tests`, `commit`, `push`, or authorizing paths outside `poc/`) remains blocked because the repository previously lacked an established mechanism proving that an authorization request originated from Kyle as Director, a defined issuance channel, a request-bound approval record schema, and defined replay/consumption semantics.

This research resolves these 15 core architectural questions and establishes concrete conclusions (A through H) for the smallest ACP-compliant Director authorization transaction.

---

## 1. Core Architectural Questions & Decisions

### 1.1 Director Identity & Trust
- **Evaluation:** Existing secrets (`DEEPSEEK_COORDINATOR_SECRET`, `CHATBOX_GATEWAY_SECRET`, `ACP_POC_TRIGGER_SECRET`) authenticate component ingress (the client/caller communicating with Render), not Kyle’s personal identity as Director. Model-generated output is strictly untrusted intent.
- **Decision:** The server establishes trusted Director authorization through an **explicit, cryptographically signed or secret-authenticated Director Approval Header / Proof (`x-director-authorization` or `authorization_proof` envelope field)** issued by Kyle via an authenticated control channel (such as an authorized GitHub issue comment signed by Kyle or an authenticated Director API endpoint), bound cryptographically to the specific `request_id` and scope hash.

### 1.2 Approval Issuance Channel
- **Evaluation:** Reusing the existing authenticated server ingress (`POST /poc/coordinator` or a dedicated director approval endpoint `POST /poc/director/approve`) is repository-native.
- **Decision:** Kyle issues approvals either via an authenticated Director API route (`POST /poc/director/approve` protected by a dedicated `DIRECTOR_APPROVAL_SECRET`) or via verified GitHub issue comment events (`@director-approve` or authorized collaborator comment). For programmatic DeepSeek coordination without a web UI, an authenticated Director approval endpoint or request-bound approval token issued by Kyle serves as the issuance channel.

### 1.3 Authorization Proof / Record Schema
- **Evaluation:** A dedicated server-side record is required to track authorization lifecycle without creating a second task registry.
- **Decision:** The authorization record schema stored within or referenced by the TaskRegistry entry includes:
  - `request_id`: Target task identifier being authorized.
  - `issuer`: `'Kyle (Director)'`.
  - `target`: Authorized specialist agent (e.g., `'Gemini Builder'`).
  - `task_mode`: Authorized task mode (`BUILDER`, `FAILOVER_EXECUTE`).
  - `capabilities`: Explicit array of authorized capabilities (`['read_only', 'modify_files', 'run_tests', 'commit', 'push']`).
  - `permitted_paths`: Exact array of allowed file paths.
  - `repository`: `'fluentwithkyle/openclaw-webhook'`.
  - `base_branch`: `'main'`.
  - `expiry`: ISO timestamp expiration (e.g., 15 minutes from issuance).
  - `issued_at`: Issuance timestamp.
  - `consumed_at`: Consumption timestamp (null until used).
  - `status`: `'PENDING'`, `'CONSUMED'`, `'REVOKED'`, or `'EXPIRED'`.
  - `approval_id`: Unique identifier (`dir-approval-<timestamp>-<rand>`).
  - `scope_hash`: Immutable SHA-256 hash of the authorized parameters.

### 1.4 Scope Binding
- **Evaluation:** Prevents scope substitution or replay across different requests.
- **Decision:** Authorization binds to a canonical `scope_hash` computed from `request_id`, `target`, `task_mode`, `capabilities`, `permitted_paths`, `repository`, and `base_branch`. Any mismatch during validation fails closed.

### 1.5 Replay & Consumption Semantics
- **Evaluation:** Approvals must be single-use to prevent replay attacks and duplicate execution.
- **Decision:** Authorization is strictly **single-use**. Upon successful validation and task registration in TaskRegistry, the authorization record transitions from `PENDING` to `CONSUMED` (`consumed_at` populated). Any subsequent attempt to use the same approval proof is rejected as a replay attack (HTTP 403).

### 1.6 Expiration & Revocation
- **Evaluation:** Stale approvals pose security risks.
- **Decision:** Approvals carry a mandatory short expiration window (`expiry`, default 15 minutes). If a task is cancelled, superseded, or expires before dispatch, the authorization is automatically revoked.

### 1.7 TaskRegistry Integration
- **Evaluation:** Must not create a second database or registry.
- **Decision:** Authorization records are embedded within or linked directly from the existing TaskRegistry entry (`task.authorization_proof`), preserving TaskRegistry as the sole authoritative task state machine.

### 1.8 ACP Integration & Validation Boundary
- **Evaluation:** Validation must occur before task registration and dispatch.
- **Decision:** Validation happens inside `poc/schemas/acp-schema.js` (`validateAuthorization` / `validateDirectorApproval`) and `routes/poc.js` coordinator ingress. If `task_mode` is `BUILDER` or `FAILOVER_EXECUTE`, a valid, unconsumed Director authorization proof matching the exact scope must be present; otherwise, task registration fails with HTTP 403.

### 1.9 Server-Derived Authority
- **Evaluation:** Model output is untrusted intent.
- **Decision:** Even with Director authorization, target, task mode, capabilities, permitted paths, repository, base branch, and verification requirements remain strictly **server-derived** or verified against the Director's explicit approval record. DeepSeek proposes intent/objective only.

### 1.10 DeepSeek Interaction
- **Evaluation:** What does DeepSeek see regarding authorization?
- **Decision:** DeepSeek may observe that a task requires Director approval (via `get_task` status projection showing `authorization_required: true`), but DeepSeek **never** sees or handles the underlying Director credential/secret. DeepSeek cannot issue approvals or self-authorize.

### 1.11 ChatBox Relationship
- **Evaluation:** Can ChatBox be the approval interface?
- **Decision:** ChatBox ingress (`POST /poc/chatbox`) remains `REVIEW`/`read_only`/`poc/`. ChatBox messages from Kyle do not automatically confer consequential authorization unless accompanied by an explicit Director approval transaction, preventing prompt-injection privilege escalation.

### 1.12 Phase 3.2 Interaction
- **Evaluation:** Boundary between authorization and specialist routing.
- **Decision:** Director authorization grants *capability* (e.g., permission to write/commit/push). Specialist routing determines *where* to dispatch an authorized task (Gemini Builder, Security Specialist, etc.). Routing never manufactures authorization.

### 1.13 Security Analysis
- **Evaluation:** Threat modeling.
- **Decision:** Mitigates credential theft (Director secret never exposed to LLM), replay (single-use consumption checks), scope substitution (immutable scope hash), confused deputy (server-enforced boundaries), and parent-child inheritance (zero inheritance; each consequential task requires its own explicit Director approval).

### 1.14 Simplicity Gate
- **Evaluation:** Choosing the smallest viable mechanism.
- **Decision:** Reusing an authenticated server ingress (`POST /poc/coordinator` with an optional `authorization_proof` object or `x-director-authorization` header) combined with the existing TaskRegistry is the smallest repository-native mechanism.

### 1.15 Implementation Contract for Codex
- **Evaluation:** Preparing for Phase 3.1 implementation.
- **Decision:** Detailed in Section 3 of this document.

---

## 2. Required Conclusions

- **A. Director Trust Decision:** The server establishes trusted Director authorization through a cryptographically verified `authorization_proof` object or `x-director-authorization` header issued by Kyle via an authenticated control ingress, validated server-side.
- **B. Approval Issuance Decision:** Kyle issues approvals through an authenticated Director endpoint or verified GitHub issue comment. DeepSeek cannot issue approvals.
- **C. Authorization Record Decision:** The canonical authorization record tracks issuer, request ID, target, task mode, capabilities, permitted paths, repository, branch, expiry, and consumption status (`PENDING` vs `CONSUMED`).
- **D. Validation Boundary:** Authorization validation occurs at the coordinator ingress and ACP schema validation layer before TaskRegistry registration and dispatch.
- **E. Replay/Consumption Decision:** Approvals are strictly single-use. Successful consumption marks the approval consumed; replays are rejected with HTTP 403.
- **F. Child/Lineage Decision:** **Zero inheritance.** Parent lineage (`parent_request_id`) is correlation only. A read-only parent task never confers authorization to a child task; any consequential child task requires its own explicit Director authorization transaction.
- **G. Phase 3.2 Boundary:** Director authorization grants capability; specialist routing (Phase 3.2) determines target specialist lane. Routing never infers or creates authorization.
- **H. Smallest Implementation:** Increment 3.1 (Director Authorization Infrastructure) — implementing `authorization_proof` schema validation and single-use consumption tracking in `acp-schema.js` and `task-registry.js` for consequential modes.

---

## 3. Implementation Contract (For Subsequent Codex Task)

- **Target Files:**
  - `poc/schemas/acp-schema.js`: Add `authorization_proof` validation rules for `BUILDER` and `FAILOVER_EXECUTE` modes.
  - `poc/task-registry.js`: Add storage and single-use consumption tracking for authorization records.
  - `routes/poc.js`: Validate `x-director-authorization` or `authorization_proof` at coordinator ingress.
  - `test/coordinator.test.js` or new `test/director-authorization.test.js`: Test successful authorization, replay rejection, scope mismatch rejection, and expiration.
- **Behavioral Requirements:** Fail-closed on missing, expired, consumed, or scope-mismatched approval proofs.

---
*Status: COMPLETED (RESEARCH). Ready for Director review and subsequent Codex Phase 3.1 implementation.*
