# Research Record: Unified Coordinator-to-Builder Automated Activation

| Field | Value |
|---|---|
| Task / Request Identifier | TASK-KILO-UNIFIED-COORDINATOR-BUILDER-AUTO-ACTIVATION-001 |
| Agent | Kilo |
| Date | 2026-10-16 |
| Task Mode | RESEARCH_DOCUMENT |
| Repository State Examined | main (working tree) |
| Result | RESEARCH COMPLETE — documented how ChatGPT, DeepSeek, and Gemini each submit authorized work and automatically activate the appropriate execution agent (Kilo, Gemini Builder). No implementation performed. |

---

## 1. Executive Summary

This research documents the **existing** activation architecture that allows each
AI coordinator to submit authorized work and automatically activate the appropriate
execution agent (Kilo for `FAILOVER_EXECUTE`, Gemini Builder for `BUILDER`) through
the repository's canonical external-activation infrastructure.

**Key finding**: All three AI lanes — ChatGPT (via one-click workflows), DeepSeek
(via the runtime control-plane tool), and Gemini (via `@gemini-cli` issue comments
or `workflow_dispatch`) — converge on the **same canonical admission path**:
`POST /poc/activation/ingress` (`routes/poc.js` → `canonicalExternalActivationIngress`
in `poc/activation-ingress.js`). This path enforces the ACP schema, the
activation-policy server-derived authority, TaskRegistry entry creation/recovery,
and an exactly-once execution claim. The activated agent is then invoked by the
GitHub Actions carrier workflow using a server-derived execution descriptor.

| AI Coordinator | How it submits authorized work | How it activates the Builder | Activation surface (verified) |
|---|---|---|---|
| **ChatGPT** | One-click workflows (`.github/workflows/one-click-*.yml`) embed a canonical ACP task artifact; workflow-side shim calls `/poc/activation/ingress` before the agent step | Via `workflow_dispatch` one-click Builder workflow → `builder-workflow-dispatch` shim → canonical ingress → `gemini-builder.yml` carrier | `workflow_dispatch` (zero-input) |
| **DeepSeek** | Runtime `control_plane` tool (`request_task`) POSTs a server-derived ACP command to `/poc/coordinator` (`routes/poc.js`), which validates and dispatches via the target-aware dispatcher | `WORKFLOW_STEP_POLICY.implementation` maps to Gemini Builder (`target: Gemini Builder, task_mode: BUILDER`); dispatcher routes to `dispatchBuilder` → `gemini-builder-trigger.js` → `gemini-builder.yml` workflow_dispatch | Internal coordinator dispatch (via `/poc/coordinator` → `services/transport-provider.js`) |
| **Gemini** | `@gemini-cli` issue comment or `workflow_dispatch` on `main.yml`/`gemini-builder.yml` | Via `workflow_dispatch` on the carrier workflow itself, or issue-comment activation → `gemini-workflow-dispatch` / `builder-workflow-dispatch` shim → canonical ingress | `github_issue_comment` or `workflow_dispatch` |

**Status classification per the task constraint (A/B/C/D)**:

| Criterion | Classification | Evidence |
|---|---|---|
| A — ChatGPT authorized submission + Builder auto-activation | **VERIFIED** | `docs/ai/ONE_CLICK_WORKFLOW_CONTRACT.md`, `.github/workflows/one-click-*.yml`, `poc/validate-external-activation.js:297-306`, `test/one-click-workflow-contract.test.js` |
| B — DeepSeek authorized submission + Builder auto-activation | **VERIFIED** | `services/deepseek-runtime.js:931-959`, `poc/orchestrator.js:347-407`, `services/transport-provider.js:20-91`, `poc/gemini-builder-trigger.js:1-143` |
| C — Gemini authorized submission + Builder auto-activation | **VERIFIED** | `docs/ai/EXTERNAL_ACTIVATION_PROCEDURE.md §5`, `poc/external-activation-validator.js:430-480`, `.github/workflows/gemini-builder.yml:72-119` |
| D — Fail-closed on missing authority / invalid surface | **VERIFIED** | `poc/activation-ingress.js:100-113, 180-188`, `test/external-activation-bypass.test.js` |

No implementation changes were made. This document is research/documentation only.

---

## 2. Canonical Architecture: The Unified Admission Path

All external and internal coordinators converge on the **same canonical admission
boundary**. This is the architectural foundation that makes unified auto-activation
possible without a second control plane.

### 2.1 Canonical Activation Sequence

