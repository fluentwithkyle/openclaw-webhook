# Fluent with Kyle — OpenClaw Automation Architecture & Development Roadmap

## Purpose and authority

This document is the authoritative operating document for both the application architecture and the intended AI-agent operating model. Read it with `GEMINI.md`, `package.json`, and the relevant implementation before changing the system.

The system automates the Fluent with Kyle client lifecycle. The Node.js application receives Tally intake and Cal.com events, makes lifecycle and communication decisions, persists CRM data in Google Sheets through Google Apps Script, sends operational notifications through LINE, and sends client email through Gmail.

The **AI-agent architecture** below describes the target operating model. It is intentionally separate from the **application architecture** that follows it. A target role or workflow is not evidence that its programmatic integration is already available.

### Core boundary

> **The Node.js application makes business decisions.**
>
> **Google Apps Script performs Google-specific operations.**

In practical terms:

| Layer | Responsibility |
| --- | --- |
| Node.js application (currently deployed in the Render/OpenClaw environment) | Intake and booking processing, lifecycle decisions and transitions, eligibility, package/credit logic, notification content, and workflow orchestration. |
| Google Apps Script | Google Sheets CRM reads/writes and Gmail delivery through the Apps Script web-app adapter. |
| Google Sheets | The current CRM record and operational interface. |
| Gmail | Email delivery channel. |
| Tally and Cal.com | Event sources. |
| LINE | Operational communication channel, not a business-rules engine. |

Do not turn this roadmap into permission for a broad redesign. The application is production-oriented and must evolve through small, verified, incremental changes.

---

## AI-agent operating model (target architecture)

### Purpose and authority

This section defines the desired coordination model for AI-assisted work on this repository. It does **not** assert that every integration needed to implement that model exists today. The application architecture begins in the next section and remains the source of truth for the running system.

| Role | Target responsibility |
| --- | --- |
| Human (Kyle) — Director | Sets high-level objectives, makes strategic decisions, and retains final authority. Kyle should not manually relay tasks, plans, reviews, or results between AI agents. |
| OpenClaw — Orchestrator | Acts as the coordination and handoff layer between Kyle and the specialist agents. It receives objectives, determines delegation, passes context and results, coordinates iterative work, tracks task and repository state, verifies completion, and returns a consolidated result to Kyle. |
| Gemini — Architect / Reviewer | Performs repository analysis, architecture interpretation, implementation planning, architectural and integration review, and identification of architectural issues. It does not own routine implementation. |
| Codex — Primary Builder | Implements approved plans, modifies repository files, runs tests, debugs issues, verifies behavior, and makes corrections following review. |
| Groq / free open models — Utility layer | Handles quick questions, transformations, boilerplate, high-volume inexpensive tasks, and other appropriately scoped utility work. |
| Local Goose — Local/background execution layer | Handles advantageous local repository work, repetitive or background tasks, local experimentation, and similar execution work. |
| GitHub — Shared source of truth | Centralizes repository state, code, documentation, commits, and history. Agents coordinate around the repository rather than keeping independent, competing copies of architectural truth. |

### Target OpenClaw-mediated workflow

The intended workflow is adaptive, not a mandatory fixed sequence. OpenClaw chooses the appropriate agents and order for the objective; it is the intended communication and handoff layer rather than Kyle.

```text
Human objective
  → OpenClaw analyzes and coordinates
  → appropriate specialist agent(s)
  → results and context return to OpenClaw
  → OpenClaw delegates subsequent work
  → implementation / testing / review / correction cycle
  → OpenClaw verifies completion
  → consolidated result to Human
```

For example, OpenClaw may ask Gemini for analysis or review, Codex for implementation and verification, Groq/free models for narrowly scoped utility work, and Local Goose for advantageous local or background execution. It passes the relevant plan, repository context, outputs, and review findings between those agents so Kyle does not need to perform manual relays.

### Verified capabilities and integration requirements

The repository verifies only the application code and configuration documented in the application sections below. It does **not** currently verify a programmatic OpenClaw integration with Gemini, Codex, Groq/free models, or Local Goose, nor a mechanism for OpenClaw to invoke or exchange context with those agents.

Establishing any needed invocation, communication, state-tracking, repository-access, and result-handoff mechanisms is a future implementation/configuration requirement. Verify the relevant configuration before claiming an integration exists or relying on it in an automated workflow.

### Orchestration capability audit — 2026-09-09

This is an environment and repository audit, not an integration implementation. It supersedes no application boundary above and deliberately does not add an OpenClaw dependency, credential, service, or application route.

#### What is available now

