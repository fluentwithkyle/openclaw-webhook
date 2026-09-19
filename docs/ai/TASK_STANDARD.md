# Canonical AI Task Request Standard

This document defines the mandatory, canonical format for all AI task requests initiated by the Director in the `fluentwithkyle/openclaw-webhook` repository.

## 1. Task Request Envelope

All task requests must be structured with the following fields:

- `originator`: (Required) The persona or role initiating the task (e.g., "Kyle — Director").
- `target_agent`: (Required) The agent to perform the task (e.g., "Gemini", "Kilo").
- `repository`: (Required) The repository the task applies to.
- `base_branch`: (Required) The branch the task is based on and intended to integrate with.
- `task_mode`: (Required) The execution mode. One of: "RESEARCH", "PLAN", "EXECUTE", or "VERIFY_RECONCILE". See Section 9 for task mode definitions.
- `capabilities`: (Required) Explicit list of capabilities required (e.g., "inspect", "modify_files", "commit", "push").
- `objective`: (Required) A concise statement of the goal.
- `scope`: (Required) Clear definition of the files, directories, or architectural boundaries impacted.
- `verification`: (Required) Specific criteria for verifying the task completion.
- `constraints`: (Optional) Operational limits or rules (e.g., "no-new-dependencies").
- `conflict_handling`: (Optional) Instructions for handling rule conflicts.

The canonical field ordering is: `originator`, `target_agent`, `repository`, `base_branch`, `task_mode`, `capabilities`, `objective`, `scope`, `verification`, `constraints`, `conflict_handling`. The `capabilities` field must appear immediately before `objective` so that the task's authorized capabilities are immediately visible to the Director before the objective is reviewed or the task is authorized.

## 2. Authorization and Safety

- **Principle of least privilege**: Agents are only authorized for the specific capabilities listed in the task request.
- **Explicit authorization**: Capabilities are never implied.
- **Fail-closed**: Any missing, ambiguous, or unauthorized capability or scope results in a blocked status.
- **Secrets**: No secrets, API keys, or credentials allowed in task requests.
- **Scope**: Changes are limited strictly to the authorized file/path scope.

## 3. Instruction Precedence

Repository-level instructions (`GEMINI.md`, `ARCHITECTURE.md`) take precedence over task requests. Any conflict between a task request and repository rules must result in a `status: blocked` report.

## 4. Relationship with ACP

This standard provides the human-readable envelope for task delegation. The Agent Command Protocol (ACP) is the *proposed* future machine-readable protocol for executing these tasks.

---

## 5. Persistence Expectations for Implementation Tasks

This section defines the mandatory persistence requirements for implementation tasks (task_mode: EXECUTE) targeting Kilo or any execution agent. These requirements ensure that implementation work is durably recorded in GitHub within the same authorized execution.

### 5.1 Same-Execution Persistence Requirement

- An implementation task with `commit` and `push` capabilities **must complete all persistence operations** (commit, push, verification reporting) within the single authorized execution that produces the work.
- The task request must be constructed so that the receiving execution can complete the authorized work **without depending on a later conversational handoff or future execution**.
- No implementation work is considered complete until it is committed and pushed to the authorized `base_branch` (typically `main`) and the execution reports the commit SHA.

### 5.2 Atomic Task Sizing

- Implementation tasks must be scoped to **atomic, independently deliverable units**.
- Each task must produce a verifiable, commit-ready change set that leaves the repository in a consistent state.
- Tasks that are too large to complete, verify, commit, and push in one execution must be decomposed into a sequence of authorized tasks, each with its own ACP authorization and GitHub deliverable.

### 5.3 Checkpointing for Multi-Execution Work

- For work requiring multiple executions:
  1. Each execution must deliver a complete, tested, and committed increment.
  2. Intermediate state is preserved in GitHub (commits on `main` or authorized feature branches).
  3. TaskRegistry tracks the `request_id` chain for orchestration correlation.
  4. Subsequent tasks' ACP authorizations explicitly reference prior deliverables and the current `base_branch`.
- No "work in progress" state may be held in the agent's ephemeral session memory.

### 5.4 Explicit Persistence Fields in Task Request

Implementation tasks should include the following persistence-related expectations in their `verification` or `constraints` fields:

- `persistence_expectation`: "same_execution" | "checkpointed" — Whether the task must complete persistence in one execution or is part of a checkpointed sequence.
- `deliverable_commit`: Boolean — Whether the task must produce at least one commit.
- `deliverable_push`: Boolean — Whether the task must push to the remote.
- `verification_requires_commit_sha`: Boolean — Whether verification requires reporting the commit SHA.

Example addition to task request:
```json
{
  "verification": "Verify implementation and report commit SHA.",
  "constraints": [
    "smallest-change",
    "persistence_expectation: same_execution",
    "deliverable_commit: true",
    "deliverable_push: true",
    "verification_requires_commit_sha: true"
  ]
}
```

