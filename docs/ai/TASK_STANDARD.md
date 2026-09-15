# Canonical AI Task Request Standard

This document defines the mandatory, canonical format for all AI task requests initiated by the Director in the `fluentwithkyle/openclaw-webhook` repository.

## 1. Task Request Envelope

All task requests must be structured with the following fields:

- `originator`: (Required) The persona or role initiating the task (e.g., "Kyle — Director").
- `target_agent`: (Required) The agent to perform the task (e.g., "Gemini", "Kilo").
- `repository`: (Required) The repository the task applies to.
- `base_branch`: (Required) The branch the task is based on and intended to integrate with.
- `task_mode`: (Required) The execution mode ("RESEARCH", "PLAN", "EXECUTE").
- `objective`: (Required) A concise statement of the goal.
- `scope`: (Required) Clear definition of the files, directories, or architectural boundaries impacted.
- `capabilities`: (Required) Explicit list of capabilities required (e.g., "inspect", "modify_files", "commit", "push").
- `verification`: (Required) Specific criteria for verifying the task completion.
- `constraints`: (Optional) Operational limits or rules (e.g., "no-new-dependencies").
- `conflict_handling`: (Optional) Instructions for handling rule conflicts.

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
  "objective": "Fix bug in abandoned booking trigger.",
  "scope": {
    "permitted_paths": ["workflows/abandonedBooking.js"]
  },
  "capabilities": ["inspect", "modify_files", "run_tests", "commit"],
  "verification": "Verify trigger logic with test case.",
  "constraints": ["smallest-change"]
}
```
