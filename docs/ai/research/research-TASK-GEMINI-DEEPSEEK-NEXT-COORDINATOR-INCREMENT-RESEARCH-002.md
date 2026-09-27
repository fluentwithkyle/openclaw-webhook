# Research Record: DeepSeek Next Coordinator Increment Research 002

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-002 |
| Research Question / Objective | Determine the smallest, safest, highest-value next coordinator increment for DeepSeek after the merged automatic same-execution result-consumption implementation, using the actual current main repository as the authoritative source. Produce a durable architectural research record identifying the next implementation boundary, required existing mechanisms, affected interfaces, security/authority implications, verification requirements, and documentation reconciliation. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-09-27 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope Examined | `ARCHITECTURE.md`, `AGENTS.md`, `services/deepseek-runtime.js`, `test/deepseek-runtime.test.js`, `poc/task-registry.js`, `poc/acp-engine.js`, `poc/orchestrator.js`, `routes/poc.js`, `services/transport-provider.js`, `docs/ai/STATE.md`, `docs/ai/RESEARCH_INDEX.md`, `docs/ai/TASK_LOG.md`. |

---

## Executive Summary

Following the successful implementation and merge of automatic same-execution result consumption (`TASK-CODEX-DEEPSEEK-AUTOMATIC-RESULT-CONSUMPTION-IMPLEMENT-001` / PR #234), DeepSeek conversational runtime (`services/deepseek-runtime.js`) now immediately observes task results upon `request_task` submission within the same model execution turn. Combined with Phase 3.2 Specialist Routing and Phase 3.1 Director Authorization infrastructure, the DeepSeek coordinator possesses a robust, bounded foundation for read-only repository reviews and task observations.

However, moving toward full conversational coordination requires answering what atomic architectural increment comes next. This research evaluates potential next increments—specifically contrasting multi-task/child lineage navigation, structured specialist evidence summarization, and read-only Director approval status querying—against security boundaries, implementation size, mechanism reuse, and failure handling. 

We conclude that the **smallest, safest, highest-value next increment is Increment 4.2: Parent-Child Lineage Navigation & Multi-Task Observation (Read-Only)**, which safely extends the existing `get_task` observation and continuation mechanisms to allow DeepSeek to query child tasks and traverse task lineage trees without expanding execution capabilities or compromising server-side authority.

---

## 1. Scope Examined

- **Core Architecture & Policies**: `ARCHITECTURE.md`, `AGENTS.md`, `docs/ai/STATE.md`, `docs/ai/ARCH_DECISIONS.md`.
- **Runtime & Coordinator**: `services/deepseek-runtime.js`, `routes/poc.js`, `poc/acp-engine.js`, `poc/task-registry.js`, `poc/orchestrator.js`, `services/transport-provider.js`.
- **Test Suite**: `test/deepseek-runtime.test.js`, `test/specialist-routing.test.js`, `test/director-authorization.test.js`, `test/reliability-enforcement.test.js`.
- **Prior Research**: Phase 3 autonomous coordination, Phase 3.1 Director authorization, Phase 3.2 specialist routing, and DeepSeek Next Coordinator Increment Research 001.

---

## 2. Current Baseline (VERIFIED Repository Facts on Main)

1. **Automatic Result Consumption**: When DeepSeek invokes `request_task`, the server immediately registers the task, dispatches it, observes its initial state via `observeTaskForDeepSeek`, and returns both coordinator response and sanitized observation/continuation classification in the same tool result (`TASK-CODEX-DEEPSEEK-AUTOMATIC-RESULT-CONSUMPTION-IMPLEMENT-001`).
2. **Specialist Routing**: `routeSpecialistIntent()` deterministically maps intent keywords to specialist lanes (`Gemini Reviewer`, `Gemini Builder`, `Security Specialist`, `Utility Specialist`, `Kilo`) with server-derived task modes and permitted paths (`REVIEW`/`read_only`/`poc/`).
3. **Director Authorization**: Phase 3.1 established cryptographic/secret-authenticated Director approval proofs (`POST /poc/director/approve`) with single-use consumption and 15-minute expiration, required for `BUILDER` or `FAILOVER_EXECUTE` task modes.
4. **Lineage & Continuation**: `request_task` accepts optional `parent_request_id`, enforcing that child creation requires prior observation of a `COMPLETE` parent with `INDEPENDENT_VERIFICATION` evidence, under a strict `MAX_TOOL_ITERATIONS = 3` limit.
5. **Observation Projection**: `get_task` and `observeTaskForDeepSeek` project sanitized lifecycle status, lineage, agent execution reports, evidence categories, and verification status without leaking internal credentials or secrets.

---

## 3. Evaluation of Potential Next Increments

### Option A: Structured Evidence & Specialist Finding Summarization (Read-Only)
- **What it does**: Enriches the projected observation payload with deep summaries of specialist findings (e.g., test outcomes, security lint results).
- **Evaluation**: High value for single-task analysis, but does not provide multi-step workflow tracking or child task traversal when a workflow spawns multiple specialist subtasks.

### Option B: Parent-Child Lineage Navigation & Multi-Task Observation (Read-Only) (`Recommended Increment 4.2`)
- **What it does**: Extends `get_task` or observation tooling to allow DeepSeek to query child tasks associated with a parent request (`taskRegistry.getTasksByParent(parentRequestId)`), enabling multi-step workflow tracking across a task tree.
- **Evaluation**: Aligns perfectly with existing `parent_request_id` lineage mechanisms, reuses `getTasksByParent()` already present in `TaskRegistry`, maintains strict read-only boundary, and enables conversational decomposition of complex workflows into subtasks without introducing duplicate dispatchers.

### Option C: Director Approval Status Query (Read-Only)
- **What it does**: Allows DeepSeek to check whether a Director approval exists for a proposed scope.
- **Evaluation**: Premature until multi-turn workflow planning and evidence interpretation are fully exercised; risks model prompt complexity before task tree observation is established.

---

## 4. Answers to Required Research Questions

### 4.1 Should the next increment improve result interpretation/evidence handling or next-decision selection?
- **Analysis**: Both are important, but **next-decision selection across multi-step task trees** (Parent-Child Lineage Navigation) is the critical structural missing piece. Now that automatic result consumption provides single-task results instantly, DeepSeek needs the ability to track and inspect *child tasks* spawned from parent objectives to manage multi-specialist workflows.

### 4.2 Should the next increment introduce another narrowly typed model-facing operation, why or why not?
- **Analysis**: No new model-facing operation is required. The existing `get_task` operation (or an optional query parameter on `get_task` such as including child summaries) can expose related tasks through existing server-side `TaskRegistry` mechanisms (`getTasksByParent`), preserving the single `control_plane` tool interface.

### 4.3 Can specialist workflow decomposition be introduced safely now?
- **Analysis**: Yes, but strictly within the `REVIEW`/`read_only`/`poc/` boundary. Specialist workflow decomposition means decomposing a complex review objective into specialized subtasks (e.g., security review via Security Specialist + documentation review via Utility Specialist) linked via `parent_request_id`. Each child task remains governed by server-side policy and requires independent verification before continuation.

### 4.4 How should verified results drive bounded follow-up task proposals?
- **Analysis**: Verified results (`COMPLETE` + `INDEPENDENT_VERIFICATION`) inform DeepSeek's conversational reasoning. When DeepSeek decides to issue a child `request_task`, server-side `evaluateContinuationPolicy()` strictly verifies that the parent is complete and verified. Model output remains untrusted intent; server policy enforces eligibility.

### 4.5 How does Director authorization interact with the proposed next increment?
- **Analysis**: Since Increment 4.2 remains strictly within `REVIEW` / `read_only` / `poc/` observation and child review task creation, Director authorization is **not required**. Consequential actions (`BUILDER`, commits, pushes) remain gated by explicit Director approval proofs (`POST /poc/director/approve`).

### 4.6 How are failures, BLOCKED results, insufficient verification, and cancellation handled?
- **Analysis**: Existing continuation and observation safeguards apply uniformly: terminal states (`FAILED`, `BLOCKED`, `CANCELLED`, `SUPERSEDED`) and unverified parents safely reject child continuation with clear error messages (`CONTINUATION_POLICY_REJECTED`).

### 4.7 Does the next increment require TaskRegistry, ACP schema, or runtime changes?
- **Analysis**: Minimal changes: primarily extending `projectTaskForDeepSeek()` or `observeTaskForDeepSeek()` in `services/deepseek-runtime.js` to optionally include child task summaries retrieved via `taskRegistry.getTasksByParent(requestId)`, without altering TaskRegistry storage schemas or ACP protocol contracts.

### 4.8 Are current documentation statements stale?
- **Analysis**: Yes. Several documentation files in `docs/ai/` still describe automatic result consumption and Phase 3 continuation as "proposed" or "code-review verified; execution unknown" rather than merged baseline reality. Reconciling STATE.md and TASK_LOG.md is performed in this research task.

---

## 5. Recommended Next Action & Implementation Scope

1. **Recommended Increment**: **Increment 4.2: Parent-Child Lineage Navigation & Multi-Task Observation (Read-Only)**.
2. **Affected Files for Future Implementation**:
   - `services/deepseek-runtime.js` (enriching `observeTaskForDeepSeek` / `projectTaskForDeepSeek` to surface child task summaries via `taskRegistry.getTasksByParent`).
   - `test/deepseek-runtime.test.js` (adding unit tests for multi-task lineage traversal and child observation).
3. **Verification**: Automated test suite execution (`npm test`), verifying strict read-only compliance, sanitization, and lineage validation.

---

## 6. Verification & Evidence Basis
- Inspected current main repository state (`services/deepseek-runtime.js`, `poc/task-registry.js`, `test/deepseek-runtime.test.js`).
- Verified that automatic result consumption (`TASK-CODEX-DEEPSEEK-AUTOMATIC-RESULT-CONSUMPTION-IMPLEMENT-001`) is fully present and functional on main.
- Adhered strictly to single control-plane architecture, ACP security boundaries, and the Solution Simplicity Gate.
