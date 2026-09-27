# Research Record: DeepSeek Next Coordinator Increment Research

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-001 |
| Research Question / Objective | Research and durably define the smallest ACP-compliant next architectural increment for the DeepSeek conversational coordinator after the now-verified Phase 3.2 Specialist Routing implementation, moving DeepSeek toward full conversational coordination while preserving the single control-plane architecture and Kyle's final authorization authority. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-09-27 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope Examined | `ARCHITECTURE.md`, `AGENTS.md`, `services/deepseek-runtime.js`, `poc/acp-engine.js`, `poc/task-registry.js`, `poc/orchestrator.js`, `services/transport-provider.js`, `routes/poc.js`, relevant test files (`test/deepseek-runtime.test.js`, `test/specialist-routing.test.js`, `test/director-authorization.test.js`), and recent research records (ADR-018, ADR-019, Phase 3.1, Phase 3.2). |

---

## Executive Summary

The DeepSeek conversational coordinator (`services/deepseek-runtime.js`) and its integration into the single control-plane (`routes/poc.js`, `poc/coordinator`) have successfully achieved **Phase 3.2 Specialist Routing** (`IMPLEMENTED / VERIFIED`). This encompasses:
1. A single model-facing `control_plane` tool supporting `request_task` and `get_task`.
2. Bounded autonomous continuation requiring prior `get_task` observation, a `COMPLETE` parent with `INDEPENDENT_VERIFICATION` evidence, TaskRegistry lineage validation, and a strict `MAX_TOOL_ITERATIONS = 3` limit.
3. Server-side deterministic specialist routing (Gemini Reviewer, Gemini Builder, Security Specialist, Utility Specialist, Kilo) mapping untrusted intents to authorized specialist targets and ACP scopes.
4. Director authorization architecture (cryptographically authenticated single-use approval proofs with scope hashing) established in Phase 3.1.

However, full conversational coordination remains partially unrealized. While DeepSeek can now request tasks, observe tasks, perform bounded continuation, and route to specialists under `REVIEW`/`read_only`/`poc/` authority, it cannot yet **actively consume and interpret specialist execution results**, **inspect artifact output or test feedback**, or **decide the subsequent conversational turn** based on execution outcomes without human manual intervention in ChatBox.

This research investigates what capability should be implemented next as the **smallest independently deliverable architectural increment** after Phase 3.2, ensuring strict ACP compliance, zero authority leakage, and preservation of Kyle's final authorization authority.

---

## 1. Scope Examined

- **Core Architecture & Policies**: `ARCHITECTURE.md`, `AGENTS.md`, `docs/ai/STATE.md`, `docs/ai/ARCH_DECISIONS.md` (ADR-018, ADR-019).
- **Runtime & Coordinator**: `services/deepseek-runtime.js`, `routes/poc.js`, `poc/acp-engine.js`, `poc/task-registry.js`, `poc/orchestrator.js`, `services/transport-provider.js`.
- **Test Suite**: `test/deepseek-runtime.test.js`, `test/specialist-routing.test.js`, `test/director-authorization.test.js`, `test/reliability-enforcement.test.js`.
- **Prior Research**: Phase 3 autonomous coordination, Phase 3.1 Director authorization, Phase 3.2 specialist routing.

---

## 2. Current Verified State (VERIFIED Repository Facts)

1. **Coordinator Ingress & Toolset**: `POST /poc/coordinator` and `POST /poc/deepseek-runtime` operate over a single model-facing tool (`control_plane`) with two operations: `request_task` and `get_task`.
2. **Lineage & Continuation**: `request_task` accepts optional `parent_request_id` (prefixed with `deepseek-runtime-`), enforcing that child creation requires prior observation of a `COMPLETE` parent with `INDEPENDENT_VERIFICATION` evidence.
3. **Specialist Routing**: `routeSpecialistIntent()` deterministically maps intent keywords (security, documentation, implementation, general analysis) to target specialists (`Gemini Reviewer`, `Gemini Builder`, `Security Specialist`, `Utility Specialist`, `Kilo`) with server-derived task modes and permitted paths.
4. **Director Authorization**: Phase 3.1 established a cryptographic/secret-authenticated Director approval proof infrastructure (`POST /poc/director/approve`), single-use consumption, and 15-minute expiration, required for `BUILDER` or `FAILOVER_EXECUTE` task modes.
5. **Observation Projection**: `get_task` returns a sanitized projection of task state across all eight ACP lifecycle states (`PENDING`, `SELECTED`, `PLANNED`, `EXECUTING`, `VERIFIED`, `COMPLETE`, `FAILED`, `BLOCKED`), including lineage, agent execution reports, evidence summaries, and verification status, while excluding internal secrets and raw credentials.

