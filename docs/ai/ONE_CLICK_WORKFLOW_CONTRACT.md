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

### 4.5 Existing Carrier + Wrong Task

If an existing zero-input one-click workflow contains a different task in its embedded carrier, the coordinator must **update that existing carrier to the requested task, then revalidate the carrier** before presenting a Run link. The governing rule is:

> **Existing carrier + wrong task = update the carrier, then revalidate.**

The coordinator must not treat the existing task as authoritative merely because the workflow, agent, or task mode already matches. It must not silently reuse the old task or create a second activation architecture when the existing carrier can be retargeted.

### 4.6 Run-Link Validity

A Run workflow link is valid only after the referenced workflow has been independently inspected and confirmed to contain the exact task that the link is intended to execute. The coordinator must not treat an existing workflow artifact as proof that the requested task has executed.

### 4.7 Task-Mode Variants

The task-to-workflow binding rule applies equally to RESEARCH_DOCUMENT, VERIFY_RECONCILE, REVIEW, BUILDER, FAILOVER_EXECUTE, and any other policy-supported task mode.

### 4.8 Copy-Safe JSON Task-Authoring Instructions

The embedded canonical ACP task carrier is a JSON string literal. To remain copy-safe and pass the one-click preflight validation (`poc/validate-external-activation.js one-click-preflight`), the carrier must satisfy the following rules:

1. **Use standard double-quote delimiters (U+0022 `"`)** for all JSON keys and string values. **Never** use smart/curly quotation marks (U+2018 `'`, U+2019 `'`, U+201C `"`, U+201D `"`, U+201A `‚`, U+201B `‛`, U+201E `„`, U+201F `‟`). The preflight validator rejects any such character with error code `MALFORMED_JSON_SMART_QUOTE`.

2. **Use canonical field ordering** as enforced by `validateCanonicalFieldOrder()` in `poc/schemas/acp-schema.js`. The canonical order is:
   `task_name`, `originator`, `target_agent`, `repository`, `base_branch`, `task_mode`, `capabilities`, `objective`, `scope`, `verification`, `constraints`, `conflict_handling`.
   The field `task_name` must appear **first**; `capabilities` must appear **immediately before** `objective`. Fields must not be reordered or omitted from required positions.

3. **`capabilities` must be a JSON array** of strings, not a single string. For FAILOVER_EXECUTE the canonical capability set is `["read_only", "modify_files", "run_tests", "commit", "push"]`. Each capability must be present in `VALID_CAPABILITIES` in the schema.

4. **`scope` must be a JSON object** with a `permitted_paths` array of strings. Every path in `permitted_paths` must fall within the server-defined `MAX_AUTHORIZED_PATHS` boundary in `poc/activation-policy.js` (currently `docs/`, `test/`, `poc/`, `.github/workflows/main.yml`, `.github/workflows/gemini-builder.yml`, `.github/workflows/one-click-kilo-acp-copy-safe.yml`). Paths outside this boundary are rejected with error code `PATH_OUTSIDE_MAX_BOUNDARY`.

5. **`target_agent` must be one of `VALID_AGENTS`** in the schema: `Kilo`, `Gemini`, `Gemini Builder`, `Security Specialist`, `Utility Specialist`.

6. **`task_mode` must be one of `VALID_TASK_MODES`** (runtime-accepted values): `REVIEW`, `VERIFY_RECONCILE`, `FAILOVER_EXECUTE`, `BUILDER`, `RESEARCH_DOCUMENT`. The conceptual Director-facing modes `PLAN` and `EXECUTE` are **not** literal task_mode values — `PLAN` is rejected as `INVALID_TASK_MODE`; `EXECUTE` is mapped to `FAILOVER_EXECUTE` at the Director layer per `TASK_STANDARD.md` Section 9.

7. **No comments, trailing commas, single-quoted strings, or unquoted keys**. The embedded text is parsed with `JSON.parse()` only — YAML-like text is rejected as `MALFORMED_JSON`.

8. **No em-dashes or non-ASCII curly punctuation inside string values**. Use `--` (two hyphens) for em-dashes within string values (e.g., `"Kyle -- Director"`). Any non-standard Unicode punctuation in a string value can cause copy-paste or encoding issues.

