# DeepSeek Coordinator Machine-Enforced Lifecycle — Authoritative Implementation Roadmap

> **Authoritative status**: `PROPOSED / TARGET` documentation and sequencing. This document establishes the implementation ordering for converting the coordinator operating protocol from a partially procedural/documentary contract into a machine-enforced lifecycle. It does **not** authorize implementation. Implementation of each increment requires a separate explicitly authorized ACP task.
>
> **Current phase**: Phase 3 — Autonomous Coordination Loop — `COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED`. Phase 4 — Scaled Conversational Orchestration & Cross-Task Lineage Navigation — `PROPOSED / TARGET` (not yet transitioned).
>
> **Source material**: Two completed Gemini research passes:
> - `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-COORDINATOR-MACHINE-ENFORCEMENT-LIFECYCLE-RESEARCH-001.md`
> - `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-COORDINATOR-MACHINE-ENFORCEMENT-LIFECYCLE-DEEP-RESEARCH-002.md`
>
> **Architecture authority**: `ARCHITECTURE.md` §16.6 remains authoritative for intended architecture. `docs/ai/STATE.md` is the authoritative live strategic state. `docs/ai/strategic-state.json` is its machine-readable projection.

---

## 1. Objective

Convert the ChatGPT/DeepSeek coordinator operating procedure from a partially procedural/documentary contract into a **machine-enforced lifecycle** while preserving the existing single-control-plane architecture.

The objective is specifically to make the transition from conversational intent and protocol review into mandatory, step-by-step state-machine progression deterministic and mechanically enforced — not merely a matter of coordinator prompt compliance.

The existing authority chain remains authoritative and unchanged:

```
Kyle — Director / Final Authority
  ↓
ChatBox
  ↓
DeepSeek Coordinator (untrusted intent)
  ↓
server-derived policy / authorization
  ↓
existing ACP
  ↓
/poc/coordinator
  ↓
TaskRegistry + existing dispatcher/orchestrator
  ↓
targeted specialist lane
```

**Key invariant**: Model-generated prose is never authoritative for lifecycle advancement. The server/runtime must derive and validate authority-bearing state. The model may *recommend* any action or state transition; the server *must independently derive and validate* every authority-bearing field before execution.

---

## 2. What Is Already Enforced (Current Repository State)

Before identifying enforcement gaps, the repository's existing enforcement primitives are documented as authoritative current implementation state:

| Enforcement Area | Authoritative Enforcement Point | Mechanism | Current Status |
|---|---|---|---|
| ACP schema validation | `poc/schemas/acp-schema.js` — `validateACPCommand` | JSON schema validation of the ACP command envelope, permitted path bounds | **IMPLEMENTED / VERIFIED** |
| Task lifecycle state | `poc/task-registry.js` — TaskRegistry status enum | `PENDING → SELECTED → PLANNED → EXECUTING → VERIFIED → COMPLETE`; terminal: `FAILED`, `BLOCKED`, `CANCELLED`, `SUPERSEDED` | **IMPLEMENTED / VERIFIED** |
| Lineage validation | `poc/acp-engine.js` — `validateLineageForCreate` | Parent lineage validation before child task creation | **IMPLEMENTED / VERIFIED** |
| Director authorization | `POST /poc/director/approve` (`routes/poc.js`) | Single-use, scope-hashed, crypto-authenticated approval proof (`task.authorization_proof`) | **IMPLEMENTED / VERIFIED** (Phase 3.1) |
| Phase-transition gating | `poc/phase-transition-gate.js` | Fail-closed validation of phase shifts: roadmap identity, convergence, independent verification, evidence binding, projection integrity, atomic update | **IMPLEMENTED / VERIFIED** |
| Strategic alignment | `poc/strategic-alignment.js` + `docs/ai/strategic-state.json` | SHA-256 projection match, roadmap phase validation, prerequisite checking, A/B classification enforcement; returns `ALIGNED_PENDING_AUTHORIZATION` or `BLOCKED` | **IMPLEMENTED / VERIFIED** |
| Bounded execution | Runtime loop (`services/deepseek-runtime.js`) | `MAX_TOOL_ITERATIONS = 3`, `MAX_AUTONOMOUS_COORDINATION_TURNS = 2` | **IMPLEMENTED / VERIFIED** |
| Workflow sequencing | `poc/orchestrator.js` + ACP schema workflow stages | Review → implementation → verification → reconciliation, server-derived, fail-closed | **IMPLEMENTED / VERIFIED** |
| Evidence types | `poc/schemas/acp-schema.js` | `AGENT_REPORT` (execution evidence only), `INDEPENDENT_VERIFICATION` (gates verified outcomes) | **IMPLEMENTED / VERIFIED** |
| Evidence-gated transitions | `poc/task-registry.js` — `updateTaskStatus` | `EXECUTING → VERIFIED` and `VERIFIED → COMPLETE` require `INDEPENDENT_VERIFICATION` evidence; fail-closed | **IMPLEMENTED / VERIFIED** |
| Server-derived authority | DeepSeek runtime `control_plane` | All authority-bearing ACP fields (repository, base branch, task_mode, capabilities, permitted_paths, target) derived server-side; model cannot supply | **IMPLEMENTED / VERIFIED** |

These primitives form the existing single control plane: TaskRegistry + ACP validation + Phase-transition gates + Director authorizations + server-derived policy.

---

## 3. Enforcement Gaps (Procedural or Partially Enforced)

The research passes identified that the following lifecycle stages remain **procedural or only partially machine-enforced** — they rely on coordinator conversational compliance rather than deterministic server-side validation:

| Lifecycle Stage | Currently Enforced? | Gap Description |
|---|---|---|
| **Project Bootstrap** | Partially | Runtime relies on static repository presence; no server-side verification of bootstrap checklist at coordinator ingress. |
| **Protocol Review** | No | Protocol content is injected via system prompt but lacks server-side version/hash verification at coordinator ingress. Coordinator self-attestation is insufficient. |
| **Applicable Requirements Extraction** | No | `requirements_reference` field is not required by the ACP schema for non-trivial tasks; no structured mapping enforcement. |
| **Repository/State Verification** | Partially | Bounded continuation requires prior `get_task` observation, but initial (root) task creation lacks mandatory pre-creation inspection evidence. |
| **Solution Simplicity Evaluation** | No (advisory) | Evaluated during review rather than mechanically gated at proposal time. Permitted-path validation exists but architectural boundary assertions are not enforced at the schema level for simplicity. |
| **Roadmap Alignment** | Partially | The strategic-alignment evaluator (`poc/strategic-alignment.js`) is enforced at `request_task` construction for DeepSeek, but the gate is advisory for coordinator action construction outside the DeepSeek runtime path. |
| **Reconciliation & Stop** | Partially | Commit verification and phase-transition checks exist, but documentation update requirements (STATE.md, TASK_LOG.md, etc.) are task-mode-specific, not a universal three-file checklist enforced mechanically. |

**The roadmap below defines how these gaps are closed through incrementally authorized implementation tasks.** No increment is authorized by this document. Each increment requires its own ACP authorization.

---

## 4. The Twelve-Stage Coordinator Lifecycle Model

The durable roadmap preserves the complete twelve-stage model. Each stage documents: purpose, authoritative state, prerequisites, machine-enforced invariant, evidence/attestation requirements, legitimate model judgment, failure/blocking behavior, recovery/re-entry behavior, and planned implementation increment.

