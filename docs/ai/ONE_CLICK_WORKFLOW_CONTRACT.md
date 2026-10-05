# One-Click Workflow Coordinator Contract

**Document Type**: Canonical coordinator operating contract
**Status**: CURRENT / IMPLEMENTED
**Owner**: Kyle — Director
**Purpose**: Durable, reusable, machine-verifiable contract that makes "one-click workflow" a project-level coordinator command, so that a fresh ChatGPT coordinator — after normal project bootstrap — automatically interprets Kyle's instruction "Make this a one-click workflow" according to the established external-activation architecture without requiring Kyle to restate the procedure or explain the implementation.

---

## 1. The One-Click Command

### 1.1 Canonical Phrase

**"Make this a one-click workflow."**

This is a **durable project command**. When Kyle states this phrase, a coordinator must interpret it as a request for a **zero-input `workflow_dispatch` activation surface** using the existing canonical external-activation architecture (`docs/ai/EXTERNAL_ACTIVATION_PROCEDURE.md`).

This command does **NOT** mean:

- "Find an existing workflow that happens to use `workflow_dispatch`."
- "Manually click through workflow inputs each time."
- "Use any workflow that requires manual parameter entry."

### 1.2 Agent/Task-Mode Variants

Kyle may specify an agent and/or task mode alongside the one-click command:

| Kyle's Instruction | Coordinator Interpretation |
|---|---|
| "Make this a one-click workflow." | Zero-input `workflow_dispatch` for the default agent (Gemini Reviewer, REVIEW read-only mode). |
| "Make this a one-click Gemini Builder workflow." | Zero-input `workflow_dispatch` targeting the Gemini Builder carrier (`.github/workflows/gemini-builder.yml`), with BUILDER task mode and full execution capabilities (`read_only, modify_files, run_tests, commit, push`). |
| "Make this a one-click Kilo workflow." | Zero-input `workflow_dispatch` or carrier activation targeting the Kilo lane, with FAILOVER_EXECUTE or REVIEW task mode per the activation policy. |

The same contract applies to all agent/task-mode variants: a zero-input trigger surface that reuses the canonical external-activation path. No separate activation procedure is constructed per variant.

---

## 2. Canonical One-Click Workflow Definition

A **one-click workflow** is a GitHub Actions workflow that satisfies **all** of the following:

1. **Zero manual inputs** — The workflow has **no required `workflow_dispatch` inputs**. All inputs are either absent or optional with defaults that allow activation with zero manual entry. The user activates the workflow by selecting it from the GitHub UI "Run workflow" dropdown and clicking "Run workflow" — no parameter entry is required.

2. **GitHub Actions `workflow_dispatch` activation surface** — The workflow trigger is `workflow_dispatch`. The activation surface is GitHub's manual workflow trigger UI.

3. **Agent and task mode determined from instruction context** — The target agent (Gemini, Gemini Builder, Kilo, etc.) and task mode (REVIEW, VERIFY_RECONCILE, FAILOVER_EXECUTE, BUILDER) are determined from the Kyle's instruction and the project's activation policy (`poc/activation-policy.js`), not from workflow inputs.

4. **Canonical external-activation admission** — The workflow routes through the canonical ingress at `POST /poc/activation/ingress` (implemented in `poc/activation-ingress.js`), guarded by `poc/validate-external-activation.js`. This performs ACP validation, TaskRegistry creation/recovery, and acquisition of an execution claim.

5. **Canonical ACP validation** — The activation envelope is validated against the ACP schema (`poc/schemas/acp-schema.js`) and the ACP engine (`poc/acp-engine.js`). All authority-bearing fields (`task_mode`, `capabilities`, `permitted_paths`, `target`, `repository`, `base_branch`) are server-derived from `ACTIVATION_POLICY` (`poc/activation-policy.js`).

6. **Existing TaskRegistry** — The workflow reuses the existing `TaskRegistry` (`poc/task-registry.js`) for task correlation, lifecycle state, and request_id tracking. No second task registry is introduced.

7. **Existing execution-claim mechanism** — The workflow reuses `claimExecutionContext()` in `poc/task-registry.js` for exactly-once execution claim enforcement. No alternate claim mechanism is introduced.

8. **Existing execution descriptor** — The workflow consumes the server-derived execution descriptor (`execution-descriptor.json`) via `jq`, not from workflow input values. The descriptor carries all authority-bearing fields from the canonical ingress to the agent.

