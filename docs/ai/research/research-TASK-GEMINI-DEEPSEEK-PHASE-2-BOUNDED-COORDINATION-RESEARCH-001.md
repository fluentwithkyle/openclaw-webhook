# Research Record: DeepSeek Phase 2 Bounded Coordination Architecture and Policy Model

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-PHASE-2-BOUNDED-COORDINATION-RESEARCH-001 |
| Research Question / Objective | Determine the smallest viable, ACP-compliant Phase 2 Bounded Coordination capability/policy model that lets DeepSeek translate an observed workflow need into an authorized coordination request without creating a second control plane or granting the model authority. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-09-27 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope of this Task | Research and documentation ONLY. No production application code implementation was authorized. |

---

## Executive Summary

Phase 1 is VERIFIED at implementation commit `8c77901`. The current DeepSeek runtime exposes exactly one model-facing `control_plane` tool with `request_task` and `get_task`. Its current `request_task` authority is server-derived and fixed to REVIEW/read_only/`poc/` with target Gemini Builder.

The smallest viable Phase 2 increment is to extend the existing `request_task` path with bounded workflow lineage (optional `parent_request_id`) while preserving the current server-derived authority envelope. This is preferable to adding a second model-facing operation or control plane.

A critical correction to the earlier draft is that the current runtime does **not** establish a model-selectable target or an existing explicit Kyle approval gate for every consequential child request. The runtime currently fixes the target server-side, while `/poc/coordinator` authenticates and validates ACP commands and then registers/dispatches them. Therefore, human authorization for future consequential coordination must be treated as a policy mechanism to be implemented or explicitly preserved by an existing trusted activation path, not as an already-proven runtime property.

Phase 2 implementation should therefore begin with a bounded, read-only lineage capability. Any future elevation to BUILDER, FAILOVER_EXECUTE, write capabilities, broader permitted paths, commit/push, or other consequential operations requires a separately defined server-side authorization policy and verification task.

---

## 1. Verified Existing Infrastructure

- **DeepSeek runtime:** `services/deepseek-runtime.js` exposes one `control_plane` function with two operations: `request_task` and `get_task`.
- **Current request authority:** `request_task` accepts untrusted intent/objective and a target field at the tool-schema level, but the server-side command builder fixes the authoritative target to Gemini Builder and derives repository, branch, task mode, capabilities, permitted paths, originator, and verification.
- **Coordinator boundary:** `routes/poc.js` authenticates `/poc/coordinator`, validates the ACP command, registers it in the existing TaskRegistry, and dispatches through the existing dispatcher.
- **TaskRegistry:** existing task creation and lineage facilities provide the durable task state and parent/child relationship mechanism.
- **Observation:** Phase 1 `get_task` provides lifecycle, lineage, agent/evidence, verification, failure, and blocked-state observation.
- **Authority:** ACP remains the authoritative validation/registration/dispatch boundary; DeepSeek model output is untrusted.

---

## 2. Smallest Viable Phase 2 Model

### Recommended first increment

Extend the existing `request_task` operation with an optional `parent_request_id`.

The server should:

1. Validate the parent identifier against the existing TaskRegistry lineage rules.
2. Permit only an allowed parent/child relationship.
3. Preserve the current server-derived authority envelope for the child.
4. Create the child through the existing ACP → TaskRegistry → dispatcher path.
5. Return the new request identifier and bounded task metadata to DeepSeek.
6. Preserve the existing tool-loop bound until a separate decision establishes a larger safe limit.

This keeps one control plane, one registry, one dispatcher/orchestrator, and one model-facing tool.

### Simplicity conclusion

A new `request_workflow_step` or `request_child_task` model-facing operation is unnecessary for the first increment because lineage is already a TaskRegistry concept and can be attached to the existing task-creation operation.

---

## 3. Untrusted Intent vs. Server Authority

### Model-supplied / untrusted

- `operation`
- `objective`
- `parent_request_id` when used for lineage
- `request_id` for observation

The model may describe what work it believes is needed. That description is intent, not authorization.

### Server-derived / authoritative

- repository
- base branch
- target agent
- task mode
- capabilities
- permitted paths
- originator
- authentication context
- verification requirements
- any consequential-operation authorization decision

The model must not be able to select or escalate these fields.

In particular, the current runtime's model-visible `target` schema field must not become an authority-bearing selector merely because it is present in the tool schema. Phase 2 should either remove that unnecessary model input or ignore it and continue deriving the target server-side.

---

## 4. Lineage and Workflow Correlation

Use the existing TaskRegistry `parent_request_id` lineage mechanism.

Required behavior for the Phase 2 increment:

- reject nonexistent or invalid parents;
- preserve existing cancellation/supersession lineage rules;
- prevent a child from inheriting greater authority than the server policy grants;
- expose parent/child correlation through the existing observation projection;
- keep task identity and lifecycle in the existing registry.