### Stage 1: Project Bootstrap

- **Purpose**: Establish repository identity and authoritative project-control documentation truth from the repository alone — never from conversation memory.
- **Authoritative State**: Repository checkout structure, `docs/ai/STATE.md`, `docs/ai/CHATGPT_START_HERE.md`.
- **Prerequisites**: None (this is the entry point).
- **Machine-Enforced Invariant**: Server startup verification of repository context and canonical file presence (`AGENTS.md`, `ARCHITECTURE.md`, `GEMINI.md`, `docs/ai/` state system) before coordinator or dispatch paths are reachable.
- **Evidence/Attestation Requirements**: File-system inspection confirmation of canonical control-document presence; bootstrap completion checklist verification.
- **Legitimate Model Judgment**: Interpretation of bootstrap instructions, classification of the incoming request.
- **Failure/Blocking Behavior**: Fail-closed startup abort with `NOT READY — PROJECT BOOTSTRAP INCOMPLETE`.
- **Recovery/Re-entry**: Re-running initialization; ensuring repository sync; ensuring canonical files are present.
- **Planned Implementation Increment**: Increment 4.1 (Phase 4 Transition Boundary) establishes the prerequisite that Phase 4 activation requires the existing phase-transition mechanism; this stage maps to the bootstrap verification that the protocol context is current before any coordinator operation.

### Stage 2: Protocol Review

- **Purpose**: Review the current repository version of `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` and extract applicable requirements.
- **Authoritative State**: `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` content on `main`; its SHA-256 hash.
- **Prerequisites**: Stage 1 (Project Bootstrap) complete.
- **Machine-Enforced Invariant**: Protocol version/hash is bound to the coordinator request/session context; stale or mismatched protocol is rejected.
- **Evidence/Attestation Requirements**: Protocol SHA-256 hash bound to the request/session record; coordinator protocol-check acknowledgment.
- **Legitimate Model Judgment**: Semantic interpretation of protocol rules, selection of applicable clauses.
- **Failure/Blocking Behavior**: Request rejection if protocol hash is stale or mismatched (`Stale Protocol`); task construction blocked.
- **Recovery/Re-entry**: Refreshing coordinator context with the latest protocol file content before retrying.
- **Planned Implementation Increment**: Increment 4.1 — Protocol version/hash binding into the coordinator ingress (`/poc/deepseek-runtime` and `/poc/coordinator`).

### Stage 3: Applicable Requirements Extraction

- **Purpose**: Identify protocol requirements applicable to the specific action being constructed.
- **Authoritative State**: `docs/ai/TASK_STANDARD.md`, `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md`.
- **Prerequisites**: Stage 2 (Protocol Review) complete.
- **Machine-Enforced Invariant**: Every non-trivial ACP task must carry a structured `requirements_reference` mapping to protocol requirements; missing references are validation failures.
- **Evidence/Attestation Requirements**: Non-empty `requirements_reference` array in the ACP task payload; task envelope completeness.
- **Legitimate Model Judgment**: Selection of applicable clauses; mapping task goals to specific requirement references.
- **Failure/Blocking Behavior**: HTTP 400 Bad Request if requirement reference is missing for non-trivial tasks.
- **Recovery/Re-entry**: Resubmitting the command with explicit `requirements_reference`.
- **Planned Implementation Increment**: Increment 4.2 — Mandatory state inspection and requirements extraction gating before `request_task`/task construction.

### Stage 4: Repository/State Verification

- **Purpose**: Establish implementation truth from GitHub and durable state before constructing a task.
- **Authoritative State**: `docs/ai/STATE.md`, `docs/ai/TASK_LOG.md`, `docs/ai/ARCH_DECISIONS.md`, `docs/ai/CONTROL_CENTER.md`, TaskRegistry, GitHub commit state, open issues/PRs.
- **Prerequisites**: Stage 3 (Applicable Requirements Extraction) complete.
- **Machine-Enforced Invariant**: No task may be constructed based on unverified or stale repository assumptions. Prior execution of `get_task` or repository state inspection tool must precede task construction for consequential work.
- **Evidence/Attestation Requirements**: TaskRegistry observation log or commit hash bound to the request; prior inspection evidence in coordinator session state.
- **Legitimate Model Judgment**: Assessment of code structure and impact; synthesis of repository findings.
- **Failure/Blocking Behavior**: Runtime refusal to emit `request_task` without prior inspection evidence; task construction blocked.
- **Recovery/Re-entry**: Executing `get_task` or repository state inspection tool before retrying task construction.
- **Planned Implementation Increment**: Increment 4.2 — Mandatory pre-creation state inspection check in the runtime loop.

### Stage 5: Solution Simplicity Evaluation

- **Purpose**: Evaluate whether the proposed solution is the simplest correct path without introducing architectural drift or duplicate control planes.
- **Authoritative State**: `ARCHITECTURE.md` design principles, existing codebase patterns.
- **Prerequisites**: Stage 4 (Repository/State Verification) complete.
- **Machine-Enforced Invariant**: Permitted-path validation; prohibition of unauthorized module additions; architectural boundary assertions at the ACP validator level.
- **Evidence/Attestation Requirements**: Permitted path validation log; architectural simplicity justification in task rationale.
- **Legitimate Model Judgment**: Trade-off analysis between design alternatives; simplicity justification.
- **Failure/Blocking Behavior**: Rejection due to scope creep or architectural boundary violation.
- **Recovery/Re-entry**: Simplifying task scope to fit permitted paths and existing patterns.
- **Planned Implementation Increment**: Increment 4.2 — Architectural boundary assertions added to the ACP validator to enforce permitted-path bounds and prohibit architectural violations at proposal time.

### Stage 6: Roadmap Alignment

- **Purpose**: Prove that proposed work aligns with the active roadmap phase before task construction.
- **Authoritative State**: `docs/ai/STATE.md` and `docs/ai/strategic-state.json` (machine-readable projection with SHA-256 match to STATE.md).
- **Prerequisites**: Stage 5 (Solution Simplicity Evaluation) complete.
- **Machine-Enforced Invariant**: Strategic alignment evaluator (`poc/strategic-alignment.js`) check against `STATE.md`; a proposal must map to an authoritative unresolved requirement, prove prerequisites, use matching A/B classification, and declare advancement/convergence.
- **Evidence/Attestation Requirements**: Strategic alignment verification report confirming phase match; valid alignment result (`ALIGNED_PENDING_AUTHORIZATION`).
- **Legitimate Model Judgment**: None — roadmap alignment is strictly determinable from authoritative state.
- **Failure/Blocking Behavior**: Request rejected as roadmap drift (`ROADMAP_DRIFT_BLOCKED`); task construction blocked.
- **Recovery/Re-entry**: Updating roadmap state (via authorized Phase 4 transition) or aligning the task request to the active phase.
- **Planned Implementation Increment**: Increment 4.1 — Hook strategic alignment evaluator directly into `/poc/coordinator` and `/poc/deepseek-runtime` ingress (already partially implemented for DeepSeek; extended to general coordinator ingress).

### Stage 7: Action Construction

