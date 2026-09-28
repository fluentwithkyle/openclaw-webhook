# Research Record: Phase 0 Coordinator Contract / Capability Architecture Reconciliation

- **Task / Request Identifier**: `TASK-GEMINI-DEEPSEEK-PHASE-0-COORDINATOR-CONTRACT-RECONCILIATION-001`
- **Research Objective**: Complete the authoritative Phase 0 — Coordinator Contract / Capability Architecture reconciliation for the DeepSeek Coordinator Evolution project, establishing a formally reconciled contract, typed operation model, server policy mapping, evidence contract, state-transition rules, Kyle authorization gates, and objective acceptance criteria.
- **Agent**: Gemini (Architect, Reviewer, and Researcher)
- **Date**: 2026-09-28
- **Task Mode**: `RESEARCH_DOCUMENT`
- **Repository Scope Examined**: 
  - `services/deepseek-runtime.js`
  - `routes/poc.js`
  - `poc/acp-engine.js`
  - `poc/task-registry.js`
  - `poc/orchestrator.js`
  - `docs/ai/STATE.md`
  - `docs/ai/CONTROL_CENTER.md`
  - `docs/ai/TASK_LOG.md`
  - `docs/ai/ARCH_DECISIONS.md`
  - `docs/ai/strategic-state.json`
  - `ARCHITECTURE.md` (§16.6)
  - Prior research records under `docs/ai/research/`

---

## 1. Actual Repository Evidence & Current-State Findings

Based on direct inspection of the repository on `main`:
1. **ChatBox / Runtime Ingress**: `POST /poc/deepseek-runtime` accepts incoming user requests, communicates with OpenRouter/DeepSeek, and exposes a single model-facing tool (`control_plane`).
2. **Operations Supported**: The `control_plane` tool permits exactly two operations:
   - `request_task`: Constructs an ACP command on the server side (target: Gemini Builder, task mode: `REVIEW`, capability: `read_only`, permitted paths: `poc/`) and submits it to `POST /poc/coordinator` using `DEEPSEEK_COORDINATOR_SECRET`.
   - `get_task`: Accepts a namespace-restricted `deepseek-runtime-` request ID, reads the TaskRegistry, and returns a safe sanitized projection covering all eight ACP lifecycle states (`PENDING`, `SELECTED`, `PLANNED`, `EXECUTING`, `VERIFIED`, `COMPLETE`, `FAILED`, `BLOCKED`), lineage, agent execution reports, evidence categories, independent verification evidence, verification requirements, and failure/blocked summaries.
3. **Execution Bounds**: The runtime tool loop is bounded by `MAX_TOOL_ITERATIONS = 2` (with Phase 3 bounded continuation allowing up to 3 iterations under strict prior-observation and completion constraints).
4. **Authority Separation**: Model output is treated strictly as intent, never authority. All authority-bearing fields (capabilities, permitted paths, targets, task modes, commit/push authority) are server-derived policy. No second TaskRegistry, dispatcher, orchestrator, or generic HTTP executor exists.
5. **Phase 0 Status**: The repository's authoritative state (`ARCHITECTURE.md` §16.6 and `STATE.md`) designates Phase 0 as **PARTIALLY COMPLETE / REQUIRES FORMAL RECONCILIATION**. While foundational operations (`request_task` / `get_task`) and observation increments (Increments 4.1–4.9) were implemented, a formal Phase 0 contract checkpoint was required before advancing to substantive Phase 2/3 features.

---

## 2. Coordinator Contract Definition (Typed Coordinator Operations)

To establish the authoritative operation model required for the Coordinator, operations are classified into implemented baseline operations and future/conditional operations.

### Operation Model Table

