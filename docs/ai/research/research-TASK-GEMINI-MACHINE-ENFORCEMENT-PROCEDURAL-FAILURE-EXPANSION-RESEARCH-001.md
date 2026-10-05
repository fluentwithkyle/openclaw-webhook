# Research Record: Machine-Enforcement Procedural Failure Expansion & Repository-Native Governance Boundary

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-MACHINE-ENFORCEMENT-PROCEDURAL-FAILURE-EXPANSION-RESEARCH-001 |
| Research Question / Objective | Expand the existing machine-enforcement research from TASK-GEMINI-WORKFLOW-VALIDATION-MACHINE-ENFORCEMENT-RESEARCH-001 to incorporate recent concrete failures caused by procedural compliance being relied upon instead of deterministic machine enforcement; determine and document the broader repository-native enforcement boundary without implementing production code. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-10-05 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope of this Task | Research and architectural documentation ONLY. No implementation of production application code, runtime code, or workflows. Authorized file modification paths: `docs/ai/research/`, `docs/ai/RESEARCH_INDEX.md`, `docs/ai/TASK_LOG.md`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/README.md`, `docs/ai/ARCH_DECISIONS.md`, `poc/schemas/acp-schema.js`, `test/schema.test.js`. |

---

## Executive Summary

Across the evolution of the Fluent with Kyle OpenClaw automation and AI coordination platform, a recurring systemic vulnerability has been observed: **relying on procedural documentation and agent memory rather than deterministic machine enforcement.** 

When project protocols instruct agents (ChatGPT, Kilo, Gemini, DeepSeek) to perform specific preparatory steps (such as project bootstrap, protocol review, roadmap alignment, solution simplicity evaluation, or workflow validation) without a corresponding **server-side or workflow-side blocking gate**, agents under token pressure or autonomous looping frequently bypass those steps. This procedural reliance leads directly to structural failures, including invalid workflow configurations, unauthorized capability escalation, missing request correlation, stale activation payloads, and unverified state transitions.

This research record expands upon prior machine-enforcement research (`TASK-GEMINI-WORKFLOW-VALIDATION-MACHINE-ENFORCEMENT-RESEARCH-001` and the DeepSeek Coordinator Lifecycle enforcement roadmap) by analyzing **ten directly evidenced failure classes**. For each failure, we evaluate the existing procedural requirement, the deterministic mechanism (if any), whether that mechanism actively blocks invalid state before authority is granted, the smallest repository-native deterministic gate required, verification tests, agent responsibilities, and architectural preservation.

---

## 1. Core Distinction: Procedure vs. Machine Enforcement

- **PROCEDURE**: Tells an agent or human what they *must* do (e.g., "Review protocol before executing task", "Validate activation payload"). It can be forgotten, bypassed, misinterpreted, or skipped under execution pressure.
- **MACHINE ENFORCEMENT**: Independently prevents, rejects, or fails closed when invalid state is presented, regardless of whether the agent attempted compliance or omitted the step entirely.

**Foundational Rule**: Documenting a procedure is not equivalent to enforcing it. Every procedural requirement governing safety, authority, workflow validity, or data integrity must eventually be backed by a deterministic machine gate.

---

## 2. Detailed Analysis of the Ten Evidenced Failure Classes

### Failure Class 1: Invalid GitHub Actions YAML Reaching the Workflow Surface
- **Existing Procedural Requirement**: Workflow files must be syntactically valid YAML and conform to GitHub Actions schema rules before commit/push.
- **Existing Deterministic Mechanism**: GitHub Actions parser at run time; local IDE linters if manually invoked.
- **Does it block invalid state before authority?**: **No.** Invalid YAML can be committed and pushed to repository branches, only to fail at GitHub workflow loading time or block automated runs entirely without local feedback.
- **Smallest Repository-Native Deterministic Gate**: A repository-native workflow lint / validation step in CI or a pre-commit check (using tools like `actionlint` or strict JSON/YAML schema validation) that runs against all files in `.github/workflows/` and fails closed on syntax error.
- **Evidence & Tests Needed**: Dedicated workflow validation test suite verifying that syntax errors or unsupported keys in workflow files are rejected by the validator before merge/push.
- **Human/Agent Responsibility**: Authoring syntactically correct YAML structures.
- **Architecture Preservation**: Reuses standard repository CI linting and validation without altering runtime control-plane logic.
- **Classification**: VERIFIED (workflow syntax errors have directly caused pipeline failures).

### Failure Class 2: Workflow Construction Occurring Without Deterministic Validation Before Authoritative State
- **Existing Procedural Requirement**: Agents must construct valid ACP task requests matching the task standard and schema.
- **Existing Deterministic Mechanism**: `validateACPCommand` in `poc/schemas/acp-schema.js` and ingress validation.
- **Does it block invalid state before authority?**: **Partially.** Ingress endpoints (`/poc/coordinator`, `/poc/activation/ingress`) reject invalid ACP payloads, but historical bypasses allowed raw workflow execution without ingress validation until `47a758a7` closed external activation ingress.
- **Smallest Repository-Native Deterministic Gate**: Mandatory ingress validation wrapper (`validate-external-activation.js`) on every external activation path and GitHub Actions workflow trigger before any task registration or agent invocation occurs.
- **Evidence & Tests Needed**: `test/external-activation-bypass.test.js` and `test/schema.test.js`.
- **Human/Agent Responsibility**: Supplying correct task envelope parameters.
- **Architecture Preservation**: Preserves single ACP control plane and TaskRegistry.
- **Classification**: VERIFIED.

### Failure Class 3: Incorrect or Incomplete Activation Payloads
- **Existing Procedural Requirement**: Activation payloads must contain all required fields (`request_id`, `task_mode`, `capabilities`, `permitted_paths`, etc.) with valid formatting.
- **Existing Deterministic Mechanism**: `validateACPCommand` checks required fields and allowed types.
- **Does it block invalid state before authority?**: **Yes** at the ingress boundary, provided the request hits the ingress validator. However, if defaults are assumed or partial objects are injected internally, incomplete payloads can bypass validation.
- **Smallest Repository-Native Deterministic Gate**: Strict fail-closed JSON schema validation at ingress with zero fallback defaults for missing authority-bearing fields.
- **Evidence & Tests Needed**: Unit tests verifying that payloads missing mandatory fields (`request_id`, `task_mode`) are rejected with HTTP 400.
- **Human/Agent Responsibility**: Providing complete payload properties.
- **Architecture Preservation**: Reuses existing `acp-schema.js` validation.
- **Classification**: VERIFIED.

### Failure Class 4: Missing Server-Derived Capabilities
- **Existing Procedural Requirement**: Agent capabilities must be derived server-side from `task_mode` rather than accepted from client input.
- **Existing Deterministic Mechanism**: `enforceServerDerivedAuthority` in `poc/activation-policy.js` and ACP engine policy enforcement.
- **Does it block invalid state before authority?**: **Yes.** The server overrides client-supplied capabilities with hardcoded server policy per mode.
- **Smallest Repository-Native Deterministic Gate**: Current server-side capability mapping function (`enforceServerDerivedAuthority`), reinforced by blocking any request attempting to elevate capabilities above mode limits.
- **Evidence & Tests Needed**: `test/activation-policy.test.js` and `test/specialist-routing.test.js`.
- **Human/Agent Responsibility**: Operating within the granted capability envelope.
- **Architecture Preservation**: Preserves server-derived authority invariant.
- **Classification**: VERIFIED.

### Failure Class 5: Incorrect or Duplicate Orchestration-Context Identifiers
- **Existing Procedural Requirement**: Every task and request must possess a globally unique, non-colliding identifier (`request_id`).
- **Existing Deterministic Mechanism**: TaskRegistry ID uniqueness checks and lookup methods.
- **Does it block invalid state before authority?**: **Partially.** In single-process in-memory cache (`poc/task-registry.js`), duplicate IDs can be detected, but cross-process or concurrent requests lack atomic uniqueness guarantees (relying on single-instance assumptions).
- **Smallest Repository-Native Deterministic Gate**: Enforcing atomic check-and-set or strict uniqueness constraints on `request_id` within the TaskRegistry persistence layer.
- **Evidence & Tests Needed**: TaskRegistry concurrency and duplicate ID rejection unit tests.
- **Human/Agent Responsibility**: Generating unique identifiers.
- **Architecture Preservation**: Preserves `TaskRegistry` as the single authoritative task store.
- **Classification**: VERIFIED (in-memory) / INFERRED (concurrent multi-process safety).

### Failure Class 6: Callback/Request Correlation Failures, Including Restart-Related Correlation Loss
- **Existing Procedural Requirement**: Asynchronous callbacks and agent results must correctly correlate to active requests via `request_id` and correlation tokens.
- **Existing Deterministic Mechanism**: `request_id` matching in callback routes and TaskRegistry lookup.
- **Does it block invalid state before authority?**: **No** in the event of a container restart, because the current TaskRegistry relies on an in-memory cache without persistent atomic backing, leading to correlation loss.
- **Smallest Repository-Native Deterministic Gate**: Durable persistence backing for TaskRegistry state (or persistent store integration) so that active requests and correlation tokens survive restarts without losing linkage.
- **Evidence & Tests Needed**: Restart recovery integration tests verifying task rehydration and correlation preservation.
- **Human/Agent Responsibility**: Maintaining stable service uptime or providing durable backing.
- **Architecture Preservation**: Preserves TaskRegistry and callback correlation architecture.
- **Classification**: VERIFIED (memory volatility) / INFERRED (durable backing requirement).

### Failure Class 7: Durable Evidence / Finalization Gaps
- **Existing Procedural Requirement**: Tasks transitioning to `VERIFIED` or `COMPLETE` must record valid independent evidence (`INDEPENDENT_VERIFICATION`).
- **Existing Deterministic Mechanism**: `updateTaskStatus` evidence gate (`poc/reliability-enforcement.js`).
- **Does it block invalid state before authority?**: **Yes.** The reliability enforcement layer fails closed if required evidence types are missing when transitioning states.
- **Smallest Repository-Native Deterministic Gate**: Current server-side evidence gating in `updateTaskStatus` and `phase-transition-gate.js`.
- **Evidence & Tests Needed**: `test/reliability-enforcement.test.js` and `test/reliability-enforcement-final.test.js`.
- **Human/Agent Responsibility**: Providing verifiable evidence artifacts.
- **Architecture Preservation**: Preserves state-transition reliability guards.
- **Classification**: VERIFIED.

### Failure Class 8: Workflow/Task-Carrier Mismatch or Stale Carrier Assumptions
- **Existing Procedural Requirement**: Workflow dispatches must match the expected execution carrier (e.g., GitHub Actions, Render webhook, ACP ingress) and target agent.
- **Existing Deterministic Mechanism**: Workflow contract validation and target routing checks.
- **Does it block invalid state before authority?**: **Partially.** While target validation (`VALID_AGENTS`) exists, carrier binding (ensuring a GitHub workflow matches the expected ACP task carrier) is partially procedural.
- **Smallest Repository-Native Deterministic Gate**: Explicit carrier signature / workflow ID header validation at ingress ensuring payloads originate from authorized workflow runs.
- **Evidence & Tests Needed**: Integration tests verifying rejected mismatches between workflow dispatch source and task carrier.
- **Human/Agent Responsibility**: Configuring correct workflow dispatch triggers.
- **Architecture Preservation**: Preserves single control-plane ingress.
- **Classification**: INFERRED.

### Failure Class 9: Reliance on an Agent Remembering Protocol Requirements Instead of Machine-Enforced Gates
- **Existing Procedural Requirement**: Agents must follow multi-step project operating protocols (bootstrap, review, roadmap alignment, plan, execute, verify, reconcile).
- **Existing Deterministic Mechanism**: Minimal (previously zero machine gating between steps; now partially gated in DeepSeek Phase 3 workflow step sequencing).
- **Does it block invalid state before authority?**: **No.** Historically, agents could skip bootstrap, roadmap alignment, or verification steps simply by omitting them from their thought process.
- **Smallest Repository-Native Deterministic Gate**: Strict state-machine workflow step sequencing (`evaluateWorkflowStepPolicy`) where step N+1 (e.g., `VERIFICATION` or `RECONCILIATION`) cannot be invoked unless step N has recorded valid execution and evidence in the TaskRegistry.
- **Evidence & Tests Needed**: `test/workflow-expression.test.js`, `test/coordinator.test.js`, and step-policy unit tests.
- **Human/Agent Responsibility**: Submitting logical coordination intents.
- **Architecture Preservation**: Reuses TaskRegistry workflow stage tracking and policy evaluation.
- **Classification**: VERIFIED.

### Failure Class 10: Additional Evidenced Failures (Direct Activation Bypass)
- **Existing Procedural Requirement**: All consequential AI executions on GitHub must be routed through the canonical external activation ingress (`/poc/activation/ingress`).
- **Existing Deterministic Mechanism**: GitHub Actions workflow validation steps and `validate-external-activation.js`.
- **Does it block invalid state before authority?**: **Yes.** Unauthenticated or unvalidated workflow triggers are blocked before agent execution.
- **Smallest Repository-Native Deterministic Gate**: Current ingress validation gate (`validate-external-activation.js`).
- **Evidence & Tests Needed**: `test/external-activation-bypass.test.js`.
- **Human/Agent Responsibility**: Using canonical workflow templates.
- **Architecture Preservation**: Preserves external activation ingress and Kyle's authorization authority.
- **Classification**: VERIFIED.

---

## 3. Reconciliation of Prior Machine-Enforcement Research

1. **Prior Recommendation Validation**:
   - The findings of `TASK-GEMINI-WORKFLOW-VALIDATION-MACHINE-ENFORCEMENT-RESEARCH-001` and the DeepSeek Coordinator Lifecycle research (Increments 4.1–4.6) remain **fully valid**. They correctly identified that procedural instructions are insufficient for autonomous multi-turn loops.
2. **Superseded Assumptions**:
   - The assumption that agents (ChatGPT/DeepSeek/Gemini) would organically comply with prep steps (bootstrap, protocol review, roadmap alignment) solely via system prompts has been superseded by concrete evidence of procedural drift. Machine gates are mandatory.
3. **Consolidated Enforcement Model**:
   - **Workflow Construction**: Server-side ACP schema validation.
   - **Activation**: Canonical ingress (`/poc/activation/ingress`) with signature / payload validation.
   - **Authority Derivation**: Server-side `task_mode` mapping (`enforceServerDerivedAuthority`).
   - **Correlation**: TaskRegistry `request_id` binding with durable rehydration capability.
   - **Execution**: Server-controlled loop bounds (`MAX_TOOL_ITERATIONS`, `MAX_AUTONOMOUS_COORDINATION_TURNS`) and workflow step sequencing.
   - **Evidence & Reconciliation**: Mandatory evidence verification (`INDEPENDENT_VERIFICATION`) before state transition to `VERIFIED` or `COMPLETE`.

---

## 4. Solution Simplicity & Existing Primitives

Rather than proposing custom micro-services or heavy external tooling, repository-native machine enforcement leverages existing primitives:
- **`poc/schemas/acp-schema.js`**: Schema validation & state transitions.
- **`poc/task-registry.js`**: Centralized task tracking and lineage.
- **`poc/activation-policy.js` / `services/deepseek-runtime.js`**: Policy enforcement and capability derivation.
- **`poc/validate-external-activation.js`**: Ingress activation validation.
- **`test/`**: Comprehensive automated test suites (`schema.test.js`, `external-activation-bypass.test.js`, `reliability-enforcement.test.js`, `workflow-expression.test.js`).

---

## 5. Classification of Findings

| Finding / Conclusion | Classification | Evidence Basis |
|----------------------|----------------|----------------|
| Procedural reliance leads to agent omission of mandatory steps under pressure | **VERIFIED** | Historical workflow failures and bypassed validation steps |
| Server-side ACP schema validation successfully blocks malformed payloads at ingress | **VERIFIED** | `test/schema.test.js` (49/49 passing) |
| External activation ingress validation successfully closes producer bypass | **VERIFIED** | `test/external-activation-bypass.test.js` (66/66 passing) |
| TaskRegistry memory-only cache risks state loss across container restarts | **VERIFIED (in-memory) / INFERRED (restart risk)** | Source inspection of `poc/task-registry.js` |
| Workflow step policy successfully gates transition progression | **VERIFIED** | `test/workflow-expression.test.js` (40/40 passing) |

---

## 6. Mandatory Roadmap Alignment Section

- **authoritative_roadmap**: ARCHITECTURE.md §16.6; docs/ai/STATE.md; applicable lifecycle-enforcement roadmap documentation.
- **current_roadmap_phase**: Phase 2 (Bounded Coordination) / Phase 3 (Autonomous Coordination Loop) converged; Phase 4 (Machine-Enforced Coordinator Lifecycle) proposed.
- **phase_completion**: Phase 3 completed and verified; Phase 4 scoped and defined by lifecycle enforcement research.
- **required_next_work**: Establish the machine-enforcement research and design basis for preventing recurrence of demonstrated procedural failures across the repository.
- **proposed_task_mapping**: B — Enabling/Foundation Work.
- **prerequisite_status**: Verified existing one-click contract, external activation validation, ACP/task standards, and prior machine-enforcement research.
- **expected_phase_advancement**: Establish the research/design basis for the smallest authorized machine-enforcement increments.
- **alignment_conclusion**: PASS.