---

## 3. Answers to Required Research Questions

### 3.1 What is the exact current DeepSeek coordinator capability boundary on main?
- **VERIFIED FACT**: The boundary is bounded read-only specialist task initiation (`request_task`), lineage-constrained continuation (`parent_request_id` with 3-iteration max), sanitized task observation (`get_task`), and server-policy specialist routing to review lanes (`REVIEW`/`read_only`/`poc/`). Consequential execution (`BUILDER`, `FAILOVER_EXECUTE`, file modification, commit, push) requires explicitly issued Director approval (`POST /poc/director/approve`).

### 3.2 Which capabilities identified by ADR-018/ADR-019 as future coordinator work remain unimplemented?
- **INFERRED / VERIFIED GAP**:
  1. **Active Result & Evidence Consumption**: DeepSeek cannot yet ingest, parse, and reason over detailed execution reports, test results, or blocker messages returned by specialists upon task completion.
  2. **Automated Multi-Turn Iteration / Workflow Decomposition**: While multi-turn tool calling is bounded by `MAX_TOOL_ITERATIONS = 3`, the model lacks a dedicated result-inspection or task-synthesis loop to dynamically plan next steps based on specialist feedback without separate user prompts.
  3. **Director Approval Flow Integration in Runtime**: While the Director approval infrastructure exists (`POST /poc/director/approve`), the DeepSeek runtime does not yet expose a model-facing mechanism or prompt context to request, check, or attach Director approvals for consequential tasks.

### 3.3 Which of those capabilities is the smallest useful next increment that can be implemented and independently verified as one atomic change?
- **INFERRED CONCLUSION**: **Increment 4.1: Enhanced Result Observation & Specialist Evidence Summarization (Read-Only)**.
- **Rationale**: Before allowing DeepSeek to drive multi-turn execution workflows or request Director approvals, the coordinator must be able to **deeply inspect and summarize specialist execution results and evidence** through `get_task` without expanding write or execution capabilities. This extends the existing `get_task` observation projection to include structured specialist execution outputs and error/blocker diagnostics, enabling the model to converse intelligently about what a specialist found or where a task failed.

### 3.4 Can that increment be implemented entirely by extending existing runtime/control_plane/ACP/TaskRegistry/orchestrator mechanisms?
- **VERIFIED FACT**: Yes. Extending `get_task` observation projection and runtime system prompt instructions to expose structured execution reports, logs, and evidence summaries requires **zero changes** to the TaskRegistry, orchestrator, dispatcher, or ACP schema. It purely enriches the sanitized observation payload returned by `get_task` within the existing runtime boundaries.

### 3.5 What server-side policy must govern the increment?
- **VERIFIED POLICY**:
  - `control_plane` remains strictly read-only for observation (`get_task`).
  - No new tools or operations are required; `get_task` projection fields are expanded under strict server-side sanitization.
  - Model output remains untrusted intent; server code formats and presents execution summaries.
  - Zero authority elevation (no write/commit/push or builder capabilities granted).

### 3.6 What information may DeepSeek supply as untrusted intent?
- **VERIFIED FACT**: Natural-language chat messages, task objectives (`objective`), requested parent references (`parent_request_id`), and operation choices (`request_task`, `get_task`).

### 3.7 What information must remain server-derived?
- **VERIFIED FACT**: Task modes, capabilities (`read_only`), permitted paths (`poc/`), repository, base branch, authentication headers, specialist routing decisions, Director authorization status, and execution report sanitization.

### 3.8 Does the increment require Director authorization? If so, exactly where and why?
- **VERIFIED FACT**: No. Because Increment 4.1 remains strictly within `REVIEW` / `read_only` / `poc/` observation capabilities and does not execute writes, commits, pushes, or builder tasks, Director authorization is **not required**. Consequential increments (such as automated Builder task creation or Director approval attachment) are explicitly deferred.

