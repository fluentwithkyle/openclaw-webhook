# Research Record: DeepSeek Next Coordinator Increment Research 006

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-006 |
| Research Question / Objective | Research the current DeepSeek coordinator architecture after completed Increment 4.5 (Child-Task Aggregate Progress & Status Summary) and identify the single smallest, highest-value, ACP-compliant next coordinator increment (Increment 4.6). Determine what concrete coordinator capability remains the most limiting gap for DeepSeek to reliably coordinate multi-task workflows using the existing control plane, TaskRegistry, dispatcher/orchestrator, specialist routing, result-driven continuation, parent-child observation, aggregate status summary, and structured evidence/diagnostic summarization. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-09-27 |
| Task Mode | RESEARCH_DOCUMENT |
| Authoritative Starting Main SHA | `cddaae4ae8802e004275a0f82af34566511d8c5d` |
| Scope Examined | `ARCHITECTURE.md`, `AGENTS.md`, `services/deepseek-runtime.js`, `test/deepseek-runtime.test.js`, `poc/task-registry.js`, `poc/acp-engine.js`, `poc/orchestrator.js`, `routes/poc.js`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/TASK_LOG.md`, `docs/ai/RESEARCH_INDEX.md`, Increment 4.5 aggregate progress summary implementation. |

---

## Executive Summary

Following the successful implementation and verification of Increment 4.1 (Automatic Same-Execution Result Consumption), Increment 4.2 (Parent-Child Lineage Navigation & Multi-Task Observation), Increment 4.3 (Structured Specialist Evidence & Result Summarization), Increment 4.4 (Structured Failure & Blocked Diagnostic Summarization), and Increment 4.5 (Child-Task Aggregate Progress & Status Summary), the DeepSeek conversational runtime (`services/deepseek-runtime.js`) supports task submission, automatic result observation, parent-child lineage traversal (up to 10 child tasks), structured evidence summarization, diagnostic summarization, and aggregate child status counting (`child_tasks_summary`).

With task submission, result consumption, lineage navigation, evidence summarization, diagnostic summaries, and aggregate status counting fully operational, this research evaluates the remaining coordinator capability gaps against the actual current main repository state. While DeepSeek can inspect child counts via `child_tasks_summary` and individual child details via `child_tasks` (bounded to 10), when a parent task's child tasks fail or encounter blockers, DeepSeek lacks a **parent-level aggregated child diagnostic summary** (`child_diagnostics_summary` or `child_failure_blocked_summary`) extracting aggregate counts and sample highlights of failures and blockers across child tasks. Without this parent-level diagnostic aggregation, DeepSeek must inspect individual child task objects to diagnose why a multi-child workflow encountered failures or blocks, increasing tool iteration consumption (`MAX_TOOL_ITERATIONS = 3`).

Applying the **Solution Simplicity Gate**, we conclude that the smallest, highest-value, implementation-ready next increment is **Increment 4.6: Child Diagnostic Aggregation & Recovery Context (Read-Only)**. This increment extends `projectTaskForDeepSeek()` in `services/deepseek-runtime.js` to compute and project an optional `child_diagnostics_summary` object when child tasks exist and contain failed or blocked states/diagnostics, summarizing failure counts, blocker counts, and bounded sanitized failure/blocker highlights across child tasks without introducing new control operations, state stores, or authority mechanisms.

---

## 1. Scope Examined

- **Core Policies & Architecture**: `ARCHITECTURE.md`, `AGENTS.md`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`.
- **Runtime & Coordinator Implementation**: `services/deepseek-runtime.js`, `poc/task-registry.js`, `poc/acp-engine.js`, `poc/orchestrator.js`, `routes/poc.js`.
- **Test Suite**: `test/deepseek-runtime.test.js`, `test/coordinator.test.js`, `test/reliability-enforcement.test.js`.
- **Prior Research**: Increments 4.1 through 4.5 research records and final verification records.

---

## 2. Current Baseline (VERIFIED Repository Facts on Main)

