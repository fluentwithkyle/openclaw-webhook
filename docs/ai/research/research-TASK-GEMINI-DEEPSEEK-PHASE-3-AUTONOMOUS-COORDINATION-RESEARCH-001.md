# Research Record: DeepSeek Phase 3 Autonomous Coordination Architecture and Policy Model

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-PHASE-3-AUTONOMOUS-COORDINATION-RESEARCH-001 |
| Research Question / Objective | Research and durably document the smallest viable ACP-compliant Phase 3 capability that allows DeepSeek to progress from bounded parent-linked REVIEW/read_only coordination toward an autonomous coordination loop, while preserving the existing ACP control-plane authority model. Determine exactly what server-side policy, authorization boundary, task lifecycle integration, specialist selection mechanism, and verification/evidence requirements are required before DeepSeek can safely coordinate multiple existing specialist lanes. Do not implement Phase 3 in this task. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-09-27 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope of this Task | Research and documentation ONLY. No implementation of Phase 3 code or production changes is authorized. |

---

## Executive Summary

Phase 1 (`get_task` observation projection) and Phase 2 (bounded parent lineage via `parent_request_id` under server-derived REVIEW/read_only authority) are fully implemented and verified in the repository. 

Phase 3 addresses the transition from single-turn parent-linked task creation toward an **autonomous coordination loop** where DeepSeek can observe task outcomes, reason about results, and orchestrate subsequent specialist task requests. 

This research establishes that Phase 3 must **not** introduce a second control plane, a second TaskRegistry, model-controlled authorization, or un-gated privilege elevation. Instead, Phase 3 can be realized as a server-side policy orchestration layer that interprets model intent, enforces TaskRegistry lineage rules, manages bounded model iterations (`MAX_TOOL_ITERATIONS`), and enforces independent verification gates before autonomous task progression. Any consequential capability elevation (such as triggering Gemini Builder or write/commit/push paths) requires an explicit Director (Kyle) authorization gate and must never be self-authorized by model output or parent lineage.

---

## 1. Current Phase 2 Baseline (Repository State)

- **Model-Facing Tool:** Exactly one tool (`control_plane`) in `services/deepseek-runtime.js`.
- **Operations:** `request_task` and `get_task`.
- **Lineage:** Optional `parent_request_id` validated server-side against existing TaskRegistry rules (`validateLineageForCreate`).
- **Authority:** Strictly server-derived (`task_mode: REVIEW`, `capabilities: [read_only]`, `permitted_paths: ['poc/']`, target fixed to Gemini Builder). Model input is untrusted intent.
- **Iteration Bounds:** `MAX_TOOL_ITERATIONS = 2`.
- **Evidence & Verification:** TaskRegistry enforces evidence-gated transitions (`INDEPENDENT_VERIFICATION` required for VERIFIED/COMPLETE).

---

## 2. Phase 3 Autonomous Coordination Architecture Requirements

### 2.1 Server-Side Specialist Selection
- **Finding:** DeepSeek cannot be permitted to select or assign arbitrary specialist lanes (e.g. Gemini Builder, Kilo, Security Specialist) directly via model-controlled parameters.
- **Requirement:** Trusted server-side policy must inspect the model's objective/intent and map it to an authorized specialist lane through a validated router or policy rule, preserving fail-closed boundaries.

### 2.2 Controlled Progression & Multi-Turn Continuation
- **Finding:** Autonomous coordination requires DeepSeek to execute multi-turn loops where it calls `get_task` on task $N$, evaluates the execution report and verification status, and decides whether to issue `request_task` for task $N+1$ with `parent_request_id: <task_N_id>`.
- **Requirement:** Bounded tool iteration (`MAX_TOOL_ITERATIONS`) and explicit stop conditions prevent infinite recursion or runaway token consumption.

### 2.3 TaskRegistry Lineage & Correlation
- **Finding:** TaskRegistry already supports parent/child lineage, cancellation, supersession, and single-active-child constraints.
- **Requirement:** Phase 3 must reuse these existing mechanisms without creating a second registry or orchestration state machine.

### 2.4 Authority Decisions & Untrusted Model Intent
- **Finding:** Model output is strictly untrusted intent/proposal. All authority parameters (task mode, capabilities, permitted paths, repository, base branch, target agent, authorization) are derived exclusively by trusted server policy.
- **Requirement:** Zero model-controlled authority fields. Parent lineage is correlation metadata only, never an authorization grant.

### 2.5 Consequential Capability Elevation & Human Authorization
- **Finding:** Phase 2 is strictly REVIEW / read_only / `poc/`. Phase 3 autonomous coordination raises the architectural question of whether DeepSeek can trigger consequential tasks (Builder, write, commit, push).
- **Requirement:** Consequential capability elevation **must never** be auto-authorized by model output, tool iteration, or parent lineage. It requires an explicit, trusted Director (Kyle) authorization transaction (human-in-the-loop approval gate).

### 2.6 Verification Gates & Evidence Requirements
- **Finding:** Agent execution reports are evidence only (`AGENT_REPORT`), never independent verification (`INDEPENDENT_VERIFICATION`).
- **Requirement:** Autonomous progression from task $N$ to task $N+1$ must respect task lifecycle states and verification gates. A task that fails (`FAILED`) or blocks (`BLOCKED`) must terminate the autonomous loop or route to human review rather than spawning blind child tasks.

### 2.7 Recovery from Interrupted Orchestration
- **Finding:** Ephemeral TaskRegistry state loss can disrupt multi-turn coordination.
- **Requirement:** Phase 3 orchestration must integrate with Path 2 GitHub issue recovery (`recoverTaskFromGitHub`) and signal artifacts (`poc/signals/`) to ensure resumability.

---

## 3. Smallest Viable Phase 3 Increment

The smallest independently deliverable Phase 3 increment is a **server-side policy evaluation layer** that:
1. Allows DeepSeek to inspect task execution and evidence via multi-turn `get_task` calls within a slightly expanded bounded iteration limit (`MAX_TOOL_ITERATIONS = 3` or controlled chaining).
2. Validates model-submitted continuation intent against TaskRegistry lineage and verification state.
3. Automatically halts autonomous loops when a task blocks, fails, or lacks independent verification.
4. Strictly disallows self-authorized privilege escalation or consequential writes without Director authorization.

---

## 4. Unresolved Decisions / Blockers for Kyle

1. **Consequential Authorization Mechanism:** Define the exact trusted human-approval transaction required before DeepSeek coordination can spawn a BUILDER or write/commit/push task.
2. **Multi-Turn Iteration Bound:** Determine whether `MAX_TOOL_ITERATIONS` should remain 2 or be increased to 3 for multi-step reasoning.
3. **Specialist Routing Policy:** Define the exact server-side policy rules for routing tasks between Gemini Reviewer, Gemini Builder, and specialized lanes during autonomous decomposition.

---

## 5. Repository Evidence & Verification Basis

- **Evidence:** `services/deepseek-runtime.js`, `poc/task-registry.js`, `poc/orchestrator.js`, `poc/schemas/acp-schema.js`, and test suites (`test/coordinator.test.js`, `test/reliability-enforcement.test.js`).
- **Status:** Research only. No Phase 3 implementation performed.
