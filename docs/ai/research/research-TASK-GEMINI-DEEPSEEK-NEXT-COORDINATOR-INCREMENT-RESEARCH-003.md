# Research Record: DeepSeek Next Coordinator Increment Research 003

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-003 |
| Research Question / Objective | Research and identify the smallest ACP-compliant next coordinator increment after the completed Increment 4.2 Parent-Child Lineage Navigation & Multi-Task Observation, using the actual current main repository state (`68aa948eb6f34900d4ab66aa4be561e6fabaf0fa`) as authoritative. Determine the highest-value remaining coordinator capability that can be implemented as one bounded, atomic, independently verifiable increment without creating a second control plane, new authority system, or unnecessary architectural complexity. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-09-27 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope Examined | `ARCHITECTURE.md`, `AGENTS.md`, `services/deepseek-runtime.js`, `test/deepseek-runtime.test.js`, `poc/task-registry.js`, `poc/acp-engine.js`, `poc/orchestrator.js`, `routes/poc.js`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/TASK_LOG.md`, `docs/ai/RESEARCH_INDEX.md`. |

---

## Executive Summary

Following the successful implementation and verification of Increment 4.1 (Automatic Same-Execution Result Consumption) and Increment 4.2 (Parent-Child Lineage Navigation & Multi-Task Observation), the DeepSeek conversational runtime (`services/deepseek-runtime.js`) can now submit tasks, immediately observe their initial results within the same model turn, and traverse parent-child task trees up to a server-side bound of 10 child tasks.

With multi-task observation and lineage traversal established, this research evaluates the remaining coordinator capabilities against the actual current main repository state (`68aa948`). We examine evidence interpretation, specialist-result synthesis, next-action determination, verification/reconciliation orchestration, failure/blocked recovery, workflow decomposition, specialist activation/selection, cross-request conversational continuity, and durable coordinator state requirements.

Applying the **Solution Simplicity Gate**, we conclude that the smallest, highest-value, implementation-ready next increment is **Increment 4.3: Structured Specialist Evidence & Result Summarization (Read-Only)**. This increment enriches the existing `get_task` / `observeTaskForDeepSeek` observation projection to synthesize structured summaries of specialist findings (test outcomes, linter results, agent report highlights) without introducing new control operations, state stores, or authority mechanisms.

---

## 1. Scope Examined

- **Core Policies & Architecture**: `ARCHITECTURE.md`, `AGENTS.md`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`.
- **Runtime & Coordinator Implementation**: `services/deepseek-runtime.js`, `poc/task-registry.js`, `poc/acp-engine.js`, `poc/orchestrator.js`, `routes/poc.js`.
- **Test Suite**: `test/deepseek-runtime.test.js`, `test/coordinator.test.js`, `test/reliability-enforcement.test.js`.
- **Prior Research**: Increment 4.1 research, Increment 4.2 research & verification records, Phase 3 autonomous coordination research, and Phase 3.1 Director authorization decisions.

---

## 2. Current Baseline (VERIFIED Repository Facts on Main)

1. **Starting Main SHA**: `68aa948eb6f34900d4ab66aa4be561e6fabaf0fa` (Working tree clean).
2. **Control Plane Surface**: Exactly two model-facing operations (`request_task` and `get_task`) exposed through the `control_plane` tool interface. `MAX_TOOL_ITERATIONS` is strictly enforced at 3.
3. **Automatic Result Consumption (Increment 4.1)**: `request_task` immediately registers, dispatches, observes initial task state, and returns sanitized observation and continuation classification in the same tool result.
4. **Parent-Child Lineage Navigation (Increment 4.2)**: `observeTaskForDeepSeek` queries `taskRegistry.getTasksByParent(requestId)`, bounding child observations to 10 and projecting sanitized child status, lineage, execution reports, and verification status.
5. **Authority Boundaries**: Server-derived `REVIEW`/`read_only`/`poc/` authority. Consequential actions (`BUILDER`, commits, pushes) remain strictly gated by authenticated Director approval proofs (`POST /poc/director/approve`). Parent lineage is informational only and does not grant authority.

---

## 3. Evaluation of Required Capability Dimensions

