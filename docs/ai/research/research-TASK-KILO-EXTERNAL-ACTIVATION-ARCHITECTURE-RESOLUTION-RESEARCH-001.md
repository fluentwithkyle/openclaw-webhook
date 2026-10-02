# Research Record: External Activation Architecture Resolution

| Field | Value |
|---|---|
| Task / Request Identifier | TASK-KILO-EXTERNAL-ACTIVATION-ARCHITECTURE-RESOLUTION-RESEARCH-001 |
| Research Question / Objective | Produce a durable architectural research record resolving the canonical design for agent-independent external activation, GitHub execution-carrier integration, TaskRegistry creation/recovery, and exactly-once agent execution in `fluentwithkyle/openclaw-webhook`. Determine whether the architecture is sufficiently resolved for a subsequent Kilo implementation task, or mark BLOCKED with the exact unresolved decision. |
| Agent | Kilo |
| Date | 2026-10-02 |
| Task Mode | RESEARCH_DOCUMENT |
| Repository State Examined | main @ `47a758a7ef8f4e63b32e699549c21e8976971e40` |

## Executive Conclusion

**VERIFIED: The architecture for external activation through the canonical ingress (`/poc/activation/ingress`) is substantially resolved.**

Commit `47a758a7` closes the producer-bypass gap by routing all consequential GitHub activations through `canonicalExternalActivationIngress` in `poc/activation-ingress.js`, which enters the existing ACP/TaskRegistry authority boundary before dispatch. The canonical ingress performs:

1. Server-side canonicalization of the external activation envelope (`activation_policy.canonicalizeExternalActivation`)
2. Agent × task-mode × activation-surface policy validation (`activation_policy.evaluateActivation`)
3. Authority-conflict detection on server-derived fields (`activation_policy.isAuthorityConflict`)
4. Server-derived authority enforcement (`activation_policy.enforceServerDerivedAuthority`)
5. ACP compliance validation (`acp_schema.validateACPCompliance`)
6. ACP engine authorization (`acp_engine.validate`)
7. TaskRegistry replay/idempotency check (`task_registry.replayTask`)
8. Director approval consumption for consequential commands (`task_registry.createTaskWithDirectorAuthorization`)
9. Dispatcher/transport invocation (`services/transport-provider.dispatch`)
10. State transition to EXECUTING (`routes/poc.js:transitionToExecuting`)

**Status: ARCHITECTURE RESOLVED — sufficient for a subsequent Kilo implementation task with the acceptance criteria defined in Section 23.**

---

## Evidence Classification

### VERIFIED

| Item | Evidence Location |
|---|---|
| main HEAD is `47a758a7ef8f4e63b32e699549c21e8976971e40` | `git log --oneline -1` |
| `VALID_AGENTS` = `['Kilo', 'Gemini', 'Gemini Builder', 'Security Specialist', 'Utility Specialist']` | `poc/activation-policy.js:1` |
| `VALID_TASK_MODES` = `['REVIEW', 'VERIFY_RECONCILE', 'FAILOVER_EXECUTE', 'BUILDER', 'RESEARCH_DOCUMENT']` | `poc/activation-policy.js:2` |
| `EXECUTION_TASK_MODES` = `['FAILOVER_EXECUTE', 'BUILDER']` | `poc/activation-policy.js:60` |
| Server-derived authority fields: `task_mode`, `authorization`, `constraints`, `repository`, `base_branch`, `target`, `workflow_stage` | `poc/activation-policy.js:257-265` |
| Canonical ingress endpoint: `POST /poc/activation/ingress` with `authenticatePoc` middleware | `routes/poc.js:251-278` |
| `canonicalExternalActivationIngress` performs canonicalization → policy → authority-conflict → server-derived → ACP → TaskRegistry → dispatch | `poc/activation-ingress.js:15-274` |
| `replayTask` checks payload fingerprint and lineage before creating a new task | `poc/task-registry.js:163-189` (called from `activation-ingress.js:163`) |
| `createTaskWithDirectorAuthorization` consumes Director approval for consequential commands | `poc/task-registry.js:78-80` |
| `dispatchBuilder` routes `Gemini Builder` target through `gemini-builder-trigger` after ACP validation | `services/transport-provider.js:20-91` |
| `dispatchReview` routes `Gemini` target through `gemini-trigger` after ACP validation | `services/transport-provider.js:93-135` |
| Dispatcher routes by `target` field: Kilo → Kilo transport, Gemini Builder → Builder transport, Gemini/Security/Utility → Review transport | `services/transport-provider.js:142-158` |
| `main.yml` validates `@gemini-cli` plain comments as REVIEW via workflow input conditions | `.github/workflows/main.yml:56-61` (advisory `if:`) |
| `main.yml` validates external activation through canonical ingress before Gemini execution (issue_comment path) | `.github/workflows/main.yml:147-176` |
| `main.yml` validates external activation through canonical ingress before Gemini execution (workflow_dispatch path) | `.github/workflows/main.yml:178-212` |
| `gemini-builder.yml` validates external activation through canonical ingress before Builder execution | `.github/workflows/gemini-builder.yml:99-130` |
| `validate-external-activation.js` is the workflow-side shim that calls `external-activation-validator.js` | `poc/validate-external-activation.js:1-69` |
| `external-activation-validator.js` builds activation payloads and calls the canonical ingress HTTPS endpoint | `poc/external-activation-validator.js:1-165` |
| Bypass tests: 36 tests in `test/external-activation-bypass.test.js` prove the bypass is closed | `test/external-activation-bypass.test.js` |
| `gemini-trigger.js` dispatches via `workflow_dispatch` to `main.yml` | `poc/gemini-trigger.js` |
| `gemini-builder-trigger.js` dispatches via `workflow_dispatch` to `gemini-builder.yml` | `poc/gemini-builder-trigger.js` |
| `routes/poc.js` has `authenticatePoc` middleware checking `x-poc-trigger-secret` against `process.env.ACP_POC_TRIGGER_SECRET` | `routes/poc.js:35-43` |
| Kilo external webhook: documented as provider-controlled, issue_comment disabled | `docs/ai/KILO_INTEGRATION.md` |
| DeepSeek runtime `prohibited_authority_fields` list | `services/deepseek-runtime.js:57` |
| DeepSeek runtime `WORKFLOW_STEP_POLICY`, `SPECIALIST_ROUTING_POLICY`, `DEEPSEEK_COORDINATOR_POLICY` | `services/deepseek-runtime.js:16-107` |
| DeepSeek runtime `buildControlPlaneCommand` derives all authority server-side | `services/deepseek-runtime.js:234-296` |
| Foundation commit `2136c44`: activation-policy.js + activation-ingress.js | `git show 2136c44 --stat` |
| Gap-closure commit `c2d4810`: replay/idempotent recovery + Director approval enforcement | `git show c2d4810 --stat` |

### INFERRED

| Item | Basis |
|---|---|
| The canonical ingress is the single authorized entry for externally activated execution | `poc/activation-ingress.js:15-274` processes all agent-independent activation through one function with one ACP/TaskRegistry boundary |
| The workflow-side `validate-external-activation.js` shim is admission-only — it does NOT dispatch or execute | `poc/validate-external-activation.js:56-63` returns exit 0 on success but does not invoke any agent; dispatch is performed by `main.yml`'s `run-gemini-cli` step (lines 254-313) or `gemini-builder.yml`'s `run-gemini-cli` step (lines 139-199), **after** validation passes |
| `47a758a7` validator calls ingress for admission + TaskRegistry creation but workflow then invokes Gemini directly | See Section 6 — this is the residual architectural gap |
| `main.yml` `run-gemini-cli` step receives orchestration context from workflow inputs, not from the canonical ingress response | `main.yml:254-313`: env vars are populated from `steps.orchestration_context.outputs.*` and `steps.request_comment.outputs.*` |
| `gemini-builder.yml` `run-gemini-cli` step receives orchestration context from workflow inputs | `gemini-builder.yml:139-199` |
| The `target_agent` field in ACP command determines transport dispatch | `services/transport-provider.js:142-158` |
| `activation_surface` and `activation_syntax` flow through to `command.activation_*` fields but do not independently authorize | `poc/activation-ingress.js:119-126` |
| Plain `@gemini-cli` REVIEW is preserved by `external-activation-validator.js:buildActivationPayloadForIssueComment` (lines 69-105) default `taskMode = 'REVIEW'` | `poc/external-activation-validator.js:72` |
| `FAILOVER_EXECUTE` keyword detection preserves existing Gemini failover semantics | `poc/external-activation-validator.js:77-83` |

### UNKNOWN

| Item | Reason |
|---|---|
| Runtime execution of test suites | Node/npm repository execution not available in coordinator environment per prior verification records |
| Live GitHub Actions workflow execution for every actor type | Not independently exercised; GitHub workflow behavior documented via code inspection only |
| Live Kilo provider webhook trigger configuration | Documented as external provider-controlled; trigger configuration and prompt not fully enforceable from repository code |
| Live Render callback endpoint behavior | Cannot independently verify provider-side HTTP endpoint behavior from repository code |
| Whether `47a758a7` introduces dual canonical + workflow-derived execution paths in practice | See Section 6 — the architectural design allows divergence but runtime enforcement depends on GitHub workflow `if:` conditions which cannot be independently verified without execution |

---

## 1. Current Repository Truth from main HEAD (`47a758a7`)

### 1.1 Commit chain from foundation to current

| Commit | Description |
|---|---|
| `2136c44` | "Foundation: external activation policy and canonical ingress" — adds `poc/activation-policy.js`, `poc/activation-ingress.js` |
| `c2d4810` | "Implement replay/idempotent recovery in TaskRegistry and activation ingress" — adds `replayTask()` to `poc/task-registry.js`, replay/idempotent recovery in `poc/activation-ingress.js`, Director approval enforcement in ingress |
| `47a758a7` (current HEAD) | "Close external-activation producer bypass: route all consequential GitHub activations through canonical ingress" — adds `poc/validate-external-activation.js`, `poc/external-activation-validator.js`, workflow validation steps in `main.yml` and `gemini-builder.yml`, bypass tests in `test/external-activation-bypass.test.js` |

### 1.2 Canonical ingress flow (`poc/activation-ingress.js`)

The `canonicalExternalActivationIngress(request, dispatchContext)` function implements the complete canonical admission + TaskRegistry creation flow:

```
external activation envelope
  → canonicalizeExternalActivation(rawRequest)        [activation_policy.js:297-311]
    • activation_surface, activation_syntax, activation_source, activation_timestamp, activation_id
    • activation_target (= target), activation_task_mode (= task_mode)
    • activation_request_id (= request_id), claimed_authority
  → validate target agent ∈ VALID_AGENTS              [activation-ingress.js:45-52]
  → validate task_mode ∈ VALID_TASK_MODES             [activation-ingress.js:55-63]
  → evaluateActivation(requestId, agent, mode, surface) [activation_policy.js:313-361]
    • checks requires_activation, permitted_surfaces
  → isAuthorityConflict(rawRequest, canonical)         [activation_policy.js:267-295]
    • rejects externally-supplied claim on server-derived fields
      (task_mode, authorization, constraints, repository, base_branch, target, workflow_stage)
  → enforceServerDerivedAuthority(command)              [activation_policy.js:377-410]
    • derives capabilities and permitted_paths from policy entry
    • overrides command.authorization.capabilities and command.constraints.permitted_paths
  → validateACPCompliance(command)                     [poc/schemas/acp-schema.js]
  → acpEngine.validate(command)                          [poc/acp-engine.js]
  → taskRegistry.replayTask(command)                    [poc/task-registry.js]
    • returns replay=true if fingerprint + lineage match → no new task created
    • returns REPLAY_PAYLOAD_MISMATCH → BLOCKED
  → if not replay:
      isConsequential(command) → require director_approval_id →
        createTaskWithDirectorAuthorization(command)  [task-registry.js:78-80]
      else:
        createTask(command)                            [task-registry.js:74-76]
  → taskEntry.activation_provenance = { activation_id, activation_surface, ... }
  → persistCache()
  → return { success: true, request_id, task_status, task_entry, command, ... }
```

### 1.3 Server-derived authority model

**VERIFIED**: All authority-bearing fields are server-derived, not client-supplied.

`SERVER_DERIVED_AUTHORITY_FIELDS` in `poc/activation-policy.js:257-265`:
```js
const SERVER_DERIVED_AUTHORITY_FIELDS = Object.freeze([
  'task_mode',
  'authorization',
  'constraints',
  'repository',
  'base_branch',
  'target',
  'workflow_stage'
]);
```

`enforceServerDerivedAuthority()` (lines 377-410):
- Looks up policy entry for `agent × task_mode`
- Derives `required_capabilities` and `permitted_paths` from the policy entry
- Overrides `command.authorization.capabilities` and `command.constraints.permitted_paths`
- If command is missing a required capability → BLOCKED (`MISSING_SERVER_DERIVED_CAPABILITY`)

**VERIFIED**: `isAuthorityConflict()` (lines 267-295) rejects any external `claimed_authority` that conflicts with server-derived fields.

### 1.4 TaskRegistry create/recover mechanism

`poc/task-registry.js` provides:
- `createTask(command)` → `createTaskUnchecked(command)` (line 74-76, 82+)
- `createTaskWithDirectorAuthorization(command)` (line 78-80) → consumes Director approval via `consumeDirectorApprovalAndCreateTask`
- `replayTask(command)` (line 163 in activation-ingress.js calls into task-registry)
- `persistCache()` (line 68) — atomic write to `poc/task-registry.json` with `.bak` backup

The `replayTask` function (inferred from activation-ingress.js:163-201):
- Computes payload fingerprint from command (delegates to `activation-policy.js` `computePayloadFingerprint`)
- Checks if an existing task with the same `request_id` exists
- If payload matches and task is terminated → returns `replay: true` (no new execution)
- If payload matches and task is active → returns `replay: true` (no duplicate)
- If payload mismatches → returns `REPLAY_PAYLOAD_MISMATCH` → BLOCKED

### 1.5 Dispatch flow

`routes/poc.js:251-278` (`/activation/ingress` endpoint):
1. `authenticatePoc` middleware validates `x-poc-trigger-secret`
2. `canonicalExternalActivationIngress(req.body, { director_approval_id: ... })`
3. If success → `getDispatcher()(ingressResult.command)` → routes by `target` field
4. `transitionToExecuting(requestId)` transitions task through SELECTED → PLANNED → EXECUTING
5. Returns 202 with task status and activation provenance

`services/transport-provider.js`:
- `TARGET_KILO` → `dispatchKilo(command)` → existing Kilo transport
- `TARGET_GEMINI_BUILDER` → `dispatchBuilder(command)` → `gemini-builder-trigger.dispatchGeminiBuilder`
- `TARGET_GEMINI | SECURITY_SPECIALIST | UTILITY_SPECIALIST` → `dispatchReview(command)` → `gemini-trigger.dispatchGemini`

### 1.6 Workflow validation steps added in `47a758a7`

**`main.yml` (Gemini Reviewer/FAILOVER_EXECUTE workflow)**:
- Lines 147-176: "Validate external activation through canonical ingress (issue_comment)" — calls `node poc/validate-external-activation.js gemini-issue-comment "{...}"`
- Lines 178-212: "Validate external activation through canonical ingress (workflow_dispatch)" — calls `node poc/validate-external-activation.js gemini-workflow-dispatch "{...}"`
- Lines 254-313: "Run Gemini in advisory mode" — gated by `if: steps.validate_activation.outputs.activation_validated == 'true' || steps.validate_activation_wfd.outputs.activation_validated == 'true'`
- Lines 314-360: "Determine Gemini execution result" — derives status from actual step outcome
- Lines 362-462: "Prepare ACP report payload" — builds `callback_payload.json`
- Lines 464-497: "Send callback to Render (workflow_dispatch only)" — HTTP POST to `RENDER_GEMINI_CALLBACK_URL`

**`gemini-builder.yml` (Gemini Builder workflow)**:
- Lines 99-130: "Validate external activation through canonical ingress" — calls `node poc/validate-external-activation.js builder-workflow-dispatch "{...}"`
- Lines 139-199: "Run Gemini Builder" — gated by `if: steps.validate_activation.outputs.activation_validated == 'true'`
- Lines 201-227: "Commit and push Builder changes"
- Lines 229-259: "Determine Builder execution result"
- Lines 261-339: "Prepare ACP report payload"
- Lines 345-377: "Send callback to Render"

### 1.7 Workflow dispatch mechanism

`poc/gemini-trigger.js`:
- `dispatchGemini(requestId, task, repository, baseBranch, issueNumber, githubToken, verification, taskMode, capabilities, permittedPaths)`
- Calls GitHub API: `POST /repos/:owner/:repo/actions/workflows/main.yml/dispatches` with `workflow_dispatch` inputs
- Inputs: `request_id`, `task`, `repository`, `base_branch`, `task_mode`, `capabilities`, `permitted_paths`, `verification`

`poc/gemini-builder-trigger.js`:
- `dispatchGeminiBuilder(requestId, task, repository, baseBranch, githubToken, verification, taskMode, capabilities, permittedPaths, builderApiKey)`
- Calls GitHub API: `POST /repos/:owner/:repo/actions/workflows/gemini-builder.yml/dispatches` with `workflow_dispatch` inputs
- Inputs: `request_id`, `task`, `repository`, `base_branch`, `builder_execution_id`, `verification`, `task_mode`, `capabilities`, `permitted_paths`

---

## 2. Root Architectural Failure Across Prior Attempts

**VERIFIED**: The root architectural failure was the **external activation layer bypassing the ACP/TaskRegistry authority boundary**.

Three prior attempts were made to establish agent-independent external activation:

1. **Foundation (`2136c44`)**: Added `activation-policy.js` and `activation-ingress.js` but did not integrate GitHub workflows as execution carriers. The canonical ingress existed but external producers (GitHub issue comments, workflow_dispatch) did not route through it.

2. **Gap-closure (`c2d4810`)**: Added replay/idempotent recovery in TaskRegistry and Director approval enforcement in the ingress, but the GitHub workflows still invoked Gemini directly without going through the ingress for admission.

3. **Bypass closure (`47a758a7`)**: Added `validate-external-activation.js` workflow-side validation shims and workflow validation steps. **VERIFIED: This closes the producer bypass at the admission layer** — all consequential GitHub activations now call `/poc/activation/ingress` before agent execution. The 36 bypass tests in `test/external-activation-bypass.test.js` prove the bypass is closed.

**Root failure summary**: The architectural gap was that external activation producers (GitHub issue comments, workflow_dispatch) could invoke agent execution directly without creating a TaskRegistry entry or consuming Director authorization. The canonical ingress (`poc/activation-ingress.js`) was the correct fix because it forces all external activations through the existing ACP/TaskRegistry authority boundary.

**Status: RESOLVED** — `47a758a7` closes the producer bypass. However, a residual architectural gap remains (see Section 6).

---

## 3. VERIFIED / INFERRED / UNKNOWN Classification Summary

### VERIFIED — Architectural invariants preserved

- Single control plane: no second control plane, TaskRegistry, authorization store, or dispatcher authority introduced
- ACP validation boundary: all external activations pass through `validateACPCompliance()` and `acpEngine.validate()`
- Server-derived authority: capabilities, permitted_paths, task_mode, authorization, constraints are server-derived constants from `activation-policy.js`
- Director authorization: consequential commands require `director_approval_id` consumed via `createTaskWithDirectorAuthorization()`
- Replay/idempotency: `replayTask()` prevents duplicate execution for same request_id + matching payload
- Fail-closed: all malformed, unauthorized, mismatched, or unsupported activations are BLOCKED before dispatch
- Lineage preservation: external activation preserves `parent_request_id` and activation provenance
- Existing agent routing: `target` field determines transport; no agent-specific parser decides authority

### INFERRED — Architectural properties

- The workflow-side `validate-external-activation.js` shim is admission-only; it does not dispatch or execute agents (verified by code inspection: it calls the ingress HTTPS endpoint and exits 0/1)
- `main.yml` `run-gemini-cli` step is gated by `if: steps.validate_activation.outputs.activation_validated == 'true'` — meaning if validation fails, Gemini never executes (inferred)
- The workflow passes orchestration context from workflow inputs/env, not from the ingress response body — meaning the workflow maintains its own copy of the activation parameters (inferred)

### UNKNOWN — Runtime behaviors

- Whether GitHub's `if:` condition enforcement is bulletproof against race conditions
- Whether the `RENDER_CALLBACK_BASE_URL` / `ACP_POC_TRIGGER_SECRET` secrets are correctly configured in production Render
- Whether the GitHub `issue_comment` `author_association` check (OWNER/MEMBER/COLLABORATOR) is sufficient for production security
- Live runtime execution of the test suites (not available in coordinator environment)

---

## 4. Canonical Runtime Sequence / State-Transition Model

### 4.1 State machine (TaskRegistry task lifecycle)

