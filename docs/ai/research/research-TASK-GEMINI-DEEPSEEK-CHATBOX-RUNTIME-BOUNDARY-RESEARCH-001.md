# Research Record: DeepSeek Chatbox Runtime Boundary and Tool-Execution Architecture

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-CHATBOX-RUNTIME-BOUNDARY-RESEARCH-001 |
| Research Question / Objective | Determine the actual current communication path from Chatbox through OpenRouter to DeepSeek, identify exactly where DeepSeek tool-call execution can and cannot occur, reconcile that path with the existing Direct ACP coordinator and ADR-017, and establish the smallest viable server-side boundary required for a future bounded control_plane tool runtime, without implementing that runtime. |
| Agent | Gemini (Architect / Reviewer / Research) |
| Date | 2026-09-25 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope of this Task | Research and documentation ONLY. No production application implementation is authorized. No new runtime, OpenRouter integration, `control_plane` tool, workflow, or source-code change is introduced by this task. |

---

## Executive Summary & Core Research Questions Answered

This research record establishes eight foundational answers regarding the Chatbox → OpenRouter → DeepSeek integration and the server-side tool execution runtime boundary:

1. **Currently Implemented Chatbox Ingress**: `POST /poc/chatbox` in `routes/poc.js`, authenticated via `x-chatbox-gateway-secret` header (`CHATBOX_GATEWAY_SECRET`), non-authorizing, constructs a REVIEW-mode ACP command (`read_only`, `poc/` permitted paths), validates target against `VALID_AGENTS`, creates task in TaskRegistry, and dispatches via the target-aware dispatcher.
2. **Currently Implemented Direct ACP Coordinator Path**: `POST /poc/coordinator` in `routes/poc.js`, authenticated via `x-deepseek-coordinator-secret` header (`DEEPSEEK_COORDINATOR_SECRET`), accepts canonical ACP JSON, validates via `validateACPCommand` (`poc/schemas/acp-schema.js`), registers in `TaskRegistry`, and dispatches via `getDispatcher()`.
3. **What OpenRouter Actually Does in the Model/Tool-Call Loop**: Acts as an OpenAI-compatible model proxy and provider-routing layer (`POST /api/v1/chat/completions`). It normalizes schemas across models/providers, handles tool definitions, and returns model outputs containing structured `tool_calls`. However, OpenRouter does *not* execute project-specific application tool calls (such as constructing and submitting an ACP command to this repository's coordinator); tool execution is strictly application-side.
4. **Server-Side DeepSeek/OpenRouter Tool Execution Runtime Existence**: Confirmed by repository inspection — **NO such runtime exists**. There is no `OPENROUTER_API_KEY`, no `tool_calls` handling logic, no `@openrouter/agent` or Agent SDK dependency, no MCP implementation, no execution runtime, and no `control_plane` symbol in source code (`routes/`, `poc/`, `services/`, `workflows/`, `test/`, `index.js`).
5. **Exact Missing Boundary Between DeepSeek `tool_call` and `POST /poc/coordinator`**: The bridge/runtime layer that receives `tool_calls` from OpenRouter/DeepSeek, executes the narrow `control_plane` tool by translating model intents into canonical ACP JSON, and submits them securely via `POST /poc/coordinator` using the server-side `DEEPSEEK_COORDINATOR_SECRET`.
6. **Accuracy of ADR-017**: Yes, ADR-017 accurately describes the smallest viable target architecture (trusted server-side execution runtime hosting the model tool-calling loop and narrow `control_plane` tool, submitting to the existing `/poc/coordinator` without bypassing ACP validation or creating a second control plane).
7. **Prerequisite for Milestone 0 Connectivity Testing**: Basic network reachability and end-to-end HTTP round-trip ping through OpenRouter/DeepSeek to Render without encountering transport/network errors ("Network Error: Load failed"), ensuring proper DNS/TLS/routing and endpoint authentication before testing complex model tool-calling logic.
8. **Unresolved Questions Requiring External Evidence**: Exact Chatbox iOS client configuration settings, OpenRouter project/model routing parameters, DNS/network constraints on mobile networks, and runtime hosting environment specifics (e.g., Render service URL and environment secret provisioning).

---

## 1. Currently Implemented Chatbox Ingress

- **Route & Implementation**: `POST /poc/chatbox` defined in `routes/poc.js`.
- **Authentication**: Authenticated via the `x-chatbox-gateway-secret` header matching `process.env.CHATBOX_GATEWAY_SECRET`. Fail-closed.
- **Role**: Non-authorizing ingress. It translates OpenAI-compatible chat requests into bounded ACP work using the Direct ACP pattern (`validateACPCommand`, `taskRegistry.createTask`, `getDispatcher()`).
- **Capability Bound**: Defaults to `REVIEW` mode (`read_only`, `poc/` permitted paths). It cannot independently grant elevated capabilities or bypass ACP validation.
- **Target Selection**: Target flows from request body through `VALID_AGENTS` validation (`Kilo`, `Gemini`, `Gemini Builder`); fail-closed on missing/invalid target.

## 2. Currently Implemented Direct ACP Coordinator Path

- **Route & Implementation**: `POST /poc/coordinator` defined in `routes/poc.js` (`ARCHITECTURE.md` Section 16.6).
- **Authentication**: Authenticated via `x-deepseek-coordinator-secret` header (`DEEPSEEK_COORDINATOR_SECRET`).
- **Role**: Canonical machine-to-machine control-plane ingress. Accepts canonical ACP JSON, validates via `validateACPCommand` (`poc/schemas/acp-schema.js`), registers tasks in `TaskRegistry`, and dispatches through the existing Kilo / Gemini Builder dispatcher (`getDispatcher()`).
- **Flow**: Direct ACP JSON → `authenticateDeepSeekCoordinator` → `validateACPCommand` → `taskRegistry.createTask` → `getDispatcher()`.

## 3. What OpenRouter Actually Does in the Model/Tool-Call Loop

- **Model Proxy & Routing**: OpenRouter acts as an OpenAI-compatible API proxy and provider-routing layer (`POST /api/v1/chat/completions`). It normalizes schemas across different underlying models and providers.
- **Tool Definitions & Calls**: OpenRouter accepts `tools` definitions (JSON Schema format) and passes them to the underlying model (e.g., DeepSeek). When the model decides to invoke a tool, OpenRouter returns structured `tool_calls` in the model response.
- **Execution Boundary**: OpenRouter does **not** execute tool calls. The model returns a request for a tool call; the application hosting the model interaction loop is responsible for executing the tool and returning the result to the model.

## 4. Repository Existence Check: Server-Side Tool Execution Runtime

- **Repository-Wide Search**: Inspected `routes/poc.js`, `poc/acp-engine.js`, `poc/task-registry.js`, `poc/orchestrator.js`, `services/transport-provider.js`, `index.js`, and `test/`.
- **Finding**: **No server-side DeepSeek/OpenRouter tool execution runtime exists in the repository.**
- **Absence List**:
  - No `OPENROUTER_API_KEY` configuration.
  - No handler for `tool_calls` or model-driven tool execution loops.
  - No `@openrouter/agent` or Agent SDK dependency in `package.json`.
  - No Model Context Protocol (MCP) implementation.
  - No `control_plane` tool definition or execution runtime in `poc/`.

## 5. Exact Missing Boundary Between DeepSeek `tool_call` and `POST /poc/coordinator`

- **The Gap**: DeepSeek (via OpenRouter) can emit a structured `tool_call` requesting a `control_plane` action, but it has no direct network path or authorization to POST to `/poc/coordinator`.
- **The Bridge (Required Boundary)**: A server-side execution runtime that:
  1. Hosts the OpenRouter conversation/tool-calling loop.
  2. Intercepts the model's `tool_call` for `control_plane`.
  3. Validates model-supplied arguments against strict JSON Schema boundaries.
  4. Constructs a canonical ACP command (assigning `task_mode`, `capabilities`, `permitted_paths`, and `target`).
  5. Submits the authenticated request to `POST /poc/coordinator` using the server-side `DEEPSEEK_COORDINATOR_SECRET`.

## 6. Evaluation of ADR-017

- **Status**: ADR-017 (`docs/ai/ARCH_DECISIONS.md`) accurately and precisely describes the smallest viable target architecture.
- **Key Tenets**:
  - Server-side execution runtime hosts the tool loop and acts as the *executor* of `control_plane` tool calls.
  - Reuses the existing `/poc/coordinator` and ACP control plane (`validateACPCommand`, `TaskRegistry`, `getDispatcher()`), avoiding a parallel orchestrator or control plane.
  - Keeps all secrets (`DEEPSEEK_COORDINATOR_SECRET`, GitHub/Render tokens) strictly server-side.
  - Exposes a narrow `control_plane` tool rather than an unrestricted generic HTTP tool.

## 7. What Must Be Proven Before Milestone 0 Connectivity Testing is Meaningful

- **Baseline Round-Trip Reachability**: Before testing complex model tool-calling logic or ACP dispatch, a basic HTTP round-trip health/ping request must successfully traverse from the client through OpenRouter/DeepSeek to Render without encountering transport/network errors (such as `"Network Error: Load failed"`).
- **Diagnostics**: Ensure proper DNS, TLS handshakes, proxy timeouts, gateway auth headers (`x-chatbox-gateway-secret`), and route handlers are verified in a staging/test environment.

## 8. Unresolved Questions Requiring External Evidence

- **Chatbox iOS Configuration**: Exact endpoint URL, headers, and model settings configured inside the Chatbox iOS client.
- **OpenRouter Routing Parameters**: Specific provider routing configurations and model behavior under tool-calling conditions.
- **Mobile Network Constraints**: Potential TLS/DNS interception or proxy blocks on mobile data networks causing "Network Error: Load failed".
- **Runtime Environment Provisioning**: Verification of environment secrets on Render (`CHATBOX_GATEWAY_SECRET`, `DEEPSEEK_COORDINATOR_SECRET`, etc.).

---