1. **Starting Main SHA**: `cddaae4ae8802e004275a0f82af34566511d8c5d` (Working tree clean).
2. **Control Plane Surface**: Exactly two model-facing operations (`request_task` and `get_task`) exposed through the `control_plane` tool interface. `MAX_TOOL_ITERATIONS` is strictly enforced at 3.
3. **Automatic Result Consumption (Increment 4.1)**: `request_task` immediately registers, dispatches, observes initial task state, and returns sanitized observation and continuation classification in the same tool result.
4. **Parent-Child Lineage Navigation (Increment 4.2)**: `observeTaskForDeepSeek` queries `taskRegistry.getTasksByParent(requestId)`, bounding child observations to 10 and projecting sanitized child status, lineage, execution reports, and verification status.
5. **Structured Evidence Summarization (Increment 4.3)**: `projectTaskForDeepSeek` extracts observed facts, execution stats, independent verification outcomes, and up to 3 bounded agent report highlights (`agent_commentary`) under strict sanitization (`MAX_REPORT_HIGHLIGHTS = 3`, `MAX_REPORT_HIGHLIGHT_LENGTH = 240`).
6. **Structured Failure & Blocked Diagnostic Summarization (Increment 4.4)**: `projectTaskForDeepSeek` synthesizes structured diagnostic summaries (`failure_summary`, `blocked_summary`) extracting observed execution statuses, blocker counts, and sanitized commentary for failed and blocked tasks.
7. **Child-Task Aggregate Progress & Status Summary (Increment 4.5)**: `projectTaskForDeepSeek` computes and projects `child_tasks_summary` aggregating total child counts and breakdown across all 8 lifecycle statuses (PENDING, SELECTED, PLANNED, EXECUTING, VERIFIED, COMPLETE, FAILED, BLOCKED).
8. **Authority Boundaries**: Server-derived `REVIEW`/`read_only`/`poc/` authority. Consequential actions (`BUILDER`, commits, pushes) remain strictly gated by authenticated Director approval proofs (`POST /poc/director/approve`). Parent lineage is informational only and does not grant authority.

---

## 3. Evaluation of Required Capability Dimensions

To determine the next atomic increment, we evaluated the remaining coordinator capability dimensions against current main:

1. **Multi-Task Observation and Traversal**: Implemented in Increment 4.2 (`child_tasks` projection via `getTasksByParent`).
2. **Specialist-Result & Evidence Synthesis**: Implemented in Increment 4.3 (`evidence_summary`).
3. **Failure & Blocked Recovery Diagnostics**: Implemented in Increment 4.4 (`failure_summary`, `blocked_summary`) for individual tasks.
4. **Child-Task Aggregate Status Counting**: Implemented in Increment 4.5 (`child_tasks_summary`).
5. **Parent-Level Child Diagnostic & Recovery Aggregation**: **Primary Remaining Gap**. When a parent task oversees multiple child tasks, Increment 4.5 provides status counts (e.g., `failed: 1`, `blocked: 1`), but does not aggregate the underlying diagnostic reasons (failure messages or blocker highlights) from the child tasks into a parent-level summary. Adding an optional `child_diagnostics_summary` projection to `projectTaskForDeepSeek()` when child tasks have failures or blockers allows DeepSeek to immediately comprehend failure/blocker context across child tasks without parsing individual child objects.
6. **Next-Action Determination**: Supported by server-derived continuation classification and structured summary projections.
7. **Verification / Reconciliation Orchestration**: Governed by ACP independent verification requirements and TaskRegistry lifecycle states; remains server-enforced.
8. **Specialist Activation / Selection**: Deterministic server-side routing (`routeSpecialistIntent`) maps objectives to specialist lanes.
9. **Cross-Request Conversational Continuity**: Ephemeral per-request memory managed by `services/deepseek-runtime.js`; durable state remains in TaskRegistry.

---

## 4. Candidate Increments Considered

