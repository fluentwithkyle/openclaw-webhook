# Research Record: DeepSeek Coordinator Machine-Enforcement Lifecycle Architecture

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-COORDINATOR-MACHINE-ENFORCEMENT-LIFECYCLE-RESEARCH-001 |
| Research Question / Objective | Conduct comprehensive architectural research to determine how the existing ChatGPT/DeepSeek coordinator operating protocol can be converted from a partially procedural/documentary system into a machine-enforced coordinator lifecycle implemented within the existing DeepSeek Coordinator Evolution architecture, identifying enforceable procedures, authoritative enforcement points, implementation gaps, target state-machine architecture, roadmap mapping, and the minimum viable first implementation increment. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-10-01 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope of this Task | Research and architectural documentation ONLY. No implementation of production application code is authorized. Authorized file modification paths: `docs/ai/research/`, `docs/ai/RESEARCH_INDEX.md`, `docs/ai/TASK_LOG.md`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/ARCH_DECISIONS.md`, `poc/schemas/acp-schema.js`, `test/schema.test.js`. |

---

## Executive Summary

The DeepSeek Coordinator Evolution project has successfully implemented and verified Phase 0 (Coordinator Contract), Phase 1 (Observation), Phase 2 (Bounded Lineage), and Phase 3 (Autonomous Coordination Loop with server-derived workflow sequencing, autonomous-turn bounds, failure/blocked termination, and Director authorization infrastructure). 

However, the broader project operating protocol (documented in `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` and `docs/ai/CHATGPT_START_HERE.md`) remains largely **procedural and documentary** at the coordinator interface level. While the DeepSeek runtime enforces bounded tool iteration (`MAX_TOOL_ITERATIONS = 3`), autonomous turns (`MAX_AUTONOMOUS_COORDINATION_TURNS = 2`), ACP schema validation, TaskRegistry lineage checks, and Director approval proofs, the transition from conversational intent and protocol review into mandatory step-by-step state machine progression can still suffer from procedural gaps (e.g., a coordinator recognizing a need for delegation but failing to construct a valid ACP task artifact, or proceeding without explicit roadmap alignment/simplicity gates).

This research establishes a complete architectural blueprint for converting the coordinator lifecycle into a **deterministic, machine-enforced state machine** embedded directly within the existing single-control-plane, ACP, TaskRegistry, and DeepSeek runtime architecture. It preserves Kyle as final authority, treats model output strictly as untrusted intent, reuses existing enforcement primitives, and defines the precise implementation sequence leading into Phase 4.

---

## 1. Comprehensive Coordinator Lifecycle Mapping

The repository's actual operating procedure defines twelve sequential lifecycle steps (`docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` and `CHATGPT_START_HERE.md`). The mapping below evaluates each step across its requirement, documentation source, current machine enforcement status, authoritative state, enforcement boundary, failure outcome, and durable evidence:

1. **Project Bootstrap**
   - **Requirement**: Establish repository and project-control documentation truth.
   - **Where Documented**: `docs/ai/CHATGPT_START_HERE.md`.
   - **Machine Enforced?**: Partially (procedural check; runtime relies on repository static presence).
   - **Authoritative State**: `docs/ai/STATE.md`, repository structure.
   - **Enforcement Boundary**: Client/Coordinator preparation gate; server-side repository context.
   - **Failure Outcome**: Fail-closed bootstrap result (`NOT READY — PROJECT BOOTSTRAP INCOMPLETE`).
   - **Durable Evidence**: Bootstrap completion checklist verification.

2. **Protocol Review**
   - **Requirement**: Review current repository version of `CHATGPT_PROJECT_OPERATING_PROTOCOL.md`.
   - **Where Documented**: `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` §2.1.
   - **Machine Enforced?**: No (relies on coordinator memory/compliance).
   - **Authoritative State**: Current protocol file hash/content on `main`.
   - **Enforcement Boundary**: Coordinator prompt-level instruction / behavioral adherence.
   - **Failure Outcome**: Protocol non-compliance / unverified coordination.
   - **Durable Evidence**: None currently persisted.

3. **Roadmap Alignment**
   - **Requirement**: Prove proposed work aligns with active roadmap phase before task construction.
   - **Where Documented**: `docs/ai/TASK_STANDARD.md` §3.1, `docs/ai/STATE.md`.
   - **Machine Enforced?**: Partially (Phase-transition gate `poc/phase-transition-gate.js` exists for phase shifts, but individual task alignment relies on prompt instructions).
   - **Authoritative State**: `docs/ai/STATE.md` (authoritative strategic state) and `docs/ai/strategic-state.json`.
   - **Enforcement Boundary**: Coordinator action construction / ACP validation check.
   - **Failure Outcome**: Task construction rejected as roadmap drift.
   - **Durable Evidence**: Strategic alignment verification report / TASK_LOG entry.

4. **Applicable Requirements Extraction**
   - **Requirement**: Identify protocol requirements applicable to the specific action.
   - **Where Documented**: `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` §2.2.
   - **Machine Enforced?**: No (coordinator responsibility).
   - **Authoritative State**: Operating protocol definitions.
   - **Enforcement Boundary**: Coordinator reasoning boundary.
   - **Failure Outcome**: Omission of necessary compliance constraints.
   - **Durable Evidence**: Plan / task envelope completeness.

5. **Repository/State Verification**
   - **Requirement**: Establish implementation truth from GitHub and durable state (`STATE.md`, `TASK_LOG.md`, `ARCH_DECISIONS.md`).
   - **Where Documented**: `docs/ai/CHATGPT_START_HERE.md` §4.
   - **Machine Enforced?**: Partially (via `get_task` and TaskRegistry status checks).
   - **Authoritative State**: TaskRegistry, GitHub commit state, `docs/ai/STATE.md`.
   - **Enforcement Boundary**: Runtime query (`get_task`, `TaskRegistry`).
   - **Failure Outcome**: Acting on stale, missing, or contradictory assumptions.
   - **Durable Evidence**: Task observation projection record.

6. **Solution Simplicity Evaluation**
   - **Requirement**: Evaluate whether proposed solution is the simplest correct path without architecture drift.
   - **Where Documented**: `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` Solution Simplicity Gate.
   - **Machine Enforced?**: No (coordinator compliance / architectural review).
   - **Authoritative State**: Architecture guidelines (`ARCHITECTURE.md`).
   - **Enforcement Boundary**: Reviewer / coordinator advisory gate.
   - **Failure Outcome**: Unnecessarily complex or non-idiomatic design.
   - **Durable Evidence**: Architectural decision record / review feedback.

7. **Action Construction**
   - **Requirement**: Construct valid ACP task request matching task standard.
   - **Where Documented**: `docs/ai/TASK_STANDARD.md`.
   - **Machine Enforced?**: **Yes** (ACP schema validation in `poc/schemas/acp-schema.js`).
   - **Authoritative State**: ACP JSON schema definition.
   - **Enforcement Boundary**: Server ingress (`validateACPCommand` at `/poc/coordinator` / `/poc/deepseek-runtime`).
   - **Failure Outcome**: Ingestion rejection (HTTP 400 / validation error).
   - **Durable Evidence**: TaskRegistry creation entry.

8. **ACP Compliance Verification**
   - **Requirement**: Verify task request conforms strictly to ACP contract and permitted paths.
   - **Where Documented**: `docs/ai/TASK_STANDARD.md`, `ARCHITECTURE.md` §12.
   - **Machine Enforced?**: **Yes** (`validateACPCommand`, permitted path enforcement).
   - **Authoritative State**: ACP schema and server-side routing policy.
   - **Enforcement Boundary**: Coordinator ingress (`routes/poc.js`).
   - **Failure Outcome**: Request blocked / rejected before registration.
   - **Durable Evidence**: Validation logs / error responses.

9. **Authorization**
   - **Requirement**: Obtain Kyle’s explicit authorization for consequential actions (`BUILDER`, `FAILOVER_EXECUTE`, write/commit/push).
   - **Where Documented**: `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` §14, ADR-016/017/018/Phase 3.1.
   - **Machine Enforced?**: **Yes** (`POST /poc/director/approve`, approval proof validation, single-use check, scope hash).
   - **Authoritative State**: TaskRegistry authorization proof record.
   - **Enforcement Boundary**: Ingress dispatch registration (`routes/poc.js`, `poc/schemas/acp-schema.js`).
   - **Failure Outcome**: HTTP 403 Forbidden / execution blocked.
   - **Durable Evidence**: Consumed authorization proof record in TaskRegistry.

10. **Authorized Execution**
    - **Requirement**: Execute permitted actions strictly within authorized paths and capabilities.
    - **Where Documented**: `AGENTS.md`, `ARCHITECTURE.md` §12, `GEMINI.md`.
    - **Machine Enforced?**: **Yes** (Dispatcher, orchestrator, github workflow permissions, file path bounds).
    - **Authoritative State**: Task execution state (`EXECUTING`, `VERIFIED`, `COMPLETE`, `FAILED`).
    - **Enforcement Boundary**: Dispatcher / orchestrator / GitHub Actions runner.
    - **Failure Outcome**: Execution failure / step abort.
    - **Durable Evidence**: `gemini-acp-report.json`, test run logs, commit hash.

11. **Independent Verification**
    - **Requirement**: Verify delivered work independently against durability standard (tests, diff check, verification artifacts).
    - **Where Documented**: `docs/ai/TASK_STANDARD.md`, `ARCHITECTURE.md`.
    - **Machine Enforced?**: Partially (automated test suites run during Builder/Kilo verification; verification artifact required for `COMPLETE`).
    - **Authoritative State**: `INDEPENDENT_VERIFICATION` status, test exit codes, ACPI verification report.
    - **Enforcement Boundary**: Test runner / verification gate / coordinator observation projection.
    - **Failure Outcome**: Insufficient verification rejection (`insufficient_verification`).
    - **Durable Evidence**: Test results, diff report, `gemini-acp-report.json`.

12. **Reconciliation & Stop**
    - **Requirement**: Reconcile durable project state (`STATE.md`, `TASK_LOG.md`, `RESEARCH_INDEX.md`) and stop.
    - **Where Documented**: `docs/ai/README.md`, `docs/ai/STATE.md`.
    - **Machine Enforced?**: Partially (commit verification, phase transition gates; documentation updates still require explicit execution).
    - **Authoritative State**: Durable repository markdown state files.
    - **Enforcement Boundary**: Documentation verification / commit checks.
    - **Failure Outcome**: Stale project state / unrecorded work.
    - **Durable Evidence**: Reconciled commit on `main`.

---

## 2. Deep-Dive: Investigating the Task-Construction Failure Mode

### The Failure Mode
A coordinator can correctly determine that another agent needs to perform work, recommend delegation in natural language, and then **fail to construct the required ACP task artifact** (or emit conversational advice without invoking `request_task`).

### Root Causes
1. **Model Conversational Drift**: LLMs trained on general chat tend to treat recommendations ("You should run test X") as terminal actions without recognizing that execution requires a programmatic tool call (`request_task`).
2. **Missing Mechanical Coupling**: In the prior unconstrained architecture, model output text was consumed directly by the user without requiring a validated, persisted TaskRegistry entry.
3. **Absence of State-Transition Invariants**: The transition from "intent understood" to "task requested" relied on model compliance rather than an explicit state machine invariant.

### Mechanical Prevention Architecture
To mechanically prevent this transition from proceeding without a valid task artifact, the architecture enforces the following invariants:
- **Strict Output-to-Action Binding**: In the DeepSeek runtime loop (`services/deepseek-runtime.js`), if the model produces text recommending delegation or action without emitting a corresponding `request_task` tool call within an autonomous turn, the runtime intercepts the turn and enforces a **fail-closed clarification/action constraint** (e.g., prompting the model to invoke `request_task` or escalating to `BLOCKED`).
- **State-Driven Workflow Gate**: As established in Phase 3 workflow sequencing, the coordinator cannot claim progress past `intent` unless an authoritative TaskRegistry task identifier (`request_id`) exists in state.
- **Single-Control-Plane Ingress Guarantee**: No external agent or coordinator can trigger work outside the authenticated `/poc/coordinator` or `/poc/deepseek-runtime` ingress. Unstructured text is never executed as a task.

---

## 3. Target Coordinator State Machine Architecture

The target coordinator state machine extends the existing DeepSeek Coordinator Evolution lifecycle/state machinery (`TaskRegistry` status enum: `PENDING`, `SELECTED`, `PLANNED`, `EXECUTING`, `VERIFIED`, `COMPLETE`, `FAILED`, `BLOCKED`, `CANCELLED`, `SUPERSEDED`) without introducing a parallel state store.

### States & Valid Transitions
```
[INTENT_RECEIVED] 
       │
       ▼