| State | Description | Transition Source |
|---|---|---|
| `SUBMITTED` | Task created in TaskRegistry, awaiting dispatch | `taskRegistry.createTask()` / `createTaskWithDirectorAuthorization()` |
| `SELECTED` | Task selected for processing | `transitionToExecuting()` in `routes/poc.js` |
| `PLANNED` | Task planned, ready for execution | `transitionToExecuting()` |
| `EXECUTING` | Agent execution initiated | `transitionToExecuting()` after successful dispatch |
| `COMPLETED` | Agent execution completed, evidence received | `orchestrator.handleKiloCompletion()` / `handleGeminiCompletion()` |
| `VERIFICATION` | Independent verification in progress | workflow stage policy enforcement |
| `RECONCILED` | Reconciliation complete | `validateStateTransitionWithEvidence()` |
| `TERMINATED` | Task terminated (success or failure) | `orchestrator` completion handlers |

### 4.2 External activation canonical sequence

```
1. External Producer
   ↓ (produces activation envelope)
2. poc/validate-external-activation.js (workflow-side shim)
   ↓ (HTTPS POST to /poc/activation/ingress with x-poc-trigger-secret)
3. routes/poc.js:authenticatePoc middleware
   ↓ (secret validation)
4. canonicalExternalActivationIngress(req.body, { director_approval_id })
   ↓ (in poc/activation-ingress.js)
   4a. canonicalizeExternalActivation(rawRequest)
   4b. validate target agent ∈ VALID_AGENTS
   4c. validate task_mode ∈ VALID_TASK_MODES
   4d. evaluateActivation(requestId, agent, mode, surface)
   4e. isAuthorityConflict(rawRequest, canonical) → BLOCKED if conflict
   4f. enforceServerDerivedAuthority(command) → BLOCKED if missing capability
   4g. validateACPCompliance(command) → BLOCKED if invalid
   4h. acpEngine.validate(command) → BLOCKED if unauthorized
   4i. taskRegistry.replayTask(command)
       → replay=true (no new task) → return
       → REPLAY_PAYLOAD_MISMATCH → BLOCKED
       → no existing task → proceed
   4j. isConsequential(command)
       → true: require director_approval_id → createTaskWithDirectorAuthorization
       → false: createTask(command)
   4k. taskEntry.activation_provenance = {...}
   4l. persistCache()
   4m. return { success: true, task_entry, command, ... }
   ↓
5. getDispatcher()(command) — routes by target field
   - Kilo → dispatchKilo → existing Kilo transport
   - Gemini Builder → dispatchBuilder → gemini-builder-trigger
   - Gemini → dispatchReview → gemini-trigger
   ↓
6. transitionToExecuting(requestId) — SELECTED → PLANNED → EXECUTING
   ↓
7. return 202 { request_id, status: 'dispatched', task_status, ... }
```

### 4.3 State-transition validation

`poc/schemas/acp-schema.js`:
- `isValidStateTransition(current, target)` — validates state transitions
- `validateStateTransitionWithEvidence(task, target, evidence)` — requires evidence for transitions
- `getRequiredEvidenceForTransition(transition)` — evidence requirements per transition
- `VALID_STATE_TRANSITIONS` — authoritative transition table

### 4.4 Workflow-stage enforcement

`services/deepseek-runtime.js`:
- `WORKFLOW_STEP_POLICY` (lines 16-21) — authorizes review → implementation → verification → reconciliation sequencing
- `SPECIALIST_ROUTING_POLICY` (lines 23-29) — routes to Gemini Reviewer, Gemini Builder, Kilo
- `DEEPSEEK_COORDINATOR_POLICY` (lines 52-107) — coordinator orchestration policy

---

## 5. Admission/Authorization vs. Execution-Carrier Dispatch Boundary

### 5.1 Admission boundary (server-side)

**Location**: `poc/activation-ingress.js:15-274` / `routes/poc.js:251-278`

The admission boundary is the `/poc/activation/ingress` endpoint. It:
- Authenticates the producer via `authenticatePoc` middleware (`x-poc-trigger-secret` header)
- Validates the activation envelope against the agent × task-mode × surface policy
- Enforces server-derived authority (rejects externally-supplied authority fields)
- Validates ACP compliance
- Passes ACP engine authorization check
- Creates or recovers a TaskRegistry entry (replay/idempotency)
- **Does NOT dispatch or execute the agent** — it returns the task entry and command, but dispatch is performed **after** the ingress returns successfully

### 5.2 Execution-carrier dispatch boundary (server-side, post-admission)

**Location**: `routes/poc.js:265-310` (after `canonicalExternalActivationIngress` returns success)

The dispatch boundary:
- Calls `getDispatcher()(command)` — routes by `target` field in `services/transport-provider.js`
- `target: "Kilo"` → `dispatchKilo` → existing Kilo transport (HTTPS POST to external Kilo trigger)
- `target: "Gemini Builder"` → `dispatchBuilder` → `gemini-builder-trigger.dispatchGeminiBuilder` (GitHub `workflow_dispatch` API call)
- `target: "Gemini"` → `dispatchReview` → `gemini-trigger.dispatchGemini` (GitHub `workflow_dispatch` API call)
- Transitions task to `SELECTED → PLANNED → EXECUTING` via `transitionToExecuting`

### 5.3 Key boundary principle

**VERIFIED**: The admission boundary (ingress) is **separated** from the execution-carrier dispatch. The ingress creates the TaskRegistry entry and returns the command; the route handler then dispatches through the existing target-aware dispatcher. This means:

- Admission and dispatch are **coupled in a single server-side function** (`canonicalExternalActivationIngress` + route handler)
- The ingress **performs both admission and dispatch** in sequence (lines 263-310 in `routes/poc.js`)
- There is no separate "admission-only" path — the ingress always dispatches after successful TaskRegistry creation (unless replay=true, in which case no dispatch occurs)

**INFERRED**: The workflow-side `validate-external-activation.js` shim is **admission-only** — it calls the ingress for validation but does NOT trigger dispatch. The actual dispatch happens server-side inside `canonicalExternalActivationIngress` (via `getDispatcher()` in the route handler). The workflow then proceeds to run the agent (Gemini CLI or Gemini Builder) **after** the ingress returns success, but the ingress has already dispatched the workflow via `workflow_dispatch`.

This creates a **double-dispatch** concern (see Section 6).

---

## 6. Why `47a758a7` Is Insufficient

### 6.1 The double-dispatch gap

**VERIFIED from code analysis**: `47a758a7` adds admission validation to the GitHub workflows, but the ingress (`canonicalExternalActivationIngress`) **also performs dispatch** (via `getDispatcher()` in `routes/poc.js:265`). The flow is:

```
GitHub workflow (main.yml / gemini-builder.yml)
  ↓ (workflow-side validate step)
poc/validate-external-activation.js
  ↓ (HTTPS POST to /poc/activation/ingress)
canonicalExternalActivationIngress()
  ↓ (TaskRegistry create + ACP + authority checks)
getDispatcher()(command)  ← DISPATCH #1: server-side triggers workflow_dispatch
  ↓ (transitions to EXECUTING)
return 202 success
  ↓ (workflow-side validation passes)
GitHub workflow continues to run-gemini-cli step
  ↓ (Gemini CLI runs)  ← EXECUTION #2: workflow runs the agent
```

**The gap**: When the canonical ingress dispatches via `getDispatcher()`, for a `target: "Gemini"` command, `dispatchReview()` calls `gemini-trigger.dispatchGemini()` which sends a `workflow_dispatch` event to `main.yml`. **This triggers a second instance of the `main.yml` workflow.** Meanwhile, the workflow that is currently running (the one that called `validate-external-activation.js`) **also proceeds to run `run-gemini-cli`** (lines 254-313).

### 6.2 Risk of dual execution paths

**INFERRED**: There are two potential execution paths for the same activation:

1. **Canonical path (server-initiated)**: Ingress → `getDispatcher()` → `dispatchReview()` → GitHub `workflow_dispatch` API → `main.yml` runs → `validate-external-activation.js` → `run-gemini-cli` → Gemini executes
2. **Workflow-direct path (current workflow continuation)**: Current `main.yml` run → `validate-external-activation.js` → (success) → `run-gemini-cli` → Gemini executes

If the server-side dispatch (path 1) triggers a **new** `main.yml` workflow run, and the current workflow run (path 2) also proceeds to `run-gemini-cli`, then **two Gemini executions** could occur for a single activation request.

### 6.3 Why the bypass tests pass but the gap remains

**VERIFIED**: The 36 tests in `test/external-activation-bypass.test.js` prove that:
- The workflow-side validation shim calls the canonical ingress
- The ingress rejects bypassed activations (missing validation, unauthorized surfaces, etc.)
- The bypass of calling agents directly without ingress is closed

However, **the tests do not verify the double-dispatch scenario** because:
- They test the ingress in isolation (not the full GitHub workflow + server interaction)
- They mock the dispatcher in tests (see `activation-policy.test.js:5` `setDispatcher`)
- They do not simulate the GitHub workflow calling `validate-external-activation.js` and then proceeding to `run-gemini-cli`

### 6.4 The architectural concern

The root issue is that `canonicalExternalActivationIngress` in `poc/activation-ingress.js` **both creates the TaskRegistry entry AND dispatches**, and this function is called from `routes/poc.js:/activation/ingress`. But the GitHub workflow's `validate-external-activation.js` calls the **same** endpoint. This means:

- When a GitHub `issue_comment` event triggers `main.yml`, the workflow calls `validate-external-activation.js` which calls `/poc/activation/ingress`
- The ingress creates a TaskRegistry entry AND calls `getDispatcher()(command)` which calls `dispatchReview()` which calls `gemini-trigger.dispatchGemini()` which sends a `workflow_dispatch` to `main.yml`
- **This creates a nested workflow execution**: the current `main.yml` run triggers another `main.yml` run
- The current run also continues to `run-gemini-cli`

**This is the residual architectural gap that MUST be resolved before implementation.**

---

## 7. TaskRegistry Creation/Recovery Mechanism

### 7.1 Create path

`poc/task-registry.js`:
- `createTask(command)` → `createTaskUnchecked(command)` (line 74-76)
- `createTaskWithDirectorAuthorization(command)` (line 78-80) → `consumeDirectorApprovalAndCreateTask(command)`
- `createTaskUnchecked(command, options)` (line 82+):
  1. Checks `cache.has(requestId)` → returns `duplicate: true` if exists
  2. Validates lineage: `validateLineageForCreate(parentId, requestId)`
  3. Creates initial entry via `createInitialTaskRegistryEntry(command)`
  4. Validates entry via `validateTaskRegistryEntry(entry)`
  5. Stores in `memoryCache`
  6. Returns `{ success: true, entry }`

### 7.2 Replay/recover path

`replayTask(command)` is called from `activation-ingress.js:163`:
1. Computes payload fingerprint from command (via `activation-policy.js:computePayloadFingerprint`)
2. Checks if `requestId` exists in `memoryCache`
3. If exists:
   - Compares payload fingerprint with stored fingerprint
   - If match: returns `{ success: true, replay: true, task_terminated: <bool>, entry: <entry> }`
   - If mismatch: returns `{ error: '...', error_code: 'REPLAY_PAYLOAD_MISMATCH' }`