| Component | Evidence inspected | Current conclusion |
| --- | --- | --- |
| OpenClaw | No `openclaw` executable, package, process, home/configuration directory, or repository configuration was found. | **Not installed or configured in this environment.** It currently cannot invoke any agent, retain orchestration state, or pass agent context/results. |
| Codex | The host has `/opt/codex/bin/codex` (`codex-cli 0.144.0-alpha.4`) and a running Codex app-server process. `codex login status` reports `Not logged in`. | The CLI binary is present, but it is not authenticated for a standalone invocation. Its running process is not evidence of an OpenClaw integration. |
| Gemini | The only repository integration is `.github/workflows/main.yml`, which runs `google-github-actions/run-gemini-cli` and requires the repository secret `GEMINI_API_KEY`. No local Gemini CLI, Gemini environment variable, or OpenClaw provider configuration was found. | Gemini can be invoked by that GitHub Actions workflow when its secret exists; it is **not** available to OpenClaw from this environment. |
| Groq / free models | No Groq CLI, SDK dependency, `GROQ_*` environment variable, provider configuration, or local-model runtime was found. | **Not configured.** No Groq/free-model invocation is currently available. |
| Local Goose | No Goose executable, package, configuration, process, or local-model runtime was found. | **Not installed or configured.** No Local Goose invocation is currently available. |
| GitHub | The checkout has no Git remote, and `gh auth status` reports no authenticated GitHub host. The GitHub Actions workflow requests repository write permissions, but its actual access depends on the GitHub-hosted workflow token and secrets at run time. | Git history is present locally, but this environment cannot currently push, create pull requests, or serve as the shared GitHub coordination point. |

The repository itself contains no `.env*`, OpenClaw configuration, agent manifest, MCP configuration, or provider credentials. The only ignored runtime-configuration files are `.clasp.json` and `.clasprc.json`; they are unrelated to agent orchestration.

#### Codex invocation and result handoff

The concrete executable interface available on this host is Codex CLI's non-interactive command:

```text
/opt/codex/bin/codex exec [options] <prompt>
```

It supports a working directory (`-C`), a sandbox policy (`-s`), JSONL event output (`--json`), and writing the final agent message to a file (`--output-last-message <file>`). Those options provide an implementable handoff contract **once an orchestrator is installed and authorized to start the CLI**: OpenClaw (or another approved runner) supplies a bounded prompt and repository path, captures JSONL/final output, then gives the resulting summary, changed-file list, test results, and commit/PR reference to the next agent. Codex must first be authenticated with an approved OpenAI account or API credential; no credential belongs in this repository.

This audit does **not** claim that the absent OpenClaw installation has a built-in Codex adapter, a shell-execution permission, or a configured Agent Client Protocol (ACP)/MCP bridge. Before adopting a specific OpenClaw-to-Codex adapter, install the intended OpenClaw release and validate its official, release-matched documentation and its configured tool/agent permissions. Do not substitute an unreviewed webhook or give an agent unrestricted shell access merely to make this work.

There is therefore no present agent-to-agent context channel. Until OpenClaw is configured, the durable coordination surfaces are Git commits and GitHub pull requests; at execution time, the orchestrator should pass only task-scoped inputs and structured outputs rather than relying on implicit shared chat history.

#### Accounts, permissions, and configuration required

Configuration belongs on a persistent orchestration host, outside this application repository. At minimum, that host needs:

1. **OpenClaw installation and its release-matched configuration file.** Run its supported onboarding/configuration workflow, select an orchestrator model/account, and restrict the main agent to explicitly approved subagents and tools. Preserve the generated configuration outside Git and do not commit secrets.
2. **Codex CLI plus authentication.** Install or expose the Codex CLI to the OpenClaw service account, authenticate it using the approved OpenAI account/API mechanism, and allow the orchestrator only the intended non-interactive command in the intended repository/worktree. Use a constrained sandbox and explicit working directory; avoid bypassing Codex approvals/sandboxing.
3. **GitHub identity and repository access.** Configure either a GitHub App or a fine-grained token for the orchestration service account with the least permissions needed: repository contents read/write for implementation, pull-request read/write for reviews/PRs, and issues read/write only if issue-driven delegation is enabled. Configure a repository remote and validate `gh auth status`/push access on the orchestration host. Protect the default branch and require review/status checks as appropriate.
4. **Gemini credentials and execution path.** Retain `GEMINI_API_KEY` as a GitHub Actions secret for the existing workflow, or separately install/authenticate Gemini on the orchestration host if OpenClaw needs direct invocation. The GitHub Actions secret is not automatically available to OpenClaw. Scope any GitHub token used by the workflow independently from the orchestrator credential.
5. **Groq/free-model provider choice and credentials.** Choose a supported provider/model intentionally, then configure its endpoint, model identifier, and API credential in the provider's secret store. If using a local free model, install and operate the selected local runtime and model separately; none is present here.
6. **Goose installation and model backend.** Install Goose on the persistent host, configure its chosen model provider/local backend and credentials, and grant only the repository, shell, and network permissions required for its assigned background tasks. Verify its OpenClaw invocation path before assigning it work.

