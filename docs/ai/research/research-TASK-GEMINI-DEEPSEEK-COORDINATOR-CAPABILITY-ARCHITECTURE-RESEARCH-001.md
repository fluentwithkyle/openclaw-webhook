# Research Record: DeepSeek Coordinator Capability and Architecture Research

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-COORDINATOR-CAPABILITY-ARCHITECTURE-RESEARCH-001 |
| Research Question / Objective | Determine the smallest ACP-compliant architecture required for DeepSeek, through the existing server-side runtime, to function as the primary conversational coordinator for human intent: understand the desired outcome, determine the appropriate research/planning/execution/verification workflow, initiate the appropriate AI specialist lanes, track asynchronous work, consume specialist results, determine subsequent actions, and continue until the authorized desired outcome is reached or human intervention is required. Identify exact gaps, distinguish VERIFIED / INFERRED / UNKNOWN / PROPOSED state, and produce an evidence-based implementation roadmap without implementing the proposed architecture. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-09-26 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope of this Task | Research and documentation ONLY. No production application code implementation is authorized. All proposed architectural extensions are documented for evaluation and future implementation phases. |

---

## Executive Summary & Core Research Questions Answered

This research record establishes the architectural blueprint, security boundaries, gap analysis, and phased roadmap for enabling DeepSeek — via the existing server-side DeepSeek runtime (`services/deepseek-runtime.js`) and ACP coordinator (`routes/poc.js`, `poc/task-registry.js`) — to act as the primary conversational coordinator for human intent:

1. **Current State of DeepSeek Runtime**: **VERIFIED** (`services/deepseek-runtime.js`). The runtime successfully hosts the OpenRouter/DeepSeek conversation loop, exposes exactly one narrow intent-only `control_plane` tool, derives REVIEW ACP authority server-side (`target: Gemini Builder`, `capabilities: ['read_only']`, `permitted_paths: ['poc/']`), and submits authenticated requests to `POST /poc/coordinator`.
2. **Current State of TaskRegistry and Orchestrator**: **VERIFIED** (`poc/task-registry.js`, `poc/orchestrator.js`). The repository features a robust, evidence-gated task registry supporting lifecycle states (`PENDING`, `SELECTED`, `PLANNED`, `EXECUTING`, `VERIFIED`, `COMPLETE`, `FAILED`, `BLOCKED`), lineage tracking, cancellation/superseding, and agent result updates (`Kilo`, `Gemini`, `Gemini Builder`) with independent verification evidence requirements.
3. **The Core Architectural Gap**: **VERIFIED**. DeepSeek currently can *initiate* a task via `control_plane` → `POST /poc/coordinator`, but the conversation loop in `services/deepseek-runtime.js` receives only a synchronous dispatch acknowledgement (`Task registered and dispatched`, `request_id`). It lacks mechanisms to poll or query task status, retrieve asynchronous execution reports, consume specialist results (e.g., Kilo or Gemini Builder outputs), and continue the multi-step conversation until the goal is achieved.
4. **Target Conversational Coordinator Capabilities**: **PROPOSED / TARGET**. To function as a full conversational coordinator, DeepSeek needs:
   - Ability to initiate research, planning, review, or builder tasks based on user intent.
   - Ability to check/poll task status and inspect asynchronous execution results (`get_task` or equivalent bounded query capability).
   - Ability to reason over specialist completion reports, determine subsequent actions (e.g., trigger verification after builder success, or handle failure/blocked states), and prompt the user or continue.
5. **Security & Authority Boundaries**: **VERIFIED / MANDATED**. DeepSeek remains conversational intelligence only; it holds **zero** repository authority, **zero** credentials, and **zero** direct execution capability. All authority (`task_mode`, `capabilities`, `permitted_paths`, `target`) is derived server-side by the runtime/coordinator. Kyle remains the Director and final authorization authority. Gemini remains Architect/Reviewer. Kilo and Gemini Builder remain execution lanes.
6. **Architectural Directives (What NOT to Do)**: **MANDATED**. Do **not** introduce a second control plane, a duplicate task registry, a generic HTTP executor, or model-supplied authority/credentials. All extensions must reuse existing ACP schemas, TaskRegistry, and dispatchers.

---

## 1. Scope Examined & Repository Evidence