9. **Existing authorized execution carrier** — The workflow is itself the authorized GitHub Actions execution carrier. It reads the server-derived descriptor and passes fields to the agent CLI via `ORCHESTRATION_*` environment variables. Workflow input values are used only for correlation, never for authority.

10. **Existing callback/evidence/reconciliation path** — After execution, the workflow reports completion via the existing callback to Render (`POST /gemini/callback` or `POST /builder/callback`), which updates TaskRegistry state and triggers verification/reconciliation through the existing orchestrator (`poc/orchestrator.js`).

11. **Embedded canonical ACP task carrier** — The workflow embeds the exact canonical ACP task intended to execute as a task description string within the workflow file (the "embedded carrier"). The `request_id` of the embedded carrier must match the requested task's `task_name`. The coordinator must verify the embedded carrier matches the requested task before presenting a Run link.

---

## 3. Zero-Input Requirement

### 3.1 What "Zero Input" Means

A one-click workflow must be activatable with **zero manual workflow inputs**. Specifically:

- The GitHub Actions `workflow_dispatch` trigger must not define **any required** inputs.
- Any `workflow_dispatch` input that exists must be **optional** (`required: false`) with a default value, OR must be absent entirely.
- The coordinator/activation layer determines all authority-bearing fields (agent, task mode, capabilities, permitted paths, repository, base branch) from the activation policy and instruction context — **not** from runtime workflow input entry.

### 3.2 What Does NOT Satisfy One-Click

An existing workflow using `workflow_dispatch` **does not** satisfy the one-click requirement merely because it uses `workflow_dispatch`. It must also satisfy the zero-input rule above.

Specifically, these are **NOT** one-click workflows:

- A `workflow_dispatch` workflow with required inputs (`request_id`, `task`, `repository`, `base_branch`, etc.). The coordinator must **not** treat this as one-click. The current `main.yml` and `gemini-builder.yml` workflows have required inputs and therefore **do not satisfy** the zero-input one-click requirement.
- A `workflow_dispatch` workflow that requires the caller to fill in `task_mode`, `capabilities`, `permitted_paths`, or other authority-bearing fields via manual input. These must be server-derived.
- A workflow that requires separate manual steps (e.g., a separate "Submit Director approval" step that the user must trigger independently).

### 3.3 Current Workflow Status

| Workflow | Trigger | Required Inputs | One-Click? |
|---|---|---|---|
| `.github/workflows/main.yml` | `issue_comment` + `workflow_dispatch` | `request_id`, `task`, `repository`, `base_branch` (all required) | **NO** |
| `.github/workflows/gemini-builder.yml` | `workflow_dispatch` | `request_id`, `task`, `repository`, `base_branch`, `builder_execution_id` (all required) | **NO** |
| `.github/workflows/one-click-gemini-activation-verify-reconcile.yml` | `workflow_dispatch` | (none) | **YES** |
| `.github/workflows/one-click-gemini-builder-smoke.yml` | `workflow_dispatch` | (none) | **YES** |
| `.github/workflows/one-click-gemini-builder-callback-correlation.yml` | `workflow_dispatch` | (none) | **YES** |
| `.github/workflows/one-click-gemini-research-documentation.yml` | `workflow_dispatch` | (none) | **YES** |

The one-click workflow variants listed above satisfy the zero-input requirement: their `workflow_dispatch` trigger defines no required inputs, and all authority-bearing fields are server-derived from the activation policy via the canonical ingress. Existing workflows with required inputs (`main.yml`, `gemini-builder.yml`) do NOT satisfy one-click and are not modified.

---

## 4. Task-to-Workflow Binding

### 4.1 Canonical Task Carrier

A one-click workflow embeds the canonical ACP task intended to execute as an **embedded task carrier** — a task description string within the workflow file that contains the complete ACP task envelope (`task_name`, `originator`, `target_agent`, `repository`, `base_branch`, `task_mode`, `capabilities`, `objective`, `scope`, `verification`, `constraints`, `conflict_handling`). The `request_id` of the embedded carrier must correspond exactly to the requested task's `task_name`.

### 4.2 Required Binding

When Kyle requests a one-click workflow for a **specific task**, the exact canonical ACP task intended to execute must be bound to the one-click workflow's embedded carrier. The coordinator must not present a Run link unless the embedded carrier contains the exact requested task.

### 4.3 No Task Substitution

A coordinator must not:

- Link an older one-click workflow whose embedded task is different from the requested task.
- Provide a generic workflow page whose embedded task differs from the requested task.
- Provide a Run workflow link for a workflow whose embedded task is different from the requested task.
- Construct a separate ACP task while leaving the workflow's embedded carrier unchanged.
- Claim the requested task is ready merely because an existing workflow has the correct agent or task mode but a different embedded task.