#### Minimum next steps to make OpenClaw functional

1. Provision one persistent, access-controlled orchestration host; do not use this Render webhook application as the agent-control plane.
2. Install the chosen OpenClaw release there and complete its supported onboarding. Record the exact release, generated configuration path, enabled tool integrations, and permitted agent identities in an operations document kept separate from secrets.
3. Configure and test one narrow builder lane first: OpenClaw → authenticated Codex CLI → isolated repository worktree → branch/commit/PR. Require structured final output and verify that OpenClaw receives it.
4. Configure GitHub remote/authentication and validate a non-destructive read followed by a controlled branch/PR workflow. Do not grant production application, Render, Google, LINE, Cal.com, or Tally credentials to the orchestration agents.
5. Add Gemini as a review-only lane only after deciding whether GitHub Actions or a direct provider integration is the authoritative path. Add Groq/free models and Goose one at a time after their provider/runtime, permissions, and handoff formats are verified.
6. Run an end-to-end dry run on a documentation-only change: high-level objective to OpenClaw, Codex implementation, optional Gemini review, OpenClaw consolidation, and GitHub PR. Document the validated configuration only after that run succeeds.

No configuration change is made by this audit. The next change should be limited to the external orchestration host and its secret store; application source code, Google Apps Script, and production webhook credentials remain out of scope.

### Agent operating rules

Before changing code, an agent must:

1. Read this document and `GEMINI.md`.
2. Inspect the relevant current implementation and interfaces.
3. Identify the smallest change that meets the request.
4. Preserve existing behavior unless the request explicitly changes it.
5. Keep business logic in the Node.js application and Google-specific implementation in Apps Script.
6. Avoid unrelated rewrites and unnecessary dependencies.
7. Run focused verification and update this document when an actual architectural boundary or roadmap item changes.

---

## Current repository architecture

The repository is at the **workflow-modular intermediate stage**:

```text
index.js
  → infrastructure, routes, health, scheduler startup, keep-alive

workflows/abandonedBooking.js
  → abandoned-booking business workflow

services/
  → integration and provider-processing services

google-apps-script/
  → Google-specific adapter implementation
```

Current source layout:

```text
openclaw-webhook/
├── index.js
├── workflows/
│   └── abandonedBooking.js
├── services/
│   ├── appsScript.js
│   ├── cal.js
│   ├── lineService.js
│   └── tally.js
├── google-apps-script/
│   ├── Code.js
│   ├── CRM.js
│   ├── AbandonedBookings.js
│   ├── Email.js
│   ├── Utilities.js
│   └── appsscript.json
├── GEMINI.md
├── package.json
└── ARCHITECTURE.md
```

### Application shell — `index.js`

`index.js` creates the Express application, installs JSON middleware, registers the Tally and Cal.com webhook routes, exposes `/` and `/health`, starts the abandoned-booking interval, starts keep-alive requests, and listens on the configured port. It imports and starts the workflow, but **does not contain the abandoned-booking business workflow**.

### Services

- `services/tally.js` processes Tally submissions, extracts and normalizes intake data, handles question submissions, determines the initial state and credits, sends LINE question alerts, and requests CRM upserts.
- `services/cal.js` processes Cal.com booking, cancellation, and meeting-ended events; retrieves client context; makes booking/cancellation decisions; creates LINE message content; and coordinates the current Free Intro follow-up email flow.
- `services/appsScript.js` is the Node-to-Apps-Script gateway. It posts action payloads to `APPS_SCRIPT_URL` and also provides timestamp/title formatting helpers.
- `services/lineService.js` sends the already-composed notification text to the LINE Messaging API.

Services may contain provider-specific processing. Business workflows belong in `workflows/` as they are extracted; do not move business rules into Apps Script.

---

## Current lifecycle and event flows

### Tally intake → CRM

```text
Tally webhook
  → Render / services/tally.js
  → normalize intake and determine package, credits, and lifecycle state
  → services/appsScript.js
  → Google Apps Script
  → Google Sheets CRM
```

