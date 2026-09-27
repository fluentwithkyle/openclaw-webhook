# Research Record: DeepSeek Phase 3 Consequential Authorization and Specialist Routing Architecture

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-PHASE-3-CONSEQUENTIAL-AUTHORIZATION-AND-SPECIALIST-ROUTING-RESEARCH-001 |
| Research Question / Objective | Research and durably define the smallest ACP-compliant architecture required for the next DeepSeek Coordinator Evolution increment beyond the now-verified Phase 3 bounded REVIEW/read_only continuation. Specifically, resolve: (1) the exact trusted Director authorization transaction required before DeepSeek may coordinate consequential tasks involving BUILDER, FAILOVER_EXECUTE, modify_files, commit, push, or other authority beyond the current REVIEW/read_only/poc/ envelope; and (2) the exact server-side specialist-routing policy mapping DeepSeek's untrusted intent to authorized specialist lanes without model-granted privilege elevation. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-09-27 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope of this Task | Research and documentation ONLY. No implementation of Phase 3.x code or production changes is authorized. |

---

## Executive Summary

Phases 1, 2, and the Phase 3 bounded continuation are fully implemented and verified in the repository. They establish a secure foundation where DeepSeek interacts through a single `control_plane` tool (`request_task`, `get_task`), with server-derived REVIEW/read_only/`poc/` authority, bounded tool iterations (`MAX_TOOL_ITERATIONS = 3`), TaskRegistry lineage validation (`parent_request_id`), and independent verification gates (`INDEPENDENT_VERIFICATION`).

However, two major architectural gaps remain before DeepSeek can coordinate tasks requiring consequential authority (such as code modification, building, testing, committing, pushing, or invoking non-Reviewer specialists like Gemini Builder or Security Specialist):
1. **Director Authorization Mechanism:** How Kyle explicitly authorizes a consequential task without allowing the model or parent lineage to self-authorize privilege elevation.
2. **Server-Side Specialist Routing Policy:** How DeepSeek's untrusted natural-language intent/objective is deterministically mapped by server policy to an authorized specialist lane (Gemini Reviewer, Gemini Builder, Security Specialist, Utility Specialist) without model-controlled authority injection.

This research establishes the canonical architecture and smallest viable implementation path for resolving both gaps while preserving ACP, TaskRegistry, the existing dispatcher/orchestrator, and Kyle's final authorization authority.

---

## Part A: Director Authorization for Consequential Tasks

### 1. Exact Authorization Boundary
Consequential execution (including `BUILDER` or `FAILOVER_EXECUTE` task modes, capabilities such as `modify_files`, `run_tests`, `commit`, `push`, and permitted paths outside `poc/`) **must never** be self-authorized by DeepSeek model output, tool iteration count, parent lineage, or unauthenticated API calls. The authorization boundary is strictly enforced at the server ingress (`/poc/coordinator` or `/poc/deepseek-runtime`) via cryptographic or authenticated Director proof.

### 2. Exact Authorization Transaction
The smallest ACP-compliant Director authorization transaction is an **explicit Director Approval Token / Proof** provided alongside or within the consequential task request.
- **Trusted Issuer:** Kyle (Director).
- **Authorization Data:** A cryptographically signed or secret-validated authorization header (`x-director-authorization` or structured field `authorization_proof: { issuer: 'Kyle', token: '...', target_request_id: '...', scope: [...] }`) or a verified GitHub issue comment event signed by Kyle.
- **Correlation Model:** The authorization proof must explicitly reference the target `request_id` (or `parent_request_id`) and state hash, preventing replay attacks or unauthorized scope expansion.

### 3. Lifecycle, Replay, Cancellation, and Supersession
- **Issuance & Consumption:** Single-use or task-scoped authorization. Once consumed by `taskRegistry.createTask` or the coordinator ingress, the authorization token is marked consumed in the registry.
- **Replay / Duplicate Prevention:** Request IDs already existing in TaskRegistry reject duplicate submissions (idempotency fail-closed).
- **Cancellation & Supersession:** If a parent or authorized task is cancelled or superseded (`lineage.cancelled === true` or `lineage.superseded_by !== null`), any downstream authorization is automatically revoked.
- **Fail-Closed Behavior:** In the absence of valid Director authorization proof, any attempt to request a consequential task mode (`BUILDER`, `FAILOVER_EXECUTE`) or capabilities beyond `read_only` is rejected with HTTP 403 / validation blocked.

### 4. Interaction with ACP Validation and TaskRegistry
- **ACP Validation (`poc/schemas/acp-schema.js`):** `validateACPCommand` checks that requested capabilities match `getRequiredCapabilitiesForMode(taskMode)`. If `task_mode` is `BUILDER` or `FAILOVER_EXECUTE`, the ACP validator requires the presence and validity of the Director authorization record in the command structure.
- **TaskRegistry (`poc/task-registry.js`):** The TaskRegistry entry stores the authorization proof reference and issuer metadata, ensuring auditability.
- **Lineage Rule:** Parent lineage (e.g. `parent_request_id`) is correlation metadata only. **Parent lineage never confers authorization or capability inheritance.** A read-only parent task cannot spawn a consequential child task without explicit separate Director authorization for the child request.