- **Purpose**: Construct a valid ACP task request matching the canonical envelope in `docs/ai/TASK_STANDARD.md`.
- **Authoritative State**: ACP JSON schema definition (`poc/schemas/acp-schema.js`).
- **Prerequisites**: Stage 6 (Roadmap Alignment) complete.
- **Machine-Enforced Invariant**: Strict JSON schema validation of the constructed action via `validateACPCommand`.
- **Evidence/Attestation Requirements**: Validated ACP JSON object; TaskRegistry creation entry.
- **Legitimate Model Judgment**: Parameter values for task payload; intent description text.
- **Failure/Blocking Behavior**: Ingestion rejection (HTTP 400 / validation error).
- **Recovery/Re-entry**: Correcting payload syntax and resubmitting.
- **Planned Implementation Increment**: **Already fully implemented** — `validateACPCommand` in `poc/schemas/acp-schema.js` enforces schema validation. No new work required for this stage.

### Stage 8: ACP Compliance Verification

- **Purpose**: Verify the task request conforms strictly to the ACP contract, permitted paths, and capability bounds.
- **Authoritative State**: ACP schema and server-side routing policy (`routes/poc.js`).
- **Prerequisites**: Stage 7 (Action Construction) complete.
- **Machine-Enforced Invariant**: Server-side checks for permitted capabilities and path bounds; fail-closed on missing/invalid authorization.
- **Evidence/Attestation Requirements**: Request authentication and authorization header verification.
- **Legitimate Model Judgment**: None.
- **Failure/Blocking Behavior**: HTTP 403 Forbidden / Access Denied.
- **Recovery/Re-entry**: Adjusting requested capabilities to match the assigned role/mode; providing valid authorization.
- **Planned Implementation Increment**: **Already fully implemented** — `validateACPCommand` and permitted path enforcement in `routes/poc.js`. No new work required for this stage.

### Stage 9: Authorization

- **Purpose**: Obtain explicit Director authorization for consequential actions (`BUILDER`, `FAILOVER_EXECUTE`, `write`/`modify_files`, `commit`, `push`).
- **Authoritative State**: TaskRegistry authorization proof record; Director approval proofs (`POST /poc/director/approve`).
- **Prerequisites**: Stage 8 (ACP Compliance Verification) complete.
- **Machine-Enforced Invariant**: Single-use consumption of cryptographic approval proof (`task.authorization_proof`); model-generated or manually fabricated Director text is insufficient — only server-issued, cryptographically bound decision identity referencing the coordinator TaskRegistry identity is accepted.
- **Evidence/Attestation Requirements**: Consumed authorization proof record in TaskRegistry; server-issued transition-decision identity stored with the authoritative coordinator task.
- **Legitimate Model Judgment**: None.
- **Failure/Blocking Behavior**: HTTP 403 Forbidden / missing approval proof / expired proof.
- **Recovery/Re-entry**: Obtaining a fresh approval proof from Kyle via `POST /poc/director/approve`.
- **Planned Implementation Increment**: **Already fully implemented** for Phase 3.1 — `POST /poc/director/approve` issues server-held, 15-minute, SHA-256 scope-bound approval records; consumed once at consequential registration/dispatch. The phase-transition gate additionally requires Director decision provenance for phase shifts. No new work required for per-task authorization.

### Stage 10: Authorized Execution

- **Purpose**: Execute permitted actions strictly within authorized paths and capabilities.
- **Authoritative State**: Task execution state (`EXECUTING`, `VERIFIED`, `COMPLETE`, `FAILED`, `BLOCKED`).
- **Prerequisites**: Stage 9 (Authorization) complete.
- **Machine-Enforced Invariant**: Dispatcher/orchestrator file path bounds and workflow permissions; no execution outside permitted paths or granted capabilities.
- **Evidence/Attestation Requirements**: Execution output logs; test results; commit hash; `gemini-acp-report.json`.
- **Legitimate Model Judgment**: Implementation details and code edits by the execution agent.
- **Failure/Blocking Behavior**: Execution failure / step abort / non-zero exit code.
- **Recovery/Re-entry**: Diagnosing failure, patching code, re-running execution within authorization; model-generated failure claims are untrusted and must be independently verified.
- **Planned Implementation Increment**: **Already fully implemented** — orchestrator (`poc/orchestrator.js`), dispatcher (`services/transport-provider.js`), and GitHub Actions runner enforce path bounds and permissions. No new work required for basic execution.

### Stage 11: Independent Verification

- **Purpose**: Verify delivered work independently against durability standards.
- **Authoritative State**: `INDEPENDENT_VERIFICATION` status, test exit codes, `INDEPENDENT_VERIFICATION` evidence records.
- **Prerequisites**: Stage 10 (Authorized Execution) complete.
- **Machine-Enforced Invariant**: Automated test suite execution and verification report generation; `INDEPENDENT_VERIFICATION` evidence type must be present for `VERIFIED` transition; execution completion does not automatically equal verification.
- **Evidence/Attestation Requirements**: Passing test logs; diff check report; `gemini-acp-report.json`; independent reviewer evidence. The implementation agent's report is execution evidence only (`AGENT_REPORT`); it must not be treated as independent verification.
- **Legitimate Model Judgment**: Code quality and style adherence assessment (review only — cannot establish `INDEPENDENT_VERIFICATION`).
- **Failure/Blocking Behavior**: `insufficient_verification` rejection; test failure.
- **Recovery/Re-entry**: Fixing failing tests, addressing review findings, or obtaining independent verification before retry.
- **Planned Implementation Increment**: **Already partially implemented** — evidence-gated transitions require `INDEPENDENT_VERIFICATION` for `EXECUTING → VERIFIED` and `VERIFIED → COMPLETE`. Full mechanical binding of `VERIFIED` status to passing test artifacts and review reports is the target of Increment 4.3.

### Stage 12: Reconciliation and Stop

- **Purpose**: Reconcile durable project state and stop — a task must not reach terminal `COMPLETE` merely because an agent reports success.
- **Authoritative State**: Durable markdown state files (`STATE.md`, `TASK_LOG.md`, `RESEARCH_INDEX.md` where applicable), main commit history.
- **Prerequisites**: Stage 11 (Independent Verification) complete.
- **Machine-Enforced Invariant**: Task-specific reconciliation contract satisfied; reconciliation is task-aware, not a universal three-file checklist; terminal stop only after all task-mode/scope/lifecycle-type-specific reconciliation obligations are met and machine-verified.
- **Evidence/Attestation Requirements**: Committed and pushed documentation updates matching completed task work; reconciliation evidence record.
- **Legitimate Model Judgment**: Summary wording only.
- **Failure/Blocking Behavior**: `stale project state` / `unrecorded work` / `unreconciled state` — task cannot reach terminal `COMPLETE`.
- **Recovery/Re-entry**: Committing missing reconciliation records within authorized paths.
- **Planned Implementation Increment**: Increment 4.4 — Automated reconciliation & closeout enforcement; task-aware reconciliation contract.

---

## 5. Procedure-to-Enforcement Matrix