9. **Validate before committing**: After editing the workflow file, run:
   ```sh
   node poc/validate-external-activation.js one-click-preflight '{"workflow_dir": ".github/workflows"}'
   ```
   This validates that the embedded carrier is valid JSON, has canonical field ordering, has no smart quotes, and has permitted paths within the `MAX_AUTHORIZED_PATHS` boundary. The output must show `all_valid: true`.

10. **Minimal example**:
    ```json
    {"task_name":"EXAMPLE-TASK-001","originator":"Kyle -- Director","target_agent":"Kilo","repository":"fluentwithkyle/openclaw-webhook","base_branch":"main","task_mode":"FAILOVER_EXECUTE","capabilities":["read_only","modify_files","run_tests","commit","push"],"objective":"Example task.","scope":{"permitted_paths":["poc/"]},"verification":"Verify implementation.","constraints":["smallest-change"],"conflict_handling":"Preserve server-derived authority."}
    ```

---

### 4.9 Verification vs. Workflow Construction

The coordinator must distinguish:

- **Constructing/preparing the one-click workflow** — embedding the exact task and verifying zero-input + binding.
- **The Director clicking Run workflow** — external activation that triggers the workflow.
- **Verifying the resulting execution** — inspecting the executed result against the original objective.

The coordinator must not confuse an existing workflow artifact (or a completed previous execution) with proof that the requested task has executed. The existence of a workflow file with a matching task_name does not establish that the task was executed or verified.

### 4.10 Machine-Enforced Binding Gate

The task-to-workflow binding is a fail-closed machine gate, not a coordinator judgment call. The repository test suite implements the gate against embedded carrier fields and regression fixtures.

The gate evaluates a requested `{ task_name, target_agent, task_mode }` against a candidate one-click workflow and permits readiness only when all of these are true:

1. The workflow uses `workflow_dispatch` with no required inputs.
2. An embedded `task_name`, `target_agent`, and `task_mode` are present.
3. `task_name` exactly equals the requested `task_name`.
4. `target_agent` exactly equals the requested agent.
5. `task_mode` exactly equals the requested task mode.
6. The workflow routes through the canonical external-activation path.

The gate returns the explicit state model:

`CARRIER_NOT_FOUND` → `CARRIER_FOUND` → `CARRIER_TASK_MISMATCH` → `CARRIER_READY` → `EXECUTION_STARTED` → `EXECUTION_VERIFIED`.

A task mismatch, agent mismatch, task-mode mismatch, required input, missing carrier field, or non-canonical activation path is **not ready** and must fail closed. A coordinator may retarget an existing carrier, but the carrier must pass the gate again after the update and before its Run link is considered valid.

This machine gate verifies workflow readiness; it does not claim that the resulting task executed. Execution remains a separate activation and verification step.

### 4.11 Coordinator Decision Rule

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
13. **Workflow registration/runnability gate** — Section 9 establishes that GitHub workflow registration/runnability must be independently established via an authoritative GitHub-hosted signal before a Run link is presented, and that repository-local YAML inspection alone is insufficient (the 2026-09-16 registration incident is referenced).
14. **Fail-closed registration** — The contract requires BLOCKED/NOT READY when GitHub registration/runnability cannot be established, and prohibits treating YAML existence as proof of GitHub recognition.
15. **VERIFIED / INFERRED / UNKNOWN classification** — Section 9.8 defines the evidence-classification terms and requires the coordinator to distinguish direct evidence from inference.

---

## 9. Workflow Registration & Runnability Gate

### 9.1 The Registration Failure Class

A workflow file **existing on the repository default branch** with a `workflow_dispatch` trigger and zero required inputs does **NOT** establish that GitHub Actions has registered, parsed, or recognized the workflow as runnable. The Gemini workflow registration incident of 2026-09-16 (`docs/ai/GEMINI_WORKFLOW_REGISTRATION_INCIDENT_2026-09-16.md`) confirmed that GitHub can fail to register a workflow — including `workflow_dispatch` not being recognized as a valid trigger (HTTP 422 "workflow did not have the workflow_dispatch trigger") — when the workflow YAML contains a construct GitHub Actions cannot successfully parse.