### 4.4 Exact-Task Inspection

Before presenting the Run workflow link, the coordinator must inspect the actual workflow file and verify:

- `workflow_dispatch` is zero-input (no required inputs).
- The embedded carrier exists in the workflow file.
- `target_agent` in the embedded carrier matches the requested agent.
- `task_name` in the embedded carrier matches the requested task.
- `task_mode` in the embedded carrier matches the requested task mode.
- The carrier's `objective`/`scope` correspond to the requested task.
- Authority-bearing fields remain subject to server-side activation policy rather than becoming workflow-input authority.

### 4.5 Dedicated Workflow When Necessary

If an existing one-click workflow contains a different task in its embedded carrier, the coordinator must create or update the appropriate one-click workflow before presenting a Run link. It must not silently reuse the old workflow.

### 4.6 Run-Link Validity

A Run workflow link is valid only after the referenced workflow has been independently inspected and confirmed to contain the exact task that the link is intended to execute. The coordinator must not treat an existing workflow artifact as proof that the requested task has executed.

### 4.7 Task-Mode Variants

The task-to-workflow binding rule applies equally to RESEARCH_DOCUMENT, VERIFY_RECONCILE, REVIEW, BUILDER, FAILOVER_EXECUTE, and any other policy-supported task mode.

### 4.8 Verification vs. Workflow Construction

The coordinator must distinguish:

- **Constructing/preparing the one-click workflow** — embedding the exact task and verifying zero-input + binding.
- **The Director clicking Run workflow** — external activation that triggers the workflow.
- **Verifying the resulting execution** — inspecting the executed result against the original objective.

The coordinator must not confuse an existing workflow artifact (or a completed previous execution) with proof that the requested task has executed. The existence of a workflow file with a matching task_name does not establish that the task was executed or verified.

### 4.9 Coordinator Decision Rule

> "The workflow is the executable carrier of the requested one-click task. The coordinator must verify the embedded task before presenting the Run workflow link."

This rule is the governing decision rule for all one-click workflow coordination. The coordinator must:

1. Inspect requested task → 2. Inspect candidate workflow → 3. Verify exact embedded task binding → 4. Create/update workflow if binding is absent or incorrect → 5. Independently verify workflow → 6. Present Run link → 7. Director executes click → 8. Inspect resulting execution.

---

## 5. One-Click Workflow Construction Procedure

When Kyle instructs "Make this a one-click workflow," the coordinator must follow this procedure:

### 5.1 Inspect Existing State

1. Inspect the existing workflows in `.github/workflows/`.
2. Determine if any existing one-click workflow already satisfies the one-click definition (Section 2) **and** has an embedded carrier whose `task_name` matches the requested task.
3. If a matching one-click workflow already exists, use it — do not create a duplicate.

### 5.2 Construct If Missing

If no matching one-click workflow exists:

1. **Determine the agent and task mode** from the instruction context via the activation policy (`poc/activation-policy.js`).
2. **Create a new `workflow_dispatch` workflow** (or add a one-click job to an existing workflow file) with:
   - **Zero required inputs** — The `workflow_dispatch` trigger has no required inputs. Optionally include informational inputs that are optional with defaults.
   - **Canonical activation validation** — A validation step calling `poc/validate-external-activation.js` that POSTs to `POST /poc/activation/ingress`.
   - **Server-derived orchestration context** — Consumes `execution-descriptor.json` via `jq` (NOT workflow inputs).
   - **Agent execution gated** on `activation_validated == 'true' && !replay`.
   - **Callback/evidence/reconciliation** path via the existing callback mechanism.
3. **Embed the exact ACP task** — The exact canonical ACP task intended to execute must be bound to the workflow's embedded carrier. The `request_id` of the embedded carrier must correspond exactly to the requested task's `task_name`.
4. **Determine the ACP task** — The task description, task_mode, capabilities, and permitted_paths are determined by the coordinator from the instruction context, then validated server-side by the canonical ingress. The coordinator must **not** allow workflow inputs to override authority-bearing fields.

### 5.3 Reuse Existing Architecture

A one-click workflow **MUST** reuse the following existing components and architecture:

- `POST /poc/activation/ingress` (canonical ingress)
- `poc/activation-ingress.js` (`canonicalExternalActivationIngress()`)
- `poc/activation-policy.js` (`ACTIVATION_POLICY`)
- `poc/task-registry.js` (TaskRegistry, including `claimExecutionContext()`, `buildExecutionDescriptor()`)
- `poc/schemas/acp-schema.js` (ACP schema validation)
- `poc/acp-engine.js` (ACP engine authorization)
- `poc/validate-external-activation.js` (workflow-side admission shim)
- `poc/external-activation-validator.js` (payload builder)
- Existing callback routes: `POST /gemini/callback`, `POST /builder/callback`
- Existing orchestrator: `poc/orchestrator.js`
- Existing GitHub Actions workflow syntax and step patterns

---

## 6. Prohibited Patterns

A one-click workflow **MUST NOT**:

1. Create a second control plane. There is one control plane: ACP + TaskRegistry + the existing orchestrator/dispatcher.
2. Create a second TaskRegistry. TaskRegistry (`poc/task-registry.js`) is the sole task-state mechanism.
3. Introduce an alternate authorization mechanism. Server-derived authority from `ACTIVATION_POLICY` is the sole authorization path.
4. Introduce an alternate execution-claim mechanism. `claimExecutionContext()` in `poc/task-registry.js` is the sole claim mechanism.
5. Use an alternate activation architecture. All external activations route through `POST /poc/activation/ingress`.
6. Treat workflow input values as authority for `task_mode`, `capabilities`, `permitted_paths`, `target`, `repository`, or `base_branch`. These are server-derived from the execution descriptor.
7. Bypass ACP validation. Every activation must pass `validateACPCompliance` and `acpEngine.validate`.
8. Require manual entry of authority-bearing fields. The whole point of "one-click" is zero-input activation.

---

## 7. Coordinator Interpretation Procedure

When Kyle says **"Make this a one-click workflow."**, the coordinator must:

1. **Classify the request** — Recognize this as a one-click workflow request per this contract.
2. **Inspect the repository** — Check `.github/workflows/` for an existing one-click workflow that satisfies the zero-input `workflow_dispatch` + canonical external-activation contract **and** whose embedded carrier matches the requested task.
3. **Determine the result**:
   - If a matching one-click workflow exists → verify the embedded task binding (Section 4) and use it. No new workflow is needed.
   - If no matching one-click workflow exists → construct one following Section 5.
4. **Determine agent/task mode** — For the plain phrase, default to the standard coordinator activation (REVIEW read-only). If Kyle names an agent (e.g., "Gemini Builder workflow"), apply the matching target and task mode from the activation policy.
5. **Determine ACP task** — Construct the ACP task envelope per `docs/ai/TASK_STANDARD.md`, setting the task_mode, capabilities, and permitted_paths that the activation policy requires for the target agent.
6. **Verify task-to-workflow binding** — Verify the embedded carrier matches the requested task per Section 4.3–4.6.
7. **Preserve all invariants** — Reuse the existing TaskRegistry, execution-claim mechanism, execution descriptor, ACP validation, callback/evidence/reconciliation path. Do not introduce duplicates or alternate mechanisms.

### 6.1 Example: "Make this a one-click Gemini Builder workflow."

1. Recognize as a one-click workflow request targeting the Gemini Builder carrier.
2. Inspect `.github/workflows/gemini-builder.yml` — it has required inputs, so it does **not** satisfy one-click.
3. Construct a zero-input variant: a `workflow_dispatch` trigger with no required inputs that validates through the canonical ingress, consumes the server-derived descriptor, and executes Gemini Builder with the BUILDER task mode and server-derived `read_only,modify_files,run_tests,commit,push` capabilities.
4. The activation policy (`poc/activation-policy.js`) derives the target as `Gemini Builder`, the task mode as `BUILDER`, and the capabilities as the required BUILDER capability set.
5. The coordinator does **not** invent a new activation path — it reuses the canonical external-activation architecture.

---

## 7. Cold-Start Discoverability

This contract is discoverable through the documented ChatGPT cold-start path:

```
AGENTS.md
→ ARCHITECTURE.md
→ docs/ai/README.md
→ docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md
→ docs/ai/TASK_STANDARD.md
→ docs/ai/STATE.md
→ docs/ai/CONTROL_CENTER.md
→ docs/ai/TASK_LOG.md
```

### 7.1 Cold-Start Path References

- `docs/ai/CHATGPT_START_HERE.md` — Bootstrap Completion Check item (line §7) references this contract as part of the authoritative project-control documents.
- `docs/ai/README.md` — File Contents section lists this contract as a normative project-control document.
- `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` — Section 11.1 links this contract alongside `EXTERNAL_ACTIVATION_PROCEDURE.md` as the canonical procedure for one-click/zero-input external activation.

