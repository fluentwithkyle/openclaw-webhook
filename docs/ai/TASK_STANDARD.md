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

## 5. Concrete Example

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