| Lifecycle Stage | Authoritative State | Enforcement Mechanism | Enforcement Component | Evidence / Provenance | Failure / Blocked Outcome |
|---|---|---|---|---|---|
| 1. Bootstrap | Repository structure, `STATE.md` | Runtime initialization check | Startup / `index.js` | File presence check | Startup abort (`NOT READY — PROJECT BOOTSTRAP INCOMPLETE`) |
| 2. Protocol Review | Protocol file + SHA-256 | Protocol hash bound to session | DeepSeek runtime ingress / system prompt | Protocol SHA-256 hash in session record | Request rejected (Stale Protocol) |
| 3. Requirements Extraction | `TASK_STANDARD.md` | `requirements_reference` field in ACP schema | `validateACPCommand` | Non-empty `requirements_reference` array | HTTP 400 Bad Request |
| 4. State Verification | `STATE.md`, TaskRegistry, Git state | Pre-creation inspection evidence check | DeepSeek runtime loop / `control_plane` | `get_task` observation log or commit hash | Refusal to emit `request_task` |
| 5. Solution Simplicity | `ARCHITECTURE.md` design principles | Permitted-path bounds + architectural boundary assertions | ACP validator / Reviewer gate | Path validation log; simplicity rationale | Simplicity/architecture violation rejection |
| 6. Roadmap Alignment | `STATE.md`, `strategic-state.json` | Strategic alignment evaluator | `poc/strategic-alignment.js` (at ingress) | Alignment report (`ALIGNED_PENDING_AUTHORIZATION`) | `ROADMAP_DRIFT_BLOCKED` |
| 7. Action Construction | ACP schema | JSON schema validation | `validateACPCommand` | Validated ACP JSON object | HTTP 400 Validation Error |
| 8. ACP Compliance | Server routing policy | Auth/capability/path checks | `routes/poc.js` ingress | Auth headers, permissions | HTTP 403 Forbidden |
| 9. Authorization | TaskRegistry proofs | Cryptographic approval proof consumption | `POST /poc/director/approve` | Consumed approval proof record | HTTP 403 / missing/expired proof |
| 10. Execution | Task status (`EXECUTING`) | Orchestrator/dispatcher path bounds | `poc/orchestrator.js`, GitHub Actions | Execution logs, commit hash | Step abort / non-zero exit |
| 11. Independent Verification | Test results, reviewer evidence | Automated test + `INDEPENDENT_VERIFICATION` evidence gate | Test runner / Reviewer | Test logs, `gemini-acp-report.json` | `insufficient_verification` |
| 12. Reconciliation & Stop | Durable markdown state, Git HEAD | Task-aware reconciliation contract check | Commit verification / state checker | Committed docs matching task work | Unreconciled state blocked |

---

## 6. Distinct System States in the Lifecycle

The roadmap explicitly distinguishes the following authority-bearing states. These must not be conflated — each represents a distinct checkpoint in the lifecycle:

1. **Model reasoning** — DeepSeek/model generates intent, workflow reasoning, and recommendations. Treated as untrusted intent. Never authoritative for lifecycle advancement.

2. **Structured model intent** — Model output is structured into a canonical request envelope. Still untrusted intent until server-validated.

3. **Machine policy/state evaluation** — Server-derived evaluation of protocol version, requirements, state verification, solution simplicity, and roadmap alignment. Produces evidence but not authorization.

4. **Lifecycle gating** — The state-machine enforcer that determines which transition is legally permitted next and which action the coordinator may take. Gate is fail-closed.

5. **ACP task construction** — Validated ACP command envelope with explicit capabilities, permitted paths, and verification requirements.

6. **ACP validation** — Schema and authorization validation of the ACP command. Server-enforced, fail-closed.

7. **Director authorization** — Explicit Kyle approval for consequential actions via cryptographically bound, single-use approval proofs. Distinct from ACP compliance.

8. **TaskRegistry state** — Durable task lifecycle state and correlation mechanism. **Authoritative task lifecycle**, but must not automatically be treated as a complete representation of every coordinator procedure.

9. **Dispatcher/orchestrator execution** — Server-derived execution within authorized paths, capabilities, and permissions.

10. **Independent verification** — Verification of delivered work against durability standards, distinct from agent execution claims. `INDEPENDENT_VERIFICATION` evidence gates `VERIFIED` and `COMPLETE` transitions.

11. **Reconciliation** — Task-specific durable state update. Reconciliation is task-aware, not a universal three-file checklist.

12. **Terminal stop** — Task reaches terminal `COMPLETE` only after execution, independent verification, and reconciliation are all satisfied per the task's completion contract.

---

## 7. Phase 4 Transition / Activation Boundary (STEP 0)

**Phase 4 must become the authoritative active roadmap phase through the existing phase-transition/convergence mechanism before Phase 4 implementation work proceeds.**

### Current Phase State (Verified Against Repository)

- **Phase 3 — Autonomous Coordination Loop**: `COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED` (STATE.md line 14; commit `8c9e005`).
- **Phase 4 — Scaled Conversational Orchestration & Cross-Task Lineage Navigation**: `PROPOSED / TARGET` (not yet transitioned).
- **Kyle's conversational transition decision**: RECEIVED (STATE.md Phase 4 Baseline Reconciliation Status).
- **Durable transition evidence**: BLOCKED / NOT ESTABLISHED. The `poc/phase-transition-gate.js` cannot validate or apply the transition because the durable coordinator transition record and coordinator TaskRegistry identity for the Phase 4 transition are not yet established on `main`.
- **Canonical Gemini execution artifact**: NOT ESTABLISHED from the durable repository state available to this reconciliation.
- **Authoritative current phase**: Phase 3 (remains so until matching transition evidence is durably established).

### The Phase 4 Transition Procedure (Existing — Not Redefined)

The repository's existing phase-transition procedure (CHATGPT_PROJECT_OPERATING_PROTOCOL.md §17.12, STATE.md Phase 3 Transition Rule, strategic-state.json Phase 4 baseline) requires:

1. Phase 3 convergence requirements satisfied (DONE — Phase 3 is CONVERGED per `poc/strategic-alignment.js` evaluation).
2. Independent verification recorded (DONE — Phase 3 independently verified).
3. Kyle's explicit conversational roadmap authorization (DONE — received conversationally).
4. The first authorized Phase 4 research/reconciliation task records the decision and creates the durable transition evidence (PENDING — this is the task being executed).
5. The existing `poc/phase-transition-gate.js` validates convergence, independent verification, evidence binding, projection integrity, atomic update, and post-transition validity, then applies the transition (PENDING — cannot invoke until evidence is established in step 4).

### Distinction: Roadmap Target vs. Authorized vs. Reconciled vs. Implementation

| State | Meaning | Current Status |
|---|---|---|
| Phase 4 is the next roadmap target | ARCHITECTURE.md §16.6 and STATE.md both identify Phase 4 as the next target | **TRUE** — Phase 4 is identified as next PROPOSED / TARGET |
| Phase 4 transition is authorized | Kyle has decided to proceed and this documentation task is authorized | **TRUE (for this documentation task)** — Kyle's conversational decision + this ACP task authorization establish the transition-bootstrap execution context |
| Phase 4 transition is durably reconciled | The phase-transition gate has validated and applied the transition; STATE.md and strategic-state.json reflect Phase 4 as active | **NOT TRUE** — durable transition evidence not yet established; gate not invoked |
| Phase 4 implementation is permitted | Implementation increments (4.1–4.5) may be separately authorized | **NOT TRUE** — implementation requires separate ACP authorization per increment; this task does not implement or authorize implementation |

### This Task's Role in Phase 4 Transition

This documentation task is the **transition-bootstrap execution context**: it establishes the authoritative lifecycle-enforcement roadmap and durable transition evidence, then invokes the phase-transition gate. It does **not** mark implementation increments complete. It does **not** activate Phase 4 merely by writing the roadmap.

