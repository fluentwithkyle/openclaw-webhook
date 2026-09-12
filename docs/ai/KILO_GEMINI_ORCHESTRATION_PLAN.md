# Kilo ↔ Gemini Orchestration Backbone — Implementation Plan

**Status**: PROPOSED / PENDING KYLE APPROVAL
**Repository**: `fluentwithkyle/openclaw-webhook`
**Base branch**: `main`
**Purpose**: Define the smallest viable machine-to-machine orchestration backbone connecting Kilo completion → orchestration state → Gemini execution → structured Gemini result → subsequent agent/action determination.

This is a planning artifact only. It does not authorize implementation, file modification, commit, push, pull request, or deployment.

## 1. Scope and Architectural Position

The backbone should reuse the existing Render/Node.js service, ACP proof of concept, transport abstraction, GitHub Actions, and existing Kilo/Gemini integration points rather than introduce a new infrastructure platform.

Current role boundaries remain:

- Kyle = Director / Final Authority
- Kilo = Primary Builder / Implementer / Tester
- Gemini = Architect / Planner / Reviewer / Researcher
- Qwen = planned Router
- OpenClaw = optional transport/orchestration layer, not a prerequisite
- No backup agent

The immediate implementation target is the Kilo ↔ Gemini execution loop. Qwen routing and OpenClaw transport remain future extensions.

## 2. Proposed Architecture Flow

```text
External Trigger
      ↓
Render POST /poc/kilo
      ↓
Kilo executes authorized ACP task
      ↓
Kilo completion callback
POST /poc/kilo/callback
      ↓
TaskRegistry records Kilo execution + result
      ↓
Orchestrator evaluates next action
      ↓
GitHub Actions workflow_dispatch
      ↓
Gemini isolated execution
      ↓
POST /poc/gemini/callback
      ↓
TaskRegistry records Gemini result
      ↓
Orchestrator determines next action
      ↓
Optional subsequent Kilo ACP task
```

The orchestration layer should live inside the existing Render application for the proof of concept. This keeps business/orchestration state close to the existing webhook service and avoids a second always-on service.

## 3. Existing Integration Points

The implementation plan should build around the repository components already identified during inspection:

- `poc/acp-engine.js` — ACP validation, capability boundaries, and path restrictions.
- `services/transport-provider.js` — transport abstraction that can be used instead of embedding provider-specific delivery logic in orchestration code.
- `routes/poc.js` — natural home for Kilo/Gemini orchestration proof-of-concept endpoints.
- `index.js` — existing Express application and route registration.
- `.github/workflows/kilo-gemini-poc.yml` — existing Kilo/Gemini proof-of-concept execution path.
- Existing Render services/workflows — available application boundary for receiving callbacks and maintaining orchestration state.
- Existing Kilo integration — Kilo is the execution worker, not the source of orchestration policy.
- Existing Gemini integration — Gemini is invoked as an isolated specialist execution lane.

The actual Kilo Cloud completion callback mechanism must remain an implementation dependency to verify during the implementation phase. If Kilo Cloud cannot directly call the Render callback, the Kilo integration must use the available supported completion/transport mechanism rather than inventing an undocumented provider feature.

## 4. Proposed Components and Files

### New files

- `poc/task-registry.js`
  - Correlation and lifecycle state for orchestration tasks.
  - File-backed JSON persistence for the proof of concept.
  - In-memory cache for active tasks.
  - Atomic writes to reduce corruption risk.
  - Designed so the persistence layer can later migrate to a database without changing the orchestration contract.

- `poc/orchestrator.js`
  - Receives execution reports.
  - Updates TaskRegistry.
  - Determines the next authorized action.
  - Coordinates Gemini triggering and future Kilo continuation.
  - Contains orchestration policy rather than provider-specific transport code.

- `poc/gemini-trigger.js`
  - Encapsulates triggering Gemini through the existing GitHub Actions execution plane.
  - Prefer `workflow_dispatch` over issue comments or polling.
  - Passes only the minimum task/context identifiers required for the Gemini execution.

- `poc/schemas/acp-schema.js`
  - Versioned ACP/task contract validation shared by the orchestration path.
  - Reuses existing ACP validation boundaries rather than creating a second incompatible contract.

- `test/task-registry.test.js`
- `test/orchestrator.test.js`
- `test/gemini-trigger.test.js`
- `test/integration.test.js`

### Existing files to modify later

