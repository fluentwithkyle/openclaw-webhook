# AI Project State System

## Purpose

This directory (`docs/ai/`) is the persistent, repository-resident memory for AI agents working on the `fluentwithkyle/openclaw-webhook` repository. It replaces reliance on transient conversation memory and provides a durable source of project context, decisions, and history.

## Cold-Start Entry Point

A completely fresh ChatGPT instance — with no prior conversation, memory, or
project-specific context — must begin at:

**`docs/ai/CHATGPT_START_HERE.md`**

This is the **canonical bootstrap contract** and cold-start entry point. It establishes
repository identity, defines ChatGPT's coordinator role, locates the authoritative
project-control documentation, defines the three mandatory preparation phases
(Project Bootstrap, Protocol Review, Repository/State Verification), specifies the
Bootstrap Completion Check, and defines the fail-closed bootstrap result. It
identifies the DeepSeek Coordinator as an existing project, explains that project
discovery cannot rely on keyword search alone, and defines the mandatory
initialization reading path. The operating protocol references and depends on this
contract and does not redefine it.

Do not bypass this document when initializing from a cold-start condition.

## When to Read

**All AI agents** working in this repository must consult the relevant files in `docs/ai/` before planning or implementing work:

- **Before starting any task**: Read `STATE.md` for current project state, active tasks, and blockers.
- **Before making architectural decisions**: Read `ARCH_DECISIONS.md` for recorded decisions and rationale.
- **Before implementing**: Check `TASK_LOG.md` for recent completed work to avoid duplication.
- **When uncertain about operating rules**: Re-read this `README.md`.

## Gemini Task Activation

To initiate a single Gemini work task through the repository's established activation procedure:

1. **Issue description**: Put the full task requirements in the GitHub issue body. The issue description contains the complete task requirements — not merely a summary.
2. **Activation comment**: Post an activation comment, beginning with:
   `@gemini-cli`
   The activation comment activates the task and confirms authorization. It does not need to repeat the issue description in full.
3. The activation comment is the Gemini activation trigger.

### Activation semantics

Gemini must treat the **issue description and the activation comment together as the complete task instruction**.

- **Issue description = full task requirements.** The issue body contains every requirement, constraint, and acceptance criterion for the task.
- **Activation comment = activation + authorization.** The `@gemini-cli` comment triggers the task and confirms that Kyle has authorized Gemini to proceed.
- **Read both together.** Gemini must read the issue description and the activation comment as a combined instruction set. Do not rely on the activation comment alone when the issue description contains additional requirements.
- **No silent override.** The activation comment must not silently replace, shorten, or override the issue description. Gemini must not discard or ignore requirements stated in the issue description merely because they are absent or abbreviated in the activation comment.
- **Conflicts require clarification.** If the activation comment and the issue description conflict, Gemini must identify the conflict and stop for clarification rather than proceeding or choosing one over the other.

These rules preserve the existing activation procedure and role boundaries. The role boundaries defined in `GEMINI.md`, `AGENTS.md`, and `ARCHITECTURE.md` remain authoritative and are not altered by this rule.

Future AI systems should follow these requirements when preparing and initiating Gemini tasks.

## Terminology and Artifact Retrieval

This section establishes the **project-wide deterministic interpretation** of natural-language references to Gemini's output. It applies to all project agents and actors when interpreting or retrieving Gemini's report, regardless of which agent performs the retrieval.

### Gemini Report Terminology → Artifact Mapping

Requests that refer to Gemini's output using natural-language references — including, but not limited to:

- "Gemini's report"
- "Gemini's results"
- "look at Gemini's report"
- "get Gemini's results"
- "find Gemini's report"
- "retrieve Gemini's report"
- "check Gemini's report"
- "go look at her report"
- "the Gemini result"
- any equivalent natural-language reference to Gemini's output

are **deterministically interpreted** as a request to retrieve the:

**`gemini-acp-report` GitHub Actions artifact**

produced by the relevant completed Gemini workflow run.

### Canonical Source

The `gemini-acp-report` artifact (containing `gemini-acp-report.json`) is the **canonical project-wide source** for Gemini-generated reports and all artifact-based Gemini output.

### Machine-Readable Filing Fields (Workflow Completion Output)

On workflow completion, the `gemini-acp-report` artifact filing status step (in `.github/workflows/main.yml`) exposes the following **machine-readable fields**. These fields are the deterministic retrieval location. `filing_status: SUCCESS` alone is **not** a retrieval location and is **not** evidence that the research itself has been inspected.