The durable transition evidence this task creates will include the roadmap alignment decision, the requirement ID (`phase-4-scaled-conversational-orchestration-cross-task-lineage-navigation`), and the coordinator task identity — satisfying the transition-evidence fields required by `poc/phase-transition-gate.js` `transitionEvidence()`.

**Important**: Per the task's `conflict_handling` and `roadmap_alignment` sections, if the repository's current Phase 4 transition state differs from assumptions, the actual authoritative state is preserved and the discrepancy is documented. The repository's actual state is: Phase 3 CONVERGED, Phase 4 PROPOSED/TARGET, transition evidence BLOCKED/NOT ESTABLISHED. This documentation preserves that distinction.

---

## 8. Implementation Sequence

The roadmap defines the following planned execution order. Each increment is atomic and independently verifiable. Each increment requires its own ACP authorization. Each increment must produce a committed/pushed repository deliverable when commit/push are authorized. No later increment should be implemented before the prior increment has been independently verified and its durable state reconciled.

Research and architecture decisions inform implementation but do not themselves constitute implementation. The two completed Gemini research records remain the detailed architectural evidence; this roadmap provides implementation sequencing and authoritative project-level direction rather than duplicating every research paragraph.

### STEP 0 — Phase 4 Transition / Activation Boundary

**Purpose**: Establish the prerequisite that Phase 4 becomes the authoritative active roadmap phase through the existing phase-transition/convergence mechanism before Phase 4 implementation work proceeds.

**Core concerns**:
- Phase 3 convergence proof (already COMPLETE / CONVERGED)
- Kyle's conversational transition decision (received)
- Durable transition evidence creation (this documentation task)
- Phase-transition gate validation and application (`poc/phase-transition-gate.js`)
- STATE.md and strategic-state.json synchronization

**Acceptance boundary**: Phase 4 cannot become the active implementation phase until the existing `poc/phase-transition-gate.js` validates and applies the transition using durably established evidence. No implementation increment may proceed before this boundary is satisfied.

**Status**: This documentation task creates the roadmap and the transition-evidence record. The mechanical gate invocation occurs after this task's committed state is in place. The transition is then either validated by the gate (Phase 4 becomes active) or remains BLOCKED pending the required evidence.

### Increment 4.1 — Server-Side Protocol & Roadmap Alignment Ingress Gate

**Purpose**: Bind the coordinator request to the authoritative protocol context and strategic roadmap state before task creation/dispatch.

**Core concerns**:
- Protocol version/hash: Inject `CHATGPT_PROJECT_OPERATING_PROTOCOL.md` SHA-256 into the coordinator request context; reject stale protocol versions.
- Strategic-state validation: Hook `poc/strategic-alignment.js` into `/poc/coordinator` and `/poc/deepseek-runtime` ingress; fail-closed on stale projections, invalid roadmap targets, missing prerequisites, convergence/verification failures, and missing/mismatched durable coordinator transition evidence.
- Roadmap alignment: A request cannot advance into consequential task construction/dispatch unless the required protocol and roadmap prerequisites are machine-established.
- Stale strategic state: Detect and reject requests based on stale `STATE.md` / `strategic-state.json` projections (SHA-256 mismatch).
- Fail-closed ingress: All validation failures reject the request before TaskRegistry creation or dispatch.
- Single-control-plane preservation: Reuses existing `poc/strategic-alignment.js`, `poc/phase-transition-gate.js`, and ACP schema; no second state store.

**Acceptance boundary**: A request cannot advance into consequential task construction/dispatch unless the required protocol and roadmap prerequisites are machine-established. The existing DeepSeek runtime already enforces strategic alignment at `request_task`; this increment extends it to the coordinator ingress for all coordinator-managed task construction.

### Increment 4.2 — Mandatory State Inspection & Requirements Extraction Gating

**Purpose**: Make repository/state inspection and applicable-requirement extraction explicit prerequisites for task construction.

**Core concerns**:
- Authoritative state observation: Require prior `get_task` observation or repository state inspection evidence before `request_task`/task construction for root tasks.
- Stable evidence binding: Bind commit hash and TaskRegistry observation evidence to the request context.
- Requirements references: Enforce structured `requirements_reference` field in the ACP schema for non-trivial tasks; reject construction without applicable-requirement evidence.
- Request idempotency: Use a stable semantic request fingerprint (hash of `task_name` + `base_branch` + `repository` + `objective` + `request_id` correlation), not task-name + timestamp hashing.
- Duplicate/replay behavior: Fail-closed on duplicate request IDs; return existing task status without re-dispatching.
- Request_task gating: A coordinator cannot create a substantive delegated task without the required authoritative state-inspection evidence and structured applicable-requirement evidence.

**Acceptance boundary**: A coordinator cannot create a substantive delegated task without the required authoritative state-inspection evidence and structured applicable-requirement evidence.

### Increment 4.3 — Mechanical Verification-to-Completion State Binding

**Purpose**: Bind execution, independent verification, `VERIFIED` state, and completion eligibility.

**Core concerns**:
- Verification evidence: Automated test suite execution results and test exit codes recorded as `INDEPENDENT_VERIFICATION` evidence.
- Test results: Test runner exit codes, JUnit/Jest output logs, and `gemini-acp-report.json` bound to the `VERIFIED` transition.
- Review evidence: Reviewer evaluation report (`INDEPENDENT_VERIFICATION` evidence type) required for `VERIFIED`.
- Commit/delivered-state binding: Commit hash recorded at dispatch and completion; linked to verification evidence.
- VERIFIED transition: `EXECUTING → VERIFIED` requires `INDEPENDENT_VERIFICATION` evidence (already partially implemented in `task-registry.js` `updateTaskStatus` evidence-gated transitions).
- COMPLETE eligibility: `VERIFIED → COMPLETE` requires task-specific reconciliation contract satisfaction.
- Execution completion ≠ verification ≠ completion: Three distinct states enforced by state machine, not agent claims.
- Implementation-agent claims are not independent verification: `AGENT_REPORT` evidence type is execution evidence only; it does not satisfy `INDEPENDENT_VERIFICATION` requirements.

**Acceptance boundary**: The system cannot represent a task as completed solely because the execution agent claims success. Execution, verification, and completion are mechanically distinct state transitions.

### Increment 4.4 — Automated Reconciliation & Closeout Enforcement

**Purpose**: Make task-specific reconciliation and terminal closeout mechanically enforceable.

**Core concerns**:
- Completion contract: Task-mode-specific reconciliation rules derived from task mode, scope, lifecycle type, and durable-state obligations (not a universal three-file checklist).
- Required durable records: The set of files that must be updated depends on the task's completion contract; `STATE.md`, `TASK_LOG.md`, `RESEARCH_INDEX.md`, `ARCH_DECISIONS.md`, `CONTROL_CENTER.md` are updated per the task-specific contract.
- Repository state: Commit verification confirms documentation updates match the completed task work.
- Git commit relationship: Reconciliation commit hash linked to the task's TaskRegistry entry.
- Reconciliation evidence: Committed and pushed documentation updates recorded as durable evidence.
- Terminal state: Task cannot enter terminal successful state (`COMPLETE`) until its applicable reconciliation contract is satisfied and machine-verified.
- Human-output synchronization: Human-facing responses derive completion/status claims from authoritative machine state and evidence.