This is the recurring coordinator failure the one-click gate closes: **workflow file exists on main + `workflow_dispatch` exists** was incorrectly treated as proof that **GitHub has registered the workflow + the workflow is actually runnable via the Run workflow UI**.

### 9.2 Registration & Runnability Requirement

Before a coordinator may present a "Run workflow" link for a one-click workflow, the coordinator must independently establish **GitHub workflow registration/runnability**. Specifically, all of the following must hold:

1. **Workflow file exists on the repository default branch** — repository-local evidence only (file presence on the default branch).
2. **`workflow_dispatch` trigger** — repository-local evidence (YAML parse of the trigger).
3. **Zero required `workflow_dispatch` inputs** — repository-local evidence (YAML parse of inputs).
4. **Exact requested task bound to the embedded canonical ACP carrier** — repository-local evidence (embedded task_name, target_agent, task_mode match).
5. **Target agent and task mode match the requested task** — repository-local evidence.
6. **GitHub Actions has recognized the workflow as a valid workflow rather than merely existing as repository YAML** — this requires an **authoritative GitHub-hosted signal** (see §9.4).
7. **Manual dispatch is independently established as runnable** — the workflow must be selectable in the GitHub UI "Run workflow" dropdown and dispatchable without GitHub returning a registration error — requires an **authoritative GitHub-hosted signal** (see §9.4).
8. **Any registration/availability failure is classified as BLOCKED / NOT READY** rather than inferred away.
9. **The coordinator does not provide a Run link until all required gates pass.**

### 9.3 Repository-Local Evidence vs. Authoritative GitHub Signals

The coordinator must distinguish what repository-local state can establish from what requires an authoritative GitHub Actions signal:

| Requirement | Evidence Source | Verifiable In-Repo? | Classification |
|---|---|---|---|
| Workflow file exists on default branch | Repository file tree | **VERIFIED** (repo-local) | Repository-local |
| `workflow_dispatch` trigger present | YAML parse | **VERIFIED** (repo-local) | Repository-local |
| Zero required inputs | YAML parse | **VERIFIED** (repo-local) | Repository-local |
| Embedded ACP carrier present and bound | YAML text search | **VERIFIED** (repo-local) | Repository-local |
| target_agent / task_name / task_mode match | Embedded carrier inspection | **VERIFIED** (repo-local) | Repository-local |
| GitHub has registered the workflow | GitHub API (`workflow_id`), Actions UI, or workflow run history | **NOT VERIFIABLE** (repo-local) | Authoritative GitHub signal |
| Workflow is selectable in "Run workflow" dropdown | GitHub UI / API `workflow` object `state` | **NOT VERIFIABLE** (repo-local) | Authoritative GitHub signal |
| Workflow is dispatchable (manual run succeeds) | Actual `workflow_dispatch` run with `completed` or `action_required` status | **NOT VERIFIABLE** (repo-local) | Authoritative GitHub signal |

### 9.4 Authoritative GitHub Registration Signal

Registration/runnability **cannot** be proven from repository-local YAML inspection alone. The authoritative signals that GitHub recognizes a workflow as registered and runnable are:

- **GitHub REST API `GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}`** returning a `workflow` object with a non-null `workflow_id` and `state` field (e.g., `state: active`). A workflow that GitHub cannot parse will **not** appear in this API response or will be absent from the workflows list.
- **The workflow appearing in the GitHub UI "Set up a workflow" / "Run workflow" dropdown** as a selectable, non-disabled entry.
- **A `workflow_dispatch` run transitioning out of `waiting` to `in_progress` or a terminal state** (`completed`, `failure`, `cancelled`), proving the workflow was dispatchable.

Repository-local tests **cannot** query these GitHub-hosted signals. The coordinator must either:

(a) consult an **authoritative GitHub API / UI check** performed by the Director or an authorized verification agent (e.g., a `VERIFY_RECONCILE` task that queries `GET /repos/{owner}/{repo}/actions/workflows` and confirms the workflow `state: active`), or
(b) **fail closed** — classify the workflow as `BLOCKED / NOT READY` and **not** present a Run link until a verifiable GitHub-hosted registration signal is provided.

### 9.5 Fail-Closed Registration Gate

The coordinator's decision procedure for presenting a one-click "Run workflow" link is:

```
1. Inspect the workflow file on the default branch (repository-local).
2. Verify zero-input workflow_dispatch (repository-local).
3. Verify the embedded ACP carrier matches the requested task (repository-local).
4. Attempt to establish GitHub registration/runnability:
   a. If an authoritative GitHub signal confirms state: active and dispatchable → VERIFIED → present Run link.
   b. If no authoritative GitHub signal is available → INFERRED/UNKNOWN → BLOCKED/NOT READY → do NOT present Run link.
   c. If an authoritative GitHub signal reports registration failure (workflow absent from API, HTTP 422, or dropdown missing) → BLOCKED/NOT READY → do NOT present Run link.
5. The coordinator must NOT treat (1)-(3) alone as sufficient for presenting a Run link.
```

### 9.6 What Repository-Local Tests Can and Cannot Prove

Repository-local machine tests can prove:

- The workflow file exists at the expected path on the default branch.
- The workflow YAML parses successfully (structural validity).
- The `workflow_dispatch` trigger is present with zero required inputs.
- The embedded ACP carrier fields (task_name, target_agent, task_mode) are present and match expected values.
- The workflow references the canonical ingress, consume the execution descriptor, and route through the canonical activation architecture.

Repository-local machine tests **cannot** prove:

- That GitHub Actions has parsed/registered the workflow (the 2026-09-16 incident is direct evidence that YAML existence ≠ GitHub registration).
- That the workflow is selectable in the "Run workflow" dropdown.
- That a `workflow_dispatch` invocation will succeed rather than return a registration error.

When GitHub registration/runnability cannot be established, the coordinator must report `BLOCKED / NOT READY` with the concrete missing evidence (an authoritative GitHub-hosted signal) rather than inferring readiness from YAML inspection alone.

### 9.7 Regression Protection

The existing one-click workflows that are already registered and runnable remain subject to this gate. A future workflow-change that introduces a GitHub-unparseable construct must **fail this gate** (BLOCKED/NOT READY) even if the file still exists on `main` with `workflow_dispatch`. The contract does not weaken existing one-click requirements to accommodate the new gate.

### 9.8 Evidence Classification

| Term | Meaning |
|---|---|
| **VERIFIED** | Directly established by authoritative evidence or tooling (e.g., repository file-tree check, YAML parse, GitHub API returning `state: active`). |
| **INFERRED** | Logically likely but not directly established by an authoritative signal (e.g., "a YAML file with `workflow_dispatch` probably registered" — this is explicitly rejected as insufficient). |
| **UNKNOWN** | Cannot be established from available evidence (e.g., GitHub registration state queried only from repository-local code without the GitHub API). |

The coordinator must record the evidence classification for each gate. GitHub workflow registration/runnability is UNKNOWN until an authoritative GitHub-hosted signal is consulted, and the coordinator must fail closed in that state.

## 10. Relationship to External Activation Procedure

This contract builds on the canonical external-activation procedure documented in `docs/ai/EXTERNAL_ACTIVATION_PROCEDURE.md`. That procedure defines:

- The canonical ingress: `POST /poc/activation/ingress`
- Admission-only semantics (no double-dispatch)
- Server-derived authority fields
- Execution-claim mechanism (exactly-once)
- Execution descriptor consumption via `jq`
- Replay/idempotency
- Director authorization for consequential commands

This one-click contract defines the **additional** requirement that a one-click workflow must have **zero required workflow_dispatch inputs** and must derive all parameters from the activation context via the canonical external-activation procedure. **Section 9 (Workflow Registration & Runnability Gate)** adds the requirement that GitHub registration/runnability must be independently established before a Run link is presented, and that repository-local YAML inspection alone is insufficient. This section does not redefine or replace the external-activation procedure; it specifies the zero-input and registration constraints on top of it.

---

## 11. Summary of Invariants

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
| GitHub workflow registration/runnability must be independently established before presenting a Run link; repository-local YAML inspection alone is insufficient | **ENFORCED** |
| Registration/availability failure is classified BLOCKED/NOT READY, not inferred away | **ENFORCED** |
| VERIFIED / INFERRED / UNKNOWN evidence classification applied to registration gate | **ENFORCED** |

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