### 5. Eligible Scope After Authorization
An explicit Director authorization can unlock:
- `task_mode`: `BUILDER` or `FAILOVER_EXECUTE`
- `capabilities`: `modify_files`, `run_tests`, `commit`, `push`
- `permitted_paths`: Specific non-`poc/` source paths requested by Kyle (never `*` or arbitrary whole-repo access unless explicitly approved).

---

## Part B: Server-Side Specialist Routing Policy

### 1. Exact Trusted Routing Boundary
DeepSeek produces **untrusted intent/objective text** as model output. DeepSeek must **not** specify target agents, task modes, capabilities, or permitted paths. The server-side routing policy layer (`services/deepseek-runtime.js` or coordinator dispatcher) intercepts the model's intent and deterministically maps it to an authorized specialist lane.

### 2. Routing Inputs
Trusted server policy evaluates:
- DeepSeek's structured intent/objective (`request_task.objective`).
- Task classification / keywords (e.g. security review, documentation, implementation, architecture review).
- Security tier requirements (Mandatory / Conditional / Advisory per ARCHITECTURE.md §12.7).
- Current repository state and task registry context.

### 3. Existing Specialist Lanes & Policy Mapping
| Specialist Lane | Target Identifier | Permitted Task Modes | Capabilities | Routing Policy Rule |
|----------------|-------------------|----------------------|--------------|---------------------|
| Gemini Reviewer | `Gemini` | `REVIEW`, `RESEARCH_DOCUMENT` | `read_only`, `modify_files` (docs only for research) | Default lane for read-only analysis, research, and review tasks. |
| Gemini Builder | `Gemini Builder` | `BUILDER` | `read_only`, `modify_files`, `run_tests`, `commit`, `push` | Activated for implementation tasks **only** when accompanied by valid Director authorization and passed Security Specialist gates. |
| Security Specialist | `Security AI` | `REVIEW` | `read_only` | **Mandatory** activation when task touches auth, credentials, secrets, crypto, or `security_review_required: true`. Produces a Security Audit Report (`AGENT_REPORT`) required before implementation dispatch. |
| General Utility Specialist | `Utility AI` | `REVIEW` | `read_only`, `modify_files` (docs/formatting) | Activated for low-risk documentation formatting, boilerplate, or simple text transformations. |
| Kilo Cloud Agent | `Kilo` | `FAILOVER_EXECUTE` | `read_only`, `modify_files`, `run_tests`, `commit`, `push` | Legacy / explicit fallback implementation lane when explicitly targeted by Director instruction. |

### 4. Authority Preservation & Unavailable Specialist Behavior
- **Model Output is Intent Only:** The model's returned object is treated purely as untrusted text describing an objective. The server constructs the ACP command using server-derived authority parameters mapped from the routing policy.
- **Unavailable Specialist:** If the policy determines a specialist is required but unavailable, or if authorization fails, the system fails closed (rejects task creation, sets task status to `BLOCKED`, and routes to human review). No silent fallback to an unprivileged or overly privileged lane is permitted.
- **Dispatcher Integration:** The routing layer delegates to the existing transport dispatcher (`services/transport-provider.js` and `poc/orchestrator.js`), ensuring no parallel dispatcher or state machine is introduced.

---

## Part C: Smallest Next Implementation Increment (Phase 3.x)

### 1. Scope and Decomposition
Authorization and routing should be implemented as **two sequenced increments** rather than an atomic monolith:
1. **Increment 3.1 (Director Authorization Infrastructure):** Add verification of Director authorization proof to `poc/schemas/acp-schema.js` and `routes/poc.js` coordinator/runtime ingress, enforcing fail-closed rejection of unauthorized consequential tasks.
2. **Increment 3.2 (Server-Side Specialist Routing Policy):** Implement deterministic intent-to-specialist mapping in the DeepSeek runtime/coordinator ingress, routing objectives to Gemini Reviewer, Gemini Builder, or Security Specialist based on policy rules.

### 2. Files Likely to Change in Phase 3.1 (Authorization)
- `poc/schemas/acp-schema.js`: Add schema validation rules for `authorization_proof` when task mode is `BUILDER` or `FAILOVER_EXECUTE`.
- `services/deepseek-runtime.js` / `routes/poc.js`: Validate incoming Director auth headers/tokens against server configuration.
- `test/coordinator.test.js` or `test/deepseek-runtime.test.js`: Add tests verifying that unauthorized consequential requests are rejected (fail-closed) and authorized ones succeed.

### 3. Authority Envelope & Prohibitions
- **Prohibited until Phase 3.1/3.2 implementation:** Automatic or model-driven triggering of Gemini Builder, write operations outside `poc/`, commit, and push.
- **Maintained Baseline:** MAX_TOOL_ITERATIONS = 3, single `control_plane` tool, TaskRegistry lineage checks, and independent verification requirements remain strictly enforced.

---

## Verification Basis & Evidence
- **Repository Code:** `services/deepseek-runtime.js`, `poc/schemas/acp-schema.js`, `poc/task-registry.js`, `poc/orchestrator.js`, `routes/poc.js`.
- **Architecture Documentation:** `ARCHITECTURE.md` (§12.7, §16.6, §17.2), `AGENTS.md`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`.
- **Status:** Research record complete. No production code modified.