- **Services**: `services/deepseek-runtime.js`, `services/transport-provider.js`
- **Routes**: `routes/poc.js`
- **POC Core / Schema**: `poc/acp-engine.js`, `poc/task-registry.js`, `poc/orchestrator.js`, `poc/gemini-builder-trigger.js`, `poc/gemini-trigger.js`, `poc/kilo-transport.js`, `poc/schemas/acp-schema.js`
- **Tests**: `test/deepseek-runtime.test.js`, `test/coordinator.test.js`, `test/chatbox-gateway.test.js`, `test/reliability-enforcement.test.js`, `test/task-registry.test.js`, `test/schema.test.js`
- **Architecture & Protocols**: `ARCHITECTURE.md`, `GEMINI.md`, `docs/ai/CHATBOX_ACP_ARCHITECTURE_RECORD.md`, `docs/ai/ARCH_DECISIONS.md` (ADR-017), `docs/ai/CONTROL_CENTER.md`, `docs/ai/STATE.md`

---

## 2. Capability Matrix: Current vs. Target Conversational Coordinator

| Capability Dimension | Current Implementation State | Target Conversational Coordinator State | Classification |
|---|---|---|---|
| **Intent Understanding** | Chatbox → OpenRouter → DeepSeek understands natural-language user intent. | Same, but with richer conversational context and tool-use guidance. | **VERIFIED** |
| **Workflow Selection** | Single `control_plane` tool supports `request_task` for Gemini Builder (`REVIEW`). | Ability to select appropriate workflows (Research, Planning, Execution, Verification/Reconciliation) and targets (Kilo, Gemini Builder). | **PROPOSED** |
| **Specialist Dispatch** | Submits via `POST /poc/coordinator` → `TaskRegistry` → `getDispatcher()`. | Reuses existing dispatcher; expands supported intents/targets within strict server-side policy bounds. | **VERIFIED** |
| **Asynchronous Tracking** | `POST /poc/deepseek-runtime` returns synchronous dispatch confirmation (`request_id`). | Ability to query task status and execution state asynchronously during the conversation. | **GAPPED / PROPOSED** |
| **Result Consumption** | Model receives JSON string `{ status: 'completed', coordinator: response.data }` containing `request_id`. | Model receives structured specialist execution reports, diff summaries, and verification results. | **GAPPED / PROPOSED** |
| **Multi-Step Continuation** | Limited to `MAX_TOOL_ITERATIONS = 2` for a single dispatch tool call. | Multi-turn conversational loop supporting poll → consume → reason → next action (up to bounded iteration limits). | **GAPPED / PROPOSED** |
| **Authority & Credentials** | Strict server-side derivation; model receives zero secrets/capabilities. | Strictly preserved: server-derived authority, no model-supplied credentials or capabilities. | **VERIFIED / MANDATED** |

---

## 3. Detailed Gap Analysis: What is Missing for Full Conversational Coordination?

### Gap 1: Asynchronous Task Status & Result Retrieval
- **Current State**: When DeepSeek calls `control_plane` (`request_task`), the runtime posts to `/poc/coordinator`, receives registration confirmation (e.g., `{ status: 'Task registered and dispatched', request_id: '...' }`), and feeds that single string back to the model as a tool response.
- **The Gap**: Specialist tasks (like Gemini Builder or Kilo workflows) execute asynchronously via GitHub Actions or background processes. The deepseek runtime loop (`runDeepSeekConversation`) terminates immediately after the initial dispatch response. It has no mechanism to query `taskRegistry.getTask(requestId)` or check if Kilo/Builder has completed, succeeded, failed, or become blocked.
- **Smallest Reusable Mechanism**: The existing `taskRegistry.getTask(requestId)` API and task state structure (`status`, `kilo`, `gemini`, `evidence`, `next_action`) already exist and are fully tested. Exposing a bounded `get_task_status` or extending the `control_plane` tool with an optional `get_task` operation allows DeepSeek to inspect task progress.

### Gap 2: Rich Specialist Result Consumption
- **Current State**: The model only learns that the task was successfully registered/dispatched. It does not see test results, execution reports, build statuses, or independent verification verdicts produced by Kilo or Gemini.
- **The Gap**: Without specialist result payloads (e.g., `report`, `status`, `diagnostics`, `evidence`), DeepSeek cannot summarize outcomes to the user or decide whether follow-up actions (like running verification or requesting human review) are needed.
- **Smallest Reusable Mechanism**: The existing `TaskRegistry` record already stores agent reports and execution metadata (`task.kilo.report`, `task.gemini.report`). Exposing summary fields from the registry entry in the tool response enables the model to reason about completed work.