```
Producer (ChatGPT / DeepSeek / Gemini / Kilo)
    ↓
[payload construction]
    ↓
POST /poc/activation/ingress          (routes/poc.js:1127)
  guarded by authenticatePoc           (routes/poc.js:36-46)
    ↓
canonicalExternalActivationIngress()   (poc/activation-ingress.js:23)
    ├─ canonicalizeExternalActivation()   (poc/activation-policy.js:347)
    ├─ validate target ∈ VALID_AGENTS      (poc/activation-policy.js:1)
    ├─ validate task_mode ∈ VALID_TASK_MODES (poc/activation-policy.js:2)
    ├─ evaluateActivation()               (poc/activation-policy.js:363)
    │   → requires_activation + permitted_surfaces check
    ├─ isAuthorityConflict()              (poc/activation-policy.js:317)
    ├─ enforceServerDerivedAuthority()    (poc/activation-policy.js:427)
    ├─ validateACPCompliance()             (poc/schemas/acp-schema.js)
    ├─ acpEngine.validate()                (poc/acp-engine.js:42)
    ├─ taskRegistry.replayTask()           (poc/task-registry.js:343)
    │   → REPLAY: return existing task, no new execution
    │   → REPLAY_PAYLOAD_MISMATCH: BLOCKED
    ├─ isConsequential → Director approval required
    │   → createTaskWithDirectorAuthorization() OR
    │   → createTaskWithAutoDirectorAuthorization() (director_admission)
    │   → NOT consequential: createTask()
    ├─ IF carrier_identity provided:
    │     authenticateCarrier()           (poc/activation-ingress.js:15)
    │     transitionToExecuting()         (poc/task-registry.js:1689)
    │     claimExecutionContext()         (poc/task-registry.js:1309)
    │     └─ ALREADY_CLAIMED → BLOCKED (exactly-once)
    │     └─ EEXIST lock race → stale-claim recovery (CLAIM_STALE_MS=15min)
    │     buildExecutionDescriptor()      (poc/task-registry.js:1654)
    └─ returns 202 + execution_descriptor  (routes/poc.js:1175-1189)
```

**Critical invariant** (documented in `docs/ai/EXTERNAL_ACTIVATION_PROCEDURE.md:101-105`):
The `/activation/ingress` route does **NOT** call `getDispatcher()`. Admission is
complete at the ingress; the carrier (GitHub Actions workflow) is solely responsible
for invoking the agent CLI using the server-derived descriptor. This prevents the
double-dispatch problem (`ingress → workflow_dispatch → ingress → workflow_dispatch`).

### 2.2 Server-Derived Authority Fields

The following fields are **server-derived** from `ACTIVATION_POLICY` in
`poc/activation-policy.js` and must not be externally claimed:

```
task_mode, authorization, constraints, repository, base_branch, target, workflow_stage
```

`enforceServerDerivedAuthority()` (`poc/activation-policy.js:427`) overrides
`command.authorization.capabilities` and `command.constraints.permitted_paths`
with server-derived values, rejecting any authority conflict.

### 2.3 Activation Policy Matrix (from `poc/activation-policy.js:112-189`)

| Agent | Task Mode | Requires Activation | Permitted Surfaces | Capabilities |
|---|---|---|---|---|
| Kilo | REVIEW | No | (none) | read_only |
| Kilo | VERIFY_RECONCILE | No | (none) | read_only, modify_files, commit, push |
| Kilo | RESEARCH_DOCUMENT | No | (none) | read_only, modify_files, commit, push |
| Kilo | FAILOVER_EXECUTE | Yes | github_issue_comment, github_issue_body, github_push_event | read_only, modify_files, run_tests, commit, push |
| Gemini | REVIEW | No | (none) | read_only |
| Gemini | VERIFY_RECONCILE | No | (none) | read_only, modify_files, commit, push |
| Gemini | RESEARCH_DOCUMENT | No | (none) | read_only, modify_files, commit, push |
| Gemini | FAILOVER_EXECUTE | Yes | github_issue_comment, workflow_dispatch | read_only, modify_files, run_tests, commit, push |
| Gemini Builder | BUILDER | Yes | workflow_dispatch | read_only, modify_files, run_tests, commit, push |
| Security Specialist | REVIEW | No | (none) | read_only |
| Utility Specialist | REVIEW | No | (none) | read_only |

**Activation surface authorization** (`poc/activation-policy.js:225`):

| Surface | Kilo FAILOVER_EXECUTE | Gemini FAILOVER_EXECUTE | Gemini Builder BUILDER |
|---|---|---|---|
| `github_issue_comment` | Yes | Yes | Yes |
| `github_issue_body` | Yes | No | No |
| `github_push_event` | Yes | No | No |
| `workflow_dispatch` | No | Yes | Yes |

---

## 3. ChatGPT — One-Click Workflow Activation

### 3.1 How ChatGPT Submits Authorized Work

ChatGPT uses **one-click workflows** — zero-input `workflow_dispatch` GitHub Actions
workflows that embed a canonical ACP task artifact as a JSON task description string.

**Authoritative contract**: `docs/ai/ONE_CLICK_WORKFLOW_CONTRACT.md`

The canonical phrase **"Make this a one-click workflow"** is interpreted as a request
for a zero-input `workflow_dispatch` activation surface using the canonical external
activation architecture. Kyle may specify an agent/task-mode variant:

| Kyle's Instruction | Coordinator Interpretation |
|---|---|
| "Make this a one-click workflow." | Zero-input `workflow_dispatch` for Gemini Reviewer (REVIEW, read-only) |
| "Make this a one-click Gemini Builder workflow." | Zero-input `workflow_dispatch` targeting `gemini-builder.yml`, BUILDER mode |
| "Make this a one-click Kilo workflow." | Zero-input `workflow_dispatch` targeting Kilo lane, FAILOVER_EXECUTE per policy |