**Acceptance boundary**: A task cannot enter its terminal successful state until its applicable reconciliation contract is satisfied and machine-verified.

### Increment 4.5 — Lifecycle Recovery, Replay & Convergence Hardening

**Purpose**: Make the lifecycle robust across interruptions, stale state, retries, duplicate requests, replay, and non-convergent recovery.

**Core concerns**:
- Interrupted model output: Ingress resumes via bounded continuation; TaskRegistry state dictates resumption point.
- Runtime restart: Persistent TaskRegistry storage restores active task lineages and state without data loss.
- Duplicate requests: Idempotent request fingerprint returns existing task status without re-dispatching.
- Duplicate task creation: Fail-closed duplicate prevention at the TaskRegistry level.
- Replayed authorization: `authorization_proof` is single-use (`consumed: true`); replayed proofs return HTTP 403.
- Stale repository state: SHA-256 projection mismatch detection; stale tasks flagged and suspended pending re-verification.
- Changed Git HEAD: Commit hash re-verification at each lifecycle checkpoint.
- Changed protocol version: Protocol hash re-binding at each coordinator turn.
- Changed strategic state: Strategic alignment re-evaluation before each task construction.
- Execution without verification: Fail-closed — `EXECUTING → VERIFIED` requires `INDEPENDENT_VERIFICATION`.
- Verification without reconciliation: Fail-closed — `VERIFIED → COMPLETE` requires task-specific reconciliation.
- Model-generated false completion claims: Treated as untrusted; rejected without `INDEPENDENT_VERIFICATION` evidence.
- Invalid lifecycle transitions: State machine rejects transitions not in the legal transition table.
- Non-convergent recovery: Recovery reconstructs the next legal transition from durable state rather than conversational memory.

**Acceptance boundary**: Lifecycle state can be reconstructed deterministically after interruption and invalid/replayed transitions are rejected.

---

## 9. Sequencing Rules

The following rules govern implementation sequencing and are documented as mandatory for future authorization:

1. **Each implementation increment is atomic and independently verifiable.** No increment bundles multiple phases of work.

2. **Each implementation increment requires its own ACP authorization.** Implementation of Increment 4.1 does not authorize Increment 4.2. Each must be separately authorized by the Director via ACP.

3. **Each implementation increment must produce a committed/pushed repository deliverable** when commit/push are authorized. No partial implementation is considered complete without durable repository delivery.

4. **No later increment should be implemented before the prior increment has been independently verified and its durable state reconciled.** This prevents speculative chaining of increments without verification at each step.

5. **Research and architecture decisions may inform implementation but do not themselves constitute implementation.** The two completed Gemini research records and this roadmap establish direction; they do not authorize code changes.

6. **Do not combine all increments into one large implementation task.** Each increment must be a separately authorized task.

7. **Do not create a second control plane.** All increments must reuse the existing `poc/` infrastructure.

8. **Do not replace the existing TaskRegistry.** TaskRegistry remains the authoritative task lifecycle state.

9. **Do not bypass Director authorization.** Consequential actions remain gated by Director approval proofs.

10. **Do not treat model prose as lifecycle authority.** Model-generated recommendations never advance the lifecycle without server-derived validation.

---

## 10. Solution Simplicity Gate — Existing Mechanisms Evaluation

Before finalizing this roadmap, the solution simplicity gate requires evaluating existing mechanisms for reuse. The following existing mechanisms can satisfy each planned increment's requirements:

| Planned Increment | Reusable Existing Mechanism | New Component Needed? |
|---|---|---|
| 4.1 — Protocol & Roadmap Alignment Ingress Gate | `poc/strategic-alignment.js` (already at DeepSeek `request_task`); `poc/phase-transition-gate.js`; `docs/ai/strategic-state.json` | Extend `strategic-alignment.js` integration to `/poc/coordinator` ingress for general coordinator task construction; add protocol hash injection to runtime context |
| 4.2 — Mandatory State Inspection & Requirements Extraction | `validateACPCommand` (`poc/schemas/acp-schema.js`); `get_task` observation; `validateLineageForCreate` (`poc/acp-engine.js`); TaskRegistry observation logs | Add `requirements_reference` schema enforcement for non-trivial tasks; add pre-creation inspection evidence check in runtime loop |
| 4.3 — Mechanical Verification-to-Completion Binding | Evidence types (`AGENT_REPORT`, `INDEPENDENT_VERIFICATION`); evidence-gated `updateTaskStatus`; `gemini-acp-report.json`; test runner | Mechanically bind `VERIFIED` transition to passing test artifacts and review reports (extend evidence-gated transitions) |
| 4.4 — Automated Reconciliation & Closeout Enforcement | `determineReconciliationStatus()`; commit verification; phase-transition gate | Add task-aware reconciliation contract evaluation (not universal checklist); closeout verification check |
| 4.5 — Recovery, Replay & Convergence Hardening | Idempotent `createTask` (request fingerprint); single-use `authorization_proof`; SHA-256 projection checks; `rehydrateTask()` | Add request idempotency fingerprint (hash of task_name + base_branch + repository + objective + request_id); extend duplicate prevention; recovery-from-durable-state reconstruction |

**Conclusion**: Existing mechanisms satisfy the majority of each increment's requirements. New components are extensions of existing primitives, not replacements. The design preserves one control plane without introducing a second authority store.

---

## 11. Model-vs-Machine Authority Boundary

- **Untrusted (Model Reasoning)**: Natural language intent, workflow reasoning, code refactoring suggestions, analysis, requirement selection, conversational summaries, completion/success claims.
- **Trusted (Server-Derived Authority)**: ACP validation, TaskRegistry state transitions, Director approval issuance and consumption, dispatcher execution, test suite execution, Git commit hashing, roadmap phase evaluation, strategic alignment evaluation, reconciliation contract verification.
- **Rule**: The model may *recommend* any action or state transition, but the server *must independently derive and validate* every authority-bearing field before execution. Model-generated prose is never authoritative for lifecycle advancement.

This boundary is non-negotiable. The model does not become an authority source. The lifecycle gate does not replace ACP authorization. Director authorization remains a distinct authorization mechanism.

---

## 12. Coordinator Lifecycle State vs. TaskRegistry Task Lifecycle

This roadmap explicitly distinguishes:

- **Coordinator lifecycle state**: The twelve-stage coordinator operating procedure (Stages 1–12 above). This is the machine-enforced coordinator procedure that governs how a coordinator session progresses from intent through terminal stop.
- **TaskRegistry task lifecycle state**: The TaskRegistry status enum (`PENDING → SELECTED → PLANNED → EXECUTING → VERIFIED → COMPLETE`; terminal `FAILED`/`BLOCKED`/`CANCELLED`/`SUPERSEDED`). This is the per-task execution lifecycle.

**Key distinction**: TaskRegistry task lifecycle state is the authoritative task lifecycle, but it must not automatically be treated as a complete representation of every coordinator procedure. The coordinator lifecycle includes stages (Bootstrap, Protocol Review, Requirements Extraction, State Verification, Solution Simplicity Evaluation, Roadmap Alignment) that occur *before* a TaskRegistry task is created, and stages (Reconciliation, Stop) that occur *after* a task reaches terminal status. The coordinator lifecycle gates *when and whether* a TaskRegistry task may be created, dispatched, verified, and reconciled.

