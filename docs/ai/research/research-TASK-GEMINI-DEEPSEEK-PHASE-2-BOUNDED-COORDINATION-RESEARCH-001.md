# Research Record: DeepSeek Phase 2 Bounded Coordination Architecture and Policy Model

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-PHASE-2-BOUNDED-COORDINATION-RESEARCH-001 |
| Research Question / Objective | Determine the smallest viable, ACP-compliant Phase 2 Bounded Coordination capability/policy model that can let DeepSeek translate an already-observed workflow need into an authorized multi-step coordination request without creating a second control plane or granting the model authority. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-09-27 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope of this Task | Research and documentation ONLY. No production application code implementation is authorized. All proposed architectural extensions are documented for evaluation and future implementation phases. |

---

## Executive Summary & Baseline State

This research record establishes the architectural blueprint, security boundaries, gap analysis, and policy model for **Phase 2 Bounded Coordination**. Building upon the successfully verified Phase 1 DeepSeek Coordinator Observation implementation (`TASK-CODEX-DEEPSEEK-PHASE-1-OBSERVATION-IMPLEMENT-001`, commit `8c77901`), Phase 2 addresses how DeepSeek — acting through the existing server-side runtime (`services/deepseek-runtime.js`) and ACP coordinator (`routes/poc.js`, `poc/task-registry.js`, `poc/orchestrator.js`) — can transition from observing a workflow need into initiating authorized multi-step coordination requests (such as advancing from research/planning to execution and verification) **without** creating a second control plane or granting the model authority.

### Core Baseline Findings (Phase 1 State)
1. **Model-Facing Boundary**: Exactly one tool (`control_plane`) supporting two narrow operations (`request_task` and `get_task`), as verified in `services/deepseek-runtime.js` and `test/deepseek-runtime.test.js`.
2. **Server-Derived Authority**: All authority-bearing fields (`repository`, `base_branch`, `target`, `task_mode`, `capabilities`, `permitted_paths`, `originator`, `authentication_context`) are strictly derived server-side. The model cannot supply capabilities or elevated access.
3. **Observation Surface**: The `get_task` projection provides a structured overview covering identity, lifecycle status (`PENDING`, `SELECTED`, `PLANNED`, `EXECUTING`, `VERIFIED`, `COMPLETE`, `FAILED`, `BLOCKED`), lineage, agent execution reports vs. independent verification evidence, verification requirements, and failure/blocked diagnostics.
4. **Zero Model Authority**: DeepSeek remains conversational intelligence only. ACP remains the authoritative validation, authorization, registration, and dispatch boundary. Kyle remains final authorization authority.

---

## 1. Mapping Existing ACP Infrastructure Reusable for Phase 2

Phase 2 must reuse existing infrastructure wherever viable, avoiding custom control planes or registries:
- **`TaskRegistry` (`poc/task-registry.js`)**: Already supports task creation, state transitions (`PENDING` → `SELECTED` → `PLANNED` → `EXECUTING` → `VERIFIED` → `COMPLETE`), evidence recording (`AGENT_REPORT`, `INDEPENDENT_VERIFICATION`), lineage tracking (`parent_request_id`, cancellation, superseding), and parent-child task queries (`getTasksByParent`).
- **Orchestrator & Dispatchers (`poc/orchestrator.js`, `services/transport-provider.js`)**: Target-aware dispatching to `Kilo`, `Gemini`, and `Gemini Builder` via secure webhooks/transports.
- **ACP Schema (`poc/schemas/acp-schema.js`)**: Validates task envelopes, allowed task modes (`REVIEW`, `VERIFY_RECONCILE`, `FAILOVER_EXECUTE`, `BUILDER`, `RESEARCH_DOCUMENT`), capabilities, and permitted paths.

---

## 2. Smallest Viable Phase 2 Coordination Operation Model

### Operation Set Analysis
1. **Can existing `request_task` be extended?**
   - *Finding*: `request_task` is designed for initial task inception. Extending it to handle multi-step workflow progression (e.g., triggering a follow-up builder task from a completed research task) by accepting optional parameters like `parent_request_id` or `next_action_intent` is viable, **provided** all authority-bearing fields remain strictly server-derived.
   - *Alternative*: Introducing a distinct operation (e.g., `request_workflow_step` or `request_child_task`) could cleanly separate initial ingress from iterative coordination. However, from the model's perspective, expressing intent to execute the next phase of an observed workflow naturally maps to requesting a task linked to a parent request.

2. **Smallest Viable Solution**:
   - Keep the model-facing `control_plane` tool interface minimal.
   - Support an optional `parent_request_id` parameter (or structured workflow coordination parameters) in `request_task`, validated against the existing `TaskRegistry` lineage validation rules (`validateLineageForCreate`).
   - Server-side runtime and coordinator validate that the parent task exists, is active (or completed successfully as a prerequisite), and that the child task inherits or appropriately restricts its authorization boundary according to server policy.

---

## 3. Workflow Intent Expression vs. Server-Derived Authority