- `routes/poc.js` — add Kilo completion and Gemini callback endpoints and wire orchestration calls.
- `index.js` — register any new routes or initialization required by the orchestration layer.
- `poc/command.json` — align proof-of-concept command payload with the versioned ACP contract.
- `.github/workflows/kilo-gemini-poc.yml` — accept the orchestration context required for isolated Gemini execution.

Protected files such as `AGENTS.md`, `GEMINI.md`, `ARCHITECTURE.md`, and production workflows require explicit authorization if a later implementation task needs to modify them.

## 5. TaskRegistry Data Model

The minimum state needed to correlate the two execution lanes should include:

```json
{
  "request_id": "unique-correlation-id",
  "parent_request_id": null,
  "originator": "Kyle",
  "current_agent": "Kilo",
  "next_agent": "Gemini",
  "repository": "fluentwithkyle/openclaw-webhook",
  "base_branch": "main",
  "task": "authorized-task-description",
  "status": "running | success | failure | blocked",
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "kilo": {
    "status": "success",
    "execution_id": "provider-execution-id",
    "report": {}
  },
  "gemini": {
    "status": "pending | running | success | failure | blocked",
    "execution_id": null,
    "report": null
  },
  "next_action": null
}
```

The registry must preserve correlation through every transition. Each agent report should reference the same `request_id`, with an optional `parent_request_id` when work is spawned from another request.

## 6. Machine-Readable Execution Report

Both Kilo and Gemini should return the same minimum report shape:

```json
{
  "request_id": "unique-correlation-id",
  "agent": "Kilo | Gemini",
  "status": "success | failure | blocked",
  "task": "task-description",
  "changed_files": [],
  "verification": [],
  "result": {},
  "commit": null,
  "push": null,
  "blockers": []
}
```

The report is an execution result, not an authorization mechanism. Authorization remains in the ACP request and repository operating rules.

Reports must never contain secrets, credentials, tokens, private keys, or sensitive environment values.

## 7. Event / Trigger Sequence

### Step 1 — Kilo execution

Kilo receives an explicitly authorized ACP request and performs only the permitted task.

### Step 2 — Kilo completion

Kilo emits a structured completion report to the orchestration callback when the supported integration path is available.

Target endpoint:

`POST /poc/kilo/callback`

The callback is authenticated and validated before it changes orchestration state.

### Step 3 — Record Kilo state

The callback passes the validated report to `TaskRegistry`, which records the Kilo execution result and updates the correlated request.

### Step 4 — Determine Gemini action

`orchestrator.js` evaluates the Kilo result against the task's authorized next action. For the initial backbone, a successful Kilo completion can trigger the Gemini review lane.

### Step 5 — Trigger Gemini

`gemini-trigger.js` invokes the existing GitHub Actions Gemini workflow using `workflow_dispatch`.

The dispatch should carry a correlation identifier and the minimum context required to retrieve the task/result. Avoid placing large reports or sensitive information directly into workflow inputs.

### Step 6 — Gemini execution

The GitHub Actions execution plane runs Gemini in its isolated specialist lane. Gemini reads the repository state and supplied task context according to its existing role and operating instructions.

### Step 7 — Gemini completion

Gemini returns a structured result to:

`POST /poc/gemini/callback`

The callback is authenticated and validated before updating TaskRegistry.

### Step 8 — Next action

The orchestrator records the Gemini result and determines whether the workflow is complete, requires another Kilo action, requires Kyle review, or is blocked.

A later implementation may trigger another authorized Kilo ACP request, but the initial backbone should keep that continuation mechanism minimal and explicit.

## 8. Security Boundaries

- Fail closed on malformed or incomplete ACP requests.
- Authenticate Kilo and Gemini callbacks with a shared secret or equivalent application-level authentication mechanism.
- Keep secrets in environment configuration, never in source or `docs/ai/`.
- Validate `request_id`, agent identity, repository, branch, and permitted task context before state mutation.
- Enforce authorized file/path boundaries through the existing ACP engine.
- Treat provider webhook metadata as context, not authorization.
- Do not infer commit/push authority from event type, issue title, commit message, sender, or other metadata.
- Do not expose secrets in execution reports or logs.
- Prevent duplicate callbacks from creating duplicate state transitions.
- Keep orchestration state separate from business CRM state.

## 9. Persistence Strategy

For the proof of concept, TaskRegistry should use a file-backed JSON store with an in-memory cache and atomic writes.