**Existing one-click workflows** (all in `.github/workflows/`):

| Workflow file | Target agent | Task mode | Embedded task identity |
|---|---|---|---|
| `one-click-kilo-acp-copy-safe.yml` | Kilo | FAILOVER_EXECUTE | `TASK-GEMINI-ACP-COPYSAFE-AND-ONE-CLICK-WORKFLOW-FIX-001` |
| `one-click-gemini-builder-smoke.yml` | Gemini Builder | BUILDER | `TASK-GEMINI-BUILDER-PHASE4-INCREMENT-4-2-...` |
| `one-click-gemini-activation-verify-reconcile.yml` | Gemini | VERIFY_RECONCILE | (task-specific) |
| `one-click-gemini-failover.yml` | Gemini | FAILOVER_EXECUTE | (task-specific) |
| `one-click-gemini-acp-report-durable-evidence-research.yml` | Gemini | RESEARCH_DOCUMENT | (task-specific) |
| `one-click-task-registry-test.yml` | Gemini | RESEARCH_DOCUMENT | (task-specific) |

### 3.2 How ChatGPT Activates the Builder

For Gemini Builder one-click workflows (e.g., `one-click-gemini-builder-smoke.yml`):

1. The workflow embeds a canonical ACP task with `target_agent: "Gemini Builder"`,
   `task_mode: "BUILDER"` as a JSON string in the workflow file (lines 26-45 of
   `one-click-gemini-builder-smoke.yml`).
2. The workflow-side shim builds an activation payload and calls
   `poc/validate-external-activation.js builder-workflow-dispatch` (line 92 of
   `one-click-kilo-acp-copy-safe.yml`; analogous in builder workflows).
3. The shim calls `POST /poc/activation/ingress` with `x-poc-trigger-secret` and
   `x-carrier-identity` headers.
4. The canonical ingress validates the ACP envelope, creates a TaskRegistry entry
   (with Director auto-authorization since `DIRECTOR_ORIGIN_SECRET` is provided by
   the Kyle-initiated workflow), acquires an execution claim, and returns a
   server-derived `execution-descriptor.json`.
5. The workflow reads the descriptor via `jq` (lines 109-143 of
   `one-click-kilo-acp-copy-safe.yml`), not from workflow inputs.
6. The `Run Gemini Builder` step (gated on
   `activation_validated == 'true' && !replay`) executes
   `google-github-actions/run-gemini-cli@v0` with `gemini_api_key:
   ${{ secrets.GEMINI_BUILDER_API_KEY }}` and `ORCHESTRATION_*` env vars from the
   descriptor.

**Evidence**: `poc/external-activation-validator.js:430-480`
(`buildBuilderActivationPayload`), `.github/workflows/gemini-builder.yml:72-119`
(validate activation step), `.github/workflows/gemini-builder.yml:215-233` (Run
Gemini Builder with `GEMINI_BUILDER_API_KEY`).

### 3.3 One-Click Workflow Contract Verification

The one-click contract is verified by `test/one-click-workflow-contract.test.js`
(250 tests) and preflight validation in `poc/validate-external-activation.js:118-161`
(`one-click-preflight` command using `poc/one-click-artifact-validator.js`).

**ChatGPT does NOT have a separate one-click workflow of its own**. ChatGPT is the
human-facing coordinator; it authorizes agents to run one-click workflows on its
behalf. The one-click workflows are the **activation surface** that ChatGPT uses to
coordinate with the execution lane.

---

## 4. DeepSeek — Runtime Control-Plane Activation

### 4.1 How DeepSeek Submits Authorized Work

DeepSeek reaches `/poc/deepseek-runtime` and exercises a bounded `control_plane`
tool with two model-facing operations: `request_task` and `get_task`.

**Policy definition** (`services/deepseek-runtime.js:52-107`):

- `model_operations`: `["request_task", "get_task"]` — exactly two operations
- `request_task` model fields: `operation`, `objective`, `parent_request_id`,
  `workflow_step` — authority-bearing ACP fields are **prohibited** (server-derived)
- Server-derived authority: `repository: fluentwithkyle/openclaw-webhook`,
  `base_branch: main`, `task_mode: REVIEW`, `capabilities: [read_only]`,
  `permitted_paths: [poc/]`

**Authorizer**: `services/deepseek-runtime.js:234-296` (`buildControlPlaneCommand`):
- Evaluates `strategicAlignment` via `evaluateCoordinatorIntent()`
- Routes intent via `routeSpecialistIntent()` or `WORKFLOW_STEP_POLICY`
- Constructs a server-derived ACP command (target, repository, base_branch,
  task_mode, capabilities, permitted_paths are all server-derived)
- POSTs to `config.coordinatorUrl` (default:
  `http://127.0.0.1:PORT/poc/coordinator`) with `x-deepseek-coordinator-secret`

### 4.2 How DeepSeek Activates the Builder

DeepSeek's `WORKFLOW_STEP_POLICY` (`services/deepseek-runtime.js:16-21`):