The existing `PENDING → SELECTED → PLANNED → EXECUTING → VERIFIED → COMPLETE` sequence represents the task execution lifecycle, not all twelve coordinator procedures. Loading all twelve stages onto the TaskRegistry status enum would overload TaskRegistry semantics.

---

## 13. Architectural Corrections from Combined Research Review

The roadmap explicitly incorporates the following corrections from the combined research review of both Gemini passes:

1. **TaskRegistry state is the authoritative task lifecycle, but it must not automatically be treated as a complete representation of every coordinator procedure.** The coordinator lifecycle includes pre-task and post-task stages that fall outside the TaskRegistry status enum. See Section 12 above.

2. **Request idempotency must use a stable semantic request fingerprint.** The fingerprint should be a hash of `task_name` + `base_branch` + `repository` + `objective` + `request_id` (or equivalent stable correlation), not task-name + timestamp hashing as suggested in the first research pass. This is addressed in Increment 4.5.

3. **Solution Simplicity must be treated as a hybrid gate**: deterministic architectural constraints (permitted paths, no second control plane, no architecture drift) plus required structured rationale/review evidence in the task payload. The permitted-path bounds are already enforced; the structured rationale requirement is a task-mode-specific obligation, not a universal schema requirement.

4. **`requirements_reference` must not be treated as automatically finalized merely because the research suggested the field.** The future implementation must define its authoritative vocabulary, derivation rules, validation rules, and relationship to `TASK_STANDARD.md` before changing the ACP schema. This is addressed in Increment 4.2, with the schema extension scoped to non-trivial task requirement mapping.

5. **Reconciliation must be task-aware rather than a universal three-file checklist.** The completion contract defines which durable records must be updated based on task mode, scope, lifecycle type, and durable-state obligations. This is addressed in Increment 4.4.

6. **Protocol version/hash binding must be documented as a mechanism for establishing the actual protocol context used by a coordinator session/request.** The protocol SHA-256 must be bound to the session/request record and invalidated on staleness. This is addressed in Increment 4.1.

7. **Roadmap alignment must use the existing machine-checkable strategic-state architecture** (`poc/strategic-alignment.js` + `docs/ai/strategic-state.json`) rather than introducing another roadmap authority. The existing evaluator returns `ALIGNED_PENDING_AUTHORIZATION` or `BLOCKED`; it does not authorize. This is already implemented for the DeepSeek runtime and extended in Increment 4.1.

8. **Independent verification must remain independent from implementation-agent self-report.** `AGENT_REPORT` is execution evidence; `INDEPENDENT_VERIFICATION` is the evidence type that gates `VERIFIED` and `COMPLETE`. The model cannot self-promote to `INDEPENDENT_VERIFICATION`. This is enforced by evidence-gated transitions and addressed in Increment 4.3.

9. **Human-facing output must derive its completion/status claims from authoritative machine state and evidence.** Conversational prose must not imply completion unless `COMPLETE` state and verification/reconciliation evidence exist. This is a runtime-output-sanitization requirement, enforced by the existing projection sanitization in `services/deepseek-runtime.js`.

10. **Recovery must reconstruct the next legal transition from durable state** (`TaskRegistry`, `STATE.md`, Git HEAD) rather than relying on model/session memory. The existing `rehydrateTask()` mechanism in `poc/task-registry.js` provides this for the Git completion-signal path; the general case is addressed in Increment 4.5.

---

## 14. Future Implementation Increments — Detailed

### Increment 4.1 — Server-Side Protocol & Roadmap Alignment Ingress Gate

**Purpose**: Bind the coordinator request to the authoritative protocol context and strategic roadmap state before task creation/dispatch.

**Core concerns**:
- Protocol version/hash: SHA-256 of `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` bound to the coordinator request context; stale or mismatched protocol rejected before TaskRegistry creation.
- Strategic-state validation: `poc/strategic-alignment.js` invoked at `/poc/coordinator` and `/poc/deepseek-runtime` ingress; fail-closed on stale projections, invalid roadmap targets, missing prerequisites, convergence/verification failures, missing/mismatched durable transition evidence.
- Roadmap alignment: A request cannot advance into consequential task construction/dispatch unless the required protocol and roadmap prerequisites are machine-established.
- Single-control-plane preservation: Reuses `poc/strategic-alignment.js`, `poc/phase-transition-gate.js`, ACP schema; no second state store.

**Acceptance boundary**: A request cannot advance into consequential task construction/dispatch unless the required protocol and roadmap prerequisites are machine-established.

### Increment 4.2 — Mandatory State Inspection & Requirements Extraction Gating

**Purpose**: Make repository/state inspection and applicable-requirement extraction explicit prerequisites for task construction.

**Core concerns**:
- Authoritative state observation: Prior `get_task` observation or repository state inspection evidence required before `request_task`/task construction for root tasks.
- Stable evidence binding: Commit hash and observation evidence bound to request context.
- Requirements references: Structured `requirements_reference` field required in ACP schema for non-trivial tasks; `validateACPCommand` rejects missing references.
- Request idempotency: Stable semantic request fingerprint (not task-name + timestamp).
- Duplicate/replay behavior: Fail-closed on duplicate request IDs.
- Request_task gating: No substantive delegated task without state-inspection evidence and structured applicable-requirement evidence.

**Acceptance boundary**: A coordinator cannot create a substantive delegated task without the required authoritative state-inspection evidence and structured applicable-requirement evidence.

### Increment 4.3 — Mechanical Verification-to-Completion State Binding

**Purpose**: Bind execution, independent verification, `VERIFIED` state, and completion eligibility.

**Core concerns**:
- Verification evidence: Automated test suite execution and test exit codes recorded as `INDEPENDENT_VERIFICATION`.
- Test results: Test runner exit codes, JUnit/Jest output logs, `gemini-acp-report.json` bound to `VERIFIED` transition.
- Review evidence: Reviewer evaluation report (`INDEPENDENT_VERIFICATION`) required for `VERIFIED`.
- Commit/delivered-state binding: Commit hash recorded at dispatch and completion.
- VERIFIED transition: `EXECUTING → VERIFIED` requires `INDEPENDENT_VERIFICATION` evidence (already partially implemented).
- COMPLETE eligibility: `VERIFIED → COMPLETE` requires task-specific reconciliation.
- Execution completion ≠ verification ≠ completion: Distinct state transitions.
- Implementation-agent claims are not independent verification: `AGENT_REPORT` is execution evidence only.

**Acceptance boundary**: The system cannot represent a task as completed solely because the execution agent claims success.

### Increment 4.4 — Automated Reconciliation & Closeout Enforcement

**Purpose**: Make task-specific reconciliation and terminal closeout mechanically enforceable.

**Core concerns**:
- Completion contract: Task-mode-specific reconciliation rules derived from task mode, scope, lifecycle type, and durable-state obligations — not a universal three-file checklist.
- Required durable records: File update set determined by the task's completion contract; `STATE.md`, `TASK_LOG.md`, `RESEARCH_INDEX.md`, `ARCH_DECISIONS.md`, `CONTROL_CENTER.md` updated per contract.
- Repository state: Commit verification confirms documentation matches completed work.
- Git commit relationship: Reconciliation commit hash linked to TaskRegistry entry.
- Reconciliation evidence: Committed/pushed documentation updates recorded as durable evidence.
- Terminal state: Task cannot reach `COMPLETE` until reconciliation contract satisfied and machine-verified.
- Human-output synchronization: Human-facing responses derive from authoritative machine state.