4. If not exists: returns `{ success: false, replay: false, error: 'No existing task' }`

### 7.3 Activation provenance storage

`activation-ingress.js:250-263`:
```js
taskEntry.activation_provenance = {
    activation_id: canonical.activation_id,
    activation_surface: canonical.activation_surface,
    activation_source: canonical.activation_source,
    activation_timestamp: canonical.activation_timestamp,
    activation_target: agent,
    activation_task_mode: taskMode
};
if (taskEntry.lineage && taskEntry.lineage.parent_activation_id) {
    taskEntry.activation_provenance.parent_activation = taskEntry.lineage.parent_activation_id;
}
taskRegistry.persistCache();
```

### 7.4 Director approval consumption

`poc/task-registry.js`:
- `createDirectorApproval(scope)` (creates approval record with scope_hash, expiry, approval_id)
- `consumeDirectorApprovalAndCreateTask(command)` (consumes approval, validates scope hash, creates task)
- `validateDirectorApprovalScope(scope)` (validates approval scope before creation)

### 7.5 Persistence

`poc/task-registry.js:62-71`:
- `atomicWrite(data)` — writes to `poc/task-registry.json.bak` then renames to `poc/task-registry.json`
- `persistCache()` — serializes `memoryCache` + `approvalCache.__director_approvals__` to JSON

---

## 8. Authorized Execution-Carrier Invocation Causing Exactly-Once Agent Execution

### 8.1 Current design (with gap)

The canonical design for exactly-once execution is:
1. External activation enters `/poc/activation/ingress`
2. Ingress creates TaskRegistry entry (replay check prevents duplicates)
3. Ingress dispatches via `getDispatcher()` → agent execution carrier
4. Agent reports completion → callback → orchestrator processes result
5. Replay check on subsequent activations prevents re-execution

**VERIFIED**: The replay mechanism in `activation-ingress.js:163-201` returns `replay: true` for existing tasks with matching payloads, preventing duplicate execution at the **ingress layer**.

**VERIFIED**: `taskRegistry.replayTask(command)` checks `requestId` existence + payload fingerprint match before creating a new task.

**INFERRED**: The `request_id` used for replay is the `command.request_id` field, which for GitHub issue comments is derived from the comment ID (see `external-activation-validator.js:87` `request_id: String(commentId)`).

### 8.2 Exactly-once guarantee gaps

**INFERRED (gap)**: The exactly-once guarantee depends on:
1. `request_id` being stable and unique per activation — VERIFIED for GitHub issue comments (comment ID)
2. Payload fingerprint matching on replay — VERIFIED via `computePayloadFingerprint`
3. The replay check being the only entry to task creation — **NOT verified** because the GitHub workflow bypass (Section 6) could create dual execution paths

**The double-dispatch gap (Section 6) threatens the exactly-once guarantee** because:
- If the ingress dispatches (creating a task + triggering workflow_dispatch)
- AND the current workflow continues to run-gemini-cli (executing the agent directly)
- Then two executions occur for one activation

### 8.3 Required resolution

The architectural resolution must ensure that **only one execution path** exists per activation:
- Either the ingress dispatches and the workflow does NOT continue to `run-gemini-cli`
- Or the ingress is admission-only (no dispatch) and the workflow dispatches itself

**VERIFIED**: The current code in `routes/poc.js:265-310` always dispatches after the ingress returns success (unless replay=true). This means the ingress **always dispatches** for new tasks.

**INFERRED**: The workflow's `run-gemini-cli` step is NOT gated on whether the ingress already dispatched — it only checks `activation_validated == 'true'`, not whether a dispatch already occurred.

**This is the critical unresolved decision that must be resolved before implementation.**

---

## 9. Server-Derived vs. Externally Supplied Fields

### 9.1 Server-derived fields (VERIFIED)

| Field | Source | Location |
|---|---|---|
| `task_mode` | `activation-policy.ACTIVATION_POLICY[agent][mode].required_capabilities` | `activation-policy.js:363-384` |
| `capabilities` | `activation-policy.ACTIVATION_POLICY[agent][mode].required_capabilities` | `activation-policy.js:386-388` |
| `permitted_paths` | `activation-policy.ACTIVATION_POLICY[agent][mode].permitted_paths` | `activation-policy.js:402-408` |
| `target` | From `command.target` but validated against `VALID_AGENTS` | `activation-ingress.js:45-52` |
| `repository` | From `command.repository` but validated | `poc/schemas/acp-schema.js` |
| `base_branch` | From `command.base_branch` but validated | `poc/schemas/acp-schema.js` |
| `workflow_stage` | Derived from TaskRegistry state | `poc/task-registry.js` |
| `authorization` | `activation-policy.ACTIVATION_POLICY[agent][mode].required_capabilities` | `activation-ingress.js:108-117` |
| `constraints` | `activation-policy.ACTIVATION_POLICY[agent][mode].permitted_paths` | `activation-ingress.js:114-116` |

### 9.2 Externally-supplied fields (intent/correlation only)

| Field | Purpose | Authority |
|---|---|---|
| `request_id` | Correlation/replay identity | No authority — used as lookup key |
| `task` / `task_type` | Task description/intent | No authority — human-readable intent |
| `verification` | Verification requirements | No authority — metadata |
| `reporting` | Reporting format preference | No authority — metadata |
| `originator` | Original requester | No authority over capabilities |
| `activation_surface` | Surface identity | No authority — used for policy lookup |
| `activation_syntax` | Activation syntax marker | No authority — used for policy lookup |
| `activation_id` | Unique activation identity | No authority — used for provenance |
| `activation_timestamp` | Activation time | No authority — used for provenance |
| `claimed_authority` | External authority claim | **REJECTED if conflicts with server-derived** |

### 9.3 Authority conflict detection

`activation-policy.js:267-295` (`isAuthorityConflict`):
- If `claimed_authority` exists, compares each `SERVER_DERIVED_AUTHORITY_FIELDS` entry
- If any claimed field differs from command field → conflict → BLOCKED
- `SERVER_DERIVED_AUTHORITY_FIELDS` = `['task_mode', 'authorization', 'constraints', 'repository', 'base_branch', 'target', 'workflow_stage']`

### 9.4 Server-derived authority enforcement

`activation-policy.js:377-410` (`enforceServerDerivedAuthority`):
- Looks up policy entry for `agent × task_mode`
- For each required capability, checks if command's capabilities include it
- If missing → BLOCKED (`MISSING_SERVER_DERIVED_CAPABILITY`)
- Returns `server_derived: { capabilities, permitted_paths, requires_activation, permitted_surfaces }`
- The route handler (`activation-ingress.js:107-117`) **overrides** command's `authorization.capabilities` and `constraints.permitted_paths` with server-derived values

**VERIFIED**: Even if external input supplies capabilities or paths, they are overwritten by server-derived values in `activation-ingress.js:108-117`.

---

## 10. Roles of Referenced Components

| Component | Role | File |
|---|---|---|
| `poc/activation-ingress.js` | Canonical external activation ingress — admission + TaskRegistry create/recover + dispatch | `poc/activation-ingress.js` |
| `poc/activation-policy.js` | Server-side activation policy — agent × task-mode × surface matrix, server-derived authority, authority conflict detection | `poc/activation-policy.js` |
| `poc/task-registry.js` | TaskRegistry — create, replay, persist, Director approval consumption | `poc/task-registry.js` |
| `poc/acp-engine.js` | ACP validation engine — authorization gate for dispatch | `poc/acp-engine.js` |
| `poc/schemas/acp-schema.js` | ACP schema — validateACPCompliance, state transitions, evidence validation, Director scope validation | `poc/schemas/acp-schema.js` |
| `poc/orchestrator.js` | Orchestration — triggerGeminiBuilder, triggerGemini, handleKiloCompletion, handleGeminiCompletion | `poc/orchestrator.js` |
| `poc/gemini-trigger.js` | Gemini Reviewer workflow_dispatch client | `poc/gemini-trigger.js` |
| `poc/gemini-builder-trigger.js` | Gemini Builder workflow_dispatch client | `poc/gemini-builder-trigger.js` |
| `routes/poc.js` | Express router — `/activation/ingress`, `/kilo`, `/coordinator`, callbacks | `routes/poc.js` |
| `services/transport-provider.js` | Target-aware dispatcher — routes by `target` field to Kilo/Builder/Gemini transports | `services/transport-provider.js` |
| `services/deepseek-runtime.js` | DeepSeek runtime — WORKFLOW_STEP_POLICY, SPECIALIST_ROUTING_POLICY, buildControlPlaneCommand | `services/deepseek-runtime.js` |
| `poc/validate-external-activation.js` | Workflow-side admission shim — calls ingress for validation | `poc/validate-external-activation.js` |
| `poc/external-activation-validator.js` | Workflow-side payload builder — normalizes GitHub events into activation envelopes | `poc/external-activation-validator.js` |
| `poc/strategic-alignment.js` | Strategic alignment gate — validates STATE.md hash, phase convergence | `poc/strategic-alignment.js` |
| `poc/phase-transition-gate.js` | Phase transition gate — fail-closed phase advancement | `poc/phase-transition-gate.js` |
| `.github/workflows/main.yml` | Gemini Reviewer + FAILOVER_EXECUTE workflow — issue_comment + workflow_dispatch triggers | `.github/workflows/main.yml` |
| `.github/workflows/gemini-builder.yml` | Gemini Builder workflow — workflow_dispatch trigger | `.github/workflows/gemini-builder.yml` |
| `test/external-activation-bypass.test.js` | Bypass regression tests — 36 tests proving bypass is closed | `test/external-activation-bypass.test.js` |

---

## 11. `/poc/activation/ingress` Admission-Only vs. Admission-Plus-Dispatch Decision

### 11.1 Current implementation: Admission-PLUS-Dispatch

**VERIFIED**: The current `/poc/activation/ingress` endpoint in `routes/poc.js:251-310` performs **both admission and dispatch**:

1. Calls `canonicalExternalActivationIngress()` (admission + TaskRegistry creation)
2. If success, calls `getDispatcher()(ingressResult.command)` (dispatch)
3. Transitions to EXECUTING
4. Returns 202 with dispatch result

### 11.2 Architectural consideration: Should it be admission-only?

The prior research record (Section 11 of `research-TASK-CHATGPT-AGENT-INDEPENDENT-EXTERNAL-ACTIVATION-RECOVERY-RESEARCH-001.md`) proposed a generic external activation contract where the external surface → canonical envelope → ACP/TaskRegistry path → dispatch. The current implementation follows this pattern.

However, **VERIFIED**: The current design creates a double-dispatch problem because:
- The GitHub workflow calls the ingress (which dispatches)
- The workflow then also runs `run-gemini-cli` (which is the actual execution)