| Step | Target | Task Mode | Capabilities | Authorization Required |
|---|---|---|---|---|
| review | Gemini | REVIEW | read_only | No |
| implementation | Gemini Builder | BUILDER | read_only, modify_files, run_tests, commit, push | Yes (Director) |
| verification | Gemini | VERIFY_RECONCILE | read_only, modify_files, commit, push | Yes (Director) |
| reconciliation | Gemini | VERIFY_RECONCILE | read_only, modify_files, commit, push | Yes (Director) |

When DeepSeek determines the next workflow step is `implementation`
(`services/deepseek-runtime.js:845`):
1. The server routes the intent to `Gemini Builder` with `task_mode: BUILDER`
2. The constructed ACP command is POSTed to `/poc/coordinator`
   (`routes/poc.js:888`)
3. The coordinator route validates ACP compliance, checks protocol hash, evaluates
   strategic alignment, then calls `taskRegistry.createTaskWithDirectorAuthorization()`
   and `getDispatcher()(command)`
4. `getDispatcher()` returns `dispatch()` from `services/transport-provider.js:142`
5. `dispatch()` routes `target === 'Gemini Builder'` to `dispatchBuilder()`
   (`services/transport-provider.js:20-91`)
6. `dispatchBuilder()` validates ACP, then calls
   `geminiBuilderTrigger.dispatchGeminiBuilder()` (`poc/gemini-builder-trigger.js:82`)
7. `dispatchGeminiBuilder` calls the GitHub API to dispatch
   `gemini-builder.yml` workflow via
   `POST /repos/fluentwithkyle/openclaw-webhook/actions/workflows/gemini-builder.yml/dispatches`
   with `GITHUB_TOKEN` and `GEMINI_BUILDER_API_KEY` in the request
8. The `gemini-builder.yml` workflow runs, validates through the canonical ingress,
   and executes the Gemini Builder CLI

**Key distinction**: DeepSeek's dispatcher path (`dispatchBuilder`) is an
**internal dispatch** that submits a GitHub API workflow_dispatch event directly.
This differs from the ChatGPT/Gemini external activation path which uses
`/poc/activation/ingress` first. Both paths converge on the same
`gemini-builder.yml` carrier workflow, but DeepSeek goes through `/poc/coordinator`
→ `transport-provider.js` → `gemini-builder-trigger.js`, while ChatGPT/Gemini goes
through `/poc/activation/ingress` → carrier workflow → agent CLI.

**Evidence**: `services/deepseek-runtime.js:931-959` (request_task handler),
`poc/orchestrator.js:347-407` (triggerGeminiBuilder),
`services/transport-provider.js:20-91` (dispatchBuilder),
`poc/gemini-builder-trigger.js:82-125` (dispatchGeminiBuilder).

---

## 5. Gemini — Issue Comment / Workflow Dispatch Activation

### 5.1 How Gemini Submits Authorized Work

Gemini has two activation surfaces depending on whether it is acting as Reviewer
or Builder:

**As Gemini Reviewer** (`target: Gemini`, `task_mode: REVIEW`):
- Activated via `@gemini-cli` issue comment on any issue/PR
- The comment body is parsed by `buildActivationPayloadForIssueComment()`
  (`poc/external-activation-validator.js:295`)
- Plain `@gemini-cli <task>` → `task_mode=REVIEW`, `capabilities=read_only`,
  `permitted_paths=poc/`
- `@gemini-cli FAILOVER_EXECUTE <task>` → `task_mode=FAILOVER_EXECUTE`, all 5
  capabilities; requires `DIRECTOR_ORIGIN_SECRET` (owner = `fluentwithkyle`)

**As Gemini Builder** (`target: Gemini Builder`, `task_mode: BUILDER`):
- Activated via `workflow_dispatch` on `gemini-builder.yml`
- Payload built by `buildBuilderActivationPayload()` (`poc/external-activation-validator.js:430`)
- Requires `director_origin_assertion` (server-signed) for consequential BUILDER mode

### 5.2 How Gemini Activates the Builder

Both paths route through the canonical ingress:

**Issue comment path** (`main.yml:91-176`):
1. `@gemini-cli` comment triggers `issue_comment` event
2. Author association checked (OWNER, MEMBER, COLLABORATOR)
3. Comment body parsed for embedded ACP descriptor
4. `validate_activation` step → `poc/validate-external-activation.js
   gemini-issue-comment` → builds payload → POST to `/poc/activation/ingress`
5. For `FAILOVER_EXECUTE`: `DIRECTOR_ORIGIN_SECRET` provided by workflow when
   `comment.user.login == 'fluentwithkyle'`
6. Ingress creates TaskRegistry entry with auto Director authorization, acquires
   execution claim, returns descriptor
7. `Run Gemini` step (`main.yml:384`) executes with descriptor env vars

**Workflow_dispatch path** (`main.yml:178-231`):
1. Manual dispatch with inputs: `request_id`, `task`, `repository`,
   `base_branch`, `task_mode`, `capabilities`, `permitted_paths`, `verification`
2. `validate_activation_wfd` step → `poc/validate-external-activation.js
   gemini-workflow-dispatch` → builds payload → POST to `/poc/activation/ingress`