[PROTOCOL_REVIEWED & STATE_VERIFIED] 
       │
       ▼ (Valid request_task invocation)
[ACP_VALIDATED & REGISTERED] (TaskRegistry: PENDING / SELECTED)
       │
       ├─► [DIRECTOR_APPROVAL_REQUIRED] ──(Valid Director Approval Proof)──┐
       │                                                                  │
       └─────────────────────────(Read-only / REVIEW)─────────────────────┼─► [DISPATCHED / EXECUTING]
                                                                          │
                                                                          ▼
                                                                 [INDEPENDENT_VERIFICATION]
                                                                          │
                                                                   ┌──────┴──────┐
                                                                   ▼             ▼
                                                               [COMPLETE]    [FAILED / BLOCKED]
                                                                   │             │
                                                                   ▼             ▼
                                                               [RECONCILED]  [ESCALATED / STOP]
                                                                   │
                                                                   ▼
                                                               [TERMINAL]
```

### Transition Prerequisites & Authoritative Inputs
- **`INTENT_RECEIVED` → `ACP_VALIDATED`**: Requires valid ACP JSON payload, matching base branch (`main`), authorized paths, and schema compliance (`validateACPCommand`).
- **`ACP_VALIDATED` → `DISPATCHED`**: For `REVIEW` / `read_only` / `poc/`, requires TaskRegistry registration and dispatcher invocation. For `BUILDER` / `FAILOVER_EXECUTE`, requires a valid, unconsumed Director approval proof (`task.authorization_proof`).
- **`DISPATCHED` → `COMPLETE`**: Requires agent execution success, test pass evidence, and `INDEPENDENT_VERIFICATION` status.
- **`COMPLETE` → `RECONCILED`**: Requires durable update of `STATE.md`, `TASK_LOG.md`, and commit/push to `main`.

---

## 4. Enforcement Boundary Mapping

| Lifecycle Procedure / Gap | Authoritative Enforcement Boundary | Enforcing Component | Mechanism |
|---|---|---|---|
| Project Bootstrap / Protocol Review | Runtime / Prompt boundary | DeepSeek Runtime / System Instructions | System prompt bootstrap contract / initial read enforcement |
| Roadmap Alignment | Control Plane / Ingress | `poc/phase-transition-gate.js` / State Evaluator | Strategic alignment state check against `STATE.md` |
| Action Construction / ACP Compliance | Server Ingress | `poc/schemas/acp-schema.js` | `validateACPCommand` JSON schema validation |
| Director Authorization | Server Ingress / Registry | `POST /poc/director/approve`, `TaskRegistry` | Cryptographic / secret-bound approval record, single-use consumption |
| Execution / Dispatch | Orchestrator / Dispatcher | `poc/orchestrator.js`, `poc/command.json` | Server-derived authority, permitted path checks |
| Independent Verification | Test Runner / Reviewer | Jest / Gemini Reviewer / `gemini-acp-report.json` | Automated test suite execution, diff checks |
| Reconciliation | Git / Repository State | GitHub Actions / Commit Verification | Mandatory durable state file updates and commit checks |

---

## 5. Reuse Analysis: Existing Mechanisms as Enforcement Primitives

Rather than creating duplicate enforcement machinery, the target architecture reuses:
1. **ACP Schema Validation (`poc/schemas/acp-schema.js`)**: Ensures all task requests adhere strictly to the canonical envelope.
2. **TaskRegistry (`poc/task-registry.js`)**: Serves as the sole authoritative task state machine, lineage tracker, and metadata store.
3. **Phase-Transition Gates (`poc/phase-transition-gate.js`)**: Enforces state-machine transition rules between roadmap phases.
4. **Director Authorization Mechanism (`POST /poc/director/approve`)**: Enforces single-use, scope-hashed approval proofs for consequential actions.
5. **Bounded Autonomous Turns (`MAX_AUTONOMOUS_COORDINATION_TURNS = 2`, `MAX_TOOL_ITERATIONS = 3`)**: Prevents infinite loops and enforces step-by-step verification.
6. **Server-Derived Workflow Sequencing**: Dictates mandatory sequence (`review → implementation → verification → reconciliation`).

---

## 6. DeepSeek Roadmap Mapping & Proposed Phase 4 Amendments

### Roadmap Status
- **Phase 0 — Coordinator Contract**: COMPLETE / VERIFIED
- **Phase 1 — Observation**: COMPLETE / VERIFIED
- **Phase 2 — Bounded Lineage**: COMPLETE / VERIFIED
- **Phase 3 — Autonomous Coordination Loop**: COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED
- **Phase 4 — Scaled Conversational Orchestration & Cross-Task Lineage Navigation**: PROPOSED / TARGET (Pending formal durable transition evidence).

### Proposed Phase 4 Roadmap Amendment
To bridge procedural operating protocols with deterministic machine enforcement, Phase 4 scope is formally amended to include **Coordinator Lifecycle State-Machine Enforcement (Increment 4.1)**:
- Codify the remaining procedural protocol gates (Protocol Review verification, Roadmap Alignment check, and Solution Simplicity validation) into explicit machine-checkable validation steps within the DeepSeek runtime ingress (`/poc/deepseek-runtime`) and ACP command validation.
- Implement explicit validation checks ensuring no coordinator session can invoke `request_task` without a validated parent lineage or explicit roadmap alignment status.

---

## 7. Implementation Dependency Sequence & Minimum Viable Increment

### Implementation Sequence (Smallest Safe Increments)
1. **Increment 4.1 (Machine-Enforced Protocol & Roadmap Alignment Gate)**: Add server-side validation ensuring that any DeepSeek-coordinated task request explicitly references an active, aligned roadmap phase recorded in `STATE.md` and validates protocol prerequisite checks before task creation.
2. **Increment 4.2 (Cross-Task Lineage Navigation & Parent-Child Aggregation)**: Implement robust multi-task lineage tree traversal in `get_task` projections as designed in Phase 4 research.
3. **Increment 4.3 (Policy-Driven Specialist Chaining & Recovery Routing)**: Automate deterministic fallback routing on failure/blocked states.

### Minimum Viable First Implementation Increment
**Increment 4.1: Roadmap Alignment & Protocol Prerequisite Validation at Coordinator Ingress** is the correct starting point. It requires no new state stores or external services, reuses `poc/phase-transition-gate.js` and ACP validation, and mechanically closes the gap between documentary protocols and runtime enforcement.

---

## 8. Unresolved Architectural Questions & Explicit Distinction

### Unresolved Questions
1. How can external chat client UI sessions (like Chatbox iOS) natively render intermediate lifecycle state transitions (e.g., `DIRECTOR_APPROVAL_REQUIRED`) without violating the server-side authority boundary?
2. What is the optimal caching strategy for strategic state projections during high-frequency autonomous coordination loops?

### Explicit Distinction
- **Verified Repository Facts**: ACP schema validation, TaskRegistry task lifecycle states, Phase 3 autonomous turns (`MAX_AUTONOMOUS_COORDINATION_TURNS = 2`), and Director authorization proofs are **fully implemented, tested, and verified** in current repository code.
- **Architectural Recommendations**: Codifying procedural protocol checks and roadmap alignment into explicit runtime validation gates represents an **architectural recommendation** for Phase 4 execution, pending Kyle's authorization.

---
*End of Research Record*