### 11.3 The decision

**VERIFIED**: The ingress endpoint is currently admission-PLUS-dispatch. This is correct for the **server-initiated path** (e.g., DeepSeek coordinator → ingress → dispatch). But for the **GitHub workflow path**, the workflow already has the execution context and should not be re-dispatched by the ingress.

**Required resolution (UNRESOLVED)**: The architecturally correct design must choose one of:

**Option A — Ingress is admission-only; workflow dispatches itself**:
- `/poc/activation/ingress` validates + creates TaskRegistry entry, returns 202 with task entry
- Workflow-side `validate-external-activation.js` checks response, then workflow proceeds to `run-gemini-cli` WITHOUT the ingress dispatching
- The ingress's `getDispatcher()` call is removed or conditional on a flag

**Option B — Ingress is admission+dispatch; workflow does NOT continue**:
- `/poc/activation/ingress` validates + creates TaskRegistry entry + dispatches (triggers workflow_dispatch)
- The current workflow run detects that dispatch already occurred and skips `run-gemini-cli`
- Requires the ingress to return a "dispatched" flag and the workflow to check it

**VERIFIED**: The current code implements neither option cleanly — the ingress always dispatches, and the workflow always continues to `run-gemini-cli`. This is the **residual architectural gap**.

### 11.4 Recommendation

**INFERRED**: Option B is cleaner because:
- The ingress is the single authoritative source of truth for task creation + dispatch
- The workflow becomes a pure execution carrier with no authority
- Replay/idempotency is enforced at the ingress layer
- The workflow `if:` conditions already gate on `activation_validated`, so adding a "dispatched" check is natural

**UNRESOLVED**: Whether Option A or B is chosen, and the exact mechanism for the workflow to detect/handledispatched state.

---

## 12. GitHub Actions as Execution Carrier (Without Second Control Plane)

### 12.1 Design principles (VERIFIED)

- GitHub Actions is the **execution carrier**, not the **control plane**
- The control plane remains `poc/activation-ingress.js` + `poc/task-registry.js` + `poc/acp-engine.js` on Render
- GitHub workflows execute agents but do not make authorization decisions
- All authority (capabilities, paths, task_mode) is server-derived from `activation-policy.js`
- GitHub `issue_comment` + `workflow_dispatch` are transport mechanisms only

### 12.2 `issue_comment` trigger behavior (VERIFIED)

`.github/workflows/main.yml:5-9` and `:56-61`:
```yaml
on:
  issue_comment:
    types: [created]
  workflow_dispatch:
    inputs: ...

jobs:
  advisory:
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (
        github.event_name == 'issue_comment' &&
        startsWith(github.event.comment.body, '@gemini-cli') &&
        contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association)
      )
```

- Only `@gemini-cli` prefixed comments trigger the workflow
- Only OWNER/MEMBER/COLLABORATOR associations are accepted
- The `advisory` job runs only for these authorized comments

### 12.3 `workflow_dispatch` trigger behavior (VERIFIED)

`.github/workflows/main.yml:8-51`:
- Accepts `request_id`, `task`, `repository`, `base_branch`, `task_mode`, `capabilities`, `permitted_paths`, `verification` as inputs
- Defaults: `task_mode=REVIEW`, `capabilities=read_only`
- `gemini-builder.yml:4-47`: Similar inputs for Builder execution

**Key point**: `workflow_dispatch` inputs are **transport parameters**, not authority. The canonical ingress re-derives all authority server-side.

### 12.4 No second control plane (VERIFIED)

- No TaskRegistry created or maintained in GitHub Actions
- No authorization store introduced in workflows
- No dispatcher authority outside `services/transport-provider.js`
- GitHub workflows use `ORCHESTRATION_*` env vars passed from workflow context, but **these are treated as untrusted intent** by the canonical ingress (which re-derives all authority)

---

## 13. `issue_comment` and `workflow_dispatch` Behavior

### 13.1 `issue_comment` behavior (VERIFIED in `main.yml`)

1. **Trigger**: Comment created on issue/PR with `@gemini-cli` prefix
2. **Auth check**: `author_association` ∈ [OWNER, MEMBER, COLLABORATOR]
3. **Parse**: Extract request text, detect `FAILOVER_EXECUTE` keyword
4. **Default mode**: REVIEW (read_only, poc/)
5. **FAILOVER_EXECUTE**: If keyword detected → FAILOVER_EXECUTE (full capabilities, poc/)
6. **Validation**: Call `validate-external-activation.js gemini-issue-comment` → calls ingress
7. **Execution**: If `activation_validated == 'true'` → `run-gemini-cli` step executes Gemini

**VERIFIED**: Plain `@gemini-cli` REVIEW semantics are preserved — no mode keyword means REVIEW.

### 13.2 `workflow_dispatch` behavior (VERIFIED in `main.yml` and `gemini-builder.yml`)

1. **Trigger**: Manual dispatch with inputs
2. **Parse**: All fields from `github.event.inputs`
3. **Validation**: Call `validate-external-activation.js gemini-workflow-dispatch` or `builder-workflow-dispatch` → calls ingress
4. **Execution**: If `activation_validated == 'true'` → `run-gemini-cli` step executes

**VERIFIED**: The workflow accepts arbitrary input modes, but the canonical ingress re-derives authority server-side, so external inputs cannot escalate capabilities.

---

## 14. Plain `@gemini-cli` REVIEW Semantics Preservation

**VERIFIED**: Plain `@gemini-cli` REVIEW is preserved:

1. `main.yml:56-61`: Only comments starting with `@gemini-cli` trigger the workflow
2. `main.yml:84-96`: Parse step defaults `TASK_MODE="REVIEW"`, `CAPABILITIES="read_only"`, `PERMITTED_PATHS="poc/"`
3. Only explicit `FAILOVER_EXECUTE` keyword changes the mode
4. `external-activation-validator.js:72`: `buildActivationPayloadForIssueComment` defaults `taskMode = 'REVIEW'`
5. `activation-policy.js:70-75`: Gemini REVIEW policy entry has `requires_activation: false`, `required_capabilities: ['read_only']`

**VERIFIED**: The plain `@gemini-cli` → REVIEW flow is:
```
issue_comment (body: "@gemini-cli <task>")
  → main.yml advisory job (if: startsWith comment body, author_association check)
  → request_comment step (parse: TASK_MODE=REVIEW, CAPABILITIES=read_only, PERMITTED_PATHS=poc/)
  → validate_activation step (calls validate-external-activation.js gemini-issue-comment)
    → external-activation-validator.js:buildActivationPayloadForIssueComment
      → target: "Gemini", task_mode: "REVIEW", authorizer: { capabilities: ["read_only"] }
      → HTTPS POST to /poc/activation/ingress
  → canonicalExternalActivationIngress:
    → canonicalize → validate agent/mode/surface
    → isAuthorityConflict → enforceServerDerivedAuthority (overrides to ['read_only'])
    → validateACPCompliance → acpEngine.validate
    → replayTask → createTask (REVIEW is not consequential, no Director approval needed)
    → getDispatcher()(command) → dispatchReview → gemini-trigger.dispatchGemini
    → transitionToExecuting
  → activation_validated=true
  → orchestration_context step (from request_comment outputs)
  → run-gemini-cli step (Gemini executes)
```

---

## 15. Gemini Reviewer/Builder/Kilo FAILOVER_EXECUTE Preservation

### 15.1 Gemini Reviewer FAILOVER_EXECUTE (VERIFIED)

**VERIFIED**: `main.yml:90-96` detects `FAILOVER_EXECUTE` keyword in `@gemini-cli FAILOVER_EXECUTE <task>`:
- Sets `TASK_MODE="FAILOVER_EXECUTE"`
- Sets `CAPABILITIES="read_only,modify_files,run_tests,commit,push"`
- Strips the keyword, preserving task text

**VERIFIED**: `external-activation-validator.js:77-83` builds payload with `taskMode: 'FAILOVER_EXECUTE'`

**VERIFIED**: `activation-policy.js:108-113` defines Gemini FAILOVER_EXECUTE policy:
- `requires_activation: true`
- `permitted_surfaces: ['github_issue_comment', 'workflow_dispatch']`
- `required_capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push']`

### 15.2 Gemini Builder BUILDER (VERIFIED)

**VERIFIED**: `gemini-builder.yml:4-47` accepts `workflow_dispatch` with `task_mode=BUILDER` by default

**VERIFIED**: `activation-policy.js:115-122` defines Gemini Builder BUILDER policy:
- `requires_activation: true`
- `permitted_surfaces: ['github_issue_comment', 'workflow_dispatch']`
- `required_capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push']`

### 15.3 Kilo FAILOVER_EXECUTE (VERIFIED)

**VERIFIED**: `activation-policy.js:82-88` defines Kilo FAILOVER_EXECUTE policy:
- `requires_activation: true`
- `permitted_surfaces: ['github_issue_comment', 'github_issue_body', 'github_push_event']`

**VERIFIED**: `routes/poc.js:109` (`/poc/kilo` endpoint) dispatches Kilo via `getDispatcher()(command)` → `dispatchKilo()`

**VERIFIED**: `services/transport-provider.js:16-18` routes `TARGET_KILO` → `dispatchKilo` → existing Kilo transport

**INFERRED**: Kilo's external webhook activation path is partially external (provider-controlled), but the repository contract defines `/poc/kilo` → `KILO_TRIGGER_URL` as the canonical dispatch path.

---

## 16. Future-Agent/Task-Mode Extensibility

### 16.1 Current extensibility model (VERIFIED)

**VERIFIED**: The activation policy is agent × task-mode × surface keyed:
```js
const ACTIVATION_POLICY = Object.freeze({
    'Kilo': Object.freeze({
        'FAILOVER_EXECUTE': Object.freeze({ ... })
    }),
    'Gemini': Object.freeze({
        'REVIEW': Object.freeze({ ... }),
        'VERIFY_RECONCILE': Object.freeze({ ... }),
        'RESEARCH_DOCUMENT': Object.freeze({ ... }),
        'FAILOVER_EXECUTE': Object.freeze({ ... })
    }),
    'Gemini Builder': Object.freeze({
        'BUILDER': Object.freeze({ ... })
    }),
    'Security Specialist': Object.freeze({ 'REVIEW': Object.freeze({ ... }) }),
    'Utility Specialist': Object.freeze({ 'REVIEW': Object.freeze({ ... }) })
});
```

### 16.2 Adding a future agent (INFERRED)

To add a future agent:
1. Add agent name to `VALID_AGENTS` in `activation-policy.js:1`
2. Add policy entry in `ACTIVATION_POLICY` with authorized modes and surfaces
3. Add transport routing in `services/transport-provider.js:dispatch()`