3. For `FAILOVER_EXECUTE`: `DIRECTOR_ORIGIN_SECRET` provided when
   `github.actor == 'fluentwithkyle'`
4. Same admission → descriptor → carrier execution flow

**Builder workflow** (`gemini-builder.yml:55-282`):
1. `workflow_dispatch` with `director_origin_assertion` input
2. `validate_activation` step → `poc/validate-external-activation.js
   builder-workflow-dispatch` → builds payload → POST to `/poc/activation/ingress`
3. Ingress validates, requires `DIRECTOR_ORIGIN_SECRET` for BUILDER mode
4. `Run Gemini Builder` step (`gemini-builder.yml:215`) gated on
   `activation_validated == 'true' && !replay && provenance_status == 'SUCCESS'`
5. Executes `run-gemini-cli@v0` with `gemini_api_key:
   ${{ secrets.GEMINI_BUILDER_API_KEY }}`

**Evidence**: `poc/external-activation-validator.js:295-377` (issue comment),
`poc/external-activation-validator.js:430-480` (builder),
`.github/workflows/main.yml:91-231`, `.github/workflows/gemini-builder.yml:72-119`.

---

## 6. Kilo — External Trigger Activation

### 6.1 How Kilo Submits Authorized Work

Kilo is activated as an execution lane for `FAILOVER_EXECUTE` tasks. The activation
path is documented in `docs/ai/KILO_INTEGRATION.md`:

- **Activation surface**: `workflow_dispatch` on `one-click-kilo-acp-copy-safe.yml`
  (`.github/workflows/one-click-kilo-acp-copy-safe.yml`)
- **Task mode**: `FAILOVER_EXECUTE` (only mode Kilo supports per
  `buildKiloActivationPayload`, `poc/external-activation-validator.js:482-540`)
- **Capabilities**: `read_only, modify_files, run_tests, commit, push` (server-derived)
- **Permitted surfaces**: `github_issue_comment`, `github_issue_body`,
  `github_push_event` (per `ACTIVATION_POLICY` for Kilo FAILOVER_EXECUTE)

### 6.2 Kilo Execution and Builder Handoff

When Kilo completes execution, the callback (`POST /kilo/callback` in
`routes/poc.js:338`) triggers the orchestrator (`poc/orchestrator.js`):

1. `handleKiloCompletion()` validates the execution report, checks TaskRegistry,
   records Kilo's result
2. If Kilo reports `success`, sets `next_action = 'trigger_builder'`
   (`poc/orchestrator.js:66-68`)
3. The callback handler (`routes/poc.js:416-426`) automatically calls
   `orchestrator.triggerGeminiBuilder()` which dispatches the
   `gemini-builder.yml` workflow via the GitHub API

**Evidence**: `routes/poc.js:416-426` (auto-trigger Builder after Kilo success),
`poc/orchestrator.js:66-68, 347-407` (handleKiloCompletion → triggerGeminiBuilder),
`poc/gemini-builder-trigger.js:82-125` (dispatchGeminiBuilder).

---

## 7. Coordinated Activation Matrix

| Producer | Entry point | Admission path | TaskRegistry creation | Execution claim | Carrier workflow | Agent CLI |
|---|---|---|---|---|---|---|
| **ChatGPT** (one-click) | `workflow_dispatch` | `validate-external-activation.js builder/kilo-workflow-dispatch` | Via `/poc/activation/ingress` (director_admission) | Via `claimExecutionContext()` | `gemini-builder.yml` / `main.yml` | `@gemini-cli` / Kilo CLI |
| **DeepSeek** (runtime) | `control_plane` tool | `/poc/coordinator` (strategic-alignment + ACP gate) | Via `taskRegistry.createTaskWithDirectorAuthorization()` | Via internal dispatch (no separate claim) | `gemini-builder.yml` (via `gemini-builder-trigger.js`) | `@gemini-cli` |
| **Gemini** (issue comment) | `@gemini-cli` comment | `validate-external-activation.js gemini-issue-comment` | Via `/poc/activation/ingress` (director_admission or approval_id) | Via `claimExecutionContext()` | `main.yml` | Gemini CLI |
| **Gemini** (wf dispatch) | `workflow_dispatch` | `validate-external-activation.js gemini/builder-workflow-dispatch` | Via `/poc/activation/ingress` | Via `claimExecutionContext()` | `main.yml` / `gemini-builder.yml` | Gemini CLI / Builder CLI |
| **Kilo** (one-click) | `workflow_dispatch` | `validate-external-activation.js kilo-workflow-dispatch` | Via `/poc/activation/ingress` | Via `claimExecutionContext()` | `one-click-kilo-acp-copy-safe.yml` → Kilo CLI | Kilo CLI |

### 7.1 Key Distinctions

**ChatGPT / Gemini external activation** (Admission-first):
- All external activations route through `/poc/activation/ingress` first
- The ingress performs admission (validation + TaskRegistry + execution claim)
  but does NOT dispatch the agent
- The carrier workflow (GitHub Actions) invokes the agent CLI using the
  server-derived execution descriptor
- This is the **canonical external-activation architecture**

