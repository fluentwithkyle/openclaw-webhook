# Canonical External-AI Activation Procedure

**Document Type**: Canonical operating procedure
**Status**: CURRENT / IMPLEMENTED / MACHINE-VERIFIED
**Owner**: Kyle — Director
**Purpose**: Durable, reusable, machine-verified procedure for external-AI activation of agent execution through the canonical ingress in `fluentwithkyle/openclaw-webhook`.

## 1. Scope and Applicability

This procedure defines the canonical sequence for externally activating an AI agent (Gemini, Gemini Builder, Kilo, Security Specialist, Utility Specialist) through the repository's activation infrastructure. It applies to all external activation producers:

- GitHub `issue_comment` events (via `@gemini-cli` prefix)
- GitHub `workflow_dispatch` events (manual workflow triggers)
- Internal coordinator/Chatbox dispatch (which converges on the same authority boundary)

The procedure is enforced by machine-verification tests in `test/external-activation-procedure.test.js` and `test/external-activation-bypass.test.js`.

## 2. Definitions

| Term | Definition |
|---|---|
| **Activation producer** | The entity initiating an external activation (e.g., GitHub `issue_comment`, GitHub `workflow_dispatch`, DeepSeek coordinator, Chatbox). |
| **Canonical ingress** | The `POST /poc/activation/ingress` endpoint in `routes/poc.js`, guarded by `authenticatePoc` middleware, which calls `canonicalExternalActivationIngress()` in `poc/activation-ingress.js`. |
| **Admission** | The server-side process of validating an activation envelope, creating or recovering a TaskRegistry entry, and acquiring an execution claim. Admission does NOT dispatch the agent. |
| **Execution claim** | An atomic, filesystem-lock-protected assertion by a carrier that it owns execution of a task. Enforced by `claimExecutionContext()` in `poc/task-registry.js`. |
| **Execution descriptor** | A server-derived JSON object containing all authority-bearing fields (`request_id`, `task`, `repository`, `base_branch`, `task_mode`, `capabilities`, `permitted_paths`, `execution_claim_id`, `carrier_identity`) returned by the ingress to the carrier. |
| **GitHub carrier** | The GitHub Actions workflow (`main.yml` or `gemini-builder.yml`) that executes the agent CLI using the server-derived descriptor. |
| **Server-derived authority** | Capabilities, permitted_paths, task_mode, target, repository, and base_branch are derived from `ACTIVATION_POLICY` in `poc/activation-policy.js`, not from external input. |
| **Director authorization** | Required for consequential commands (FAILOVER_EXECUTE, BUILDER) via `POST /poc/director/approve`. |
| **Replay** | A repeated activation with the same `request_id` and matching payload fingerprint. The ingress returns the existing task entry without creating a duplicate. |

## 3. Canonical Activation Sequence

The complete activation sequence is:

```
1. External Producer
   ↓ (produces activation envelope)
2. Workflow-side admission shim: poc/validate-external-activation.js
   ↓ (HTTPS POST to /poc/activation/ingress with x-poc-trigger-secret + x-carrier-identity)
3. routes/poc.js: authenticatePoc middleware (validates x-poc-trigger-secret)
   ↓
4. canonicalExternalActivationIngress(req.body, { director_approval_id, carrier_identity, carrier_type })
   ↓ (in poc/activation-ingress.js)
   4a. canonicalizeExternalActivation(rawRequest)
       → activation_surface, activation_syntax, activation_id, activation_timestamp,
         activation_target, activation_task_mode, activation_request_id, claimed_authority
   4b. validate target agent ∈ VALID_AGENTS
   4c. validate task_mode ∈ VALID_TASK_MODES
   4d. evaluateActivation(requestId, agent, mode, surface)
       → checks requires_activation + permitted_surfaces per ACTIVATION_POLICY
   4e. isAuthorityConflict(rawRequest, canonical) → BLOCKED if external claim conflicts
   4f. enforceServerDerivedAuthority(command) → BLOCKED if missing capability;
       overrides command.authorization.capabilities and command.constraints.permitted_paths
   4g. validateACPCompliance(command) → BLOCKED if ACP schema invalid
   4h. acpEngine.validate(command) → BLOCKED if server authorization fails
   4i. taskRegistry.replayTask(command)
       → replay=true (no new task, returns existing) → return to carrier
       → REPLAY_PAYLOAD_MISMATCH → BLOCKED
       → no existing task → proceed
   4j. isConsequential(command)
       → true: require director_approval_id → createTaskWithDirectorAuthorization
       → false: createTask(command)
   4k. taskEntry.activation_provenance = { activation_id, activation_surface, ... }
   4l. persistCache()
   4m. IF carrier_identity provided:
       4m-i. authenticateCarrier(dispatchContext) → BLOCKED if missing
       4m-ii. transitionToExecuting(requestId) → SELECTED → PLANNED → EXECUTING
       4m-iii. claimExecutionContext(requestId, { carrier_id, carrier_type })
              → returns execution_claim_id (exactly one claim per task)
       4m-iv. buildExecutionDescriptor(requestId, taskEntry, claimId)
              → returns server-derived descriptor with authority-bearing fields
       → return { success, execution_descriptor, carrier_identity, execution_claim_id }
   4n. IF no carrier_identity:
       → return { success, task_admitted, execution_claimed: false }
5. routes/poc.js returns 202 (success) or 403/409/401 (BLOCKED)
   → does NOT call getDispatcher() — admission is complete, no dispatch occurs
6. Workflow-side shard (poc/validate-external-activation.js)
   6a. IF blocked → exit 1 (workflow fails closed, no agent execution)
   6b. IF replay → persist replay response to execution-descriptor.json,
       set GITHUB_OUTPUT: replay=true
   6c. IF execution_descriptor present → persist descriptor to execution-descriptor.json,
       set GITHUB_OUTPUT: request_id, execution_claim_id, carrier_identity, task_mode, etc.
7. GitHub Actions workflow consumes server-derived descriptor:
   7a. orchestration_context step reads from execution-descriptor.json via jq
       → NOT from workflow inputs
   7b. Run Gemini step gated on:
       activation_validated == 'true' && !replay
   7c. Gemini CLI / Builder CLI receives ORCHESTRATION_* env vars from descriptor
8. Agent executes (Gemini CLI or Gemini Builder CLI)
   ↓ produces execution result
9. Agent reports completion via callback to Render:
   → POST /gemini/callback or POST /builder/callback
   → callback payload includes request_id, execution_claim_id, carrier_identity
10. routes/poc.js callback handler validates report and calls orchestrator
    → handleGeminiCompletion() or handleGeminiBuilderCompletion()
    → state transition: EXECUTING → VERIFIED → COMPLETE (or FAILED/BLOCKED)
    → TaskRegistry persists final state
```

### 3.1 Admission-Only Ingress (No Dispatch)

**Critical invariant**: The `/poc/activation/ingress` route does **not** call `getDispatcher()`. The ingress performs admission (validation + TaskRegistry entry + execution claim) and returns a server-derived execution descriptor to the carrier. The carrier (GitHub Actions workflow) is solely responsible for invoking the agent CLI using the descriptor.

This design prevents the double-dispatch problem: the ingress does not dispatch, so there is no recursive `ingress → workflow_dispatch → ingress → workflow_dispatch` cycle. The workflow executes the agent once, directly, using only server-derived authority.

## 4. Activation Policy Matrix

### 4.1 Server-derived authority fields

| Agent | Task Mode | Requires Activation | Permitted Surfaces | Required Capabilities |
|---|---|---|---|---|
| Kilo | REVIEW | No | (none) | read_only |
| Kilo | VERIFY_RECONCILE | No | (none) | read_only, modify_files, commit, push |
| Kilo | RESEARCH_DOCUMENT | No | (none) | read_only, modify_files, commit, push |
| Kilo | FAILOVER_EXECUTE | Yes | github_issue_comment, github_issue_body, github_push_event | read_only, modify_files, run_tests, commit, push |
| Gemini | REVIEW | No | (none) | read_only |
| Gemini | VERIFY_RECONCILE | No | (none) | read_only, modify_files, commit, push |
| Gemini | RESEARCH_DOCUMENT | No | (none) | read_only, modify_files, commit, push |
| Gemini | FAILOVER_EXECUTE | Yes | github_issue_comment, workflow_dispatch | read_only, modify_files, run_tests, commit, push |
| Gemini Builder | BUILDER | Yes | github_issue_comment, workflow_dispatch | read_only, modify_files, run_tests, commit, push |
| Security Specialist | REVIEW | No | (none) | read_only |
| Utility Specialist | REVIEW | No | (none) | read_only |

