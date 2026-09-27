# Research Record: DeepSeek Next Coordinator Increment Research 004

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-004 |
| Research Question / Objective | Research the current DeepSeek coordinator architecture after the completed Increment 4.3 structured specialist-evidence summarization work and identify the single smallest, highest-value, ACP-compliant next coordinator increment (Increment 4.4). Determine what concrete coordinator capability remains the most limiting gap for DeepSeek to reliably perform bounded conversational coordination using the existing control plane, TaskRegistry, dispatcher/orchestrator, specialist routing, result-driven continuation, parent-child observation, and structured evidence projection. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-09-27 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope Examined | `ARCHITECTURE.md`, `AGENTS.md`, `services/deepseek-runtime.js`, `test/deepseek-runtime.test.js`, `poc/task-registry.js`, `poc/acp-engine.js`, `poc/orchestrator.js`, `routes/poc.js`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/TASK_LOG.md`, `docs/ai/RESEARCH_INDEX.md`, Increment 4.3 structured specialist evidence implementation. |

---

## Executive Summary

Following the successful implementation and verification of Increment 4.1 (Automatic Same-Execution Result Consumption), Increment 4.2 (Parent-Child Lineage Navigation & Multi-Task Observation), and Increment 4.3 (Structured Specialist Evidence & Result Summarization), the DeepSeek conversational runtime (`services/deepseek-runtime.js`) can submit tasks, immediately observe initial results, traverse parent-child lineage (up to 10 child tasks), and project structured evidence summaries (extracted key findings, test counts, linter/security check summaries, and bounded agent report highlights up to 3 items of 240 characters).

With successful execution and positive evidence summarization now fully supported, this research evaluates the remaining coordinator capability gaps against the actual current main repository state. When tasks succeed, DeepSeek has rich structured evidence summaries. However, when tasks fail (`FAILED`) or block (`BLOCKED`), DeepSeek currently receives minimal terminal details (`terminalDetails: { status: task.status, agent_execution: agentExecutions }`) without structured diagnostic summarization, blocker classification, or remediation feedback.

Applying the **Solution Simplicity Gate**, we conclude that the smallest, highest-value, implementation-ready next increment is **Increment 4.4: Structured Failure & Blocked Diagnostic Summarization (Read-Only)**. This increment extends `projectTaskForDeepSeek()` in `services/deepseek-runtime.js` to synthesize structured diagnostic summaries (extracting error messages, failure reasons, and blocker descriptions from failed or blocked task execution reports and evidence) without introducing new control operations, state stores, or authority mechanisms.

---

## 1. Scope Examined

- **Core Policies & Architecture**: `ARCHITECTURE.md`, `AGENTS.md`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`.
- **Runtime & Coordinator Implementation**: `services/deepseek-runtime.js`, `poc/task-registry.js`, `poc/acp-engine.js`, `poc/orchestrator.js`, `routes/poc.js`.
- **Test Suite**: `test/deepseek-runtime.test.js`, `test/coordinator.test.js`, `test/reliability-enforcement.test.js`.
- **Prior Research**: Increments 4.1, 4.2, and 4.3 research records and final verification records.

---

## 2. Current Baseline (VERIFIED Repository Facts on Main)

1. **Starting Main SHA**: `8b696a0913dae08be3095e98689619bdedc52c53` (Working tree clean).
2. **Control Plane Surface**: Exactly two model-facing operations (`request_task` and `get_task`) exposed through the `control_plane` tool interface. `MAX_TOOL_ITERATIONS` is strictly enforced at 3.
3. **Automatic Result Consumption (Increment 4.1)**: `request_task` immediately registers, dispatches, observes initial task state, and returns sanitized observation and continuation classification in the same tool result.
4. **Parent-Child Lineage Navigation (Increment 4.2)**: `observeTaskForDeepSeek` queries `taskRegistry.getTasksByParent(requestId)`, bounding child observations to 10 and projecting sanitized child status, lineage, execution reports, and verification status.
5. **Structured Evidence Summarization (Increment 4.3)**: `projectTaskForDeepSeek` extracts observed facts, execution stats, independent verification outcomes, and up to 3 bounded agent report highlights (`agent_commentary`) under strict sanitization (`MAX_REPORT_HIGHLIGHTS = 3`, `MAX_REPORT_HIGHLIGHT_LENGTH = 240`).
6. **Authority Boundaries**: Server-derived `REVIEW`/`read_only`/`poc/` authority. Consequential actions (`BUILDER`, commits, pushes) remain strictly gated by authenticated Director approval proofs (`POST /poc/director/approve`). Parent lineage is informational only and does not grant authority.

---