**DeepSeek internal dispatch** (Coordinator-first):
- DeepSeek's `request_task` tool goes through `/poc/coordinator`
- The coordinator route calls `getDispatcher()(command)` **after** TaskRegistry
  creation
- `getDispatcher()` returns `dispatch()` from `transport-provider.js`
- `dispatch()` routes to `dispatchBuilder()` which directly calls the GitHub API
  to dispatch `gemini-builder.yml` — no carrier workflow admission step needed
- This is the **internal dispatcher** path, used for model-mediated workflow steps

**Kilo handoff** (Completion-triggered):
- Kilo is activated as a carrier (like ChatGPT one-click)
- When Kilo completes successfully, the Kilo callback handler automatically
  triggers Gemini Builder via `orchestrator.triggerGeminiBuilder()`
- This is a **completion-triggered dispatch**, not a pre-activation

---

## 8. Evidence Classification

### VERIFIED (direct repository inspection)

| # | Claim | File(s) | Line(s) |
|---|---|---|---|
| V1 | Canonical ingress is `POST /poc/activation/ingress` in `routes/poc.js` | `routes/poc.js` | 1127 |
| V2 | `authenticatePoc` middleware guards the ingress | `routes/poc.js` | 36-46 |
| V3 | `canonicalExternalActivationIngress()` in `poc/activation-ingress.js` | `poc/activation-ingress.js` | 23 |
| V4 | Ingress does NOT call `getDispatcher()` (admission-only) | `poc/activation-ingress.js` | 440 (final return blocks), `routes/poc.js` | 440 (comment) |
| V5 | `VALID_AGENTS` includes Kilo, Gemini, Gemini Builder | `poc/activation-policy.js` | 1 |
| V6 | `VALID_TASK_MODES` includes REVIEW, VERIFY_RECONCILE, FAILOVER_EXECUTE, BUILDER, RESEARCH_DOCUMENT | `poc/activation-policy.js` | 2 |
| V7 | `EXECUTION_TASK_MODES = ['FAILOVER_EXECUTE', 'BUILDER']` | `poc/activation-policy.js` | 60 |
| V8 | Server-derived authority fields include task_mode, authorization, constraints, repository, base_branch, target, workflow_stage | `poc/activation-policy.js` | 307-315 |
| V9 | `enforceServerDerivedAuthority()` overrides capabilities and permitted_paths | `poc/activation-policy.js` | 427-447 |
| V10 | `replayTask()` with payload fingerprint before task creation | `poc/task-registry.js` | 325-388 |
| V11 | `claimExecutionContext()` with `O_EXCL` lock, `ALREADY_CLAIMED` on concurrent | `poc/task-registry.js` | 1309-1445 |
| V12 | `CLAIM_STALE_MS = 15 * 60 * 1000` (15-min stale-claim recovery) | `poc/task-registry.js` | 33 |
| V13 | `buildExecutionDescriptor()` returns server-derived fields | `poc/task-registry.js` | 1654-1687 |
| V14 | `createTaskWithAutoDirectorAuthorization()` for director_admission | `poc/task-registry.js` | 137-203 |
| V15 | `createTaskWithDirectorAuthorization()` consumes Director approval | `poc/task-registry.js` | 133-135, `poc/schemas/acp-schema.js` |
| V16 | DeepSeek `control_plane` tool: `request_task` and `get_task` only | `services/deepseek-runtime.js` | 54, 118 |
| V17 | `request_task` POSTs to `/poc/coordinator` | `services/deepseek-runtime.js` | 147, 949-955 |
| V18 | DeepSeek `request_task` model fields: operation, objective, parent_request_id, workflow_step | `services/deepseek-runtime.js` | 56-57 |
| V19 | DeepSeek prohibited authority fields include target, repository, base_branch, task_mode, capabilities, permitted_paths, authorization | `services/deepseek-runtime.js` | 57 |
| V20 | `WORKFLOW_STEP_POLICY` maps implementation → Gemini Builder BUILDER | `services/deepseek-runtime.js` | 16-21 |
| V21 | `/poc/coordinator` route calls `getDispatcher()(command)` after TaskRegistry | `routes/poc.js` | 949, 973 |
| V22 | `dispatch()` routes target to Kilo / Gemini Builder / Gemini | `services/transport-provider.js` | 142-158 |
| V23 | `dispatchBuilder()` calls `geminiBuilderTrigger.dispatchGeminiBuilder()` | `services/transport-provider.js` | 46-57 |
| V24 | `dispatchGeminiBuilder()` calls GitHub API workflow_dispatch on `gemini-builder.yml` | `poc/gemini-builder-trigger.js` | 17-80 |
| V25 | `handleKiloCompletion` sets `next_action = 'trigger_builder'` on success | `poc/orchestrator.js` | 66-68 |
| V26 | Kilo callback handler auto-triggers Builder (`orchestrator.triggerGeminiBuilder`) | `routes/poc.js` | 416-426 |
| V27 | `buildActivationPayloadForIssueComment()` sets default REVIEW for plain `@gemini-cli` | `poc/external-activation-validator.js` | 326-376 |
| V28 | `@gemini-cli FAILOVER_EXECUTE` requires `directorOriginSecret` | `poc/external-activation-validator.js` | 333-349 |
| V29 | `buildBuilderActivationPayload()` sets target to `Gemini Builder`, task_mode `BUILDER` | `poc/external-activation-validator.js` | 430-480 |
| V30 | `buildKiloActivationPayload()` only supports FAILOVER_EXECUTE | `poc/external-activation-validator.js` | 482-540 |
| V31 | One-click workflows embed ACP task as JSON in workflow file | `.github/workflows/one-click-*-*.yml` | see files |
| V32 | `validate-external-activation.js one-click-preflight` verifies zero-input + canonical ingress | `poc/validate-external-activation.js` | 118-161 |
| V33 | One-click contract: "Make this a one-click workflow" = zero-input workflow_dispatch | `docs/ai/ONE_CLICK_WORKFLOW_CONTRACT.md` | 14-16 |
| V34 | `EXTERNAL_ACTIVATION_PROCEDURE.md` documents full sequence | `docs/ai/EXTERNAL_ACTIVATION_PROCEDURE.md` | 1-344 |
| V35 | Ingress returns 202 with execution_descriptor (not dispatch) | `routes/poc.js` | 1175-1189 |
| V36 | Replay returns 200 with `replay: true` (no new execution) | `routes/poc.js` | 1160-1173 |
| V37 | `gemini-builder.yml` Run step gated on `activation_validated && !replay && provenance_status == SUCCESS` | `.github/workflows/gemini-builder.yml` | 215 |
| V38 | `gemini-builder.yml` passes `gemini_api_key: ${{ secrets.GEMINI_BUILDER_API_KEY }}` | `.github/workflows/gemini-builder.yml` | 233 |
| V39 | `main.yml` uses `GITHUB_TOKEN` and `GEMINI_API_KEY` (not Builder key) for Gemini Reviewer | `.github/workflows/main.yml` | 386-388, 403 |
| V40 | Callback routes: `/kilo/callback`, `/gemini/callback`, `/builder/callback` | `routes/poc.js` | 338, 443, 531 |

