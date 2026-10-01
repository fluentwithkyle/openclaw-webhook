# Research Record: DeepSeek Coordinator Machine-Enforcement Lifecycle Deep Research (Pass 2)

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-COORDINATOR-MACHINE-ENFORCEMENT-LIFECYCLE-DEEP-RESEARCH-002 |
| Research Question / Objective | Conduct a second, substantially deeper architectural research pass on the machine-enforcement of the complete DeepSeek Coordinator lifecycle across all 12 operating-procedure stages, defining a deterministic state-machine model, procedure-to-enforcement matrix, evidence/provenance rules, recovery/re-entry mechanics, model-vs-machine authority boundaries, human-output contracts, and refined Phase 4 implementation decomposition. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-10-01 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope Examined | `docs/ai/CHATGPT_START_HERE.md`, `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md`, `docs/ai/TASK_STANDARD.md`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/TASK_LOG.md`, `docs/ai/ARCH_DECISIONS.md`, `poc/schemas/acp-schema.js`, `services/deepseek-runtime.js`, `poc/task-registry.js`, `poc/phase-transition-gate.js`, `poc/orchestrator.js`, `routes/poc.js`. |

---

## Executive Summary

The initial research record (`TASK-GEMINI-DEEPSEEK-COORDINATOR-MACHINE-ENFORCEMENT-LIFECYCLE-RESEARCH-001`) established that while the DeepSeek runtime and single-control-plane architecture strongly enforce ACP schema validation, authorization proofs, task registry lifecycle states, and bounded autonomous turns (`MAX_AUTONOMOUS_COORDINATION_TURNS = 2`, `MAX_TOOL_ITERATIONS = 3`), several key coordinator operating procedure stages—such as protocol review, requirements extraction, state verification, solution simplicity evaluation, and roadmap alignment—remain partially procedural or rely on coordinator conversational compliance.

This second, deeper research pass provides an exhaustive architectural specification for **complete machine-enforcement of the 12-stage coordinator lifecycle** without introducing any second control plane. It establishes an explicit procedure-to-enforcement matrix, authoritative state machine semantics, rigorous evidence/provenance bindings, robust recovery and interruption models, strict model-vs-machine authority separation, and a decomposed multi-increment Phase 4 implementation roadmap.

---

## 1. Current-State Findings

1. **Existing Enforcement Strengths**:
   - `validateACPCommand` (`poc/schemas/acp-schema.js`) enforces strict structural validity and permitted path bounds.
   - `TaskRegistry` (`poc/task-registry.js`) maintains authoritative task state (`PENDING`, `SELECTED`, `PLANNED`, `EXECUTING`, `VERIFIED`, `COMPLETE`, `FAILED`, `BLOCKED`, `CANCELLED`, `SUPERSEDED`) and lineage.
   - Director authorization (`POST /poc/director/approve`) enforces single-use, scope-hashed, crypto-authenticated approval proofs for consequential actions (`BUILDER`, `FAILOVER_EXECUTE`).
   - Phase-transition gates (`poc/phase-transition-gate.js`) guard roadmap phase shifts.
   - Bounded tool iterations (`MAX_TOOL_ITERATIONS = 3`) and autonomous turns (`MAX_AUTONOMOUS_COORDINATION_TURNS = 2`) prevent infinite execution loops.

2. **Existing Enforcement Gaps**:
   - **Protocol Review & Requirements Extraction**: Rely on coordinator prompt instructions without server-side verification of protocol version hashes or requirement check artifacts.
   - **Roadmap Alignment & Simplicity Gates**: Currently evaluated informally or via advisory prompts rather than deterministic server-side state-machine guards before `request_task` ingress.
   - **Verification & Reconciliation Gates**: While test results and `gemini-acp-report.json` provide downstream evidence, the transition from `VERIFIED` to `COMPLETE` and `RECONCILED` depends on explicit post-execution commits rather than automated state machine transitions driven by Git/GitHub webhooks.

---

## 2. Complete 12-Stage Lifecycle Analysis

Every coordinator procedure is treated as an explicit lifecycle requirement. The twelve stages are analyzed individually below:

### Stage 1: Project Bootstrap
- **Current Authoritative State**: Repository checkouts, `docs/ai/STATE.md`, `CHATGPT_START_HERE.md`.
- **Prerequisite State**: Repository initialized, environment configured.
- **Invariant**: Project truth must be derived from committed repository files, not transient conversational memory.
- **What Must Be Machine-Enforced**: Server startup verification of repository context and file presence.
- **What Can Only Be Evidence/Attestation**: Developer/environment initialization logs.
- **What May Legitimately Remain Model Judgment**: Interpretation of bootstrap instructions.
- **Authoritative Enforcement Point**: Runtime bootstrap / initialization checks (`index.js`).
- **Required Evidence/Provenances**: File system inspection confirmation.
- **Failure / Blocked Transition**: Fail-closed startup abort (`NOT READY — PROJECT BOOTSTRAP INCOMPLETE`).
- **Recovery / Re-entry Behavior**: Re-running initialization / ensuring repository sync.
- **Current Implementation Gap**: Relies on static runtime assumption.
- **Required Implementation Work**: Runtime bootstrap validation hook verifying core file presence.

### Stage 2: Protocol Review
- **Current Authoritative State**: `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` on `main`.
- **Prerequisite State**: Stage 1 Bootstrap complete.
- **Invariant**: Coordinator must operate under the exact protocol version defined in the repository.
- **What Must Be Machine-Enforced**: Protocol version/hash inclusion in coordinator request context.
- **What Can Only Be Evidence/Attestation**: Coordinator self-attestation of protocol comprehension.
- **What May Legitimately Remain Model Judgment**: Semantic interpretation of protocol rules.
- **Authoritative Enforcement Point**: DeepSeek runtime ingress (`/poc/deepseek-runtime`) / system prompt builder.
- **Required Evidence/Provenances**: Protocol SHA-256 hash bound to the request/session record.
- **Failure / Blocked Transition**: Request rejection if protocol hash is stale or mismatched.
- **Recovery / Re-entry Behavior**: Refreshing coordinator context with the latest protocol file content.
- **Current Implementation Gap**: Protocol content is injected via system prompt but lacks version/hash verification.
- **Required Implementation Work**: Inject protocol SHA-256 hash into runtime request context and require protocol check acknowledgment.

### Stage 3: Applicable Requirements Extraction
- **Current Authoritative State**: Operating protocol sections and task standard (`docs/ai/TASK_STANDARD.md`).
- **Prerequisite State**: Stage 2 Protocol Review complete.
- **Invariant**: Every task action must explicitly map to defined protocol requirements.
- **What Must Be Machine-Enforced**: Structured requirement reference in the ACP task payload (`requirements_reference` field).
- **What Can Only Be Evidence/Attestation**: Coordinator reasoning mapping task goals to requirements.
- **What May Legitimately Remain Model Judgment**: Selection of applicable clauses.
- **Authoritative Enforcement Point**: ACP schema validation (`poc/schemas/acp-schema.js`).
- **Required Evidence/Provenances**: Non-empty requirement reference array in task metadata.
- **Failure / Blocked Transition**: Validation error (`400 Bad Request`) if requirement reference is missing.
- **Recovery / Re-entry Behavior**: Resubmitting command with explicit requirements reference.
- **Current Implementation Gap**: Optional or missing requirement metadata in ACP schema.
- **Required Implementation Work**: Extend `acp-schema.js` to require `requirements_reference` for non-trivial tasks.

### Stage 4: Repository/State Verification
- **Current Authoritative State**: `docs/ai/STATE.md`, `docs/ai/TASK_LOG.md`, `TaskRegistry`, GitHub commit state.
- **Prerequisite State**: Stage 3 Requirements Extraction complete.
- **Invariant**: No task may be constructed based on unverified or stale repository assumptions.
- **What Must Be Machine-Enforced**: Mandatory prior execution of `get_task` or repository state inspection tool in the session history before `request_task`.
- **What Can Only Be Evidence/Attestation**: Model synthesis of repository findings.
- **What May Legitimately Remain Model Judgment**: Assessment of code structure and impact.
- **Authoritative Enforcement Point**: DeepSeek runtime loop / `control_plane` state check.
- **Required Evidence/Provenances**: TaskRegistry observation log or commit hash bound to request.
- **Failure / Blocked Transition**: Runtime refusal to emit `request_task` without prior inspection evidence.
- **Recovery / Re-entry Behavior**: Executing `get_task` or state check before task construction.
- **Current Implementation Gap**: Bounded continuation requires prior observation, but initial task creation lacks mandatory inspection proof.
- **Required Implementation Work**: Enforce pre-creation state inspection check in runtime loop.

### Stage 5: Solution Simplicity Evaluation
- **Current Authoritative State**: `ARCHITECTURE.md` design principles, codebase style.
- **Prerequisite State**: Stage 4 State Verification complete.
- **Invariant**: Solutions must adhere to maximum simplicity without introducing architectural drift or duplicate control planes.
- **What Must Be Machine-Enforced**: Permitted path validation and prohibition of unauthorized module additions.
- **What Can Only Be Evidence/Attestation**: Architectural simplicity justification in task rationale.
- **What May Legitimately Remain Model Judgment**: Trade-off analysis between design alternatives.
- **Authoritative Enforcement Point**: ACP validator & Gemini Reviewer gate.
- **Required Evidence/Provenances**: Permitted path validation log, review approval record.
- **Failure / Blocked Transition**: Rejection due to scope creep or architectural violation.
- **Recovery / Re-entry Behavior**: Simplifying task scope to fit permitted paths and existing patterns.
- **Current Implementation Gap**: Evaluated purely during review rather than mechanically at proposal time.
- **Required Implementation Work**: Add architectural boundary assertions to ACP validator.

### Stage 6: Roadmap Alignment
- **Current Authoritative State**: `docs/ai/STATE.md` and `docs/ai/strategic-state.json`.
- **Prerequisite State**: Stage 5 Simplicity Evaluation complete.
- **Invariant**: Task must align strictly with the active roadmap phase (`STATE.md`).
- **What Must Be Machine-Enforced**: Strategic alignment evaluator (`poc/strategic-alignment.js`) check against `STATE.md`.
- **What Can Only Be Evidence/Attestation**: None; roadmap alignment is strictly determinable from state.
- **What May Legitimately Remain Model Judgment**: None.
- **Authoritative Enforcement Point**: Phase transition gate & ACP ingress (`poc/phase-transition-gate.js`).
- **Required Evidence/Provenances**: Strategic alignment verification report confirming phase match.
- **Failure / Blocked Transition**: Request rejected as roadmap drift (`ROADMAP_DRIFT_BLOCKED`).
- **Recovery / Re-entry Behavior**: Updating roadmap state or aligning task request to active phase.
- **Current ImplementationGap**: Gate exists for phase shifts, but individual task alignment relies on prompt instructions.
- **Required Implementation Work**: Hook strategic alignment evaluator directly into `/poc/coordinator` and `/poc/deepseek-runtime` ingress.

### Stage 7: Action Construction
- **Current Authoritative State**: `docs/ai/TASK_STANDARD.md`, `poc/schemas/acp-schema.js`.
- **Prerequisite State**: Stage 6 Roadmap Alignment complete.
- **Invariant**: Action must conform precisely to the canonical ACP command envelope.
- **What Must Be Machine-Enforced**: Strict JSON schema validation of the constructed action.
- **What Can Only Be Evidence/Attestation**: Intent description text.
- **What May Legitimately Remain Model Judgment**: Parameter values for task payload.
- **Authoritative Enforcement Point**: `validateACPCommand` (`poc/schemas/acp-schema.js`).
- **Required Evidence/Provenances**: Validated ACP JSON object.
- **Failure / Blocked Transition**: HTTP 400 Validation Error.
- **Recovery / Re-entry Behavior**: Correcting payload syntax and resubmitting.
- **Current Implementation Gap**: Fully implemented and enforced (`validateACPCommand`).
- **Required Implementation Work**: None (canonical foundation).

### Stage 8: ACP Compliance
- **Current Authoritative State**: `ARCHITECTURE.md` §12, `docs/ai/TASK_STANDARD.md`.
- **Prerequisite State**: Stage 7 Action Construction complete.
- **Invariant**: Command must satisfy all protocol invariants (mode, capabilities, paths).
- **What Must Be Machine-Enforced**: Server-side checks for permitted capabilities and path bounds.
- **What Can Only Be Evidence/Attestation**: None.
- **What May Legitimately Remain Model Judgment**: None.
- **Authoritative Enforcement Point**: Ingress routing (`routes/poc.js`).
- **Required Evidence/Provenances**: Request authentication and authorization header verification.
- **Failure / Blocked Transition**: HTTP 403 Forbidden / Access Denied.
- **Recovery / Re-entry Behavior**: Adjusting requested capabilities to match assigned role/mode.
- **Current Implementation Gap**: Fully implemented.
- **Required Implementation Work**: None.

### Stage 9: Authorization
- **Current Authoritative State**: TaskRegistry approval proofs, ADR-016/017/018.
- **Prerequisite State**: Stage 8 ACP Compliance complete.
- **Invariant**: Consequential actions (`BUILDER`, `FAILOVER_EXECUTE`, write/commit/push) require explicit, crypto-bound Director approval.
- **What Must Be Machine-Enforced**: Single-use consumption of cryptographic approval proof (`task.authorization_proof`).
- **What Can Only Be Evidence/Attestation**: Kyle's conversational or signed approval intent.
- **What May Legitimately Remain Model Judgment**: None.
- **Authoritative Enforcement Point**: `POST /poc/director/approve` & TaskRegistry dispatch gate.
- **Required Evidence/Provenances**: Consumed approval proof record in TaskRegistry.
- **Failure / Blocked Transition**: HTTP 403 Forbidden / missing approval proof / expired proof.
- **Recovery / Re-entry Behavior**: Obtaining a fresh approval proof from Kyle via `POST /poc/director/approve`.
- **Current Implementation Gap**: Fully implemented for Phase 3.1 (`POST /poc/director/approve`), needs wiring into all consequential dispatch paths.
- **Required Implementation Work**: Ensure zero bypasses exist around approval proof consumption.

### Stage 10: Authorized Execution
- **Current Authoritative State**: Task execution status (`EXECUTING`), agent runner outputs.
- **Prerequisite State**: Stage 9 Authorization complete.
- **Invariant**: Execution must occur strictly within authorized paths and capabilities.
- **What Must Be Machine-Enforced**: Dispatcher/orchestrator file path bounds and workflow permissions.
- **What Can Only Be Evidence/Attestation**: Agent execution log output.
- **What May Legitimately Remain Model Judgment**: Implementation details and code edits by agent.
- **Authoritative Enforcement Point**: Orchestrator (`poc/orchestrator.js`) / GitHub Actions runner.
- **Required Evidence/Provenances**: Execution output logs, test results, commit hash (`gemini-acp-report.json`).
- **Failure / Blocked Transition**: Execution failure / step abort / non-zero exit code.
- **Recovery / Re-entry Behavior**: Diagnosing failure, patching code, re-running execution within authorization.
- **Current Implementation Gap**: Fully implemented.
- **Required Implementation Work**: None.

### Stage 11: Independent Verification
- **Current Authoritative State**: Test runner exit codes, Gemini Reviewer evaluation report.
- **Prerequisite State**: Stage 10 Authorized Execution complete.
- **Invariant**: Delivered work must be independently verified against durability standards before completion.
- **What Must Be Machine-Enforced**: Automated test suite execution and verification report generation.
- **What Can Only Be Evidence/Attestation**: Reviewer qualitative assessment.
- **What May Legitimately Remain Model Judgment**: Code quality and adherence to style.
- **Authoritative Enforcement Point**: Test runner / review gate / `gemini-acp-report.json`.
- **Required Evidence/Provenances**: Passing test logs, diff check report, verification signature.
- **Failure / Blocked Transition**: Insufficient verification (`insufficient_verification`) / test failure.
- **Recovery / Re-entry Behavior**: Fixing failing tests or addressing review findings before retry.
- **Current Implementation Gap**: Partially automated; requires strict state machine binding (`VERIFIED` status).
- **Required Implementation Work**: Mechanically bind `VERIFIED` task status to passing test artifacts and review reports.

### Stage 12: Reconciliation and Stop
- **Current Authoritative State**: Durable markdown state files (`STATE.md`, `TASK_LOG.md`, `RESEARCH_INDEX.md`), main commit history.
- **Prerequisite State**: Stage 11 Independent Verification complete.
- **Invariant**: Project state and documentation must be fully reconciled on `main` before task termination.
- **What Must Be Machine-Enforced**: Mandatory file updates and clean commit verification.
- **What Can Only Be Evidence/Attestation**: Final synthesis summary.
- **What May Legitimately Remain Model Judgment**: Summary wording.
- **Authoritative Enforcement Point**: GitHub branch protection / commit verification checks.
- **Required Evidence/Provenances**: Committed and pushed documentation updates matching completed task work.
- **Failure / Blocked Transition**: Unreconciled state / dangling task / missing documentation record.
- **Recovery / Re-entry Behavior**: Committing missing reconciliation records.
- **Current Implementation Gap**: Relies on agent discipline; needs automated reconciliation checklist check.
- **Required Implementation Work**: Add reconciliation verification check to closeout procedure.

---

## 3. Procedure → State → Invariant → Enforcement Matrix

| Lifecycle Stage | Authoritative State | Prerequisite State | Required Invariant | Enforcement Mechanism | Evidence / Provenance | Failure / Blocked Outcome |
|---|---|---|---|---|---|---|
| **1. Bootstrap** | `STATE.md`, File System | None | Truth derived from repository | Runtime initialization check | File presence check | Startup abort (`NOT READY`) |
| **2. Protocol Review** | `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` | Bootstrap Complete | Protocol adherence | Protocol hash bound to session | SHA-256 protocol hash | Request rejected (Stale Protocol) |
| **3. Requirements** | `TASK_STANDARD.md` | Protocol Review | Explicit requirement mapping | `validateACPCommand` schema check | `requirements_reference` array | HTTP 400 Bad Request |
| **4. State Verification** | `STATE.md`, TaskRegistry | Requirements Extraction | No unverified assumptions | Runtime inspection check | `get_task` / inspection log | Refusal to emit `request_task` |
| **5. Simplicity** | `ARCHITECTURE.md` | State Verification | Simplest correct path | Permitted path bounds check | Path validation log | Simplicity violation rejection |
| **6. Roadmap Alignment** | `STATE.md`, `strategic-state.json` | Simplicity Evaluation | Strict phase alignment | Strategic alignment evaluator | Alignment report | `ROADMAP_DRIFT_BLOCKED` |
| **7. Action Construction** | ACP Schema | Roadmap Alignment | Valid ACP JSON envelope | `validateACPCommand` | Valid ACP object | HTTP 400 Validation Error |
| **8. ACP Compliance** | Ingress Routing | Action Construction | Role & capability bounds | Server-side auth / capability check | Auth headers / permissions | HTTP 403 Forbidden |
| **9. Authorization** | TaskRegistry Proofs | ACP Compliance | Consequential actions approved | Cryptographic approval consumption | Consumed approval proof record | HTTP 403 Forbidden / Missing Proof |
| **10. Execution** | Task Status (`EXECUTING`) | Authorization | Bounded execution scope | Orchestrator path bounds | Execution logs, commit hash | Step abort / exit non-zero |
| **11. Verification** | Test Runner / Reviewer | Authorized Execution | Independent verification passed | Test suite + Reviewer gate | Test logs, `gemini-acp-report.json` | `insufficient_verification` |
| **12. Reconciliation** | Markdown Files, Git HEAD | Independent Verification | Fully reconciled state & docs | Commit verification check | Committed docs & PR/commit | Unreconciled state blocked |

---

## 4. Authoritative Lifecycle State Model

The state machine is hosted entirely within the existing `TaskRegistry` (`poc/task-registry.js`) and DeepSeek runtime control plane. No second control store is introduced.

### State Names & Legal Transitions
- `PENDING` → `SELECTED` → `PLANNED` → `EXECUTING` → `VERIFIED` → `COMPLETE`
- Alternative terminal/exception states: `FAILED`, `BLOCKED`, `CANCELLED`, `SUPERSEDED`

### Prerequisites & Invariants per Transition
- **`PENDING` → `SELECTED`**: Requires valid ACP validation (`validateACPCommand`) and roadmap alignment (`strategic-alignment.js`).
- **`SELECTED` → `PLANNED`**: Requires requirements extraction and applicable prerequisite check.
- **`PLANNED` → `EXECUTING`**: For review/read-only: automatic. For consequential (`BUILDER`, `FAILOVER_EXECUTE`): requires unconsumed valid Director approval proof (`task.authorization_proof`).
- **`EXECUTING` → `VERIFIED`**: Requires agent completion and independent verification test/review success.
- **`VERIFIED` → `COMPLETE`**: Requires full documentation reconciliation and commit verification.
- **Terminal Transitions (`FAILED`, `BLOCKED`, `CANCELLED`, `SUPERSEDED`)**: Irrevocable terminal states; stop further execution and require explicit new task creation if restarted.

### Concurrency, Idempotency, and Replay Protection
- **Idempotency**: Task creation is idempotent based on request fingerprint (Hash of `task_name` + `base_branch` + timestamp/payload). Duplicate requests return existing task status without re-dispatching.
- **Concurrency Control**: TaskRegistry uses file/memory-backed atomic updates ensuring a task cannot be dispatched twice concurrently.
- **Replay Protection**: Director approval proofs (`authorization_proof`) are single-use (`consumed: true`). Replaying an old approval proof returns HTTP 403 Forbidden.
- **Stale-State Handling**: If `STATE.md` or Git HEAD changes during execution, active tasks are flagged as stale and suspended pending re-verification.

---

## 5. Evidence and Provenance Model

To ensure strict verifiability, the runtime binds every lifecycle transition to cryptographic and server-derived evidence:
- **Request / Task Identity**: Unique `request_id` generated server-side or validated against strict naming standards.
- **Session / Conversation Identity**: Chatbox / API session binding.
- **Repository / Base Branch**: Mandatory `main` branch anchor.
- **Git State / Commit**: Exact Git commit SHA (`git rev-parse HEAD`) recorded at task dispatch and completion.
- **Protocol / State Version**: SHA-256 hash of `CHATGPT_PROJECT_OPERATING_PROTOCOL.md` and `STATE.md`.
- **Roadmap Phase**: Active phase string validated against `STATE.md`.
- **Authorization Proof**: Cryptographic token issued by `POST /poc/director/approve`, bound to scope hash and single-use flag.
- **Verification Evidence**: Test exit code, JUnit/Jest output log, and `gemini-acp-report.json`.
- **Reconciliation Evidence**: Commit hash containing updated documentation (`STATE.md`, `TASK_LOG.md`, `RESEARCH_INDEX.md`).

**Distinction**: Model-generated claims (e.g., "I have successfully verified the code") are treated as **untrusted intent**. Only server-derived execution exit codes, test runner logs, and Git commit hashes constitute **authoritative evidence**.

---

## 6. Deep-Dive: Difficult Lifecycle Stages

1. **Protocol Review & Requirements Extraction**:
   - Cannot be fully automated via strict deterministic assertions because natural language protocol comprehension requires LLM reasoning.
   - **Enforcement Mechanism**: Structured artifact gates—the model must emit a machine-parsable `requirements_reference` array and protocol hash acknowledgment; runtime rejects requests missing these fields.
2. **Repository / State Verification**:
   - Enforced by requiring prior tool execution (`get_task` or directory inspection) in the session state before allowing `request_task`.
3. **Solution Simplicity & Roadmap Alignment**:
   - Roadmap alignment is fully deterministic via `poc/strategic-alignment.js` evaluating `STATE.md`. Simplicity is enforced via strict permitted-path boundaries and prohibition of unapproved architectural patterns.
4. **Independent Verification & Reconciliation**:
   - Independent verification is enforced via automated test runner execution and required verification reports (`gemini-acp-report.json`). Reconciliation is enforced via git commit checks verifying that documentation files were updated.

---

## 7. Recovery and Interruption Handling

The system reconstructs the authoritative next transition from durable state (`TaskRegistry`, `STATE.md`, Git HEAD) rather than conversational memory:
- **DeepSeek output stops midway**: Ingress resumes via bounded continuation; TaskRegistry state (`EXECUTING` or `PLANNED`) dictates resumption point.
- **Tool call fails**: Task transitions to `FAILED` or `BLOCKED`; error details recorded in TaskRegistry; fallback routing invoked.
- **Coordinator process restarts**: Persistent TaskRegistry storage restores active task lineages and state without data loss.
- **Duplicate request arrives**: Idempotency check returns existing task status.
- **Authorization exists but execution not occurred**: Task remains in `PLANNED` / ready-to-dispatch state; approval proof remains valid until consumed or expired (15 mins).
- **Execution occurred but verification incomplete**: Task held in `EXECUTING` / pending review; verification runner invoked.
- **Verification occurred but reconciliation incomplete**: Task held in `VERIFIED`; reconciliation reminder issued.

---

## 8. Model-vs-Machine Authority Boundary

- **Untrusted (Model Reasoning)**: Natural language intent, code refactoring suggestions, analysis, requirement selection, conversational summaries.
- **Trusted (Server-Derived Authority)**: ACP validation, TaskRegistry state transitions, Director approval issuance and consumption, dispatcher execution, test suite execution, Git commit hashing, roadmap phase evaluation.
- **Rule**: The model may **recommend** any action or state transition, but the server **must independently derive and validate** every authority-bearing field before execution.

---

## 9. Human-Output Contract Interaction

- The user-facing response rendered in Chatbox/UI must reflect **authoritative runtime state** derived from TaskRegistry and execution artifacts.
- Conversational prose generated by the model must never be allowed to imply that an action, verification, reconciliation, or completion occurred unless the corresponding machine state (`COMPLETE`, `VERIFIED`) and cryptographic/server evidence (`gemini-acp-report.json`, commit hash) exist.
- Runtime output sanitization strips or corrects unverified completion claims if state is pending.

---

## 10. Phase 4 Roadmap Mapping & Implementation Decomposition

Phase 4 ("Scaled Conversational Orchestration & Cross-Task Lineage Navigation") is the active target roadmap phase. Increment 4.1 alone is insufficient for full lifecycle enforcement. The work is decomposed into four clean implementation increments:

1. **Increment 4.1: Server-Side Protocol & Roadmap Alignment Ingress Gate**
   - Bind protocol version hash and strategic alignment evaluation (`strategic-alignment.js`) directly into `/poc/coordinator` and `/poc/deepseek-runtime` ingress validation.
2. **Increment 4.2: Mandatory State Inspection & Requirements Extraction Gating**
   - Require prior `get_task` observation evidence and structured `requirements_reference` before task creation.
3. **Increment 4.3: Mechanical Verification-to-Completion State Binding**
   - Mechanically tie TaskRegistry `VERIFIED` and `COMPLETE` states to passing test runner exit codes and durable documentation commits.
4. **Increment 4.4: Automated Reconciliation & Closeout Enforcement**
   - Implement closeout checks ensuring `STATE.md`, `TASK_LOG.md`, and `RESEARCH_INDEX.md` are updated prior to terminal task closure.

---

## 11. Pre-Implementation Decisions Required

1. Confirm whether protocol hash mismatches should result in immediate rejection (`400 Bad Request`) or automatic context refresh.
2. Define the exact fallback routing behavior when roadmap alignment evaluation fails.

---

## 12. Deferred Questions

1. Real-time WebSockets / SSE streaming of intermediate lifecycle states to mobile chat clients (UI enhancement, non-critical for control plane).
2. Advanced cross-repository multi-agent orchestration.

---

## 13. Risks and Architectural Constraints

- **Constraints Preserved**: Single control plane, existing ACP authority model, TaskRegistry, dispatcher/orchestrator, Kyle as final authority, server-derived fields, untrusted model intent, permitted paths, authorization proof, independent verification boundary. No second control plane.
- **Risks**: Over-rigidity blocking legitimate exploratory research if protocol gates are too restrictive. Mitigated by `RESEARCH_DOCUMENT` and exploratory modes.

---

## 14. Conclusion

This research record establishes the complete architectural specification and lifecycle state model required to mechanically enforce the 12-stage coordinator operating procedure. By reusing existing control-plane primitives (TaskRegistry, ACP validation, Phase-transition gates, Director approvals) and decomposing Phase 4 into four targeted increments, the project maintains its single-control-plane architecture while achieving total operational determinism.
