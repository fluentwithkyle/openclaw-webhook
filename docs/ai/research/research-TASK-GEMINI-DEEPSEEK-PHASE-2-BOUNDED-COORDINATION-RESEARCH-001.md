# Research Record: DeepSeek Coordinator Evolution Phase 2 — Bounded Coordination Research

- **Task ID**: `TASK-GEMINI-DEEPSEEK-PHASE-2-BOUNDED-COORDINATION-RESEARCH-001`
- **Research Objective**: Research and durably define the next roadmap-required atomic increment for DeepSeek Coordinator Evolution Phase 2 — Bounded Coordination, using the reconciled repository state and `ARCHITECTURE.md` §16.6 as authoritative.
- **Agent**: Gemini — Architect, Reviewer, and Researcher
- **Date**: 2026-09-28
- **Task Mode**: `RESEARCH_DOCUMENT`

---

## 1. Scope Examined

- `ARCHITECTURE.md` §16.6 (DeepSeek Coordinator Evolution — Full Conversational Coordination)
- `docs/ai/STATE.md` (Live authoritative strategic state)
- `docs/ai/strategic-state.json` (Machine-readable strategic projection)
- `docs/ai/CONTROL_CENTER.md` (Derived human-facing dashboard)
- `docs/ai/TASK_LOG.md` (Append-only AI development task log)
- `docs/ai/TASK_STANDARD.md` (Roadmap Alignment Gate §3.1, §3.2)
- Relevant Phase 0 Coordinator Contract research and verification records (`docs/ai/research/`)
- Relevant Phase 1 Observation research and verification records (`docs/ai/research/`)
- Existing DeepSeek runtime implementation (`services/deepseek-runtime.js`)
- Existing ACP schema (`poc/schemas/acp-schema.js`)
- Existing TaskRegistry (`poc/task-registry.js`)
- Existing dispatcher/orchestrator (`poc/orchestrator.js`, `services/transport-provider.js`)
- Existing specialist-routing/authorization/continuation mechanisms (`poc/director-authorization.js` or equivalent routes)
- `docs/ai/RESEARCH_INDEX.md`

---

## 2. Required Research Questions & Findings

### Q1: What is the authoritative current roadmap phase?
- **Finding**: According to `ARCHITECTURE.md` §16.6 and `STATE.md`, the authoritative current roadmap phase is **Phase 2 — Bounded Coordination** (substantially built/in progress, following the formal reconciliation of Phase 0 and the completion of Phase 1 observation).

### Q2: What exact Phase 2 acceptance requirement remains unresolved?
- **Finding**: Per `ARCHITECTURE.md` §16.6, Phase 2 requires: *"add policy-controlled workflow operations that map to existing ACP modes, capabilities, paths, targets, verification requirements, and authorization gates."* While base continuation and result-driven same-execution consumption have been implemented, policy-controlled multi-step workflow operations (such as structured workflow stage progression, dependency-gated step execution, and coordinated multi-task state tracking under strict server-side rules) remain the core unresolved Phase 2 requirement.

### Q3: What existing repository capabilities already satisfy portions of that requirement?
- **Finding**:
  1. Authenticated `POST /poc/coordinator` and `POST /poc/deepseek-runtime` ingress.
  2. Phase 1 observation (`get_task`) across all eight ACP lifecycle states, lineage, evidence categories, independent verification, and failure/blocked state.
  3. Bounded continuation requiring prior `get_task` observation, `COMPLETE` parent state, `INDEPENDENT_VERIFICATION`, and TaskRegistry lineage validation.
  4. Same-execution automatic result consumption correlating submitted tasks to the current bounded conversation.
  5. Director authorization infrastructure (`POST /poc/director/approve`) and specialist routing policy (Security and Utility specialist routing).

### Q4: What portions are independently verified?
- **Finding**: Phase 0 Coordinator Contract (commit `ec9c476`), Phase 1 observation projection, Phase 2 bounded lineage validation (`e8ecb49`), Phase 3.1 Director authorization infrastructure, and Phase 3.2 specialist routing (correction commit `11d057bc756739f111aab9c0189108ca2e678e14` independently verified by `TASK-CODEX-DEEPSEEK-PHASE-3.2-SPECIALIST-ROUTING-FINAL-VERIFY-RECONCILE-001`).