### INFERRED (logical consequence of verified structure)

| # | Claim | Basis |
|---|---|---|
| I1 | ChatGPT coordinates one-click workflow activation by authorizing Kyle-initiated workflow runs | ChatGPT is human-facing coordinator; `CHATGPT_START_HERE.md:37` states it translates intent into technical routes |
| I2 | DeepSeek's autonomous continuation can transition from REVIEW → BUILDER via workflow sequencing | `WORKFLOW_STEP_POLICY` + `deriveNextWorkflowStep()` in deepseek-runtime.js |
| I3 | Kilo handoff to Builder happens in the callback handler, not the ingress | `routes/poc.js:416-426` calls `orchestrator.triggerGeminiBuilder` |
| I4 | The `/poc/coordinator` dispatch path and `/poc/activation/ingress` path both converge on `gemini-builder.yml` | Both call GitHub API to dispatch the same workflow file |

### UNKNOWN (not verified / not determinable from repository)

| # | Claim | Note |
|---|---|---|
| U1 | Live ChatGPT → one-click workflow activation has been observed end-to-end | No GitHub Actions run evidence provided; ChatGPT does not have a GitHub Actions trigger surface of its own |
| U2 | Live DeepSeek → Builder dispatch has been observed end-to-end | `services/deepseek-runtime.js` POSTs to coordinator; runtime execution depends on OpenRouter/DeepSeek API availability |
| U3 | Live Gemini Builder CLI execution has produced commits/pushes | Workflow runs depend on `GEMINI_BUILDER_API_KEY` and `GITHUB_TOKEN` being configured in GitHub secrets |
| U4 | Multi-agent sequential orchestration (Kilo → Builder → Gemini Reviewer) has completed a full cycle | The orchestrator supports it (`orchestrator.js`); live execution evidence not provided |
| U5 | The `DIRECTOR_ORIGIN_SECRET` is configured in the production Render environment | Referenced in code and workflows but cannot verify live configuration from repository |

---

## 9. Fail-Closed Behavior

The architecture preserves fail-closed behavior throughout:

| Failure point | Result | Evidence |
|---|---|---|
| Missing `x-poc-trigger-secret` | HTTP 401 | `routes/poc.js:36-46` |
| Invalid agent | HTTP 403 `INVALID_AGENT` | `poc/activation-ingress.js:53-61` |
| Invalid task_mode | HTTP 403 `INVALID_TASK_MODE` | `poc/activation-ingress.js:63-71` |
| Unauthorized activation surface | HTTP 403 `UNAUTHORIZED_ACTIVATION_SURFACE` | `poc/activation-policy.js:225-248` |
| Authority conflict (externally claimed fields) | HTTP 403 `AUTHORITY_CONFLICT` | `poc/activation-ingress.js:90-99` |
| Missing server-derived capability | HTTP 403 | `poc/activation-ingress.js:102-113` |
| ACP compliance failure | HTTP 403 `ACP_COMPLIANCE_FAILED` | `poc/activation-ingress.js:168-177` |
| ACP engine validation failure | HTTP 403 `SERVER_AUTHORIZATION_FAILED` | `poc/activation-ingress.js:179-188` |
| Replay payload mismatch | HTTP 409 `REPLAY_PAYLOAD_MISMATCH` | `poc/activation-ingress.js:231-241` |
| Duplicate request_id (active) | HTTP 409 `DUPLICATE_REQUEST_ID` | `poc/activation-ingress.js:289-298` |
| Consequential without Director approval | HTTP 403 `DIRECTOR_APPROVAL_REQUIRED` | `poc/activation-ingress.js:266-277` |
| Concurrent execution claim | `ALREADY_CLAIMED` (BLOCKED) | `poc/task-registry.js:1335-1343` |
| Callback invalid secret | HTTP 401 | `routes/poc.js:48-60, 62-74, 76-88` |
| Callback mismatched request_id | HTTP 400 | `routes/poc.js:374-380, 477-485` |
| Execution claim mismatch on callback | HTTP 403 | `routes/poc.js:613-625` |