| Field | Description |
|---|---|
| `filing_status` | `SUCCESS` when the `gemini-acp-report` artifact was successfully uploaded; `FAILED` when the upload step failed; `UNKNOWN` when the outcome is missing/skipped. |
| `artifact_name` | The canonical GitHub Actions artifact name: `gemini-acp-report`. |
| `artifact_file` | The canonical payload file inside the artifact: `gemini-acp-report.json`. |
| `artifact_id` | The GitHub-assigned numeric artifact ID exposed by the native `actions/upload-artifact@v4` output (`steps.upload_gemini_result.outputs.artifact-id`). This is the exact machine-readable identity of the uploaded artifact, used to identify it without guessing among multiple artifacts in a run. |
| `workflow_run_id` | The GitHub Actions `run_id` of the completed Gemini workflow run (integer). |
| `workflow_run_url` | The GitHub Actions run URL: `https://github.com/<repository>/actions/runs/<workflow_run_id>`. |
| `artifact_url` | The browser run page URL where the `gemini-acp-report` artifact is listed: `https://github.com/<repository>/actions/runs/<workflow_run_id>`. An actual artifact download requires an authenticated GitHub API token; `artifact_url` is **not** a no-auth download link and no secret-bearing or authenticated download URL is embedded. |

On **failed or indeterminate** artifact filing (`filing_status: FAILED` or `filing_status: UNKNOWN`), the completion output reports FAILED or UNKNOWN rather than implying successful persistence. The Durable Completion Output must not treat Gemini's textual response, issue comment, workflow conclusion, Job Summary, or generic upload success as the research itself.

### Deterministic Retrieval Procedure

The retrieval chain is:

```
Gemini
→ GitHub Actions (`.github/workflows/main.yml` — Gemini Architect and Reviewer workflow)
→ gemini-acp-report.json
→ gemini-acp-report GitHub Actions artifact
→ Agent retrieval / review
```

To retrieve the canonical Gemini report deterministically, an agent MUST follow this exact procedure:

1. **Obtain the workflow run identifier.** Use the machine-readable filing fields exposed by the workflow's "Report artifact filing status" step. The authoritative fields are `filing_status`, `artifact_name`, `artifact_file`, `artifact_id`, `workflow_run_id`, and `workflow_run_url`. The `artifact_id` is the GitHub-assigned numeric artifact ID (from the native `actions/upload-artifact@v4` output) that uniquely identifies the uploaded artifact without guessing among multiple artifacts in a run. If these fields are unavailable in a prior run's output, resolve the relevant run deterministically from the immediately preceding Gemini execution context (see "Resolving the Relevant Run" below).
2. **Inspect the filing status.** If `filing_status` is `FAILED` or `UNKNOWN`, the artifact was not successfully filed. Do **not** treat the workflow conclusion, Job Summary, or any textual response as proof of filing. Report the filing failure as NOT YET VERIFIED and stop — the canonical artifact was not produced.
3. **Inspect the workflow run.** Using `workflow_run_id` or `workflow_run_url`, open the completed `Gemini Architect and Reviewer` workflow run in `.github/workflows/main.yml`.
4. **Locate the artifact.** In that workflow run's "Artifacts" section, locate the artifact whose identity matches `artifact_name` (`gemini-acp-report`) and whose ID matches `artifact_id`. Use the `artifact_id` to identify the exact uploaded artifact when multiple artifacts are present in the run.
5. **Retrieve/inspect the payload.** Download the artifact and extract the file named exactly `gemini-acp-report.json` (the value of `artifact_file`).
6. **Read the report.** Read and inspect `gemini-acp-report.json` as the authoritative Gemini result for that execution.
7. **Navigate to durable research (when applicable).** If the task was a `RESEARCH_DOCUMENT` task, the canonical `gemini-acp-report.json` payload contains an explicit `durable_research_record_path` field binding the report to its durable Markdown research record under `docs/ai/research/`. Inspect that research record for the underlying persistent research. Do NOT infer the research path from task naming or conversational context — follow the report's explicit `durable_research_record_path` reference. If no `durable_research_record_path` field is present or it is null, that linkage is NOT established and must not be assumed.

This procedure is repository retrieval procedure, not a new persistence mechanism, control plane, or authorization path. An agent MUST NOT guess the artifact name, payload file, run ID, or run URL; it MUST use the machine-readable filing fields or deterministically resolve the run as described.

### Fail-Closed Verification Gate

**Gemini execution is not independently verified until the `gemini-acp-report` artifact has been retrieved and `gemini-acp-report.json` has been inspected.** This is a mandatory, project-wide completion gate. If the canonical artifact has not been retrieved and `gemini-acp-report.json` has not been inspected, the result MUST be reported as **NOT YET VERIFIED** regardless of any secondary signal.

### Retrieval Path

The retrieval chain is:

```
Gemini
→ GitHub Actions (`.github/workflows/main.yml` — Gemini Architect and Reviewer workflow)
→ `gemini-acp-report.json` (the `artifact_file` field)
→ `gemini-acp-report` GitHub Actions artifact (the `artifact_name` field)
→ Agent retrieval / review
```