To determine the next atomic increment, we evaluated the remaining 10 coordinator capability dimensions against current main:

1. **Multi-Task Observation and Traversal**: Implemented in Increment 4.2 (`child_tasks` projection via `getTasksByParent`).
2. **Evidence Interpretation & Specialist-Result Synthesis**: **Bottleneck**. While raw agent reports and evidence categories are projected, DeepSeek must parse unstructured/verbose agent result text to extract key insights (e.g., test pass/fail counts, security findings). Synthesizing structured evidence summaries directly into the task projection reduces token overhead and improves reasoning accuracy.
3. **Next-Action Determination**: Supported by server-derived continuation classification (`eligible_for_next_decision`, `reason`), but benefits directly from improved evidence summarization.
4. **Verification / Reconciliation Orchestration**: Governed by ACP independent verification requirements and TaskRegistry lifecycle states; remains server-enforced.
5. **Failure / Blocked Recovery**: Handled via terminal state detection (`FAILED`, `BLOCKED`, `CANCELLED`, `SUPERSEDED`), rejecting continuation.
6. **Workflow Decomposition**: Supported via `parent_request_id` and multi-task observation; structured evidence helps DeepSeek decompose subsequent steps.
7. **Specialist Activation / Selection**: Deterministic server-side routing (`routeSpecialistIntent`) maps objectives to Gemini Reviewer, Security Specialist, Utility Specialist, Gemini Builder, or Kilo.
8. **Cross-Request Conversational Continuity**: Ephemeral per-request memory managed by `services/deepseek-runtime.js`; durable state remains in TaskRegistry.
9. **Durable Coordinator State Requirements**: TaskRegistry provides durable task storage (`poc/task-registry.json`). No second registry needed.

---

## 4. Recommended Next Increment: Increment 4.3

### 4.1 Recommended Increment Definition
- **Increment Name**: **Increment 4.3: Structured Specialist Evidence & Result Summarization (Read-Only)**
- **Objective**: Enhance `projectTaskForDeepSeek()` and `observeTaskForDeepSeek()` in `services/deepseek-runtime.js` to synthesize structured specialist evidence summaries (extracting key findings, test outcomes, linter/security check summaries, and agent report highlights) into the projected task observation payload, without altering the two-operation control plane or introducing new state authorities.

### 4.2 Architectural Boundary
- **Model-Facing Operations**: Exactly two (`request_task`, `get_task`). No new operations.
- **Authority & Security**: Strictly read-only (`REVIEW`/`read_only`/`poc/`). Zero authority elevation. Sanitization (`sanitizeReport`, `sanitizeStringValue`) strictly enforced on all synthesized summaries.
- **Mechanism Reuse**: Reuses existing `task.evidence`, `task.kilo`, `task.builder`, `task.gemini`, and independent verification records in `TaskRegistry`.

### 4.3 Affected Interfaces & Files (for Future Implementation)
- `services/deepseek-runtime.js`: Update `projectTaskForDeepSeek()` to include an `evidence_summary.synthesized_findings` or `evidence_summary.structured_highlights` field derived from agent execution reports.
- `test/deepseek-runtime.test.js`: Add unit tests verifying structured evidence summarization across specialist execution reports (Security Specialist, Gemini Reviewer, Utility Specialist).

### 4.4 Required Tests
- Unit tests verifying that structured evidence summarization correctly extracts finding categories, test counts, and agent report highlights without leaking secrets.
- Regression tests confirming all 450+ existing tests pass, maintaining the two-operation control plane and `MAX_TOOL_ITERATIONS = 3`.

### 4.5 Explicit Out-of-Scope Boundaries
- No consequential capability escalation (`BUILDER`, commits, pushes) without Director approval.
- No new control operations or dispatcher mechanisms.
- No cross-request database persistence.

---

## 5. Unresolved Architectural Questions
None. All underlying mechanisms (TaskRegistry evidence collection, sanitization, projection) are fully implemented and verified on main.

---

## 6. Implementation Readiness State
**IMPLEMENTATION-READY**. The recommended increment requires no prior architectural decisions and can be implemented directly as a bounded, atomic code change adhering to all repository constraints.