---

## 10. Idempotency

| Mechanism | Implementation | Evidence |
|---|---|---|
| Replay at ingress | `taskRegistry.replayTask(command)` with SHA-256 payload fingerprint | `poc/task-registry.js:325-388` |
| Replay at workflow | `if: ... && !steps.validate_activation.outputs.replay` gates agent steps | `.github/workflows/gemini-builder.yml:215` |
| Execution claim idempotency | `O_EXCL` filesystem lock; `ALREADY_CLAIMED` on concurrent | `poc/task-registry.js:1309-1445` |
| Callback idempotency | `handleGeminiCompletion` checks `task.gemini.status` before recording | `poc/orchestrator.js:112-114` |
| Stale claim recovery | `CLAIM_STALE_MS = 15min`; re-claims after staleness | `poc/task-registry.js:1303-1435` |

---

## 11. No-Implementation Constraint Compliance

This research task performed **no implementation**. The following constraints
were respected:

- No new control plane, dispatcher, TaskRegistry, authorization layer, or execution
  queue was created.
- No GitHub Actions workflows were modified, created, or run.
- No code files were modified.
- No commits, pushes, PRs, or workflow runs were created.
- No secrets or credentials were introduced or logged.
- The existing `main.yml`, `gemini-builder.yml`, `one-click-*` workflows,
  `poc/activation-ingress.js`, `poc/activation-policy.js`,
  `poc/task-registry.js`, `poc/orchestrator.js`,
  `services/transport-provider.js`, `services/deepseek-runtime.js`, and
  `poc/gemini-builder-trigger.js` were inspected read-only.

---

## 12. Summary: How Each AI Submits Authorized Work and Activates the Builder

### ChatGPT
1. Kyle authorizes a one-click workflow execution
2. The one-click workflow (`workflow_dispatch`, zero-input) embeds a canonical ACP
   task artifact
3. The workflow-side shim calls `/poc/activation/ingress` (admission-only)
4. Ingress validates ACP, creates TaskRegistry entry (with auto Director authn via
   `DIRECTOR_ORIGIN_SECRET`), acquires execution claim, returns server-derived
   descriptor
5. The carrier workflow invokes the Gemini Builder CLI with the descriptor
6. Builder reports completion via callback → orchestrator handles finalization

### DeepSeek
1. DeepSeek's `control_plane.request_task` tool constructs a server-derived ACP
   command (intent only; authority is server-derived)
2. The command is POSTed to `/poc/coordinator`
3. The coordinator route validates ACP compliance, protocol hash, strategic
   alignment, creates TaskRegistry entry with Director authorization
4. The coordinator calls `getDispatcher()(command)` → `dispatch()` →
   `dispatchBuilder()` → `dispatchGeminiBuilder()`
5. `dispatchGeminiBuilder` calls the GitHub API to dispatch `gemini-builder.yml`
6. The Builder workflow runs, validates through canonical ingress, executes
   Gemini Builder CLI with server-derived descriptor
7. Builder reports completion via callback

### Gemini
1. Kyle provides `@gemini-cli` directive via issue comment or `workflow_dispatch`
2. The carrier workflow builds an activation payload and calls
   `/poc/activation/ingress`
3. Ingress validates ACP, creates TaskRegistry entry, acquires execution claim,
   returns descriptor
4. The carrier workflow invokes the Gemini (Reviewer or Builder) CLI
5. For Builder: `gemini-builder.yml` executes Builder CLI with
   `GEMINI_BUILDER_API_KEY`
6. Reports completion via callback

### Unified conclusion
All three AI coordinators converge on the **same canonical admission boundary**
(`/poc/activation/ingress`) and the **same execution claim mechanism**
(`claimExecutionContext()` in TaskRegistry). The difference is the **entry point**:
- ChatGPT and Gemini use the **external activation** path (workflow-side shim →
  ingress → carrier)
- DeepSeek uses the **internal coordinator** path (`/poc/coordinator` →
  transport-provider → `gemini-builder-trigger.js` → GitHub API)

Both paths activate the **same carrier workflow** (`gemini-builder.yml`) and the
**same Builder CLI**, ensuring consistent authorization, idempotency, and
fail-closed behavior regardless of which AI coordinator initiates the work.