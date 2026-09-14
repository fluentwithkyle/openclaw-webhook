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

## 5. Control Center

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

## 6. Concrete Example

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