The workflow run is identified by the machine-readable `workflow_run_id` and `workflow_run_url` fields exposed by the filing-status step.

### Resolving the Relevant Run

When multiple completed Gemini workflow runs exist, the **relevant run** is resolved deterministically from the immediately preceding Gemini execution / task context — the Gemini workflow run associated with the most recent Gemini task, activation, or execution relevant to the current request. Correlation uses the machine-readable `filing_fields` (`workflow_run_id`, `workflow_run_url`) exposed by the filing-status step, and otherwise available durable identifiers in priority order: the orchestration `request_id`, then the issue number / issue-comment event, then the Kilo commit SHA, then the event type (`issue_comment` vs. `workflow_dispatch`), then the workflow run timestamp. Identifiers are never invented; only identifiers present in the durable GitHub state are used. If the first lookup does not locate the execution, the discovery chain must be continued rather than concluding the artifact does not exist. The relevant run is the run that yields the canonical `gemini-acp-report` artifact.

### Fail-Closed Verification Gate

**Gemini execution is not independently verified until the `gemini-acp-report` artifact has been retrieved and `gemini-acp-report.json` has been inspected.** This is a mandatory, project-wide completion gate. If the canonical artifact has not been retrieved and `gemini-acp-report.json` has not been inspected, the result MUST be reported as **NOT YET VERIFIED** regardless of any secondary signal.

The canonical `gemini-acp-report` artifact and `gemini-acp-report.json` payload are the sole authoritative source for Gemini-generated reports. The following are NOT substitutes for inspecting the canonical artifact: Gemini's chat/comment response; Gemini's completion report; GitHub issue comments; workflow conclusion; workflow annotations; Job Summary; artifact-upload status; the `filing_status` field alone (SUCCESS is not a retrieval location); or an assistant's prior memory of the execution. This rule is the single project-wide definition; the ChatGPT-specific procedural implementation lives in `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` (Section 5). No second or competing retrieval mechanism is established.

### Canonical Report vs. Durable Research Record

The canonical Gemini ACP report artifact (`gemini-acp-report` / `gemini-acp-report.json`) is **distinct from** the underlying durable Markdown research record under `docs/ai/research/`. When a Gemini task is a `RESEARCH_DOCUMENT` task:

- The **canonical report** (`gemini-acp-report.json`) is the machine-readable execution report produced by the workflow. It is the authoritative machine-readable retrieval location.
- The **durable research record** (`docs/ai/research/research-*.md`) is the human-readable persistent research record.

The canonical report must contain an explicit `durable_research_record_path` field that binds the report to its durable Markdown research record under `docs/ai/research/`, using the repository's established `docs/ai/research/research-{task_name}.md` naming convention. The report must verify the referenced record exists and references the correct `task_name` (identity binding) before binding the path. **Fail-closed:** If a `RESEARCH_DOCUMENT` task's durable research record is missing, malformed, or cannot be verified, the canonical report MUST be marked `status: failure` with a machine-readable blocker — it MUST NOT be produced as a successful/normal completion with `durable_research_record_path: null`. Only a verified research-record path is bound to a successful RESEARCH_DOCUMENT report; non-RESEARCH_DOCUMENT tasks do not require a research-record path and the field is null. The `filing_status` field alone is not a retrieval location and is not evidence that the research record has been inspected.

### ChatGPT Procedural Retrieval

The ChatGPT-specific procedural retrieval instructions are preserved in `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md`, Section 5.1.1 (Gemini Report Discovery Procedure), which implements this project-wide definition. This project-wide definition is the single authoritative mapping; local agent procedures must not create a second or conflicting definition. ChatGPT MUST use the machine-readable filing fields (`filing_status`, `artifact_name`, `artifact_file`, `artifact_id`, `workflow_run_id`, `workflow_run_url`) exposed by the workflow's filing-status step as the primary retrieval location, and MUST NOT present `filing_status: SUCCESS` as evidence that the report has been inspected.

## File Contents

### `CHATGPT_START_HERE.md` — Cold-Start Bootstrap Contract
- Canonical cold-start entry point and **sole canonical bootstrap contract** for a completely fresh ChatGPT instance with no prior context.
- Establishes repository identity, ChatGPT's coordinator role, the mandatory
  initialization reading path, the project discovery hierarchy, the three mandatory
  preparation phases (Project Bootstrap, Protocol Review, Repository/State
  Verification), the Bootstrap Completion Check, and the fail-closed bootstrap result.
- Must be the first document consulted on cold start. No consequential action
  (including ACP task construction) may proceed until the Bootstrap Completion Check
  is satisfied.