**Acceptance boundary**: A task cannot enter terminal successful state until its applicable reconciliation contract is satisfied and machine-verified.

### Increment 4.5 — Lifecycle Recovery, Replay & Convergence Hardening

**Purpose**: Make the lifecycle robust across interruptions, stale state, retries, duplicate requests, replay, and non-convergent recovery.

**Core concerns**:
- Interrupted model output: Resume via bounded continuation; TaskRegistry state dictates resumption.
- Runtime restart: Persistent TaskRegistry storage restores active task lineages.
- Duplicate requests: Stable request fingerprint returns existing task status.
- Duplicate task creation: Fail-closed duplicate prevention at TaskRegistry level.
- Replayed authorization: `authorization_proof` is single-use; replayed proofs return 403.
- Stale repository state: SHA-256 projection mismatch detection; stale tasks suspended.
- Changed Git HEAD: Commit hash re-verification at each checkpoint.
- Changed protocol version: Protocol hash re-binding at each turn.
- Changed strategic state: Strategic alignment re-evaluation before each construction.
- Execution without verification: Fail-closed.
- Verification without reconciliation: Fail-closed.
- Model-generated false completion claims: Rejected without `INDEPENDENT_VERIFICATION`.
- Invalid lifecycle transitions: State machine rejects illegal transitions.
- Non-convergent recovery: Reconstruct next legal transition from durable state.

**Acceptance boundary**: Lifecycle state can be reconstructed deterministically after interruption and invalid/replayed transitions are rejected.

---

## 15. What This Task Does and Does Not Do

### This task does:

- Creates this authoritative lifecycle-enforcement roadmap document reconciling both Gemini research passes.
- Updates `STATE.md` to record the lifecycle-enforcement architectural direction, the five planned implementation increments (4.1–4.5), prerequisite ordering, and the Phase 4 transition boundary.
- Updates `CONTROL_CENTER.md` with a concise operational view.
- Updates `TASK_LOG.md` with this task entry.
- Creates ADR-024 recording the architectural direction established by this work.
- Ensures `RESEARCH_INDEX.md` correctly indexes both lifecycle research records.
- Establishes durable Phase 4 transition evidence and invokes the phase-transition gate.
- Does not mark any implementation increment complete.
- Does not falsely activate Phase 4 (Phase 4 remains PROPOSED/TARGET until the gate validates the transition).

### This task does NOT:

- Implement the lifecycle state machine (no production runtime code).
- Implement Increment 4.1, 4.2, 4.3, 4.4, 4.5, or any additional runtime behavior.
- Modify production runtime implementation (`index.js`, `routes/poc.js`, `services/`, `poc/` runtime code).
- Create a second control plane.
- Change ACP authority semantics.
- Alter TaskRegistry behavior.
- Alter Director authorization behavior.
- Modify `AGENTS.md`, `GEMINI.md`, `ARCHITECTURE.md`, or `.github/workflows/*.yml` (protected files).
- Redefine the 12-stage model (preserves the existing model from the research records).
- Treat research documentation as implementation authorization.

---

## 16. Source Material Mapping

This roadmap reconciles and incorporates the following source material:

- **Research Record 1** (`research-TASK-GEMINI-DEEPSEEK-COORDINATOR-MACHINE-ENFORCEMENT-LIFECYCLE-RESEARCH-001.md`): 12-stage lifecycle mapping, task-construction failure mode analysis, target state machine architecture, enforcement boundary mapping, reuse analysis, 4-increment Phase 4 amendment proposal.
- **Research Record 2** (`research-TASK-GEMINI-DEEPSEEK-COORDINATOR-MACHINE-ENFORCEMENT-LIFECYCLE-DEEP-RESEARCH-002.md`): Complete 12-stage analysis with enforcement/invariant/evidence/failure/recovery detail, procedure-to-state-to-invariant matrix, evidence/provenance model, recovery/interruption handling, model-vs-machine authority boundary, human-output contract, 4-increment Phase 4 decomposition.

**Reconciliation against repository**: Where the research records describe pre-implementation targets, the repository's actual implemented state is authoritative. The repository has implemented Increments 4.1–4.9 as read-only observation enhancements to the DeepSeek `get_task` projection — these are documented in `STATE.md` as `IMPLEMENTED / STATICALLY VERIFIED; RUNTIME EXECUTION BLOCKED`. This roadmap treats those as established foundation work and defines the *next* five increments (4.1–4.5 as renumbered for the lifecycle-enforcement roadmap) as future authorized implementation tasks. The existing Increment 4.1–4.9 observation work is distinct from the lifecycle-enforcement Increments 4.1–4.5 defined here; this document uses the lifecycle-enforcement numbering per the task's `implementation_sequence` requirement.

**Note on numbering**: The task's `implementation_sequence` section explicitly defines five increments numbered 4.1 through 4.5. The repository's existing Increment 4.1–4.9 (observation enhancements) are a separate historical implementation sequence. This roadmap adopts the task's required five-increment numbering for the lifecycle-enforcement roadmap, preserving the existing observation-increment history as documented precedent in `STATE.md`.

---

## 17. Roadmap Alignment

- **authoritative_roadmap**: `ARCHITECTURE.md` §16.6 (DeepSeek Coordinator Evolution); `docs/ai/STATE.md` (authoritative current project state); `docs/ai/strategic-state.json` (machine-readable projection); `docs/ai/ARCH_DECISIONS.md` (ADR-018, ADR-019, ADR-021, ADR-022).
- **current_phase**: Phase 3 — Autonomous Coordination Loop.
- **phase_completion_status**: Phase 3 is COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED. All prerequisites for Phase 3 are satisfied. Phase 4 is PROPOSED / TARGET.
- **relevant_prior_work**: Phase 0 (Coordinator Contract), Phase 1 (Observation), Phase 2 (Bounded Lineage), Phase 3 (Autonomous Coordination Loop) — all COMPLETE. Increments 4.1–4.9 (read-only observation enhancements) — IMPLEMENTED / STATICALLY VERIFIED. Two lifecycle-enforcement research passes (RESEARCH-001, DEEP-RESEARCH-002) — COMPLETED.
- **proposed_task_classification**: B — Enabling/Foundation Work. This task establishes the authoritative sequencing and architectural direction necessary for the lifecycle-enforcement implementation. It is required technical foundation before Phase 4 implementation increments can be authorized.
- **phase_unlock_or_advancement**: This documentation work enables the lifecycle-enforcement implementation increments (4.1–4.5) and the Phase 4 transition. It does not alone advance the Phase 4 transition — the phase-transition gate must validate and apply it.
- **alignment_conclusion**: PASS. This task is Enabling/Foundation Work that establishes the authoritative roadmap for the lifecycle-enforcement effort. It does not implement or activate Phase 4; it documents what must happen for each implementation increment and what conditions must be satisfied before each may execute.

---

*This document is the authoritative lifecycle-enforcement roadmap for the DeepSeek Coordinator. It is the single coherent roadmap integrating both completed Gemini research passes. The two research records remain the detailed architectural evidence; this roadmap provides implementation sequencing and project-level authoritative direction.*