### Gap 3: Bounded Multi-Step Continuation Loop
- **Current State**: `MAX_TOOL_ITERATIONS = 2` in `services/deepseek-runtime.js` supports exactly one tool call per turn (dispatch task) and one response.
- **The Gap**: Coordinating complex multi-step workflows (e.g., step 1: request research/planning; step 2: poll until complete; step 3: request implementation; step 4: poll until complete; step 5: request verification) requires a multi-turn tool-calling loop where the model can invoke tools across multiple iterations with safeguards against infinite loops.
- **Smallest Reusable Mechanism**: Incrementing `MAX_TOOL_ITERATIONS` safely while adding read-only status-checking tools (`get_task_status`) and enforcing strict iteration limits prevents runaway execution while enabling multi-step orchestration.

---

## 4. Role Boundaries & Security Implications

To ensure absolute system integrity, the architectural extensions must adhere to strict role and security boundaries:

1. **Kyle (Director)**: Remains the human in the loop and final authorization authority for all production deployments and consequential actions.
2. **DeepSeek (Conversational Coordinator Intelligence)**: Acts solely as the conversational interface for understanding human intent and suggesting structured workflows. **Granted zero repository authority, zero credentials, and zero execution privileges.**
3. **Server-Side Runtime (`services/deepseek-runtime.js`)**: Acts as the trusted validation and translation layer. All ACP parameters (`task_mode`, `capabilities`, `permitted_paths`, `target`) are derived server-side. Secrets (`DEEPSEEK_COORDINATOR_SECRET`, `OPENROUTER_API_KEY`) remain strictly server-side.
4. **Gemini (Architect / Reviewer / Research)**: Acts as advisory architect and independent verification reviewer.
5. **Kilo / Gemini Builder**: Acts as the authorized execution lanes within explicit permitted paths.
6. **TaskRegistry & Orchestrator**: The single source of truth for task state, lifecycle transitions, lineage, and evidence collection.

---

## 5. Architectural Changes to Avoid (Negative Constraints)

To prevent architectural drift and maintain system simplicity, the following changes **MUST NOT** be made:
- **No Second Control Plane**: Do not create a new orchestrator, database, or registry. Reuse `TaskRegistry` (`poc/task-registry.js`) and `orchestrator.js`.
- **No Generic HTTP Executor**: Do not give DeepSeek an arbitrary `http_post` or shell-execution tool. All tool calls must be strongly typed and validated against strict schemas (`control_plane`).
- **No Model-Supplied Authority or Credentials**: DeepSeek must never supply `capabilities`, `permitted_paths`, repository tokens, or coordinator secrets.
- **No Duplicate Dispatchers**: All commands must route through the existing target-aware `getDispatcher()` mechanism.

---

## 6. Phased Implementation Roadmap

Ordered by dependency and risk, each phase independently verifiable:

### Phase 1: Bounded Task Status Inspection Tool (`get_task_status`)
- **Objective**: Allow DeepSeek to query the status of a previously dispatched task (`request_id`) via a second narrow tool (`control_plane` with `operation: 'get_task'`).
- **Mechanism**: Extend `CONTROL_PLANE_TOOL` in `services/deepseek-runtime.js` to support `get_task` operation requiring a valid `request_id`.
- **Security**: Runtime looks up `taskRegistry.getTask(requestId)` server-side; ensures only non-sensitive task metadata and status are returned to the model.
- **Verification**: Unit tests in `test/deepseek-runtime.test.js` verifying status queries.

### Phase 2: Specialist Result Summarization & Result Ingestion
- **Objective**: Include task execution reports and status details in the tool response returned to DeepSeek when a task completes or blocks.
- **Mechanism**: Format agent report summaries (`status`, `kilo.report`, `gemini.report`) into the tool output string.
- **Verification**: Integration tests verifying that DeepSeek receives structured completion data.

### Phase 3: Multi-Turn Orchestration Loop Expansion
- **Objective**: Safely increase `MAX_TOOL_ITERATIONS` (e.g., to 4 or 5) to allow multi-step conversational workflows (dispatch → poll → review → follow-up action).
- **Verification**: End-to-end conversation tests with mocked multi-turn tool execution.

---

## 7. Verification & Evidence Basis

- **Code Inspection**: Verified `services/deepseek-runtime.js`, `routes/poc.js`, `poc/task-registry.js`, and `test/deepseek-runtime.test.js`.
- **Architectural Alignment**: Fully aligned with `ARCHITECTURE.md` (Section 16.6), `docs/ai/ARCH_DECISIONS.md` (ADR-017), and `docs/ai/CHATBOX_ACP_ARCHITECTURE_RECORD.md`.
- **Security Compliance**: Enforces server-side authority derivation, fail-closed validation, and zero model-supplied credentials.