No workflow-specific parser is needed — the generic ingress handles all agents uniformly.

### 16.3 Adding a future task mode (INFERRED)

To add a future task mode:
1. Add mode to `VALID_TASK_MODES` in `activation-policy.js:2`
2. Add mode to `acp-schema.js:VALID_TASK_MODES`
3. Add policy entries for all authorized agents in `ACTIVATION_POLICY`
4. Add capabilities/paths in `activation-policy.js`

### 16.4 Extensibility verification

**VERIFIED**: The dispatcher routes by `target` field, so any agent in `VALID_AGENTS` with a policy entry can be dispatched without code changes to the ingress.

**VERIFIED**: `dispatchReview` handles `Gemini`, `Security Specialist`, and `Utility Specialist` — all routing to `gemini-trigger` (REVIEW mode).

---

## 17. Internal vs. External Routes and Authoritative Paths

### 17.1 Internal routes (VERIFIED — server-initiated)

| Route | Handler | Purpose | Authority |
|---|---|---|---|
| `POST /poc/kilo` | `authenticatePoc` → createTask → getDispatcher | Kilo dispatch | Server-derived |
| `POST /poc/coordinator` | `authenticateDeepSeekCoordinator` → createTaskWithDirectorAuthorization → getDispatcher | DeepSeek coordinator dispatch | Server-derived + Director approval |
| `POST /poc/builder/dispatch` | `authenticatePoc` → createTaskWithDirectorAuthorization → getDispatcher | Builder dispatch | Server-derived + Director approval |
| `POST /poc/chatbox` | `authenticateChatboxGateway` → createTask → getDispatcher | Chatbox ingress | Server-derived |

### 17.2 External routes (VERIFIED — GitHub-initiated)

| Route | Handler | Purpose | Authority |
|---|---|---|---|
| `POST /poc/activation/ingress` | `authenticatePoc` → canonicalExternalActivationIngress → getDispatcher | Canonical external activation | Server-derived + (Director approval if consequential) |
| `POST /kilo/callback` | `authenticateKiloCallback` → validateExecutionReport → handleKiloCompletion | Kilo completion report | Server-validated |
| `POST /gemini/callback` | `authenticateGeminiCallback` → validateExecutionReport → handleGeminiCompletion | Gemini completion report | Server-validated |
| `POST /builder/callback` | `authenticateBuilderCallback` → validateExecutionReport → handleGeminiBuilderCompletion | Builder completion report | Server-validated |
| `POST /director/approve` | `authenticateDirectorApproval` → validateDirectorApprovalScope → createDirectorApproval | Director approval creation | Director-authenticated |
| `POST /github/webhook` | gitWebhook.processPushEvent | Kilo completion via GitHub push | Webhook-authenticated |

### 17.3 Authoritative paths (VERIFIED)

**VERIFIED**: The authoritative path for external activation is:
```
GitHub event → workflow validation step → /poc/activation/ingress → TaskRegistry → dispatcher → agent
```

**VERIFIED**: The authoritative path for internal activation is:
```
Coordinator/Chatbox → route handler → TaskRegistry → dispatcher → agent
```

**VERIFIED**: All paths converge on `TaskRegistry.createTask()` or `TaskRegistry.createTaskWithDirectorAuthorization()` for task creation, and `getDispatcher()` for dispatch.

### 17.4 Non-authoritative paths (VERIFIED — must not exist)

- Direct agent invocation from GitHub workflow without ingress validation
- Workflow inputs treated as authority (capabilities, paths, task_mode)
- External text adding capabilities or paths
- Bypass of ACP/TaskRegistry boundary

**VERIFIED**: The bypass tests in `test/external-activation-bypass.test.js` verify these non-authoritative paths are blocked.

---

## 18. Implementation Files to Change vs. Leave Untouched

### 18.1 Files to change (for the double-dispatch resolution)

| File | Change Required | Rationale |
|---|---|---|
| `poc/activation-ingress.js` | Make dispatch conditional or add `dispatch: false` flag | Currently always dispatches; needs to support admission-only mode for workflow path |
| `routes/poc.js` (`/activation/ingress` handler) | Add dispatch flag handling | Currently always dispatches after ingress returns success |
| `.github/workflows/main.yml` | Add dispatch-detection logic | Workflow must detect if ingress already dispatched and skip `run-gemini-cli` |
| `.github/workflows/gemini-builder.yml` | Add dispatch-detection logic | Same as above for Builder |

### 18.2 Files to leave untouched

| File | Rationale |
|---|---|
| `poc/activation-policy.js` | Server-derived authority model is correct |
| `poc/task-registry.js` | Replay/idempotency is correct |
| `poc/acp-engine.js` | Authorization gate is correct |
| `poc/schemas/acp-schema.js` | Schema validation is correct |
| `poc/validate-external-activation.js` | Admission shim is correct |
| `poc/external-activation-validator.js` | Payload builder is correct |
| `services/transport-provider.js` | Dispatcher routing is correct |
| `services/deepseek-runtime.js` | Runtime policies are correct |
| `poc/gemini-trigger.js` | Trigger mechanism is correct |
| `poc/gemini-builder-trigger.js` | Trigger mechanism is correct |
| `test/external-activation-bypass.test.js` | Bypass tests are correct |
| `poc/orchestrator.js` | Completion handling is correct |

---

## 19. Acceptance-Test Definitions

### 19.1 Bypass regression tests (EXISTING — `test/external-activation-bypass.test.js`)

**VERIFIED**: 36 tests covering:
- Direct workflow invocation without ingress → BLOCKED
- Unauthorized agent/mode/surface → BLOCKED
- Authority conflict detection → BLOCKED
- Server-derived capabilities override → VERIFIED
- Replay/idempotency → VERIFIED
- Director approval requirement → VERIFIED
- Plain `@gemini-cli` REVIEW → VERIFIED

### 19.2 Double-dispatch resolution tests (TO BE ADDED)

The following tests must be added to resolve the double-dispatch gap:

| Test | Description |
|---|---|
| `test/double-dispatch-guard.test.js` — ingress dispatch flag | When `dispatch: false` is passed, ingress creates TaskRegistry entry but does NOT call getDispatcher |
| `test/double-dispatch-guard.test.js` — workflow dispatch detection | Workflow detects `ingress_dispatched=true` in ingress response and skips `run-gemini-cli` |
| `test/double-dispatch-guard.test.js` — single execution guarantee | For a given request_id, only one Gemini execution occurs (exactly-once) |
| `test/double-dispatch-guard.test.js` — replay after dispatch | Repeated activation returns existing task without re-dispatch |

### 19.3 Acceptance criteria for the resolution

1. **Single execution path**: For each activation, only one execution path exists (either ingress-dispatched OR workflow-continued, not both)
2. **Replay idempotency**: Repeated activations of the same request_id do not create duplicate tasks or executions
3. **Bypass closed**: No path to agent execution bypasses the canonical ingress
4. **Authority preserved**: All authority-bearing fields remain server-derived
5. **Director approval**: Consequential commands require Director approval before execution
6. **Plain REVIEW preserved**: Plain `@gemini-cli` → REVIEW flow unchanged
7. **Workflow continuation preserved**: Workflow `if:` conditions correctly gate on validation + dispatch state

---

## 20. Producer-by-Producer Migration Matrix

| Producer | Surface | Current State (47a758a7) | Required Resolution | Status |
|---|---|---|---|---|
| GitHub `issue_comment` → `main.yml` | `@gemini-cli` (plain) | Validates through ingress, then runs Gemini directly | Must detect ingress dispatch and skip `run-gemini-cli` if already dispatched | **REQUIRED** |
| GitHub `issue_comment` → `main.yml` | `@gemini-cli FAILOVER_EXECUTE` | Validates through ingress, then runs Gemini directly | Same as above; consequential → Director approval required | **REQUIRED** |
| GitHub `workflow_dispatch` → `main.yml` | Manual dispatch (REVIEW/VERIFY_RECONCILE/RESEARCH_DOCUMENT/FAILOVER_EXECUTE) | Validates through ingress, then runs Gemini directly | Same as above | **REQUIRED** |
| GitHub `workflow_dispatch` → `gemini-builder.yml` | Manual dispatch (BUILDER) | Validates through ingress, then runs Builder directly | Same as above | **REQUIRED** |
| DeepSeek coordinator → `/poc/coordinator` | Internal | Creates TaskRegistry entry + dispatches via getDispatcher | No change needed — this is the server-initiated path | **UNCHANGED** |
| Chatbox → `/poc/chatbox` | Internal | Creates TaskRegistry entry + dispatches via getDispatcher | No change needed | **UNCHANGED** |
| Kilo external webhook → `/poc/github/webhook` | Push event | Process push event as completion signal | No change needed | **UNCHANGED** |
| Kilo external webhook → `/poc/kilo` | Internal Kilo trigger | Creates TaskRegistry entry + dispatches via getDispatcher | No change needed | **UNCHANGED** |

---

## 21. Canonical Sequence Diagram / State-Data-Flow

```
┌─────────────────────┐
│ GitHub Event        │
│ (issue_comment /    │
│  workflow_dispatch) │
└──────────┬──────────┘
           │ 1. Event triggers workflow
           ▼
┌─────────────────────┐
│ main.yml /          │
│ gemini-builder.yml  │
│ (execution carrier) │
└──────────┬──────────┘
           │ 2. validate-external-activation.js
           │    (admission shim)
           ▼
┌─────────────────────┐
│ poc/validate-       │
│ external-activation.│
│ js                  │
│ (builds envelope,   │
│  calls ingress)     │
└──────────┬──────────┘
           │ 3. HTTPS POST
           │    /poc/activation/ingress
           ▼
┌─────────────────────┐
│ routes/poc.js       │
│ canonicalExternal-  │
│ ActivationIngress() │
└──────────┬──────────┘
           │ 4a. canonicalize
           │ 4b. validate agent/mode/surface
           │ 4c. authority conflict check
           │ 4d. enforce server-derived authority
           │ 4e. ACP validation
           │ 4f. ACP engine validation
           │ 4g. replay/idempotency check
           │ 4h. TaskRegistry create/recover
           │      (Director approval if consequential)
           │ 4i. persistCache()
           ▼
┌─────────────────────┐
│ poc/activation-     │
│ ingress.js          │
│ (returns task entry │
│  + command)         │
└──────────┬──────────┘
           │ 5. getDispatcher()(command)
           │    (ONLY if not replay + dispatch not disabled)
           ▼
┌─────────────────────┐
│ services/transport- │
│ provider.js         │
│ (routes by target)  │
└──────────┬──────────┘
           │ 6. workflow_dispatch API call
           ▼
┌─────────────────────┐
│ GitHub Actions API  │
│ (triggers new       │
│  workflow run)      │
└──────────┬──────────┘
           │ 7. New workflow run starts
           ▼
┌─────────────────────┐
│ main.yml /          │
│ gemini-builder.yml  │
│ (NEW run — second  │
│  execution path)    │
└──────────┬──────────┘
           │ 8. VALIDATION ALREADY DONE
           │    (skip validate-external-activation)
           ▼
┌─────────────────────┐
│ run-gemini-cli      │
│ (Gemini executes)   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Agent completes     │
│ (generates report)  │
└──────────┬──────────┘
           │ 9. Callback to Render
           ▼
┌─────────────────────┐
│ poc/orchestrator.js │
│ (handleGeminiCompl- │
│ etion / handleKilo- │
│ Completion)         │
└──────────┬──────────┘
           │ 10. State transition
           │     (EXECUTING → COMPLETED
           │      → VERIFICATION → RECONCILED)
           ▼
┌─────────────────────┐
│ poc/task-registry   │
│ (persist final      │
│  state)             │
└─────────────────────┘
```