### 4.2 Authority conflict fields

The following fields are **server-derived** and must not be externally claimed:

```
task_mode, authorization, constraints, repository, base_branch, target, workflow_stage
```

If an external activation includes a `claimed_authority` that conflicts with any of these fields, the ingress returns `BLOCKED` with `error_code: AUTHORITY_CONFLICT`.

### 4.3 Activation surface authorization

| Surface | Kilo FAILOVER_EXECUTE | Gemini FAILOVER_EXECUTE | Gemini Builder BUILDER |
|---|---|---|---|
| `github_issue_comment` | Yes | Yes | Yes |
| `github_issue_body` | Yes | No | No |
| `github_push_event` | Yes | No | No |
| `workflow_dispatch` | No | Yes | Yes |

## 5. Workflow Dispatch Path

### 5.1 GitHub `issue_comment` → `main.yml` (Gemini Reviewer / FAILOVER_EXECUTE)

1. Comment created on an issue/PR with `@gemini-cli` prefix
2. Author association checked: OWNER, MEMBER, or COLLABORATOR
3. Comment body parsed:
   - Plain `@gemini-cli <task>` → `task_mode=REVIEW`, `capabilities=read_only`, `permitted_paths=poc/`
   - `@gemini-cli FAILOVER_EXECUTE <task>` → `task_mode=FAILOVER_EXECUTE`, all 5 capabilities
4. `validate_activation` step calls `poc/validate-external-activation.js gemini-issue-comment`
5. Shim builds activation payload via `buildActivationPayloadForIssueComment()`
6. Shim calls `POST /poc/activation/ingress` with `x-poc-trigger-secret` + `x-carrier-identity`
7. Ingress validates, creates TaskRegistry entry, acquires execution claim, returns descriptor
8. Shim persists descriptor to `execution-descriptor.json`, sets `activation_validated=true`
9. `orchestration_context` step reads from descriptor via `jq` (NOT from workflow inputs)
10. `Run Gemini` step gated on: `activation_validated == 'true' && !replay`
11. Gemini CLI receives `ORCHESTRATION_*` env vars from descriptor
12. Callback step sends `callback_payload.json` to Render with `x-gemini-callback-secret`

### 5.2 GitHub `workflow_dispatch` → `main.yml` (Gemini Reviewer / FAILOVER_EXECUTE)

1. Workflow manually dispatched with inputs: `request_id`, `task`, `repository`, `base_branch`, `task_mode`, `capabilities`, `permitted_paths`, `verification`
2. `validate_activation_wfd` step calls `poc/validate-external-activation.js gemini-workflow-dispatch`
3. Shim builds activation payload via `buildActivationPayloadForWorkflowDispatch(params)`
4. Shim calls `POST /poc/activation/ingress` with `x-poc-trigger-secret` + `x-carrier-identity`
5. Ingress validates, creates TaskRegistry entry, acquires execution claim, returns descriptor
6. Shim persists descriptor to `execution-descriptor.json`, sets `activation_validated=true`
7. `orchestration_context` step reads from descriptor via `jq` (NOT from workflow inputs)
8. `Run Gemini` step gated on: `activation_validated == 'true' && !replay`
9. Gemini CLI receives `ORCHESTRATION_*` env vars from descriptor
10. Callback step sends `callback_payload.json` to Render (workflow_dispatch only)

### 5.3 GitHub `workflow_dispatch` → `gemini-builder.yml` (Gemini Builder)