### Q5: What is the smallest atomic increment that directly advances the unresolved Phase 2 requirement?
- **Finding**: **Bounded Workflow Step Validation & Explicit Stage Progression Policy**. This increment enforces server-side policy rules governing how a DeepSeek conversation can propose a subsequent workflow step (e.g., advancing from research to planning or review) by validating explicit stage prerequisites against TaskRegistry metadata, without introducing a second control plane, generic queue, or model-granted authority.

### Q6: Why is this increment classified A — Roadmap-Required Work?
- **Finding**: It directly implements the documented Phase 2 acceptance requirement in `ARCHITECTURE.md` §16.6 ("add policy-controlled workflow operations that map to existing ACP modes..."), moving the project deliberately toward Phase 2 completion without skipping into Phase 3 autonomous execution.

### Q7: What existing mechanisms must it reuse?
- **Finding**: `TaskRegistry` (`poc/task-registry.js`), `acp-engine` (`poc/acp-engine.js`), `transport-provider` dispatcher (`services/transport-provider.js`), `deepseek-runtime` (`services/deepseek-runtime.js`), and existing schema validation (`poc/schemas/acp-schema.js`).

### Q8: What new behavior, if any, must be introduced?
- **Finding**: Server-side validation rules in the runtime/coordinator policy that check workflow stage progression constraints before allowing a child task request to map to specific non-default workflow steps or specialized review lanes.

### Q9: What model-facing inputs are permitted?
- **Finding**: Objective, parent request ID, and strictly enumerated, server-validated workflow step identifiers. No arbitrary capabilities, paths, targets, or unverified parameters.

### Q10: What authority-bearing fields must remain server-derived?
- **Finding**: Repository, base branch, target agent, task mode, capabilities, permitted paths, originator, coordinator authentication context, verification requirements, and Director approval proofs.

### Q11: What existing security and authorization boundaries must remain unchanged?
- **Finding**: DeepSeek model output remains untrusted intent; server policy remains authoritative; `/poc/coordinator` remains the ACP boundary; TaskRegistry remains authoritative task state; Director authorization remains required for consequential elevation; independent verification remains distinct from execution completion.

### Q12: What exact files would an implementation task need to modify?
- **Finding**:
  - `services/deepseek-runtime.js`
  - `test/deepseek-runtime.test.js` (or related test files)

### Q13: What tests and acceptance evidence are required?
- **Finding**: Focused unit tests for workflow step validation, ACP schema compliance tests, TaskRegistry integration checks, and full regression suite execution (`npm test`).

### Q14: What would constitute independent verification?
- **Finding**: Independent review of the code diff, passing test suite execution, verification that server-side authority boundaries are strictly maintained, and formal verification record (`RESEARCH_DOCUMENT` mode).

### Q15: What would cause the implementation to be blocked rather than expanded in scope?
- **Finding**: Any attempt by model output to inject custom paths, unapproved capabilities, arbitrary targets, unauthenticated approval proofs, or bypass the Roadmap Alignment Gate.

---

## 3. Conclusions & Recommended Next Action

1. **Conclusion**: Phase 2 — Bounded Coordination is substantially built but requires formal policy-controlled workflow operation mapping before Phase 3 autonomous coordination can be considered.
2. **Recommended Next Action**: Authorize an implementation task (subject to Kyle's approval) to implement **Bounded Workflow Step Validation & Explicit Stage Progression Policy** in `services/deepseek-runtime.js` and associated tests, strictly adhering to the security and authority invariants.

---

## 4. Mandatory Roadmap Alignment

- **roadmap-classification**: A — Roadmap-Required Work
- **authoritative_roadmap**: `ARCHITECTURE.md` §16.6 and authoritative `docs/ai/STATE.md`
- **current_phase**: Phase 2 — Bounded Coordination
- **phase_completion_status**: IN PROGRESS / SUBSTANTIALLY BUILT
- **unresolved_requirement**: Policy-controlled workflow operations that map to existing ACP modes, capabilities, paths, targets, verification requirements, and authorization gates.
- **alignment_conclusion**: **Gate PASSED**. The proposed increment directly fulfills the explicit Phase 2 requirement in `ARCHITECTURE.md` §16.6 without introducing speculative capabilities, second control planes, or bypassing server authority.