A parent relationship is correlation and decomposition metadata; it is **not** an authorization grant.

---

## 5. Authorization Boundary

The current repository proves authentication and ACP validation at `/poc/coordinator`, but it does not prove that every consequential operation requested by DeepSeek has a separate human approval transaction.

Therefore:

- read-only Phase 2 chaining may use the existing bounded REVIEW/read_only authority envelope;
- BUILDER, FAILOVER_EXECUTE, `modify_files`, `commit`, `push`, broader permitted paths, or other consequential authority must remain unavailable to the Phase 2 model-facing request path unless a separate server-side authorization policy explicitly permits it;
- a future human-approval mechanism must be a trusted server-side policy/activation boundary, not a model-provided flag;
- parent lineage must never itself authorize privilege escalation.

---

## 6. Lifecycle Scenarios

| Scenario | Phase 2 first increment |
|---|---|
| Research/review follow-up | Allowed only within the server-derived bounded REVIEW/read_only scope |
| Implementation request | Request may be observed/reported as intent, but the Phase 2 read-only path does not grant implementation authority |
| Verification/reconciliation | Remains a separate trusted operation/policy decision |
| Failure/recovery | Consume existing `get_task` failure/blocked observation and preserve lineage |
| Blocked/escalation | Surface existing BLOCKED/human-review state; do not let the model self-authorize escalation |

---

## 7. Explicit Phase 2 Security Boundaries

Phase 2 must not introduce:

- arbitrary filesystem access;
- model-selected capabilities;
- model-selected permitted paths;
- model-selected task modes;
- model-selected target escalation;
- generic HTTP execution;
- direct GitHub credentials or repository authority;
- self-authorized commit/push;
- a second control plane, registry, dispatcher, or orchestrator;
- an unbounded tool loop.

---

## 8. Implementation Surface for the First Phase 2 Increment

A later atomic implementation task should inspect and, only where required, modify:

1. `services/deepseek-runtime.js` — extend the existing request-task tool/command construction with bounded parent lineage; keep authority server-derived.
2. `poc/schemas/acp-schema.js` — only if the canonical ACP envelope currently requires an explicit lineage field or needs validation changes.
3. `poc/task-registry.js` — reuse existing lineage validation; change only if the existing implementation cannot safely support the coordinator child-request case.
4. Relevant runtime, schema, and TaskRegistry tests — prove lineage, authority invariants, invalid-parent rejection, and no privilege escalation.
5. Documentation/state files — reconcile only after implementation is independently verified.

The implementation task must inspect the current code before changing any of these files and use the Solution Simplicity Gate.

---

## 9. Unresolved Decisions for Later Policy Work

1. **Consequential authorization mechanism:** the repository currently does not establish a dedicated human-approval transaction for DeepSeek-requested elevation. A future task must define the trusted server-side authorization mechanism before DeepSeek can initiate consequential work.
2. **Automatic read-only chaining policy:** determine the exact bounded conditions under which DeepSeek may create additional REVIEW/read_only children without a separate human approval event.
3. **Tool iteration limit:** retain `MAX_TOOL_ITERATIONS = 2` for the first Phase 2 increment. Any increase requires measured justification and tests; it is not required to implement lineage.
4. **Target selection:** determine whether the model-facing `target` schema field should be removed entirely or retained as non-authoritative metadata. The current runtime should continue deriving the actual target server-side.

These are policy decisions, not reasons to expand the first implementation beyond bounded read-only lineage.

---

## 10. Evidence vs. Recommendation

**Repository evidence:** one model-facing control-plane tool; fixed server-derived request authority; authenticated/validated `/poc/coordinator`; existing TaskRegistry lineage facilities; Phase 1 observation.

**Recommendation:** implement the smallest Phase 2 increment as bounded parent-linked REVIEW/read_only child requests through the existing `request_task` path.

**Not established by this research:** an automatic privilege-escalation path, a completed human-approval mechanism for consequential DeepSeek requests, or authorization to change task modes/capabilities/paths.

---

## 11. Implementation Acceptance Criteria

The first Phase 2 implementation is acceptable only if:

1. exactly one model-facing `control_plane` tool remains;
2. no new control plane, registry, dispatcher, or generic executor is introduced;
3. `parent_request_id` is validated server-side against existing lineage rules;
4. child authority remains server-derived and bounded to the existing REVIEW/read_only policy;
5. invalid, nonexistent, cancelled, or superseded parents are rejected according to existing lineage semantics;
6. the model cannot select task mode, capabilities, permitted paths, or consequential authorization;
7. Phase 1 `get_task` continues to expose the resulting lineage;
8. tests cover valid lineage, invalid lineage, and privilege-boundary invariants;
9. `MAX_TOOL_ITERATIONS` remains 2 for this increment;
10. no claim is made that consequential human approval has been implemented unless a separate trusted mechanism is actually present and verified.