| Operation ID | Purpose | Required Inputs | Prohibited Inputs | Server-Derived Fields | Expected Output | Lifecycle Semantics | Evidence Requirements | Authorization Requirements | Failure / Blocked Behavior | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| `request_task` | Submit a read-only coordination objective | `objective` (string), optional `parent_request_id` | `target`, `capabilities`, `permitted_paths`, `task_mode`, `commit`, `push`, credentials | Target (`Gemini Builder`), task mode (`REVIEW`), capabilities (`read_only`), permitted paths (`poc/`), originator (`DeepSeek Coordinator`), verification requirements | Registered task envelope with `request_id`, status `PENDING`, and correlation metadata | Creates initial TaskRegistry entry; initiates downstream dispatch | None (submission request) | Authenticated via `DEEPSEEK-COORDINATOR-SECRET`; subject to strategic alignment evaluation | Fails closed (`STRATEGIC_ALIGNMENT_BLOCKED` or validation error) if unaligned or malformed | **IMPLEMENTED / VERIFIED** |
| `get_task` | Observe task lifecycle, state, lineage, and verification evidence | `request_id` (string starting with `deepseek-runtime-`) | Arbitrary task IDs outside the current runtime session/namespace, credentials, secret tokens | Sanitized projection fields (lifecycle, lineage, evidence counts/categories, independent verification, failure/blocked summaries) | Sanitized task observation JSON object | Read-only observation; does not mutate state | Requires valid TaskRegistry task lookup | Restricted to runtime-owned namespace prefix (`deepseek-runtime-`) | Returns error / sanitized fallback if task not found or unauthorized | **IMPLEMENTED / VERIFIED** |
| `request_consequential_task` (Future Phase 2/3) | Submit a consequential task (write, commit, push, FAILOVER_EXECUTE) | `objective`, `target`, `task_mode`, `capabilities`, `permitted_paths`, `director_approval_proof` | Unauthenticated requests, inherited approval proofs | Server-validated approval proof hash, scope matching | Registered consequential task envelope | Initiates builder/failover dispatch with elevated capabilities | Requires valid cryptographic/secret Director approval proof | Explicit Director approval via `POST /poc/director/approve` (Phase 3.1 infrastructure) | Fails closed (`DIRECTOR_APPROVAL_REQUIRED` or `APPROVAL_EXPIRED_OR_INVALID`) | **DOCUMENTED / PROPOSED / TARGET** |

---

## 3. Server Policy Mapping

The architectural boundary separating model intent from server-enforced policy is defined as follows:

1. **What DeepSeek May Express as Intent**: Natural language objectives, workflow decomposition steps, parent-child task references (`parent_request_id`), and observation requests (`get_task` for current session task IDs).
2. **What the Server Derives**: Execution envelope defaults (repository `fluentwithkyle/openclaw-webhook`, base branch `main`, `REVIEW` mode, `read_only` capability, `poc/` permitted paths for baseline operations).
3. **What ACP Derives / Enforces**: Capability isolation, permitted path validation, task mode boundaries, independent verification rules, and fail-closed schema checks (`poc/schemas/acp-schema.js`).
4. **What TaskRegistry Owns**: Durable task state, authoritative lifecycle status (`PENDING`, `SELECTED`, `PLANNED`, `EXECUTING`, `VERIFIED`, `COMPLETE`, `FAILED`, `BLOCKED`), evidence records, lineage navigation, and duplicate/active task protection.
5. **What the Orchestrator / Dispatcher Owns**: Execution dispatch, transport provider routing (`services/transport-provider.js`), callback handling, and trigger orchestration.
6. **Where Authorization is Established**: At the ACP compliance boundary (`poc/acp-engine.js`), validated against server environment secrets and explicit Director approval proofs (Phase 3.1).
7. **Where Specialist Selection Belongs**: Server-side specialist routing policy (matching intent keywords and risk tiers per `ARCHITECTURE.md` §12.7; model cannot arbitrarily assign specialists).
8. **Where Consequential Capabilities Become Available**: Only when backed by a server-held, single-use, scope-bound Director approval proof (Phase 3.1 architecture) unlocking BUILDER/FAILOVER_EXECUTE, write/modify capabilities, and commit/push.
9. **Where Kyle Approval is Required**: Any capability expansion beyond `REVIEW` / `read_only` / `poc/`, any repository file modification outside `docs/ai/` (for VERIFY_RECONCILE) or general source files, any commit/push, and any task mode change to FAILOVER_EXECUTE.
10. **Capability Registry / Policy Subsystem Rule**: No separate capability registry or policy subsystem is introduced. All policy is enforced directly within `services/deepseek-runtime.js`, `poc/acp-engine.js`, and `poc/task-registry.js`.

---

## 4. Evidence Contract

The evidence contract governs how coordinator decisions are informed and validated:

- **Agent Execution Report (`AGENT_REPORT`)**: Records execution output, logs, changed files, and agent commentary. This represents execution completion only, **not** desired-outcome verification.
- **TaskRegistry Lifecycle State**: Authoritative runtime status tracking transitions from `PENDING` through `EXECUTING` to `COMPLETE`, `FAILED`, or `BLOCKED`.
- **Verification Evidence**: Required artifacts or validation test outcomes attached to a task.
- **Independent Verification (`INDEPENDENT_VERIFICATION`)**: Mandatory gating evidence provided by an independent reviewer (e.g., Gemini Reviewer or verifier script) confirming that the change meets acceptance criteria. Per reliability rules (`TASK-KILO-CONTROL-PLANE-RELIABILITY-ENFORCEMENT-IMPLEMENT-001`), transitions to `VERIFIED` and `COMPLETE` require `INDEPENDENT_VERIFICATION`.
- **Reconciliation Evidence**: Git status, diff checks, and report artifacts confirming state consistency.
- **Desired-Outcome Verification**: Confirmation that the functional goal of the task was successfully achieved in the environment.
- **Failure Evidence (`failure_summary`)**: Sanitized diagnostic information recorded when a task enters `FAILED` state.
- **Blocked Evidence (`blocked_summary`)**: Sanitized blocker description recorded when a task enters `BLOCKED` state.
- **Evidence Sufficient to Permit Another Bounded Coordinator Decision**: For read-only observation (`get_task`), observation of a `COMPLETE` parent with attached `INDEPENDENT_VERIFICATION` evidence.
- **Evidence Sufficient to Establish Phase Convergence**: Independent verification reports, passing test suite execution logs, clean `git diff --check`, and strategic alignment evaluation matching all criteria of the phase.

---

## 5. State-Transition Contract

The coordinator lifecycle maps directly onto the authoritative ACP and TaskRegistry state machine:

1. **Legal Coordinator States**: Derived from TaskRegistry states: `PENDING`, `SELECTED`, `PLANNED`, `EXECUTING`, `VERIFIED`, `COMPLETE`, `FAILED`, `BLOCKED`.
2. **Legal Transitions**: 
   - `PENDING` → `SELECTED` → `PLANNED` → `EXECUTING`
   - `EXECUTING` → `VERIFIED` (requires `INDEPENDENT_VERIFICATION` evidence)
   - `VERIFIED` → `COMPLETE` (requires independent verification and reconciliation)
   - Any active state → `FAILED` or `BLOCKED` upon error or blocking condition
   - Active/Pending states → `CANCELLED` or `SUPERSEDED` upon explicit directive
3. **Terminal States**: `COMPLETE`, `FAILED`, `BLOCKED`, `CANCELLED`, `SUPERSEDED`.
4. **Verification Gates**: `EXECUTING` → `VERIFIED` cannot occur without an independent verification evidence record.
5. **Continuation Gates**: A child task creation (`request_task` with `parent_request_id`) requires the parent to be in `COMPLETE` state with `INDEPENDENT_VERIFICATION` evidence, observed previously via `get_task`.
6. **Cancellation / Supersession Behavior**: Cancelling or superseding a parent task immediately revokes pending child creation and invalidates any matching pending Director approvals.
7. **Failure / Blocked Handling**: Fails closed; diagnostic summaries are projected read-only without granting authority; execution halts and requires human intervention or Kyle escalation.
8. **Kyle Escalation Points**: Any architectural conflict, strategic alignment failure, unverified implementation, or request for consequential capability without a valid approval proof.

---

## 6. Kyle Authorization Gates

Director (Kyle) authorization is strictly required for:
- **Read-Only Coordination (`REVIEW`, `read_only`, `poc/`)**: Permitted under server-derived baseline policy without explicit Director approval proofs.
- **Research (`RESEARCH_DOCUMENT`, permitted doc paths)**: Authorized via ACP task command specifying permitted paths.
- **Implementation (`BUILDER`, modify files within permitted paths)**: Requires explicit ACP authorization and Gemini Builder invocation.
- **Consequential Execution**: Requires explicit signed/secret-authenticated Director approval proof (`POST /poc/director/approve`).
- **Write / Modify Capability**: Requires `modify_files` capability granted via ACP command.
- **Commit / Push**: Requires `commit` and `push` capabilities.
- **FAILOVER_EXECUTE**: Requires explicit temporary override and Director authorization.
- **Future Autonomous Continuation**: Requires explicit Phase 3 Director approval and governance convergence.

---

## 7. Implementation-vs-Contract Reconciliation