1. Workflow manually dispatched with inputs: `request_id`, `task`, `repository`, `base_branch`, `task_mode`, `capabilities`, `permitted_paths`, `verification`, `builder_execution_id`
2. `validate_activation` step calls `poc/validate-external-activation.js builder-workflow-dispatch`
3. Shim builds activation payload via `buildBuilderActivationPayload(params)`
4. Shim calls `POST /poc/activation/ingress` with `x-poc-trigger-secret` + `x-carrier-identity`
5. Ingress validates, creates TaskRegistry entry (requires Director approval for BUILDER), acquires execution claim, returns descriptor
6. Shim persists descriptor to `execution-descriptor.json`, sets `activation_validated=true`
7. `orchestration_context` step reads from descriptor via `jq` (NOT from workflow inputs)
8. `Run Gemini Builder` step gated on: `activation_validated == 'true' && !replay`
9. Gemini Builder CLI receives `ORCHESTRATION_*` env vars from descriptor
10. Commit and push step runs (gated on `if: always()`)
11. Callback step sends `callback_payload.json` to Render with `x-builder-callback-secret`

## 6. Replay and Idempotency

### 6.1 Replay at the ingress layer

`canonicalExternalActivationIngress` calls `taskRegistry.replayTask(command)` before creating a new task:

- Computes a payload fingerprint from the command
- If `request_id` exists in TaskRegistry:
  - **Fingerprint matches**: Returns `replay: true` — no new task created, no execution claim acquired
  - **Fingerprint mismatches**: Returns `REPLAY_PAYLOAD_MISMATCH` → BLOCKED (HTTP 409)
  - **Task terminated**: Returns `replay: true` with `task_terminated: true` — existing task status returned
  - **Task active**: Returns `replay: true` — no duplicate created

### 6.2 Replay at the workflow layer

The workflow steps use `if:` conditions to gate on replay:

```yaml
if: steps.validate_activation.outputs.activation_validated == 'true' && !steps.validate_activation.outputs.replay
```

When `replay=true`, the workflow skips `run-gemini-cli` and `orchestration_context` steps, preventing re-execution.

### 6.3 Execution claim idempotency

Even if the ingress is called concurrently with the same `request_id`:

- `claimExecutionContext()` uses a filesystem-based lock (`fs.openSync` with `O_EXCL` flag)
- Only one claim succeeds; concurrent claims return `ALREADY_CLAIMED`
- The lock has a stale-claim timeout of 15 minutes (`CLAIM_STALE_MS = 900000`)

## 7. Director Authorization for Consequential Commands

Commands in `FAILOVER_EXECUTE` or `BUILDER` modes are consequential and require Director authorization:

1. A Director approval is created via `POST /poc/director/approve` with a scope hash
2. The approval `approval_id` is included in the activation payload's `authorization.approval_id` field
3. `canonicalExternalActivationIngress` checks `dispatchContext.director_approval_id`
4. If present and matching scope: `createTaskWithDirectorAuthorization(command)` consumes the approval and creates the task
5. If absent for a consequential command: Returns `BLOCKED` with `error_code: DIRECTOR_APPROVAL_REQUIRED`

## 8. Execution Descriptor Fields

The server-derived execution descriptor contains:

| Field | Source | Authority |
|---|---|---|
| `request_id` | TaskRegistry entry | Server-derived |
| `execution_claim_id` | Execution claim | Server-derived |
| `activation_id` | Activation provenance | Server-derived |
| `activation_target` | Activation provenance | Server-derived |
| `activation_task_mode` | Activation provenance | Server-derived |
| `activation_surface` | Activation provenance | Server-derived |
| `task` | TaskRegistry entry | Intent only (not authority) |
| `repository` | TaskRegistry entry | Server-derived |
| `base_branch` | TaskRegistry entry | Server-derived |
| `task_mode` | TaskRegistry entry | Server-derived |
| `capabilities` | TaskRegistry entry | Server-derived |
| `permitted_paths` | TaskRegistry entry | Server-derived |
| `verification` | TaskRegistry entry | Intent only (not authority) |
| `workflow_stage` | TaskRegistry entry | Server-derived |
| `target_agent` | TaskRegistry entry | Server-derived |
| `carrier_identity` | Execution claim | Server-derived |
| `carrier_type` | Execution claim | Server-derived |