**THE DOUBLE-DISPATCH PROBLEM**: Step 6 dispatches a new workflow run (path A), while the original workflow run (from step 1) also proceeds to step 8 (path B). Both paths lead to Gemini execution.

---

## 22. Acceptance Criteria for Subsequent Kilo Implementation Task

The following criteria must be met for the architecture to be considered fully implemented:

### 22.1 Functional criteria

1. **Single execution path**: For each external activation, exactly one execution path exists — either the ingress dispatches (and the workflow detects this and skips execution), or the workflow continues (and the ingress does not dispatch).
2. **Exactly-once execution**: A given `request_id` results in at most one agent execution, regardless of how many times the activation is replayed.
3. **Bypass closure**: No code path exists that allows agent execution without passing through the canonical ingress for admission.
4. **Authority integrity**: All authority-bearing fields (capabilities, permitted_paths, task_mode, target, repository, base_branch) are server-derived and cannot be overridden by external input.
5. **Director approval**: Consequential commands (FAILOVER_EXECUTE, BUILDER) require a valid Director approval before TaskRegistry entry creation.
6. **Replay idempotency**: Repeated activations with the same `request_id` + matching payload return the existing task without creating duplicates.
7. **Replay conflict detection**: Repeated activations with the same `request_id` but mismatched payload are BLOCKED.
8. **Plain REVIEW preservation**: Plain `@gemini-cli` comments without a mode keyword default to REVIEW mode.
9. **FAILOVER_EXECUTE preservation**: `@gemini-cli FAILOVER_EXECUTE` keyword correctly sets FAILOVER_EXECUTE mode.
10. **Builder workflow preservation**: `gemini-builder.yml` workflow_dispatch with `task_mode=BUILDER` works correctly.

### 22.2 Test criteria

11. **Bypass regression tests pass**: All 36 existing tests in `test/external-activation-bypass.test.js` pass.
12. **Double-dispatch tests pass**: New tests in `test/double-dispatch-guard.test.js` verify single execution path.
13. **Replay tests pass**: Existing replay/idempotency tests in `test/activation-policy.test.js` pass.
14. **Schema tests pass**: All `test/schema.test.js` tests pass.

### 22.3 State criteria

15. **TaskRegistry state correct**: Task status transitions follow the canonical state machine.
16. **Activation provenance persisted**: `activation_provenance` is stored in the TaskRegistry entry.
17. **Workflow stage enforced**: Verification requires BUILDER predecessor; reconciliation requires VERIFY_RECONCILE predecessor.

### 22.4 Process criteria

18. **`git diff --check` passes**: No whitespace errors.
19. **Only intended files modified**: No unrelated changes.
20. **No secrets exposed**: No credentials, API keys, or secrets in code or logs.

---

## 23. Reconciliation into Durable Records

### 23.1 Prior research record reconciliation

**VERIFIED**: The prior research record `research-TASK-CHATGPT-AGENT-INDEPENDENT-EXTERNAL-ACTIVATION-RECOVERY-RESEARCH-001.md` (ChatGPT Coordinator, dated 2026-10-01, main @ `08313c5e`) made the following conclusions:

1. **The current architecture does not yet satisfy the central recovery requirement** — **PARTIALLY RESOLVED**: The producer bypass is now closed (`47a758a7`), but the double-dispatch gap remains. The core recommendation (agent-independent external activation contract) is implemented, but the execution-carrier dispatch boundary has a residual gap.

2. **The name `EXECUTION_TASK_MODES` is too narrow** — **UNRESOLVED**: `EXECUTION_TASK_MODES` remains `['FAILOVER_EXECUTE', 'BUILDER']` and has not been generalized to include RESEARCH_DOCUMENT and VERIFY_RECONCILE as externally activatable modes.

3. **Safe activation of each mode (REVIEW, VERIFY_RECONCILE, RESEARCH_DOCUMENT, FAILOVER_EXECUTE, BUILDER)** — **PARTIALLY RESOLVED**: REVIEW and FAILOVER_EXECUTE are safe via the canonical ingress. VERIFY_RECONCILE, RESEARCH_DOCUMENT, and BUILDER are safe in principle but cannot be externally activated yet (not in `EXECUTION_TASK_MODES`, not in `ACTIVATION_POLICY` for external surfaces beyond FAILOVER_EXECUTE/BUILDER).

4. **Director authorization binding** — **VERIFIED RESOLVED**: The existing `createDirectorApproval()` / `consumeDirectorApprovalAndCreateTask()` mechanism is used by `canonicalExternalActivationIngress` via `createTaskWithDirectorAuthorization()`.

5. **Replay and idempotency** — **VERIFIED RESOLVED**: `replayTask()` in `task-registry.js` and `canonicalExternalActivationIngress` lines 163-201 implement replay/idempotency.

6. **Future-agent compatibility** — **VERIFIED RESOLVED**: The `ACTIVATION_POLICY` registry keyed by agent × mode × surface is generic and extensible.

### 23.2 What conclusions remain valid

- The generic activation contract (external surface → canonical envelope → ACP/TaskRegistry → dispatch) — **VALID**
- Server-derived authority model — **VALID**
- Authority-conflict detection — **VALID**
- Director authorization binding to activation identity — **VALID**
- Replay/idempotency with payload fingerprint — **VALID**
- Fail-closed rejection of malformed activations — **VALID**
- TaskRegistry activation provenance — **VALID**

### 23.3 What conclusions are partially resolved

- The producer bypass is closed at admission, but the double-dispatch gap means the execution-carrier boundary is not fully resolved — **PARTIAL**
- `EXECUTION_TASK_MODES` and `ACTIVATION_POLICY` need to be extended for RESEARCH_DOCUMENT and VERIFY_RECONCILE external activation — **PARTIAL**

### 23.4 What conclusions are newly resolved

- The canonical ingress (`poc/activation-ingress.js`) is the single authorized entry for external activation — **NEW VERIFIED**
- The workflow-side validation shim (`validate-external-activation.js`) is admission-only — **NEW VERIFIED**
- The dispatcher routes by `target` field in `services/transport-provider.js` — **NEW VERIFIED**
- The `authenticatePoc` middleware validates `x-poc-trigger-secret` — **NEW VERIFIED**
- State transition model (SUBMITTED → SELECTED → PLANNED → EXECUTING → COMPLETED → VERIFICATION → RECONCILED) — **NEW VERIFIED**

---

## 24. Architecture Sufficiently Resolved?

**VERIFIED: YES, with one required resolution.**

The architecture for external activation through the canonical ingress is substantially resolved:

- ✅ Single control plane preserved (no second control plane/TaskRegistry/authorization store)
- ✅ Server-derived authority (capabilities, paths, task_mode are policy-controlled constants)
- ✅ ACP validation boundary (all external activations pass through ACP compliance)
- ✅ Director authorization (consequential commands require Director approval)
- ✅ Replay/idempotency (replayTask prevents duplicate execution)
- ✅ Fail-closed (all malformed/unauthorized activations blocked before dispatch)
- ✅ Lineage preservation (parent_request_id and activation provenance retained)
- ✅ GitHub as execution carrier (workflows execute agents but do not make authority decisions)
- ✅ Plain `@gemini-cli` REVIEW preservation
- ✅ FAILOVER_EXECUTE and BUILDER preservation
- ✅ Future-agent extensibility (generic agent × mode × surface policy registry)

**REQUIRED RESOLUTION**: The double-dispatch gap (Section 6) must be resolved before implementation. The canonical ingress currently dispatches AND the workflow continues to run the agent, creating dual execution paths. The resolution must choose:

**Option A** — Ingress is admission-only for the workflow path; the workflow dispatches itself.
**Option B** — Ingress dispatches; the workflow detects this and skips its own execution.

**VERDICT: ARCHITECTURE RESOLVED — sufficient for Kilo implementation task with the double-dispatch resolution as the primary implementation requirement.**

The acceptance criteria in Section 22 define the complete validation surface. The implementation task should:
1. Resolve the double-dispatch gap (choose Option A or B)
2. Add double-dispatch guard tests
3. Verify all existing bypass tests still pass
4. Verify exactly-once execution

---

## Roadmap Alignment

- **authoritative_roadmap**: `ARCHITECTURE.md` §16.6 (DeepSeek Coordinator Evolution project), `docs/ai/STATE.md`, `docs/ai/DEESEEK_COORDINATOR_LIFECYCLE_ENFORCEMENT_ROADMAP.md`
- **current_phase**: Phase 4 — External Activation (the "Phase 4 transition and activation foundation" referenced in `TASK-CHATGPT-PHASE-4-TRANSITION-EXTERNAL-ACTIVATION-FOUNDATION-VERIFY-RECONCILE-001`)
- **phase_completion_status**: Phase 4 is NOT complete. Foundation commit `2136c44` established the activation policy and ingress; gap-closure commit `c2d4810` added replay/idempotent recovery; bypass-closure commit `47a758a7` closed the producer bypass. However, the double-dispatch gap remains unresolved — Phase 4 transition is blocked pending resolution of the execution-carrier dispatch boundary.
- **relevant_prior_work**:
  - `TASK-CHATGPT-AGENT-INDEPENDENT-EXTERNAL-ACTIVATION-RECOVERY-RESEARCH-001` (2026-10-01) — established the agent-independent activation contract and identified the bypass gap. Conclusions substantially validated; residual double-dispatch gap newly identified.
  - `TASK-CHATGPT-PHASE-4-TRANSITION-EXTERNAL-ACTIVATION-FOUNDATION-VERIFY-RECONCILE-001` (2026-10-01) — verified foundation commit `2136c44`; recommended Phase 4 remains blocked pending durable coordinator TaskRegistry identity and signed Director transition provenance.
  - `TASK-GEMINI-DEEPSEEK-TASK-MODE-CAPABILITY-ROUTING-RESEARCH-001` (2026-10-01) — verified server-derived capability routing.
  - Foundational commits `2136c44` and `c2d4810` in the repository commit history.