A normal Tally #1 submission is written with `Schedule Status = Pending Booking`. Question submissions create a follow-up-needed CRM update and send a LINE alert. Current credit handling assigns four credits to the intensive/monthly/flex products and one credit to Deep Dive, Single Session, and Free Intro products.

### Booking, cancellation, and Free Intro follow-up

```text
Cal.com webhook
  → Render / services/cal.js
  → look up CRM context through Apps Script
  → decide the lifecycle update and create operational notification content
  → Google Sheets CRM and LINE
```

For booking-created handling, Render determines session type from guest information, updates the CRM to `Confirmed`, and sends the booking notification. For cancellation handling, Render updates `Schedule Status` and `Cancellation Status` to `Cancelled`, records the cancellation reason, and sends the cancellation notification.

For a `MEETING_ENDED` event whose title indicates Free Intro, Render generates the personalized Tally #2 URL and currently requests the `intro_followup` template from Apps Script, performs placeholder substitution in Render, then requests Gmail delivery through Apps Script. Moving template selection, personalization, and generation toward Render remains a later, incremental improvement.

### Abandoned booking — current Render-owned workflow

The abandoned-booking workflow extraction is **COMPLETED**. `index.js` starts a five-minute scheduler; the business workflow is in `workflows/abandonedBooking.js`.

```text
scheduler
  → abandonedBooking workflow
  → get_pending
  → elapsed-time calculation
  → eligibility
  → CRM update
  → LINE notification
```

The workflow requests pending clients with `get_pending`, calculates elapsed time from the submitted timestamp, considers pending records eligible after the threshold, sends the LINE alert, then requests a CRM status update to `Follow-Up Needed`.

**Preserved strict behavior:** the current eligibility condition is `elapsedMs > 30 minutes` (strictly greater than 30 minutes), not greater-than-or-equal-to.

Duplicate-alert prevention/durable processing is still needed: the current sequence relies on the CRM status update after notification and does not yet provide a durable idempotency mechanism. It is important, but it follows authentication of the Node-to-Apps-Script action contract.

---

## Google Apps Script adapter

The Google Apps Script source is versioned in `google-apps-script/`. It is part of the current repository—not a future target.

```text
Node.js application
  → action payload to Apps Script web app
  → Code.js action routing
  → CRM.js / Email delivery functions
  → Google Sheets CRM / Gmail
```

### Deployment and trust boundary

`appsscript.json` declares a web app executed as the deploying user and accessible to anyone anonymous. The Node gateway posts action payloads to the configured Apps Script endpoint. This arrangement exposes a web-app endpoint that accepts actions for CRM writes and email delivery, while the current application-level action contract has no trust boundary.

The endpoint URL has historically been available through configuration/source. This must be treated as a production-hardening concern, not as an invitation to redesign the adapter.

### Action routing — `Code.js`

`Code.js` implements `doPost(e)`: it parses the request body, reads `data.action`, dispatches the supported action, and returns JSON through `ContentService`. The currently routed actions are:

- `upsert_client` → CRM upsert;
- `get_client` → CRM lookup by email or LINE ID;
- `get_pending` → pending-booking retrieval;
- `get_template` → email-template retrieval; and
- `send_email` → Gmail send operation.

Unknown actions and caught errors produce an error response. This list documents the current implementation; do not invent action names or expand the contract without a narrowly scoped, reviewed change.

### CRM responsibilities — `CRM.js`

`CRM.js` owns the physical Google Sheets operations: opening the configured spreadsheet/tab, upserting clients by email or LINE ID, retrieving a client by email or LINE ID, retrieving clients in `Pending Booking`, and retrieving email templates from the `EmailTemplates` sheet. Its current row mapping covers the expanded 22-column Clients CRM, including identity, intake context, package, credits, schedule state, booking/cancellation data, and question text.

Render decides which lifecycle transition and values should be applied. Apps Script carries out the Sheets read/write.

### Email responsibilities — `Email.js`

`Email.js` contains the Gmail-specific `sendClientEmail(data)` implementation. It uses the request’s recipient, subject, and HTML body and sends through `GmailApp` with the Fluent with Kyle sender name. `Code.js` also contains a `sendClientEmail(data)` helper used by its route; the duplicate helper name is current repository state and should be handled carefully in any future focused cleanup. This document does not redefine that behavior or contract.

### Utility and manifest files

- `Utilities.js` provides the current JSON response helper.
- `appsscript.json` defines the Apps Script runtime, timezone, required Sheets/Gmail/external-request scopes, and web-app deployment configuration.