The workflow consumes the descriptor via `jq` in the `orchestration_context` step and passes fields to the agent CLI via `ORCHESTRATION_*` environment variables. Workflow input values are NOT used for authority-bearing fields.

## 9. Failure Handling

| Stage | Failure | Result |
|---|---|---|
| Admission | Missing `x-poc-trigger-secret` | HTTP 401 — workflow fails closed |
| Admission | Invalid agent or task_mode | HTTP 403 — workflow fails closed |
| Admission | Unauthorized activation surface | HTTP 403 — workflow fails closed |
| Admission | Authority conflict | HTTP 403 — workflow fails closed |
| Admission | Missing server-derived capability | HTTP 403 — workflow fails closed |
| Admission | ACP compliance failure | HTTP 403 — workflow fails closed |
| Admission | ACP engine validation failure | HTTP 403 — workflow fails closed |
| Admission | Replay payload mismatch | HTTP 409 — workflow fails closed |
| Admission | Duplicate request_id (active) | HTTP 409 — workflow fails closed |
| Admission | Consequential without Director approval | HTTP 403 — workflow fails closed |
| Admission | Carrier identity missing for carrier path | HTTP 403 — workflow fails closed |
| Execution claim | Concurrent claim | `ALREADY_CLAIMED` — second carrier blocked |
| Workflow | Validation step exits non-zero | `set -euo pipefail` fails the step; Gemini step skipped |
| Workflow | Descriptor file missing | Orchestration context step exits 1 |
| Callback | Invalid callback secret | HTTP 401 — completion rejected |
| Callback | Mismatched request_id | HTTP 400 — completion rejected |

## 10. Machine-Verification

The canonical activation procedure is machine-verified by:

- `test/external-activation-bypass.test.js` — 68 tests verifying bypass closure, workflow ordering, descriptor binding, replay safety, and callback correlation
- `test/external-activation-procedure.test.js` — Tests verifying the documented procedure matches the actual implementation, including:
  - Workflow `workflow_dispatch` trigger with required inputs
  - Canonical ingress validation step before agent execution
  - Execution descriptor persistence and consumption
  - Execution claim gating on successful activation
  - request_id / execution_claim_id / carrier_identity correlation
  - Server-derived authority (no workflow-input authority reconstruction)
  - Failure when procedure references nonexistent canonical workflow or required activation input

## 11. Implementation Files

| Component | File |
|---|---|
| Canonical ingress function | `poc/activation-ingress.js` |
| Activation policy | `poc/activation-policy.js` |
| TaskRegistry (create, replay, claim, persist) | `poc/task-registry.js` |
| ACP schema validation | `poc/schemas/acp-schema.js` |
| ACP engine authorization | `poc/acp-engine.js` |
| Express route handler | `routes/poc.js` (`/activation/ingress`) |
| Target-aware dispatcher | `services/transport-provider.js` |
| Workflow-side admission shim | `poc/validate-external-activation.js` |
| Workflow-side payload builder | `poc/external-activation-validator.js` |
| Gemini Reviewer workflow | `.github/workflows/main.yml` |
| Gemini Builder workflow | `.github/workflows/gemini-builder.yml` |

## 12. Do's and Don'ts

**DO**:
- Route all external activations through `/poc/activation/ingress`
- Consume the server-derived execution descriptor in the workflow, not workflow inputs
- Gate agent execution on `activation_validated == 'true' && !replay`
- Include `x-carrier-identity` header (derived from `GITHUB_RUN_ID`) in ingress calls
- Include `x-poc-trigger-secret` header (from `ACP_POC_TRIGGER_SECRET`) in ingress calls
- Persist the execution descriptor to `execution-descriptor.json` and read from it via `jq`
- Fail closed — if validation exits non-zero, the workflow must not proceed

**DO NOT**:
- Call `getDispatcher()` from the `/activation/ingress` route (prevents double-dispatch)
- Treat workflow inputs (`inputs.*`) as authority for capabilities, paths, task_mode, or target
- Reconstruct authority from workflow input values
- Dispatch the agent from the ingress (the carrier is responsible)
- Bypass the canonical ingress for any external activation
- Claim external activation is "live verified" without execution evidence