This is intentionally a transitional persistence mechanism. It minimizes infrastructure while proving correlation and orchestration behavior. The interface should isolate persistence details so the registry can later move to durable managed storage when concurrent execution, multi-instance deployment, or higher reliability requirements make file-backed state insufficient.

The implementation should explicitly document the persistence limitations rather than presenting file-backed state as production-grade distributed coordination.

## 10. Testing Strategy

### Unit tests

- Task creation and correlation.
- Kilo completion updates.
- Gemini trigger state transitions.
- Gemini completion updates.
- Duplicate callback handling.
- Invalid/malformed reports.
- Missing authorization fields.
- Persistence and recovery behavior.

### Integration tests

- Kilo callback → TaskRegistry → Gemini trigger.
- Gemini callback → TaskRegistry → next-action determination.
- End-to-end correlation using a stable `request_id`.
- Authentication failure paths.
- Provider failure/timeout paths.

### Repository verification

- `git status --short --branch`
- `git diff --check`
- targeted test suite
- final diff inspection
- secret review

## 11. Known Dependency / Unknown

The principal external dependency is the supported mechanism for receiving a Kilo completion event. Public Kilo Cloud documentation clearly supports inbound webhook triggers, while a customer-configurable outbound completion webhook is not established as a documented capability. The implementation must therefore verify the actual available Kilo completion path before selecting the final callback transport.

The Gemini trigger path is more concrete: GitHub Actions `workflow_dispatch` can provide the execution boundary without introducing a continuously running Gemini service.

A GitHub token for orchestration should use the minimum permissions necessary. The proposed `ORCHESTRATOR_GH_TOKEN` is intended for the workflow-dispatch operation and required read access only; exact permission scope must be validated during implementation.

## 12. Existing POC Issue to Resolve

The current POC contains a known task-name mismatch:

- `poc/main.js` references task `inspect-repo`.
- The execution engine uses `inspect-poc-files`.

The later implementation task should resolve this mismatch or remove the obsolete POC path as part of the smallest coherent implementation.

## 13. Implementation Phases

### Phase 1 — Contract and registry

- Define the versioned ACP/task schema.
- Implement TaskRegistry.
- Add registry tests.

### Phase 2 — Orchestration endpoints

- Add authenticated Kilo callback endpoint.
- Add authenticated Gemini callback endpoint.
- Connect both to TaskRegistry.
- Add orchestration tests.

### Phase 3 — Gemini trigger

- Implement `workflow_dispatch` integration.
- Pass correlation context.
- Add trigger tests and failure handling.

### Phase 4 — End-to-end POC

- Wire Kilo completion → orchestration → Gemini → orchestration.
- Verify state transitions and machine-readable reports.
- Resolve the known POC task-name mismatch.

### Phase 5 — Hardening / future extension

- Validate callback idempotency.
- Review persistence behavior under Render deployment constraints.
- Determine whether durable managed storage is required.
- Add subsequent Kilo triggering only after the Kilo completion/transport path is verified.

## 14. Acceptance Criteria for Later Implementation Task

The implementation is acceptable when:

1. A valid Kilo completion can reach the Render orchestration endpoint through a supported integration path.
2. The completion is authenticated, validated, correlated, and persisted by TaskRegistry.
3. A successful eligible Kilo result can trigger the existing Gemini GitHub Actions execution lane.
4. Gemini receives a stable `request_id` and sufficient task/result context to perform its authorized role.
5. Gemini returns a standardized machine-readable execution report.
6. The Gemini callback is authenticated, validated, correlated, and persisted.
7. The orchestrator can determine the next action from the recorded result without embedding provider-specific business logic.
8. Duplicate or malformed callbacks do not corrupt task state.
9. No secrets are stored in source, documentation, task state, or reports.
10. Unit and integration tests cover the primary success and failure transitions.
11. `git diff --check` passes and the final diff contains only authorized changes.
12. Commit and push occur only when explicitly authorized by the implementation task.

## 15. Future Architectural Extensions

These are outside the initial backbone implementation:

- Qwen Router selecting specialist lanes through the same ACP contract.
- Additional specialist agents such as Security or Utility.
- OpenClaw as an optional transport/orchestration provider.
- Durable managed TaskRegistry storage.
- Generalized event bus / queue semantics.
- More sophisticated policy-driven next-action selection.
- Human approval gates for consequential actions.

The backbone should therefore establish stable contracts and correlation without prematurely implementing the larger multi-agent system.