## 3. Evaluation of Required Capability Dimensions

To determine the next atomic increment, we evaluated the remaining coordinator capability dimensions against current main:

1. **Multi-Task Observation and Traversal**: Implemented in Increment 4.2 (`child_tasks` projection via `getTasksByParent`).
2. **Specialist-Result & Evidence Synthesis**: Implemented in Increment 4.3 (`evidence_summary` with observed facts and bounded highlights).
3. **Failure & Blocked Recovery Diagnostics**: **Primary Bottleneck**. When a specialist task enters `FAILED` or `BLOCKED` status, `projectTaskForDeepSeek()` returns basic `failure` and `blocked` objects containing raw agent executions without a synthesized diagnostic summary. DeepSeek cannot easily discern *why* a task failed or what blocker was encountered without parsing unstructured verbose error text. Adding a structured `failure_summary` / `blocked_summary` projection (extracting error messages, failure codes, blocker descriptions, and remediation context) closes this loop.
4. **Next-Action Determination**: Supported by server-derived continuation classification and structured evidence/failure summaries.
5. **Verification / Reconciliation Orchestration**: Governed by ACP independent verification requirements and TaskRegistry lifecycle states; remains server-enforced.
6. **Workflow Decomposition**: Supported via `parent_request_id` and multi-task observation; failure diagnostics help DeepSeek decide whether to retry, adjust objectives, or abandon a branch.
7. **Specialist Activation / Selection**: Deterministic server-side routing (`routeSpecialistIntent`) maps objectives to specialist lanes.
8. **Cross-Request Conversational Continuity**: Ephemeral per-request memory managed by `services/deepseek-runtime.js`; durable state remains in TaskRegistry.

---

## 4. Recommended Next Increment: Increment 4.4

### 4.1 Recommended Increment Definition
- **Increment Name**: **Increment 4.4: Structured Failure & Blocked Diagnostic Summarization (Read-Only)**
- **Objective**: Enhance `projectTaskForDeepSeek()` in `services/deepseek-runtime.js` to synthesize structured diagnostic summaries for tasks in `FAILED` or `BLOCKED` states (extracting blocker messages, failure reasons, error snippets, and diagnostic highlights from execution reports and evidence records) without altering the two-operation control plane or introducing new state authorities.

### 4.2 Architectural Boundary
- **Model-Facing Operations**: Exactly two (`request_task`, `get_task`). No new operations.
- **Authority & Security**: Strictly read-only (`REVIEW`/`read_only`/`poc/`). Zero authority elevation. Sanitization (`sanitizeReport`, `sanitizeStringValue`) strictly enforced on all synthesized failure summaries.
- **Mechanism Reuse**: Reuses existing `task.evidence`, `task.status`, `task.kilo`, `task.builder`, `task.gemini`, and sanitization infrastructure in `TaskRegistry` and `deepseek-runtime.js`.

### 4.3 Affected Interfaces & Files (for Future Implementation)
- `services/deepseek-runtime.js`: Update `projectTaskForDeepSeek()` to include a structured `failure_summary` or `blocked_summary` field when `task.status === 'FAILED'` or `'BLOCKED'`, extracting sanitised error messages and blocker highlights.
- `test/deepseek-runtime.test.js`: Add unit tests verifying structured failure and blocked diagnostic summarization across failed and blocked specialist execution reports.

### 4.4 Required Tests
- Unit tests verifying that structured failure/blocked summarization correctly extracts blocker descriptions, error messages, and diagnostics without leaking secrets or violating sanitization bounds.
- Regression tests confirming all existing tests pass, maintaining the two-operation control plane and `MAX_TOOL_ITERATIONS = 3`.

### 4.5 Explicit Out-of-Scope Boundaries
- No consequential capability escalation (`BUILDER`, commits, pushes) without Director approval.
- No new control operations or dispatcher mechanisms.
- No automatic autonomous retry loop (DeepSeek receives failure diagnostics to reason and decide next steps within `MAX_TOOL_ITERATIONS = 3`).

---

## 5. Architectural Invariants & Solution Simplicity Gate
- **Exactly One Control Plane**: Preserved.
- **Exactly Two Operations**: `request_task` and `get_task`. No new tool operations added.
- **MAX_TOOL_ITERATIONS**: Remains strictly 3.
- **TaskRegistry**: Authoritative task-state store.
- **Model Output**: Untrusted intent; server-derived summarization and sanitization.

---

## 6. Implementation Readiness State
**IMPLEMENTATION-READY**. Increment 4.4 requires no new state stores, control operations, or protocol changes. It builds directly upon the proven extension pattern established in Increments 4.1, 4.2, and 4.3.