### `CHATGPT_PROJECT_OPERATING_PROTOCOL.md` — ChatGPT Operating Protocol
- References and depends on the canonical bootstrap contract
  (`CHATGPT_START_HERE.md`); it does not redefine the bootstrap procedure.
- Defines the Protocol Gate, Solution Simplicity Gate, Standard Project Flow,
  Project Status Procedure, ACP Task Protocol, and Consequential Action Stop Gate.
- Authoritative for ChatGPT's preparation, authorization, execution, and
  verification operating behavior.

### `STATE.md` — Current Live Project State
- **Mutable current state**, not immutable history.
- Current status, active tasks, blockers, upcoming/backlog items.
- Current agent roles/state where useful.
- Updated by agents after authorized completed work.

### `ARCH_DECISIONS.md` — Architectural Decisions (ADR-style)
- Significant architectural decisions and rationale.
- Structure: Title, Status, Context, Decision, Rationale, Consequences.
- `ARCHITECTURE.md` remains authoritative for overall architecture.
- This file records decisions for persistent AI project context.

### `TASK_STANDARD.md` — Canonical AI Task Request Standard
- Mandatory, canonical format for all AI task requests initiated by the Director.
- Defines the Task Request Envelope, authorization requirements, instruction precedence, and relationship with ACP.
- A fresh ChatGPT instance must begin at `CHATGPT_START_HERE.md` (the canonical bootstrap contract), which directs to this standard.
- All agents must conform to this standard when preparing and initiating tasks.

### `TASK_LOG.md` — Historical Task Record
- **Append-only** historical record of completed AI development tasks.
- Record: task, date, summary, outcome, commit reference.
- Do not use as current-state file.

### `README.md` — This File
- Operating instructions for the AI project-state directory.
- Update rules, security requirements, authoritative vs historical distinctions.

### `RESEARCH_INDEX.md` — Research Record Index
- Navigational index for durable research records under `docs/ai/research/`.
- Each RESEARCH_DOCUMENT task produces one Markdown research record; the index and TASK_LOG reference it.
- Research records are durable research artifacts, not current-state files.

### `ONE_CLICK_WORKFLOW_CONTRACT.md` — One-Click Workflow Coordinator Contract
- Canonical contract making "Make this a one-click workflow" a durable project command.
- Defines zero-input `workflow_dispatch` requirement, agent/task-mode variants, and the
  prohibition on treating existing workflows with required inputs as one-click.
- References the canonical external-activation architecture (`EXTERNAL_ACTIVATION_PROCEDURE.md`).
- Machine-verifiable via `test/one-click-workflow-contract.test.js`.

## Update Rules

| File | When to Update | Who Updates |
|------|----------------|-------------|
| `STATE.md` | After any authorized work that changes current project state (active tasks, blockers, status) | Gemini Builder (primary), any authorized agent |
| `ARCH_DECISIONS.md` | When a significant architectural decision is made or reviewed | Gemini (primary), Gemini Builder when implementing |
| `TASK_LOG.md` | After every completed authorized task | Gemini Builder (primary), any agent completing authorized work |
| `RESEARCH_INDEX.md` | When a RESEARCH_DOCUMENT task completes or a research record is added | Gemini Builder (primary), any authorized research agent |
| `README.md` | When operating rules or security requirements change | Gemini Builder (when authorized) |

**Update discipline:**
- Make the smallest change that reflects the new reality.
- Do not rewrite history in `TASK_LOG.md` (append-only).
- Distinguish **CURRENT / IMPLEMENTED** from **PROPOSED / TARGET** clearly.
- Never include secrets, credentials, or sensitive production values.

## Security & Secrecy Requirements

**Never include in any `docs/ai/` file:**
- API keys
- Access tokens
- Webhook secrets
- Passwords
- Private keys
- Credentials
- Sensitive production values (endpoints, internal URLs with auth, etc.)

Do not copy secrets from existing files into this documentation.
Do not introduce a new secret-management mechanism.

## Authoritative vs Historical Information

| Source | Authority | Purpose |
|--------|-----------|---------|
| `ARCHITECTURE.md` | **Authoritative** for intended architecture | Overall system design, boundaries, roadmap |
| Production code | **Authoritative** for implemented behavior | What actually runs in production |
| `docs/ai/STATE.md` | Current AI project state | Live status for AI agents |
| `docs/ai/ARCH_DECISIONS.md` | Recorded decisions + rationale | Context for AI decision-making |
| `docs/ai/TASK_LOG.md` | Historical record | Audit trail of completed AI work |
| `docs/ai/README.md` | Operating rules | How agents use the system |
| `docs/ai/RESEARCH_INDEX.md` | Research record index | Navigation to durable research records |

**Rule**: Documentation is not proof that proposed functionality is implemented. Always verify against production code.