### Legacy Apps Script abandoned-booking workflow

`google-apps-script/AbandonedBookings.js` exists in the repository and contains the prior Apps Script-based abandoned-booking check and a callback to Render. It is architecturally inconsistent with the current Render-owned workflow.

Repository code existing is **not proof** that a deployed Apps Script time-driven trigger invokes it. Before retirement, verify the deployed Apps Script project and whether such a trigger exists. If it is deployed, disable/retire it only after that verification and after confirming the Render workflow is the intended active path. Do not claim the legacy trigger is active without deployment evidence.

---

## Current CRM and lifecycle model

Google Sheets is the current CRM. The `Clients` row shape is:

| Column | Field |
| --- | --- |
| A | Timestamp |
| B | Name |
| C | Email |
| D | LINE ID |
| E | Location/Address |
| F | Profession |
| G | English Reality |
| H | 3-Month Goal |
| I | Conversation Topics |
| J | Package |
| K | 1-on-1 / 1-on-2 |
| L | Guest Name |
| M | Guest Email |
| N | Guest LINE ID |
| O | Payment Status |
| P | Session Credits |
| Q | Schedule Status |
| R | Booking Date/Time |
| S | Cancellation Status |
| T | Cancellation Reason |
| U | Booking Notes |
| V | Question Text |

Current observed lifecycle states include `Pending Booking`, `Confirmed`, `Follow-Up Needed`, and `Cancelled`. Future work should standardize lifecycle states and CRM transition handling without changing currently working transitions accidentally.

---

## Roadmap and sequencing

### Completed

- **COMPLETED — abandoned-booking workflow extraction.** The scheduler remains in `index.js`; the business workflow is in `workflows/abandonedBooking.js`.
- **COMPLETED — Google Apps Script source included in the repository.** The adapter source and manifest are available under `google-apps-script/` for review with the Node implementation.

### Single current highest-priority task

## Authenticate and harden the Node → Google Apps Script action contract

This is the immediate production-hardening priority. The Apps Script web-app endpoint currently accepts actions that include CRM writes and email delivery, the endpoint is anonymously accessible at the deployment level, and the current contract lacks an application-level trust boundary. Because the endpoint URL has historically been available through configuration/source, authentication must be implemented **before** further reliability work.

Keep this change narrow: authenticate and validate the current Node-to-Apps-Script request/response boundary without using it as an opportunity to replace the architecture, rename unrelated actions, or refactor unrelated workflows.

### After authentication, in approximate order

1. **Retire or disable the legacy Apps Script abandoned-booking workflow** after verifying whether a deployed time-driven trigger exists.
2. **Add durable, idempotent abandoned-booking processing** to prevent duplicate alerts and make retries safe.
3. **Standardize Apps Script responses and Render error handling** at the existing adapter boundary.
4. **Move email template selection, personalization, and generation toward Render** while retaining Apps Script for Gmail delivery.
5. **Standardize lifecycle states and CRM transition handling.**
6. **Expand focused automated testing.** Testing remains an identified gap.
7. **Continue gradual domain-oriented refactoring.**
8. **Centralize event processing later.**
9. **Implement the required OpenClaw orchestration integrations/configuration** only when a concrete requirement justifies them and after verifying the available mechanisms.

### Intentionally deferred architecture

The following are future directions, not current implementation mandates:

```text
workflow-modular intermediate system
  → gradual domain-oriented business modules
  → centralized event processing
  → more complete client lifecycle automation

separately: target OpenClaw-mediated AI-agent operating model
  → verified orchestration integrations/configuration when justified
```

Do not introduce an event bus, a new persistence system, a wholesale CRM replacement, broad framework changes, or an OpenClaw application-management plane while addressing the immediate authentication task. Make each later transition only when a concrete requirement justifies it and after reviewing the existing workflow boundaries.

---

## Change discipline and verification

For any implementation work:

- Treat the current repository implementation as the source of truth.
- Preserve the Node.js-owned business-decision boundary.
- Preserve Apps Script as the Google-specific adapter.
- Prefer focused tests and targeted checks; add tests where a change has a clear seam.
- Check imports/exports, asynchronous behavior, error handling, environment variables, and external action payloads.
- Update this roadmap when an architectural milestone is actually complete; do not mark planned work as complete.

The application end state is a reliable, incremental automation system in which the Node.js application owns the client lifecycle and Google Apps Script remains a minimal, authenticated adapter for Google Sheets and Gmail. The intended AI-agent end state is an OpenClaw-mediated operating model with GitHub as the shared source of truth; integrations are claimed only after they are verified.