| Contract Element | Implementation Status | Repository Evidence / Location |
|---|---|---|
| Typed `request_task` operation | **IMPLEMENTED / VERIFIED** | `services/deepseek-runtime.js`, `routes/poc.js` |
| Typed `get_task` observation | **IMPLEMENTED / VERIFIED** | `services/deepseek-runtime.js`, `poc/task-registry.js` |
| Server-derived REVIEW/read_only/poc/ authority | **IMPLEMENTED / VERIFIED** | `services/deepseek-runtime.js` |
| Server policy mapping (intent vs policy) | **IMPLEMENTED / VERIFIED** | `services/deepseek-runtime.js`, `poc/acp-engine.js` |
| Evidence contract (AGENT_REPORT, INDEPENDENT_VERIFICATION) | **IMPLEMENTED / VERIFIED** | `poc/task-registry.js`, `test/reliability-enforcement.test.js` |
| State-transition contract & verification gates | **IMPLEMENTED / VERIFIED** | `poc/task-registry.js`, `poc/orchestrator.js` |
| Kyle authorization gates & approval infrastructure | **IMPLEMENTED / VERIFIED** | `services/deepseek-runtime.js`, `routes/poc.js` (Phase 3.1) |
| Bounded result-driven continuation | **IMPLEMENTED / VERIFIED** | `services/deepseek-runtime.js`, `poc/task-registry.js` (Phase 3) |
| Specialist routing policy | **IMPLEMENTED / VERIFIED** | `services/transport-provider.js`, `services/deepseek-runtime.js` (Phase 3.2) |
| Autonomous multi-turn coordination loop | **DOCUMENTED / NOT IMPLEMENTED** | `ARCHITECTURE.md` §16.6 (Phase 3 target) |

---

## 8. Phase 0 Acceptance Criteria

Phase 0 is formally accepted when the following objective criteria are independently verifiable:
1. **Contract Completeness**: The Coordinator Contract is explicitly documented, defining typed operations, server policy mapping, evidence contract, state transitions, and Kyle authorization gates.
2. **Implementation Alignment**: All baseline contract elements (`request_task`, `get_task`, server-derived policy, evidence gating, state transitions) are fully implemented and verified by automated test suites.
3. **No Unenforced Authority**: Zero model-granted credentials, capabilities, paths, targets, or commit/push permissions exist in code or policy.
4. **Independent Verifiability**: An independent reviewer can inspect `services/deepseek-runtime.js`, `routes/poc.js`, and `poc/task-registry.js` and confirm that all invariants are structurally enforced.

---

## 9. Phase Transition Condition & Recommendation

- **Evidence establishing `phase-0-contract-defined`**: This research record, combined with the implemented baseline runtime (`services/deepseek-runtime.js`) and verified test suites (`test/deepseek-runtime.test.js`, `test/coordinator.test.js`), provides complete, independently verifiable evidence that Phase 0 is defined and reconciled.
- **Remaining Director Decision Required**: After independent verification of this research record, Kyle (Director) must formally issue a phase transition decision to advance from Phase 0 (Coordinator Contract) to the next roadmap phase.
- **Exact Recommendation**: Stop at this convergence point. The required next action is:
  `independent verification → Kyle Director transition decision → next roadmap task.`

---

## ## Roadmap Alignment

- **Authoritative Roadmap**: `ARCHITECTURE.md` §16.6, `docs/ai/STATE.md`, `docs/ai/strategic-state.json`, `docs/ai/ARCH_DECISIONS.md`
- **Current Phase**: Phase 0 — Coordinator Contract
- **Phase Completion Status**: **COMPLETED / RECONCILED** (transitioning from PARTIALLY COMPLETE upon independent verification and Director approval)
- **Relevant Prior Work**: Stage 1 network path; existing DeepSeek runtime; `request_task` / `get_task` contract; Phase 1 observation; Phase 2 bounded coordination foundations; Phase 3.1 Director authorization; Phase 3.2 specialist routing
- **Required Prerequisite**: Stage 1 network path COMPLETE / VERIFIED
- **Proposed Task Classification**: A — Roadmap-Required Work
- **Roadmap Requirement Addressed**: `phase-0-contract-reconciliation`
- **Phase Unlock / Advancement**: Establishes the authoritative Coordinator Contract / Capability Architecture required before further substantive Coordinator capability expansion
- **Alignment Conclusion**: **ALIGNED — CONVERGENCE REACHED PENDING INDEPENDENT VERIFICATION & DIRECTOR TRANSITION**