A fresh coordinator following the cold-start path will encounter this contract before making any activation or workflow construction decision.

---

## 8. Machine Verification

The one-click workflow contract is machine-verifiable. Tests live in:

- `test/one-click-workflow-contract.test.js`

These tests verify:

1. **Canonical phrase definition** — "Make this a one-click workflow" has an explicit normative definition in `docs/ai/ONE_CLICK_WORKFLOW_CONTRACT.md`.
2. **Zero-input requirement** — The contract explicitly requires zero required `workflow_dispatch` inputs.
3. **Existing workflow distinction** — The contract explicitly states that `main.yml` and `gemini-builder.yml` do NOT satisfy the one-click requirement because they have required inputs.
4. **Agent/task-mode variants** — The contract covers agent/task-mode variants (e.g., "Make this a one-click Gemini Builder workflow").
5. **Cold-start discoverability** — The contract is referenced from the documented cold-start path (`CHATGPT_START_HERE.md`, `README.md`, `CHATGPT_PROJECT_OPERATING_PROTOCOL.md`).
6. **Architecture reuse** — The contract explicitly requires reuse of the canonical external-activation architecture and prohibits second control planes / TaskRegistries.
7. **Implementation file references** — The contract references real implementation files (`poc/activation-ingress.js`, `poc/activation-policy.js`, `poc/task-registry.js`, `poc/schemas/acp-schema.js`, `poc/acp-engine.js`, `poc/validate-external-activation.js`, `poc/external-activation-validator.js`).
8. **Task-to-workflow binding** — The contract requires the embedded carrier in a one-click workflow to contain the exact requested task, and prohibits task substitution.
9. **No task substitution** — The contract prohibits linking an older workflow, providing a generic page, or claiming readiness when the embedded task differs from the requested task.
10. **Exact-task inspection** — The contract requires inspection of the actual workflow file to verify zero-input, embedded carrier, target_agent, task_name, task_mode, and objective/scope match.
11. **Run-link validity** — The contract requires independent verification of the workflow before presenting a Run link.
12. **Verification vs. construction distinction** — The contract distinguishes workflow construction, Director Run click, and execution verification.

---

## 9. Relationship to External Activation Procedure

This contract builds on the canonical external-activation procedure documented in `docs/ai/EXTERNAL_ACTIVATION_PROCEDURE.md`. That procedure defines:

- The canonical ingress: `POST /poc/activation/ingress`
- Admission-only semantics (no double-dispatch)
- Server-derived authority fields
- Execution-claim mechanism (exactly-once)
- Execution descriptor consumption via `jq`
- Replay/idempotency
- Director authorization for consequential commands

This one-click contract defines the **additional** requirement that a one-click workflow must have **zero required workflow_dispatch inputs** and must derive all parameters from the activation context via the canonical external-activation procedure. It does not redefine or replace the external-activation procedure; it specifies the zero-input constraint on top of it.

---

## 10. Summary of Invariants

| Invariant | Status |
|---|---|
| "Make this a one-click workflow" is a durable project command | **ENFORCED** |
| A one-click workflow requires zero `workflow_dispatch` inputs | **ENFORCED** |
| A one-click workflow uses `workflow_dispatch` trigger | **ENFORCED** |
| Agent/task mode is determined from instruction context, not inputs | **ENFORCED** |
| Canonical external-activation admission is required | **ENFORCED** |
| Server-derived authority is required (no input authority) | **ENFORCED** |
| Existing TaskRegistry is reused (no second registry) | **ENFORCED** |
| Existing execution-claim mechanism is reused | **ENFORCED** |
| Existing execution descriptor is consumed via `jq` | **ENFORCED** |
| Existing callback/evidence/reconciliation path is reused | **ENFORCED** |
| No second control plane, authorization, or activation mechanism | **ENFORCED** |
| A specific-task one-click request must bind the exact canonical ACP task to the embedded carrier | **ENFORCED** |
| No task substitution — no linking older/different-task workflows, no generic pages, no separate ACP task with unchanged carrier | **ENFORCED** |
| Exact-task inspection required before presenting a Run link (zero-input, embedded carrier, target_agent, task_name, task_mode, objective/scope) | **ENFORCED** |
| A Run workflow link is valid only after the referenced workflow is independently inspected and confirmed to contain the exact task | **ENFORCED** |
| Dedicated workflow created/updated when an existing one-click workflow contains a different task | **ENFORCED** |
| Verification vs. workflow construction distinction enforced | **ENFORCED** |
| Discoverable from the documented cold-start path | **ENFORCED** |
