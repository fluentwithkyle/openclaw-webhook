# Research Record: Durable Controls for ChatGPT Coordinator Failure Modes

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-COORDINATOR-RELIABILITY-CONTROL-RESEARCH-001 |
| Research Question / Objective | Research and design durable, machine-enforceable controls to mitigate ChatGPT coordinator failure modes. |
| Agent | Gemini |
| Date | 2026-09-23 |
| Task Mode | RESEARCH_DOCUMENT |

## 1. Repository State Reviewed
- `ARCHITECTURE.md`, `GEMINI.md`
- `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md`, `docs/ai/TASK_STANDARD.md`
- `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md`
- `poc/schemas/acp-schema.js`, `poc/acp-engine.js`, `poc/task-registry.js`, `poc/orchestrator.js`

## 2. Findings

### Failure Modes Analysis (Verified)
The coordinator (ChatGPT) frequently suffers from:
- **State Contamination**: Architectural/role models carried over from stale conversations.
- **Verification Failure**: Inference replacing independent repository-state verification.
- **Identity/Destination Drift**: Forgetting the active agent, task ID, or execution lane during interruptions.
- **Evidence Inflation**: Treating self-reports as verified completion.

### Current Architecture & ACP (Implemented)
- **ACP Enforcement**: Partial validation via `poc/schemas/acp-schema.js` and `validateACPCommand`.
- **Durable State**: `TaskRegistry` persists task state, but conversational context remains the primary driver for task construction.
- **Verification**: Protocol requires verification, but enforcement is procedural (human-reliant).

## 3. Recommended Durable Control Architecture (Proposed)

1. **Immutable Task Identity**: Require `request_id` to be signed into all artifacts and status records.
2. **Mandatory Evidence Transition**: Introduce explicit evidence classes (`AGENT_REPORT`, `WORKFLOW_SUCCESS`, `INDEPENDENT_VERIFICATION`). Task status cannot transition to `VERIFIED` without an `INDEPENDENT_VERIFICATION` evidence record.
3. **Control Plane Enforcement**: Move task-construction validation (ACP checklist compliance) from ChatGPT-prompts to `orchestrator.js` / `acp-engine.js` enforced gate.
4. **Fail-Closed Default**: If any state transition lacks required evidence or authorization data, default to `BLOCKED`.
5. **State-Driven Recovery**: Recovery MUST be driven by `TaskRegistry` lookups keyed by `request_id`, explicitly forbidding conversational reconstruction.

## 4. Machine-Enforced Boundaries

| Control | Type |
|---------|------|
| `request_id` correlation | Runtime Invariant |
| ACP Schema Compliance | Deterministic Runtime Validation |
| Evidence Hierarchy | Durable State Invariant |
| Authorization Boundary | Human-Authorized / Durable Data |

## 5. Implementation Roadmap
- **Phase 1**: Enhance `acp-engine.js` with strict artifact-compliance checklist enforcement (machine-enforced).
- **Phase 2**: Extend `TaskRegistry` to track evidence classes and mandate `INDEPENDENT_VERIFICATION` evidence for `VERIFIED` status transitions.
- **Phase 3**: Implement automatic `STATE.md` reconciliation upon successful verification.

## 6. Open Decisions
- Alignment of Control Gate logic between Render and ACP execution infrastructure.
- Scope of `TaskRegistry` extensions for automated recovery.

## 7. Repository Evidence Supporting Findings
- Observed failure patterns documented in task instruction.
- `poc/schemas/acp-schema.js` lacks structural enforcement for evidence-based transitions.
- `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` relies heavily on agent adherence to procedures (Section 8.2).