To prevent the model from escalating its own privileges:
- **Model Inputs (Untrusted)**: `operation` (`request_task` or `get_task`), `objective` (string description of the next step), `target` (authorized target agent from `VALID_AGENTS`, e.g., `Gemini Builder` or `Kilo`), `request_id` (for `get_task`), and optional `parent_request_id` (for task decomposition/lineage).
- **Server-Derived Fields (Strictly Enforced)**: `task_mode`, `capabilities`, `permitted_paths`, `repository`, `base_branch`, `originator`, and authentication secrets.
- **Rule**: DeepSeek cannot select task modes or capabilities. If a workflow step requires execution (`BUILDER` or `FAILOVER_EXECUTE`), server-side policy determines whether the session context permits it or whether it requires Kyle's explicit authorization (human-in-the-loop gate).

---

## 4. Multi-Step Workflow Correlation & Lineage

- **Correlation**: Multi-step workflows correlate through `TaskRegistry` using `parent_request_id`.
- **Lineage Representation**: When DeepSeek observes a completed research or planning task (e.g., status `VERIFIED` or `COMPLETE`), it can issue a follow-up `request_task` with `parent_request_id` pointing to the parent task.
- **Registry Enforcement**: `taskRegistry.createTask` checks `validateLineageForCreate(parentId, newRequestId)`:
  - Rejects children of cancelled or superseded tasks.
  - Ensures correct task tree decomposition without introducing a second registry.

---

## 5. Authorization Gating & Consequential Operations

- **Review / Read-Only vs. Consequential Execution**:
  - Phase 1 established DeepSeek in a read-only review context (`REVIEW` mode, `read_only` capability, `poc/` permitted path).
  - Phase 2 bounded coordination must respect task mode boundaries. If DeepSeek observes that a research task is complete and recommends implementation (`BUILDER` or `VERIFY_RECONCILE`), the resulting child task request cannot automatically execute with write privileges unless authorized by server policy or explicitly gated by Kyle.
  - **Human-in-the-Loop Gate**: Consequential operations (modifying code outside `poc/`, executing tests, committing, pushing) remain gated behind ACP task activation with proper credentials (`GEMINI_BUILDER_API_KEY`, GitHub PAT) and Kyle's authorization. DeepSeek can *request* or *recommend* the follow-up task, but the execution boundary remains strictly enforced by ACP.

---

## 6. Lifecycle & Scenario Representation

- **Research-Only**: Handled via `REVIEW` or `RESEARCH_DOCUMENT` mode within restricted paths (`docs/ai/research/`, `poc/`).
- **Review-Only**: Handled via `REVIEW` mode.
- **Implementation**: Handled via `BUILDER` mode, initiated through trusted triggers (`gemini-builder-trigger.js`) with explicit secret validation.
- **Failure / Recovery**: Handled via agent failure reports updating task status to `FAILED`, captured in observation projection, allowing DeepSeek to reason over blockers and prompt the user or suggest remediation.
- **Blocked / Escalation**: Handled via `BLOCKED` task status and `next_action: 'human_review'`, which DeepSeek observes and reports to the human operator.

---

## 7. Explicitly Out of Scope for Phase 2

The following capabilities remain **strictly outside** Phase 2 and must never be granted to DeepSeek:
1. **Arbitrary Filesystem Access**: Model cannot read or write arbitrary files outside permitted scopes.
2. **Arbitrary Capabilities**: Model cannot request `modify_files`, `commit`, `push`, or `run_tests` directly.
3. **Generic HTTP Execution**: Model cannot make arbitrary network requests or invoke unvetted webhooks.
4. **Direct GitHub Authority**: Model holds no GitHub tokens, PATs, or merge/push privileges.
5. **Credential Access**: Secrets (`DEEPSEEK_COORDINATOR_SECRET`, `OPENROUTER_API_KEY`, etc.) are never exposed to the model.
6. **Self-Authorized Commits / Pushes**: All repository mutations require authorized agent lanes (Kilo, Gemini Builder) and ACP validation.
7. **Autonomous Unbounded Tool Loop**: Tool execution remains bounded by `MAX_TOOL_ITERATIONS` and explicit validation checks.

---

## 8. Required Implementation Artifacts for Subsequent Atomic Implementation Task

When Phase 2 is authorized for implementation, the following changes will be required:
1. **ACP Schema / Validation (`poc/schemas/acp-schema.js`)**: Extend validation to accept optional `parent_request_id` in task creation commands originating from the coordinator.
2. **DeepSeek Runtime (`services/deepseek-runtime.js`)**: Update `buildControlPlaneCommand` to optionally accept `parent_request_id` when the model invokes `request_task` in a multi-step coordination flow.
3. **Tests (`test/deepseek-runtime.test.js`, `test/task-registry.test.js`)**: Add unit tests verifying parent-child task creation and lineage tracking through the coordinator tool interface.
4. **Documentation**: Reconcile `ARCHITECTURE.md`, `STATE.md`, and `CONTROL_CENTER.md` upon implementation.

---

## 9. Unresolved Architectural / Security Questions for Kyle

1. **Policy Threshold for Automated Chaining**: Should DeepSeek be permitted to automatically chain read-only research tasks (e.g., research → sub-research), while execution tasks (research → builder) always require explicit human approval via GitHub issue comment / workflow dispatch? (*Recommended position: Yes, read-only chaining can be bounded, while execution tasks require explicit human activation*).
2. **Iteration Limits**: What is the optimal `MAX_TOOL_ITERATIONS` for multi-step coordination (e.g., increasing from 2 to 4) without risking excessive token consumption or runaway loops?