1. **Candidate 1: Parent-Level Child Diagnostic Aggregation (`child_diagnostics_summary`)**
   - *Description*: Aggregate failure and blocked diagnostic summaries across all child tasks of a parent task into a single optional `child_diagnostics_summary` projection when child tasks exist and contain failures or blockers.
   - *Pros*: Reuses Increment 4.4 diagnostic projection and sanitization logic; provides immediate parent-level visibility into why child tasks failed or blocked without consuming token iteration budget on child inspection.
   - *Cons*: None relative to existing architecture; purely additive read-only server projection.
2. **Candidate 2: Cross-Child Dependency Graph Resolution**
   - *Description*: Introduce explicit DAG dependency modeling between sibling tasks.
   - *Pros*: Allows complex sequencing.
   - *Cons*: Violates the Solution Simplicity Gate and non-expansion mandate by altering TaskRegistry data models and task creation schemas.
3. **Candidate 3: Autonomous Multi-Turn Auto-Retry / Loop Execution**
   - *Description*: Allow DeepSeek runtime to automatically retry failed/blocked subtasks in a loop.
   - *Pros*: Autonomous recovery.
   - *Cons*: Violates bounded execution limits and model authority boundaries; model output must remain intent-only, with execution strictly server-coordinated and gated.

---

## 5. Recommended Next Increment: Increment 4.6

### 5.1 Recommended Increment Definition
- **Increment Name**: **Increment 4.6: Child Diagnostic Aggregation & Recovery Context (Read-Only)**
- **Objective**: Enhance `projectTaskForDeepSeek()` in `services/deepseek-runtime.js` to compute and project an optional `child_diagnostics_summary` object when a parent task has child tasks (`child_tasks.length > 0`) that include failed or blocked states/diagnostics. The summary aggregates total failed/blocked child counts and bounded, sanitized failure/blocker highlights across the child tasks, without altering the two-operation control plane or introducing new state authorities.

### 5.2 Architectural Boundary
- **Model-Facing Operations**: Exactly two (`request_task`, `get_task`). No new operations.
- **Authority & Security**: Strictly read-only (`REVIEW`/`read_only`/`poc/`). Zero authority elevation. Relies entirely on server-side TaskRegistry child lookup (`taskRegistry.getTasksByParent(requestId)`).
- **Mechanism Reuse**: Reuses existing `taskRegistry.getTasksByParent()`, Increment 4.4 diagnostic summary mechanisms (`projectStructuredDiagnosticSummary`), and sanitization utilities (`sanitizeReport`, `sanitizeStringValue`).

### 5.3 Affected Interfaces & Files (for Future Implementation)
- `services/deepseek-runtime.js`: Update `projectTaskForDeepSeek()` to compute `child_diagnostics_summary` (aggregating failure/blocker counts and bounded highlights from child tasks retrieved via `taskRegistry.getTasksByParent(task.request_id)`) when child tasks exist and have failures or blockers.
- `test/deepseek-runtime.test.js`: Add unit tests verifying child diagnostic aggregation across multi-child parent tasks with failed and blocked child tasks.

### 5.4 Required Tests
- Unit tests verifying that `child_diagnostics_summary` correctly aggregates failed child counts, blocked child counts, and sanitized failure/blocker highlights across child tasks.
- Regression tests confirming all existing tests pass, maintaining the two-operation control plane and `MAX_TOOL_ITERATIONS = 3`.

### 5.5 Explicit Out-of-Scope Boundaries
- No consequential capability escalation (`BUILDER`, commits, pushes) without Director approval.
- No new control operations or dispatcher mechanisms.
- No automated autonomous retry loop.

---

## 6. Architectural Invariants & Solution Simplicity Gate
- **Exactly One Control Plane**: Preserved.
- **Exactly Two Operations**: `request_task` and `get_task`. No new tool operations added.
- **MAX_TOOL_ITERATIONS**: Remains strictly 3.
- **TaskRegistry**: Authoritative task-state store.
- **Model Output**: Untrusted intent; server-derived aggregation and sanitization.

---

## 7. Implementation Readiness State
**IMPLEMENTATION-READY**. Increment 4.6 requires no new state stores, control operations, or protocol changes. It builds directly upon the proven extension pattern established in Increments 4.1 through 4.5 and reuses Increment 4.4 diagnostic aggregation patterns.