### 5.5 No Reliance on Agent Session Memory

- Task requests must not assume the execution agent retains any context from prior executions, conversations, or issue comments.
- All necessary context, authorization, and scope must be explicitly included in the task request body.
- Recovery from interruption is performed by inspecting GitHub state and TaskRegistry, not by resuming an agent session.

### 5.6 Authority Boundaries Preserved

These persistence expectations reinforce, but do not alter, the existing authority boundaries:
- Kyle remains Director and final authorization authority.
- ChatGPT remains coordinator and verification layer.
- Kilo remains Builder/Implementer/Tester.
- Gemini remains Architect/Planner/Reviewer.
- GitHub remains the durable repository source of truth.

---

## 6. Control Center

`docs/ai/CONTROL_CENTER.md` is a **derived human-facing presentation layer** for Kyle.

- **docs/ai/STATE.md remains the authoritative current project-state source.**
- CONTROL_CENTER.md is a presentation layer containing concise summaries and actionable information.
- CONTROL_CENTER.md does not duplicate large portions of STATE.md or TASK_LOG.md.
- CONTROL_CENTER.md is not authoritative for project state.

### Refresh Trigger

An authorized implementation task shall cause CONTROL_CENTER.md to be refreshed when:

- The task changes active task status, blockers, or project status in STATE.md.
- The task completes a task listed in CONTROL_CENTER.md.
- A new task is authorized that Kyle must be aware of.

Kilo refreshes CONTROL_CENTER.md as part of the task verification step, only when the task scope includes `docs/ai/CONTROL_CENTER.md` in permitted_paths or when STATE.md content reflected in CONTROL_CENTER.md has materially changed.

### Authority Boundary

- Kilo may update CONTROL_CENTER.md only as a side effect of an authorized implementation task.
- Kilo may not independently create or modify CONTROL_CENTER.md outside of an authorized task.
- CONTROL_CENTER.md updates must preserve least-privilege and fail-closed requirements.
- No automated synchronization of CONTROL_CENTER.md is introduced by this standard.
- CONTROL_CENTER.md must never grant Kilo unrestricted authority over project-state documentation.

## 7. Concrete Example

```json
{
  "originator": "Kyle — Director",
  "target_agent": "Kilo",
  "repository": "fluentwithkyle/openclaw-webhook",
  "base_branch": "main",
  "task_mode": "EXECUTE",
  "capabilities": ["inspect", "modify_files", "run_tests", "commit"],
  "objective": "Fix bug in abandoned booking trigger.",
  "scope": {
    "permitted_paths": ["workflows/abandonedBooking.js"]
  },
  "verification": "Verify trigger logic with test case.",
  "constraints": ["smallest-change"]
}
```

## 8. Dynamic Recovery and Convergence Protocol

This section defines the execution behavior for Kilo (and any implementation agent) when implementing authorized tasks. It replaces any fixed recovery-cycle limits with a convergence-based model that allows productive exploration and recovery while preventing unbounded debugging loops and scope expansion.

### 8.1 Initial Exploration Is Expected

- Kilo may inspect relevant code, documentation, tests, and configuration before and during implementation.
- A few exploratory steps are normal and should not immediately trigger a blocked result.
- Exploration is bounded by the task's authorized scope (`permitted_paths`, `capabilities`).

### 8.2 Recovery Is Allowed

- When implementation or validation reveals a problem, Kilo may diagnose and repair it.
- There is no rigid universal one-recovery-cycle limit.
- Recovery steps must remain within the authorized scope and capabilities.

### 8.3 Convergence Determines Whether Kilo Continues

Continue execution when the execution path is converging toward the stated objective. Signals of convergence include:

- The identified failure becomes narrower and more specific.
- The implementation moves closer to the objective with each step.
- Tests progressively improve or pass.
- The required scope remains stable.
- Each recovery step produces useful information or measurable progress.

### 8.4 Non-Convergence Determines When Kilo Stops

Stop and report `status: blocked` when recovery becomes materially non-convergent. Signals include:

- Repeated failure without meaningful improvement.
- Expanding into unrelated files or systems beyond authorized scope.
- Changing the task objective.
- Repeatedly restructuring test infrastructure instead of fixing the target implementation.
- Entering open-ended architectural investigation.
- Accumulating increasingly speculative fixes without evidence of convergence.

### 8.5 Scope Expansion Is a Hard Warning Signal

- Kilo should prefer preserving the original bounded execution path.
- If solving the task requires genuinely new architectural decisions or external-system investigation, that work must be surfaced as a blocker/escalation rather than silently turning the task into a different task.
- Scope expansion beyond `permitted_paths` or authorized `capabilities` requires new explicit authorization.

### 8.6 Verification Remains Bounded

- Verification should validate the stated objective and relevant regression surface.
- Do not turn "verify the change" into an unrestricted repository-wide debugging exercise.
- Verification scope is limited to what is necessary to confirm the authorized change.