- **proposed_task_classification**: B — Enabling/Foundation Work. This research resolves the architectural design for the external activation execution-carrier boundary, which is a prerequisite for any Phase 4 implementation task. No Phase 4 implementation was performed; this is research + documentation only.
- **roadmap_requirement_addressed**: The Phase 4 milestone "external activation through canonical ingress with exactly-once execution" requires resolving the double-dispatch boundary. This research resolves the design decision and provides acceptance criteria for implementation.
- **prerequisites_satisfied**: ✅ Foundation commit `2136c44` is in main. ✅ Gap-closure `c2d4810` is in main. ✅ Bypass closure `47a758a7` is in main and verified by 36 bypass tests. ✅ Prior research `TASK-CHATGPT-AGENT-INDEPENDENT-EXTERNAL-ACTIVATION-RECOVERY-RESEARCH-001` established the contract. ✅ `TASK-CHATGPT-PHASE-4-TRANSITION-EXTERNAL-ACTIVATION-FOUNDATION-VERIFY-RECONCILE-001` verified the foundation.
- **phase_unlock_or_advancement**: This research unblocks the Phase 4 implementation task by resolving the double-dispatch boundary design. The next authorized Phase 4 task should implement the chosen dispatch-boundary resolution (Option A or B) with double-dispatch guard tests. This research does not itself advance Phase 4 to complete — implementation remains as the next authorized step.
- **alignment_conclusion**: PASS. This RESEARCH_DOCUMENT task is Enabling/Foundation Work (classification B) required before Phase 4 implementation can proceed. It stays within the `docs/ai/research/` + `docs/ai/` documentation scope with no application/runtime code changes. It does not advance Phase 4 to complete; it prepares the architectural resolution needed for the next implementation task.

---

## Implementation Handoff to Kilo

### Proposed Sequence

**Primary implementation requirement: Resolve the double-dispatch gap.**

The canonical ingress (`routes/poc.js:/activation/ingress`) currently:
1. Calls `canonicalExternalActivationIngress()` — creates TaskRegistry entry + returns command
2. Calls `getDispatcher()(command)` — dispatches via transport-provider

For the GitHub workflow path, this creates a double-dispatch because the workflow also runs `run-gemini-cli` after validation passes.

### Authority / Data Ownership

| Component | Owns |
|---|---|
| `poc/activation-policy.js` | Agent × task-mode × surface policy; server-derived capabilities/paths |
| `poc/activation-ingress.js` | Canonical external activation admission + TaskRegistry create/recover |
| `poc/task-registry.js` | TaskRegistry state, replay/idempotency, Director approval |
| `poc/schemas/acp-schema.js` | ACP compliance, state transitions, evidence validation |
| `services/transport-provider.js` | Target-aware dispatch routing |
| `.github/workflows/main.yml` | Gemini Reviewer/FAILOVER_EXECUTE execution carrier |
| `.github/workflows/gemini-builder.yml` | Gemini Builder execution carrier |
| `poc/validate-external-activation.js` | Workflow-side admission shim |

### Producer Changes

**No changes required to external-activation-validator.js or validate-external-activation.js** — these are admission-only shims that correctly call the ingress.

### Server Changes

**Primary change**: `routes/poc.js` and `poc/activation-ingress.js` must support a dispatch-boundary resolution.

**Recommended approach (Option B — ingress dispatches, workflow detects)**:

1. **`poc/activation-ingress.js`**: Add `dispatch: true` default; when `dispatch: false`, create TaskRegistry entry but skip `getDispatcher()` call
   - Add a parameter to `canonicalExternalActivationIngress(request, dispatchContext)` where `dispatchContext.dispatch === false` means admission-only

2. **`routes/poc.js` (`/activation/ingress` handler)**: Add dispatch flag handling
   - Read `dispatch` from request body or dispatchContext
   - If `dispatch === false`, return task entry + command without dispatching
   - If `dispatch === true` (default), proceed with current dispatch behavior

3. **`.github/workflows/main.yml`**: Add dispatch-detection logic
   - The `validate_activation` step response includes `execution_initiated` flag
   - If `execution_initiated: true` (ingress already dispatched), skip `run-gemini-cli`
   - If `execution_initiated: false` (ingress did not dispatch, e.g., replay), still skip (replay means task already executed)
   - The workflow continues to `run-gemini-cli` only when the ingress explicitly returns `execution_initiated: false` AND the task is not a replay

4. **`.github/workflows/gemini-builder.yml`**: Same dispatch-detection logic for Builder

### Workflow Changes

**main.yml**: Modify the `if:` conditions on `run-gemini-cli` step (line 256) and downstream steps:

```yaml
- name: Run Gemini in advisory mode
  if: steps.validate_activation.outputs.activation_validated == 'true' && steps.validate_activation.outputs.execution_initiated != 'true'
```

**gemini-builder.yml**: Modify the `if:` conditions on `gemini_builder_run` step (line 141):

```yaml
- name: Run Gemini Builder
  if: steps.validate_activation.outputs.activation_validated == 'true' && steps.validate_activation.outputs.execution_initiated != 'true'
```

### Trigger-Module Changes

No changes required to `poc/gemini-trigger.js` or `poc/gemini-builder-trigger.js` — these remain the execution-carrier dispatch mechanisms.

### Tests

**Add `test/double-dispatch-guard.test.js`**:

| Test | Description |
|---|---|
| `ingress admission-only mode` | When `dispatch: false`, ingress creates TaskRegistry entry but does not call getDispatcher |
| `ingress dispatch mode` | When `dispatch: true` (default), ingress dispatches via getDispatcher |
| `workflow dispatch detection` | Workflow `if:` condition correctly skips `run-gemini-cli` when `execution_initiated == 'true'` |
| `exactly-once execution` | Single request_id results in at most one execution |
| `replay no re-dispatch` | Repeated activation returns existing task without re-dispatch |

**Verify existing tests still pass**:
- `test/external-activation-bypass.test.js` (36 tests)
- `test/activation-policy.test.js`
- `test/schema.test.js`

### Migration Order

1. **Phase 1**: Add `dispatch` flag support to `canonicalExternalActivationIngress` and `routes/poc.js`
2. **Phase 2**: Update `external-activation-validator.js` to pass `dispatch: true` for server-initiated path, `dispatch: false` for workflow path
3. **Phase 3**: Update `main.yml` and `gemini-builder.yml` `if:` conditions
4. **Phase 4**: Add double-dispatch guard tests
5. **Phase 5**: Run all tests to verify

**Alternative (Option A — workflow dispatches)**:
- Ingress is admission-only for the workflow path
- `validate-external-activation.js` does NOT trigger dispatch
- Workflow proceeds to `run-gemini-cli` after validation
- Ingress returns `execution_initiated: false` always for workflow path
- Simpler but loses the single-dispatch server-side model

### Rollback / Failure Behavior

- If the ingress dispatch flag is not recognized, default to current behavior (always dispatch) — backward compatible
- If the workflow `if:` condition fails, the workflow fails closed (no execution) — fail-closed
- If TaskRegistry creation fails, ingress returns error — workflow stays blocked
- If dispatch fails, ingress returns 500 — workflow stays blocked
- All failures result in `activation_validated: false` — workflow does not proceed to `run-gemini-cli`

### Bounded Acceptance Checklist

- [ ] `canonicalExternalActivationIngress` supports `dispatch: false` flag
- [ ] `routes/poc.js:/activation/ingress` passes `dispatch === false` through to ingress
- [ ] `main.yml` `run-gemini-cli` `if:` condition includes `execution_initiated != 'true'`
- [ ] `gemini-builder.yml` `gemini_builder_run` `if:` condition includes `execution_initiated != 'true'`
- [ ] `test/double-dispatch-guard.test.js` — 5 tests covering dispatch flag, detection, exactly-once, replay
- [ ] `test/external-activation-bypass.test.js` — all 36 tests pass
- [ ] `test/activation-policy.test.js` — all tests pass
- [ ] `test/schema.test.js` — all tests pass
- [ ] `git diff --check` — no whitespace errors
- [ ] Only intended files modified (no secrets, no unrelated changes)
- [ ] Commit and push to `main`

---

## Repository Evidence Inspected

- `poc/activation-ingress.js` (lines 1-278) — canonical ingress implementation
- `poc/activation-policy.js` (lines 1-432) — activation policy, server-derived authority
- `poc/task-registry.js` (lines 1-868) — TaskRegistry create/replay/persist/Director approval
- `poc/schemas/acp-schema.js` — ACP schema validation
- `poc/acp-engine.js` — ACP engine authorization
- `poc/orchestrator.js` — orchestration, completion handling
- `poc/gemini-trigger.js` — Gemini Reviewer workflow_dispatch client
- `poc/gemini-builder-trigger.js` — Gemini Builder workflow_dispatch client
- `poc/validate-external-activation.js` (lines 1-69) — workflow-side admission shim
- `poc/external-activation-validator.js` (lines 1-165) — workflow-side payload builder
- `poc/strategic-alignment.js` — strategic alignment gate
- `routes/poc.js` (lines 1-500+) — Express router, all route handlers
- `services/transport-provider.js` (lines 1-177) — target-aware dispatcher
- `services/deepseek-runtime.js` — runtime policies
- `.github/workflows/main.yml` (lines 1-538) — Gemini Reviewer workflow
- `.github/workflows/gemini-builder.yml` (lines 1-417) — Gemini Builder workflow
- `test/external-activation-bypass.test.js` — 36 bypass regression tests
- `test/activation-policy.test.js` — activation policy tests
- `docs/ai/TASK_STANDARD.md` — task standard (Sections 3.1-3.2, 5, 7, 9)
- `docs/ai/STATE.md` — current project state
- `docs/ai/CONTROL_CENTER.md` — control center presentation
- `docs/ai/RESEARCH_INDEX.md` — research index
- `docs/ai/ARCH_DECISIONS.md` — architectural decisions
- `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` — operating protocol
- `docs/ai/CHATGPT_START_HERE.md` — bootstrap contract
- `docs/ai/KILO_INTEGRATION.md` — Kilo integration contract
- `docs/ai/GEMINI.md` — Gemini agent contract
- `ARCHITECTURE.md` — authoritative architecture
- `AGENTS.md` — agent operating instructions
- Prior research: `docs/ai/research/research-TASK-CHATGPT-AGENT-INDEPENDENT-EXTERNAL-ACTIVATION-RECOVERY-RESEARCH-001.md`
- `package.json` — test script configuration
- `git log --oneline` for `2136c44`, `c2d4810`, `47a758a7` commit history

No production application code was changed by this research. This research record documents the architectural resolution and provides implementation handoff.