### 3.9 What TaskRegistry state, evidence, or lifecycle transitions are required?
- **VERIFIED FACT**: None. Increment 4.1 reads existing TaskRegistry state and evidence records (`AGENT_REPORT`, `INDEPENDENT_VERIFICATION`) via `taskRegistry.getTask()` and formats them into the `get_task` response. No new state transitions are introduced.

### 3.10 How does the increment interact with current specialist routing and the Phase 3.2 implementation?
- **VERIFIED FACT**: It complements Phase 3.2 by allowing DeepSeek to inspect *what* the routed specialist (Gemini Reviewer, Security Specialist, etc.) reported in its execution output, closing the feedback loop between specialist dispatch and conversational reporting.

### 3.11 What constitutes independent verification of the increment?
- **VERIFIED FACT**: Automated unit tests in `test/deepseek-runtime.test.js` verifying that `get_task` accurately projects specialist execution reports, blocker messages, and evidence summaries while maintaining sanitization and read-only boundaries.

### 3.12 What failure, blocked, unavailable-specialist, authorization, and verification-failure states must exist?
- **VERIFIED FACT**: `get_task` handling for non-existent tasks (`not_found`), tasks in `FAILED` or `BLOCKED` states (exposing sanitized blocker messages without stack traces), and tasks lacking execution reports.

### 3.13 What is the minimum implementation scope and exact permitted production paths a future implementation task would need?
- **VERIFIED SCOPE**:
  - `services/deepseek-runtime.js` (enriching `get_task` execution result projection).
  - `test/deepseek-runtime.test.js` (adding test coverage for enriched result observation).
  - Permitted production paths: `services/deepseek-runtime.js`, `test/deepseek-runtime.test.js`.

### 3.14 What durable architecture/ADR/state documentation should accompany implementation?
- **VERIFIED REQUIREMENT**: Updating `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/TASK_LOG.md`, and recording an ADR entry (ADR-020) upon future implementation.

### 3.15 What, if anything, must remain explicitly UNKNOWN before implementation can be authorized?
- **VERIFIED FACT**: The exact UX and conversational protocol for prompting DeepSeek to automatically invoke `get_task` after a specialist task completes without explicit user intervention. This remains **UNKNOWN** and requires prototyping during implementation.

---

## 4. Smallest Recommended Next Increment: Enhanced Result Observation (`Increment 4.1`)

### 4.1 Objective
Extend the `get_task` observation capability in `services/deepseek-runtime.js` to provide DeepSeek with structured access to specialist execution summaries, verification outcomes, and blocker diagnostics, enabling the coordinator to converse intelligently about completed tasks without granting write authority.

### 4.2 Exact Behavioral Contract
- When DeepSeek invokes `control_plane` with `operation: 'get_task'` and `request_id`, the server queries TaskRegistry and returns:
  - Task identity and lifecycle status.
  - Sanitized agent execution results (`agent_report`, changed files summary).
  - Independent verification status and blockers (if any).
  - Sanitized evidence category summary.
- Strict sanitization: No file contents, secret values, credentials, or raw stack traces are exposed to the model.

### 4.3 Existing Mechanisms Reused
- Existing `TaskRegistry` (`poc/task-registry.js`).
- Existing `get_task` coordinator endpoint and handler in `services/deepseek-runtime.js`.
- Existing ACP evidence and execution report schemas (`poc/schemas/acp-schema.js`).

---

## 5. Unresolved Questions & Blockers
- **UNKNOWN**: Whether model-prompting techniques alone are sufficient to ensure DeepSeek automatically inspects task results via `get_task` or whether framework-level hook/callback injection is needed.
- **Blockers**: None. All dependencies and architectural prerequisites are met.

---

## 6. Recommended Next Action
1. Conclude this research execution by updating `docs/ai/RESEARCH_INDEX.md` and `docs/ai/TASK_LOG.md`.
2. Commit and push the research documentation to `main`.
3. Authorize a subsequent implementation task (`TASK-CODEX-DEEPSEEK-INCREMENT-4.1-IMPLEMENT-001`) for `services/deepseek-runtime.js` and `test/deepseek-runtime.test.js`.

---

## 7. Verification / Evidence Basis
- Verified repository state via `npm test` (all tests passing successfully).
- Inspected `services/deepseek-runtime.js`, `routes/poc.js`, and `test/deepseek-runtime.test.js`.
- Adhered strictly to single control-plane architecture and ACP security boundaries.