### 8.7 Durable Completion

- When the task reaches a valid completed state, Kilo must finish the requested implementation, verification, commit, push, and completion report according to the existing task standard.
- Completion includes reporting the commit SHA and verification performed.

### 8.8 Behavioral Principle

**Allow enough exploration and recovery for Kilo to gain traction. Stop when the execution path stops converging.**

This principle replaces any interpretation of "fail fast" as "stop at the first unexpected problem." The objective is autonomous completion without babysitting, while preserving reasonable room for Kilo to solve ordinary implementation problems independently.

### 8.9 Conflict Resolution

If existing `TASK_STANDARD.md` language conflicts with the dynamic recovery model above, resolve the conflict in favor of:

**Bounded execution + reasonable exploration + convergence-based recovery + explicit escalation when execution becomes non-convergent.**

Do not introduce an arbitrary numeric retry limit merely to satisfy previous recommendations.

## 9. Task Modes

The following task modes define the execution semantics for ACP tasks. Every task request must specify exactly one `task_mode`.

### 9.1 RESEARCH

The agent inspects the repository, architecture, and relevant files to answer questions, analyze problems, or gather information. No repository changes are made. Read-only.

### 9.2 PLAN

The agent produces a structured implementation plan — affected files, steps, risks, validation requirements, and acceptance criteria. No repository changes are made.

### 9.3 EXECUTE

The agent implements the authorized task within the permitted scope, validates, and persists results. May include `modify_files`, and when explicitly authorized, `commit` and `push`. See Section 5 for persistence expectations.

### 9.4 VERIFY_RECONCILE

**Definition**: `VERIFY_RECONCILE = VERIFY + RECONCILE`. Both components are mandatory and neither may be satisfied by the other.

**VERIFY** means independently establishing whether the target state, implementation, or prior agent result is correct. This includes inspecting the actual repository state (committed code, documentation, CI results, commits, diffs) and confirming that reported work was actually delivered and matches the original objective. Agent reports and prior conversation are supporting evidence only; the durable repository state is the authoritative verification source.

**RECONCILE** means updating the designated durable repository records so that they accurately and durably represent the independently verified state and verification result. For tasks scoped to `docs/ai/`, the durable records include `docs/ai/STATE.md`, `docs/ai/TASK_LOG.md`, `docs/ai/ARCH_DECISIONS.md`, and `docs/ai/CONTROL_CENTER.md` as appropriate.

**RECONCILIATION IS NOT OPTIONAL.**

The following interpretation is explicitly prohibited:

> "No reconciliation is required because the existing documentation is already accurate."

Existing accurate documentation does NOT eliminate the reconciliation requirement. If the existing durable records already describe the implementation accurately, the agent must still perform reconciliation by determining where the independent verification event/result belongs in the established durable-record structure and recording it appropriately — for example, recording that the verification was performed, its result, and that the verified state was confirmed accurate.

The durable record must distinguish, where applicable:

- What was implemented by the implementation agent;
- What was independently verified by the verification agent;
- The resulting verified state.

**A VERIFY_RECONCILE task is incomplete if verification occurred but reconciliation did not.**

#### 9.4.1 Relationship Between Operations

The canonical ordering and relationship between operations is:

1. **VERIFY** — Independently establish whether the target state or prior result is correct.
2. **RECONCILE** — Update durable repository records to represent the verified result.
3. **VALIDATE** — Confirm that the reconciliation accurately reflects the verified state (i.e., the updated records correctly and completely represent what was implemented and verified).
4. **COMMIT** — Persist the reconciled documentation (only when the `commit` capability is explicitly authorized).
5. **PUSH** — Make the persisted reconciliation available on the authorized `base_branch` (only when the `push` capability is explicitly authorized).

Verification and reconciliation are co-mandatory. Validation confirms the reconciliation. Commit and push persist the reconciliation. None of these steps may be skipped when their corresponding capability is authorized and the task requires it.

#### 9.4.2 Completion Requirement

A VERIFY_RECONCILE task cannot be considered complete until:

1. Independent verification of the target state or prior result has been performed and its result is documented.
2. The verification result has been durably recorded in the appropriate repository durable records.
3. The reconciliation has been validated as accurate.
4. If `commit` and `push` capabilities are authorized, the changes have been committed and pushed to the authorized `base_branch`.

#### 9.4.3 Authorization Boundary Preserved

Reconciliation being mandatory within the task does not bypass existing authorization gates. The mandatory nature of reconciliation is a task-internal procedural requirement, not an authorization grant. Authorization remains governed by the ACP command envelope: explicit capabilities are never implied, `modify_files` does not authorize `commit`, `commit` does not authorize `push`, and every capability must be explicitly granted. Only explicitly authorized paths may be modified. The fact that reconciliation is mandatory within a VERIFY_RECONCILE task does not authorize repository changes outside the explicitly authorized `permitted_paths` or capabilities.
