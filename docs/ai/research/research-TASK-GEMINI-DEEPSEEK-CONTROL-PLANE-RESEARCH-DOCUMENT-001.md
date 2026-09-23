# Research Record: DeepSeek Control-Plane Tool-Execution Architecture

| Field | Value |
|-------|-------|
| Task / Request Identifier | TASK-GEMINI-DEEPSEEK-CONTROL-PLANE-RESEARCH-DOCUMENT-001 |
| Research Question / Objective | Document the discovery, evidence, and resulting architecture that allows DeepSeek (reached from Chatbox on a phone, through OpenRouter) to perform authorized control-plane operations — such as requesting a Builder/Kilo task — through a narrowly scoped `control_plane` tool that is executed by a trusted server-side runtime. Record the verified state of the existing repository control plane, the security boundary, unresolved implementation decisions, and the distinction between what is documented as an architectural direction and what is not yet implemented. |
| Agent | Kilo (Builder / Implementer / Tester) |
| Date | 2026-09-23 |
| Task Mode | RESEARCH_DOCUMENT |
| Scope of this Task | Research and documentation ONLY. No production application implementation is authorized. No new runtime, OpenRouter integration, `control_plane` tool, workflow, or source-code change is introduced by this task. |

---

## Implementation Status Distinction (Authoritative)

This document distinguishes four categories. Only **VERIFIED** and **IMPLEMENTED** items correspond to working code. The remainder is architectural direction awaiting a future implementation task.

### VERIFIED / IMPLEMENTED (confirmed against `main`)

- **`POST /poc/coordinator`** authenticated DeepSeek Coordinator ingress — implemented in `routes/poc.js` (DeepSeek Coordinator middleware `authenticateDeepSeekCoordinator`, env: `DEEPSEEK_COORDINATOR_SECRET`; route handler), validated via `validateACPCommand` (`poc/schemas/acp-schema.js`), registered via `taskRegistry.createTask` (`poc/task-registry.js:60`), dispatched via `getDispatcher()` (`services/transport-provider.js:98`). See `ARCHITECTURE.md` Section 16.6.
- **Current DeepSeek control-plane path (Direct ACP)** — DeepSeek emits canonical ACP JSON directly to `/poc/coordinator`. `ARCHITECTURE.md:1580`: "The agreed target architecture is **Direct ACP**: DeepSeek emits canonical ACP JSON directly."
- **Chatbox gateway (current `POST /poc/chatbox`)** — authenticated non-authorizing ingress (`x-chatbox-gateway-secret` / `CHATBOX_GATEWAY_SECRET`), constructs a REVIEW-mode ACP command (`read_only`, `poc/` paths), target-aware dispatch.
- **Existing ACP control plane** — `validateACPCommand`, `validateAuthorization` (task_mode, capabilities, permitted_paths); `VALID_TASK_MODES` (`REVIEW`, `VERIFY_RECONCILE`, `FAILOVER_EXECUTE`, `BUILDER`, `RESEARCH_DOCUMENT`); `VALID_CAPABILITIES`; `VALID_AGENTS`; TaskRegistry; target-aware dispatcher (`Kilo`/`Gemini Builder`/BLOCKED).
- **`POST /poc/kilo`** authenticated Kilo dispatch trigger and the `inspect-poc-files` execution path in `poc/acp-engine.js:execute`.
- **OpenRouter application-side tool-calling model** — the model returns structured `tool_calls`; the application executes the requested tool and returns the result. (Verified against current OpenRouter documentation below.)
- **Current repository absence of OpenRouter/DeepSeek model integration** — confirmed by repository-wide search (see Section 15). No `OPENROUTER_API_KEY`, no `tool_calls`/`tool-calling` handling, no `@openrouter/agent` or Agent SDK dependency, no MCP implementation, no `execution runtime`, no `control_plane` symbol exists in `poc/`, `routes/`, `services/`, `workflows/`, `test/`, `index.js`, `google-apps-script/`, or `ai-models/`.

### ESTABLISHED ARCHITECTURAL DIRECTION (documented here; NOT yet implemented)

- DeepSeek remains the model/intelligence.
- OpenRouter remains the model API/provider-routing layer.
- Chatbox remains the user-facing conversational client.
- A **server-side execution runtime** hosts the DeepSeek/OpenRouter tool-calling loop and the `control_plane` tool.
- The runtime executes the tool (it is the executor, not a second control plane), then calls the **existing** `/poc/coordinator`.
- The `/poc/coordinator` → ACP → TaskRegistry → dispatcher → Gemini Builder/Kilo boundary remains authoritative.

### NOT YET IMPLEMENTED (explicit; out of scope for this task)

- Server-side execution runtime (host of the OpenRouter model interaction loop).
- OpenRouter integration in the repository (no `OPENROUTER_API_KEY`, no provider configured).
- The `control_plane` tool definition and schema.
- The runtime endpoint/interface and deployment topology.
- Chatbox production integration with the future runtime.

### UNRESOLVED

- Exact runtime placement (where the server-side loop runs).
- Exact `control_plane` argument schema.
- Exact ACP translation strategy (how model-generated arguments map to an ACP command).
- Minimal application-side tool-loop implementation vs. OpenRouter Agent SDK vs. MCP value for this use case.

---

## 1. Original DeepSeek / Chatbox Objective

The originating goal is to allow Kyle to use **Chatbox (iOS)** to communicate naturally with **DeepSeek** and, eventually, have DeepSeek perform authorized control-plane operations — for example, requesting a Builder/Kilo task.

Chatbox is the user-facing client; DeepSeek is the model; OpenRouter is the model API/provider-routing layer. The natural-language channel is:

```
Kyle → Chatbox iOS → DeepSeek (via OpenRouter)
```

The integration challenge was initially framed as: how does DeepSeek, sitting behind OpenRouter inside Chatbox, reach the repository's existing ACP control plane without making Chatbox itself the arbitrary HTTP tool executor?

## 2. Existing Chatbox Architecture (Verified)

The repository's **existing** Chatbox entry point is an authenticated, non-authorizing ingress, **not** a model runtime.

- Route: `POST /poc/chatbox` in `routes/poc.js` (Chatbox Gateway middleware `authenticateChatboxGateway`, env: `CHATBOX_GATEWAY_SECRET`; handler).
- Authentication: distinct shared secret (`x-chatbox-gateway-secret`), fail-closed, separate from `KILO_CALLBACK_SECRET`, `GEMINI_CALLBACK_SECRET`, `DEEPSEEK_COORDINATOR_SECRET`, `ACP_POC_TRIGGER_SECRET` (see `docs/ai/ARCH_DECISIONS.md` ADR-015).
- Authorization boundary: Chatbox is **non-authorizing**. `buildChatboxCommand` (`routes/poc.js`) transforms an OpenAI-compatible Chatbox request into a **REVIEW-mode** ACP command (`read_only`, `poc/` permitted paths). It does **not** grant `modify_files`, `commit`, `push`, or `FAILOVER_EXECUTE`.
- Flow: OpenAI-compatible validation → REVIEW-mode ACP command → `validateACPCommand` → `taskRegistry.createTask` → `getDispatcher()` → existing Kilo (or target-aware Builder) dispatch.
- Target handling: `target` flows from the request body through `VALID_AGENTS` validation (`Kilo`, `Gemini`, `Gemini Builder`); fail-closed on missing/invalid. `createInitialTaskRegistryEntry` (`poc/schemas/acp-schema.js`) sets the registry `current_agent` from `command.target`.

This is the **current** Chatbox gateway. It is unrelated to the *future* server-side execution runtime described below; it remains the authenticated ingress for natural-language REVIEW requests.

## 3. Existing Coordinator Architecture (Verified)

The existing DeepSeek Coordinator is a **Direct ACP** ingress — it accepts canonical ACP JSON, not model tool calls.

- Route: `POST /poc/coordinator` in `routes/poc.js`.
- Authentication: `x-deepseek-coordinator-secret` header, env: `DEEPSEEK_COORDINATOR_SECRET` (see `poc/acp-engine.js` for the review-mode gate and `routes/poc.js` DeepSeek Coordinator middleware).
- Implemented flow (`ARCHITECTURE.md:1601-1603`):
  ```
  DeepSeek Coordinator → authenticated POST /poc/coordinator
    → existing ACP validation (validateACPCommand)
    → existing TaskRegistry (taskRegistry.createTask)
    → existing Kilo dispatcher (getDispatcher())
    → existing Kilo execution path
  ```
- Response contract: `202` on successful dispatch; `401` auth failure; `400` malformed/invalid ACP; `409` duplicate `request_id`; `403` dispatch `BLOCKED`; `500` dispatch `FAILED` or registry/dispatch failure.
- On success: task transitions PENDING → SELECTED → PLANNED → EXECUTING (`routes/poc.js` coordinator handler); provider identifiers returned by the dispatcher are persisted in the TaskRegistry.
- This path does **not** involve OpenRouter or model tool calling. DeepSeek is expected to emit ACP JSON directly. No `model runtime`, no `tool_calls`, no `control_plane` symbol exists in the repository for this ingress.

## 4. Initial Technical Obstacle

The obstacle was not DeepSeek's intelligence or OpenRouter's ability to expose tools. The obstacle was **tool execution**:

- DeepSeek can request a tool through OpenRouter's tool-calling interface.
- The model itself does **not** execute the HTTP request.
- The application that hosts the model interaction executes the requested tool and returns the result to the model.

Without a server-side application hosting the model interaction, DeepSeek had no trusted place to execute a `control_plane` tool. This is the crux of the discovery (next sections).

## 5. Findings From the DeepSeek Investigation

- **DeepSeek cannot directly access the network or POST to `/poc/coordinator`.** A model does not perform its own HTTP tool execution.
- **OpenRouter is a model/API proxy.** It routes model requests and returns model outputs (including structured `tool_calls`). It does not execute arbitrary, project-specific control-plane functions (such as constructing and submitting an ACP command to this project's coordinator). It exposes model capability; it does not host the application loop.
- **Chatbox iOS, in its current configuration, was not being treated as the arbitrary HTTP tool executor.** Treating a mobile conversational client as the trusted tool executor would invert the intended trust boundary.
- **Therefore a server-side application runtime is required somewhere in the model interaction** to execute the custom `control_plane` function. This does not replace DeepSeek; it supplies the execution environment required by the model's tool-calling protocol.

## 6. OpenRouter Tool-Calling Behavior (Verified Against Official Documentation)

OpenRouter's current official documentation (`https://openrouter.ai/docs`) states:

### 6.1 OpenAI-compatible surface
- Single endpoint: `POST /api/v1/chat/completions` (OpenAI Chat API-compatible). "OpenRouter normalizes the schema across models and providers to comply with the OpenAI Chat API." Headers include `Authorization: Bearer <OPENROUTER_API_KEY>`, plus optional `HTTP-Referer` / `X-OpenRouter-Title` for attribution.

### 6.2 Tool calling contract
- Request `tools?: Tool[]` where `Tool = { type: 'function'; function: FunctionDescription }` and `FunctionDescription = { description?, name, parameters }` (a JSON Schema object).
- Response: a choice's `message` contains `tool_calls?: ToolCall[]` where `ToolCall = { id, type: 'function', function: FunctionCall }`.
- `finish_reason` is normalized to include `tool_calls`, `stop`, `length`, `content_filter`, `error`. Multiple tool calls may be returned in a single turn.
- "We transform the tools into a YAML template. The model responds with an assistant message." For OpenAI-compatible providers, tool definitions are passed down as-is.
- "Tool support varies by model." Filterable at `openrouter.ai/models?supported_parameters=tools`.

### 6.3 The application executes the tools
This is the verified sequence (OpenRouter Agent SDK documentation and the OpenAI-compatible contract):

1. Application sends the conversation (and tool definitions) to the model via OpenRouter.
2. Model returns a structured `tool_calls` request.
3. **Application executes the requested tool.**
4. Application sends the tool result back to the model.
5. Model continues and produces the final response (or makes further tool calls).

The model decides *when* it needs a tool; the **application** executes the tool. OpenRouter's documentation makes this explicit in its Agent SDK description: "The SDK sends the prompt, receives a tool call from the model, executes `get_weather`, feeds the result back, and returns the final response" — i.e., the SDK (the application) executes, not the model.

## 7. Discovery: The Application-Side Execution Requirement

The decisive finding is the **application-side execution requirement**:

- A model (including DeepSeek via OpenRouter) never executes its own tool calls over the network. The tool-calling protocol is, by design, a request from model → host; the host is responsible for execution and for returning the result.
- Consequently, to let DeepSeek drive a `control_plane` operation, the project must host the **model interaction loop** itself (send conversation to DeepSeek via OpenRouter; receive `tool_calls`; execute them; return results; repeat). Chatbox cannot be made into the trusted executor without violating the intended trust boundary.

This is precisely the gap the current repository does **not** fill: there is no `execution runtime`, no OpenRouter integration, and no tool-processing loop in the codebase (verified in Section 15).

## 8. Resulting Server-Side Execution-Runtime Architecture

The resulting target architecture introduces a single new trusted component — the **server-side execution runtime** — whose only job is to host the DeepSeek/OpenRouter tool-calling loop and dispatch its (validated) results to the **existing** coordinator.

### 8.1 User-facing interaction (unchanged from goal)

```
Chatbox iOS  →  DeepSeek (via OpenRouter)
```
Chatbox is the client; DeepSeek is the intelligence; OpenRouter is the provider-routing layer.

### 8.2 Tool execution (future target)

```
DeepSeek
   ↓  control_plane tool request (tool_calls)
server-side execution runtime
   ↓  authenticated POST /poc/coordinator
existing OpenClaw control plane (ACP → TaskRegistry → dispatcher → Gemini Builder/Kilo)

Result returns:
existing control plane → server-side execution runtime → DeepSeek → final natural-language response → Chatbox
```

### 8.3 Conceptual distinction

- **DeepSeek** = intelligence / decision about *when* to request a tool.
- **Server-side execution runtime** = trusted executor of the requested tool. It is an execution mechanism, not a replacement for DeepSeek and not a second control plane.
- **`/poc/coordinator`** = existing authorization/control-plane boundary (unchanged).

## 9. The `control_plane` Tool Concept

The intended future tool is:

```
control_plane(...)
```

Documented contract (conceptual):

- **Purpose**: expose a deliberately narrow interface through which DeepSeek can request an operation from the existing OpenClaw control plane.
- **Trust boundary**: the tool is invoked by the runtime (trusted), not by the model directly. DeepSeek's call is an untrusted, model-generated request that the runtime validates.
- **Expected input category**: a high-level, narrowly-scoped operation description (e.g., "request a Builder/Kilo task with this objective and these constraints"). The exact argument shape is **not finalized** (Section 17).
- **Expected result category**: the outcome of the ACP operation (registered task identity, status, execution identity) returned to DeepSeek for natural-language surfacing.
- **Relationship to ACP**: the runtime translates the validated tool request into a canonical ACP command and submits it to `/poc/coordinator`, which runs the existing `validateACPCommand` / `validateAuthorization` / `TaskRegistry` / dispatcher path.
- **Relationship to `/poc/coordinator`**: the runtime's *output* is an authenticated request to the existing coordinator; the runtime does not reimplement the coordinator.

The exact production schema is intentionally **not** invented here (Section 14, Section 17).

## 10. Existing Coordinator as the Authorization Boundary

The future runtime must ultimately feed into the existing control plane; it must **not** create a parallel implementation. The verified current flow (`/poc/coordinator`, `routes/poc.js`; `ARCHITECTURE.md` Section 16.6) is:

```
/poc/coordinator
   ↓  ACP validation (validateACPCommand, validateAuthorization)
   ↓  TaskRegistry (taskRegistry.createTask)
   ↓  dispatcher (getDispatcher() → target-aware)
   ↓  target-specific transport (Kilo: poc/kilo-transport.js → HTTPS KILO_TRIGGER_URL;
                          Gemini Builder: poc/gemini-builder-trigger.js → workflow_dispatch)
   ↓  Gemini Builder / Kilo / other authorized target
```

The runtime must therefore produce an authenticated request to `POST /poc/coordinator` carrying a canonical ACP command. There must be **no**:

- second `TaskRegistry`;
- second orchestrator (`poc/orchestrator.js` remains the single orchestrator);
- second agent dispatcher (`services/transport-provider.js` `getDispatcher()` remains the single dispatcher);
- parallel control plane;
- generic unrestricted HTTP executor;
- bypass around ACP validation (`poc/acp-engine.js` `validate` / schema `validateAuthorization`).

## 11. Relationship to the Existing ACP System

Per the ACP schema (`poc/schemas/acp-schema.js`) and engine (`poc/acp-engine.js`), the future runtime relates to ACP as follows:

- **Agents**: `VALID_AGENTS` = `Kilo`, `Gemini`, `Gemini Builder` (`acp-schema.js:32`). DeepSeek is not an ACP *agent*; it is an upstream *requester* whose tool request the runtime translates into an ACP command targeting an existing agent.
- **Task modes**: `VALID_TASK_MODES` = `REVIEW`, `VERIFY_RECONCILE`, `FAILOVER_EXECUTE`, `BUILDER`, `RESEARCH_DOCUMENT` (`acp-schema.js:95`). The runtime determines `task_mode` server-side from the intended operation (defaulting to a constrained mode), never from a model-supplied string that bypasses `validateAuthorization`.
- **Capabilities**: `VALID_CAPABILITIES` = `read_only`, `modify_files`, `commit`, `push`, `run_tests` (`acp-schema.js:98`). `validateAuthorization` enforces the exact capability set per mode (e.g., `RESEARCH_DOCUMENT_CAPABILITIES = ['read_only','modify_files','commit','push']` at `acp-schema.js:104`; `RESEARCH_DOCUMENT_PATHS` at `:112-122`). Model-generated arguments are inputs to the trusted application, **not** authorization — the runtime selects capabilities; the model does not.
- **Command envelope**: `validate(command)` (`poc/acp-engine.js:41`) requires `protocol_version`, `request_id`, `source`, `target`, `task_type`, `repository`, `base_branch`, `task`, `constraints`, `authorization`, `verification`, `reporting`, plus a valid `task_mode`, and (for `REVIEW`) restricts to `read_only` + `poc/` paths. For non-REVIEW modes, `validateAuthorization` enforces mode-specific capabilities and `permitted_paths`.
- **Registration**: `taskRegistry.createTask` (`poc/task-registry.js:60`) dedups by `request_id`, builds `createInitialTaskRegistryEntry` (which sets `current_agent` from `command.target`, `next_agent` default `Gemini`, capabilities/permitted_paths), validates the registry entry, and persists to `poc/task-registry.json`.
- **Dispatch**: `getDispatcher()` (`services/transport-provider.js:98`) returns `dispatch`, which routes by `command.target`: `Kilo` → `dispatchKilo` (`poc/kilo-transport.js:4`, HTTPS to `KILO_TRIGGER_URL`); `Gemini Builder` → `dispatchBuilder`; anything else → `BLOCKED` (fail-closed). The runtime must submit a command whose `target` is an existing agent; the dispatcher already enforces this.

### Security principle (explicit)

Model-generated arguments are untrusted inputs to a trusted application. The runtime validates them and constructs a constrained ACP command. The existing ACP control plane remains responsible for authorization of the actual operation.

## 12. Current Chatbox Current State (Verified)

`POST /poc/chatbox` (`routes/poc.js`) today implements:

- **Authentication**: `x-chatbox-gateway-secret` / `CHATBOX_GATEWAY_SECRET`; fail-closed; distinct from all other secrets.
- **Current request transformation**: `buildChatboxCommand` produces an OpenAI-compatible→REVIEW-mode ACP command (`read_only`, `poc/` paths); preserves intent in `task` and `natural_language_intent`.
- **ACP construction**: a fixed REVIEW-mode ACP envelope; `target` taken from the request body and validated against `VALID_AGENTS`.
- **Current REVIEW / read-only restriction**: Chatbox issues only `read_only` + `poc/` capability, never writing capabilities.
- **TaskRegistry registration**: `taskRegistry.createTask` after `validateACPCommand`.
- **Dispatcher behavior**: `getDispatcher()` target-aware routing (Kilo → `dispatchKilo`, Gemini Builder → `dispatchBuilder`, else BLOCKED).
- **Current target handling**: no hardcoded `target: 'Kilo'` (removed); target flows from the trusted request body.

### How the future DeepSeek execution-runtime path differs

- **Chatbox gateway** is an authenticated *ingress* that converts one request into one REVIEW-mode ACP command for the existing control plane. It is stateless and non-authorizing.
- The **future DeepSeek execution runtime** is an authenticated *model loop host*: it iterates (model request → `tool_calls` → execute `control_plane` → return result → model → final response) and, on each `control_plane` call, constructs and submits an ACP command to `/poc/coordinator`. It introduces a bounded tool loop with iteration limits, argument validation, and safe logging — none of which exist today.

The two are complementary; the Chatbox gateway is not replaced.

## 13. DeepSeek Research Findings From the Investigation

These are the investigation-level conclusions, recorded so they survive conversation expiry:

- **DeepSeek itself cannot directly access the network or POST to `/poc/coordinator`.** A model does not execute its own HTTP tool calls.
- **OpenRouter is a model/API proxy** (provider routing + model output, including structured `tool_calls`). It does not execute this project's custom `control_plane` function.
- **Chatbox iOS was not treated as the arbitrary HTTP tool executor** (would invert the trust boundary).
- **A server-side application runtime is therefore required** to host the model interaction and execute the `control_plane` tool. This does **not** replace DeepSeek; it supplies the execution environment required by the tool-calling protocol.
- The intended relationship:
  ```
  DeepSeek = intelligence / decision about when to request a tool
  Execution runtime = trusted executor of the requested tool
  /poc/coordinator = existing authorization / control-plane boundary
  Gemini Builder / Kilo = existing execution agents
  ```

## 14. Generic HTTP Execution Must Not Become the Design

The intended tool is deliberately narrow — `control_plane(...)`, **not** a generic primitive such as:

```
http_post(url, headers, body)   // NOT the intended design
```

The execution runtime must retain server-side authority over:

- **endpoint** (always the existing `/poc/coordinator`);
- **authentication** (`x-deepseek-coordinator-secret`, never model-supplied);
- **ACP construction** (task_mode, capabilities, permitted_paths, verification, reporting);
- **target** (one of the existing `VALID_AGENTS`);
- **validation** of tool name and arguments;
- **execution policy** (bounded loops, iteration limits, result-size caps, safe logging).

DeepSeek requests an *operation*; the trusted runtime decides how that operation is safely translated into the existing control plane. This preserves the ACP fail-closed boundary rather than trusting model output as authorization.

## 15. Current Repository Findings (Section 11 Verification)

Repository-wide search (excluding `node_modules` and `package-lock.json`) for `OpenRouter`, `DeepSeek`, `OPENROUTER_API_KEY`, `tool calling`, `tool_calls`, `Agent SDK`, `MCP`, `model runtime`, `execution runtime`, `control-plane tool`, `control_plane`:

- **No matches in any JavaScript/TypeScript source** (`poc/`, `routes/`, `services/`, `workflows/`, `test/`, `index.js`, `google-apps-script/`, `ai-models/`) for `OpenRouter`, `OPENROUTER_API_KEY`, `tool_calls`, `tool-calling`, `Agent SDK`, `@openrouter/agent`, `execution runtime`, or `control_plane`.
- The only files containing `OpenRouter`/`DeepSeek` *text* are **documentation** (`ARCHITECTURE.md`, `docs/ai/ARCH_DECISIONS.md`, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/TASK_LOG.md`, `docs/ai/CHATBOX_ACP_ARCHITECTURE_RECORD.md`) — these document the Chatbox → OpenRouter → DeepSeek *concept* and the "DeepSeek Coordinator" *ingress label*, not a model/tool-calling implementation.
- The strings "DeepSeek Coordinator" / "Chatbox Gateway" in `routes/poc.js` and `test/coordinator.test.js` / `test/chatbox-gateway.test.js` are **authentication labels for ACP ingresses** (shared-secret middleware), not references to a DeepSeek model, OpenRouter, or a tool loop.

### Conclusion of the repository finding

> The current research finds **no existing OpenRouter / DeepSeek tool-execution implementation** in the repository. The DeepSeek ingress currently implements **Direct ACP** (canonical ACP JSON via `/poc/coordinator`), not model tool calling.

This remains true on current `main`.

## 16. OpenRouter Research

### 16.1 Integration approaches (verified)

OpenRouter exposes three integration approaches (official docs):

1. **API** — direct HTTP to `/api/v1/chat/completions`; full control, any language, no dependencies.
2. **Client SDKs** — `@openrouter/sdk` (TypeScript) / `openrouter` (Python): typed thin layer over the REST API.
3. **Agent SDK** — `@openrouter/agent` (TypeScript/Python/Go, ports kept in sync): higher-level primitives; "built on top of" `@openrouter/sdk`.

### 16.2 Agent SDK (verified)

- Package: `@openrouter/agent` (`npm`), `openrouter-agent-sdk` (Python), `go-agent` (Go).
- `callModel` runs an inference loop: (1) send input; (2) if the model returns tool calls, execute them automatically; (3) append tool results; (4) repeat until a stop condition is met or no more tool calls.
- **Stop conditions** are first-class: `stepCountIs(n)`, `maxCost(cents)`, `hasToolCall`, etc. These are precisely the "bounded execution" controls required for a production tool loop.
- **Tool definition**: `tool({ name, description, inputSchema (Zod), execute })` — the SDK handles serialization, validation, and dispatch.
- **MCP plug-in**: the Agent SDK can plug in a remote Model Context Protocol server ("its tools drop straight into `callModel`").
- **Distinction from Client SDK**: Client SDKs mirror the REST API directly; the application manages the conversation loop, tool dispatch, and stop conditions itself. The Agent SDK manages loops/state/stops automatically.

### 16.3 MCP research (verified)

- OpenRouter **hosts an MCP server** (`https://mcp.openrouter.ai/mcp`, remote, OAuth login) that exposes **live OpenRouter data** — which models exist, pricing, credit balance, usage rankings — for use by coding assistants while building. The docs explicitly state: *"To run models in your app, keep calling the OpenRouter API directly."*
- MCP is therefore a **build-time data-retrieval** facility for assistants, **not** a model-execution or control-plane execution layer for this project's needs.
- The Agent SDK's MCP support lets MCP tools be *consumed* during a model loop, but MCP is not a substitute for the narrow `control_plane` tool and does not reduce the need for a trusted execution boundary.

### 16.4 Minimal application-side loop

The smallest viable mechanism is a small application-side loop over the OpenRouter API:

```
model request (conversation + control_plane tool def)        ← OpenRouter /api/v1/chat/completions
→ tool_calls (control_plane(...))
→ validate tool name + arguments
→ execute permitted control-plane operation (build ACP → POST /poc/coordinator)
→ append tool result to conversation
→ model request
→ (bounded: repeat until stop condition / max iterations / no tool_calls)
→ final natural-language answer → return to Chatbox
```

This can be implemented with the **API + a few dozen lines of loop code**, with `max_iterations`, argument parsing/validation, and result-size caps. The Agent SDK adds abstractions (stop conditions, state tracking, streaming, MCP) that may be more than this narrow requirement needs.

## 17. Proposed Future Implementation Boundary

The future runtime's functional role is established; its physical form is not:

1. Receive the user's conversation (from Chatbox or equivalent).
2. Send the conversation to DeepSeek through OpenRouter (with the narrow `control_plane` tool defined).
3. Receive any `tool_calls`.
4. Validate the requested tool name (must be `control_plane`) and its arguments.
5. Execute the permitted control-plane operation — i.e., translate the validated request into a canonical ACP command and authenticate `POST /poc/coordinator`.
6. Authenticate to `/poc/coordinator` using the server-side secret (`DEEPSEEK_COORDINATOR_SECRET`), **never** a model-supplied value.
7. Receive the control-plane result.
8. Return the tool result to DeepSeek.
9. Allow DeepSeek to produce the final natural-language answer.
10. Return that answer to Chatbox.

The runtime determines endpoint, authentication, ACP construction (task_mode/capabilities/permitted_paths), target, validation, and execution policy. DeepSeek never receives secrets, credentials, or an unrestricted HTTP capability.

## 18. Security Model

The future execution runtime **must be the trusted application layer**.

DeepSeek must **not** receive:

- coordinator secrets (`DEEPSEEK_COORDINATOR_SECRET`);
- GitHub credentials;
- Render credentials;
- arbitrary HTTP access (no `http_post(url, ...)` primitive);
- unrestricted filesystem access;
- unrestricted ACP capabilities.

Trust sequence:

```
Model-generated request
   ↓  trusted runtime validation (tool name + arguments)
   ↓  authenticated coordinator request (server-side secret)
   ↓  existing ACP authorization (validateAuthorization: task_mode, capabilities, permitted_paths)
   ↓  authorized agent execution (dispatcher → Kilo / Gemini Builder)
```

The runtime is a validation and translation layer, not an authorization grant. Model output is untrusted input.

## 19. Error / Loop Control (Application-Side Requirements)

For a reliable tool loop, the runtime must handle (per OpenRouter guidance on bounded loops and repeated-call controls):

| Condition | Required handling |
|-----------|-------------------|
| Malformed tool arguments | Parse-failure → return a tool result encoding the error (do not execute). |
| Unsupported tool name | Only `control_plane` accepted; any other name → error result, no execution. |
| Multiple tool calls in one turn | Execute each, validate each independently, return each result. |
| Repeated tool calls | Bounded by `max_iterations` (hard ceiling) regardless of model behavior. |
| Tool execution failure / coordinator rejection | Propagate the coordinator's status (BLOCKED/FAILED) as a tool result; do not surface secrets. |
| Model errors (non-2xx, malformed JSON) | Surface a sanitized error; stop the loop. |
| Iteration limits | Hard `max_iterations` and optional cost/length-based stop (OpenRouter Agent SDK: `stepCountIs`, `maxCost`). |
| Result-size / history growth | Cap tool-result size and context length; trim history as needed. |
| Safe logging | Log tool names, request_id, and status only; never log secrets, credentials, or full bodies. |

OpenRouter documentation explicitly recommends bounded loops and repeated-call controls for production tool execution.

## Architectural Diagram (Documented Target — NOT Implemented)

```
┌──────────────┐
│  Chatbox iOS │
└──────┬───────┘
       │ conversation
       ▼
┌────────────────────────────────┐
│ Server-side execution          │
│ runtime                        │
│                                │
│ OpenRouter model interaction   │
│   + bounded control_plane      │
│     executor                   │
└──────┬───────────────────┬────┘
       │ model             │ control_plane tool request (tool_calls)
       ▼                   │
┌──────────────┐            │
│  OpenRouter  │            │
└──────┬───────┘            │
       ▼                    │
┌──────────────┐            │
│   DeepSeek   │◄───────────┘
└──────┬───────┘
       │ tool result / final natural-language response
       ▼
┌────────────────────┐
│ /poc/coordinator   │   (auth: x-deepseek-coordinator-secret)
└────────┬───────────┘
         ▼
┌────────────────────┐
│ Existing ACP       │   (validateACPCommand / validateAuthorization)
│ TaskRegistry        │   (poc/task-registry.js)
└────────┬───────────┘
         ▼
┌────────────────────┐
│ Dispatcher          │   (getDispatcher(): Kilo / Gemini Builder / BLOCKED)
└────────┬───────────┘
         ▼
┌────────────────────┐
│ Gemini Builder /   │
│ Kilo                │
└────────────────────┘
```

This is the documented **target architecture**, not an implemented system. The solid boxes that already exist are: Chatbox iOS (client), `/poc/coordinator`, ACP/TaskRegistry, Dispatcher, Gemini Builder/Kilo. The box to be added by a future task is the **server-side execution runtime** (OpenRouter model interaction + bounded `control_plane` executor).

## Status Distinction

### Current Implementation (VERIFIED)

- `POST /poc/coordinator` — implemented and verified (`routes/poc.js`).
- Current DeepSeek control-plane path — **Direct ACP** (`ARCHITECTURE.md` Section 16.6): DeepSeek emits canonical ACP JSON to `/poc/coordinator`.
- `POST /poc/chatbox` — implemented and verified (`routes/poc.js`).
- ACP schema/engine, TaskRegistry, dispatcher — implemented (`poc/schemas/acp-schema.js`, `poc/acp-engine.js`, `poc/task-registry.js`, `services/transport-provider.js`).
- No repository OpenRouter/DeepSeek tool-execution implementation (verified, Section 15).
- OpenRouter application-side tool-calling model (verified, Section 6).

### Future Target (DOCUMENTED, NOT Implemented)

- Server-side execution runtime hosting the OpenRouter/DeepSeek tool-calling loop.
- `control_plane` tool (narrow, server-defined).
- OpenRouter integration in the repository (no `OPENROUTER_API_KEY` configured today).
- Runtime endpoint/interface and deployment topology.
- Chatbox production integration with the future runtime.

### Unresolved

- Exact runtime placement, API surface, and `control_plane` schema.
- Exact ACP translation strategy.
- Minimal application-side tool loop vs. OpenRouter Agent SDK vs. MCP for this narrowly-scoped requirement.

## Simplicity Gate

**Question**: Can a small server-side application-side OpenRouter tool loop provide the required DeepSeek → `control_plane` → existing Coordinator path without introducing an additional agent framework or a parallel control plane?

**Evidence-based assessment**: Yes — a minimal application-side loop over `POST /api/v1/chat/completions` (conversation + `control_plane` tool definition) with `max_iterations`, argument validation, ACP-command construction, and authenticated submission to the existing `/poc/coordinator` satisfies the functional requirement. Such a loop is tens of lines of code over the REST API and reuses the **entire** existing control plane (`validateACPCommand` → `taskRegistry.createTask` → `getDispatcher()` → Kilo/Builder).

- The **OpenRouter Agent SDK** adds multi-turn state management, streaming, and an MCP plug-in. Those facilities are valuable for general agents but are **not required** for this specific requirement (one model, one narrow tool, bounded loop, existing coordinator). Introducing it would add abstraction without eliminating the need for the trusted execution boundary.
- **MCP** is, per OpenRouter's own documentation, a build-time data-retrieval facility for assistants ("To run models in your app, keep calling the OpenRouter API directly"); it is not a runtime for control-plane execution and does not replace the `control_plane` tool.
- A **generic HTTP executor** must not be used; the runtime exposes `control_plane` and retains server-side authority over endpoint/authentication/ACP construction.

**Conclusion for a future decision**: Prefer the minimal application-side OpenRouter tool loop as the baseline; adopt the Agent SDK only if multi-model/MCP/streaming/stop-condition complexity is later justified. MCP is not applicable to the control-plane execution requirement.

## Recommended Next Research / Implementation Step

Implement a **bounded prototype** of the server-side execution runtime as a new, explicitly-scoped execution task — NOT as part of this research document. The prototype should:

1. Host a minimal OpenRouter tool loop (`POST /api/v1/chat/completions`) with a hard `max_iterations` cap.
2. Define the narrow `control_plane` tool server-side only (no `http_post`).
3. Validate tool name + arguments, then construct a canonical ACP command and authenticate `POST /poc/coordinator` using the existing `x-deepseek-coordinator-secret` boundary.
4. Reuse `validateACPCommand` → `taskRegistry.createTask` → `getDispatcher()` → existing Kilo/Builder dispatch with **no new** orchestrator, TaskRegistry, or dispatcher.
5. Never accept secrets, capabilities, endpoints, or targets from the model.

This should be a separate implementation ACP task with its own authorization, capabilities, and permitted paths — not a research-document task.

## Sources / Evidence Used

- Repository source (read on `main`, commit `d2372b5`): `routes/poc.js` (DeepSeek Coordinator + Chatbox Gateway + Kilo routes, auth middleware, `buildChatboxCommand`, `getDispatcher()` usage), `poc/schemas/acp-schema.js` (`VALID_TASK_MODES`, `VALID_CAPABILITIES`, `VALID_AGENTS`, `RESEARCH_DOCUMENT_CAPABILITIES`/`PATHS`, `validateACPCommand`, `validateAuthorization`, `createInitialTaskRegistryEntry`), `poc/acp-engine.js` (`validate`, `validateReviewMode`, `execute`), `poc/task-registry.js` (`createTask`, `rehydrateTask`), `poc/orchestrator.js` (`handleKiloCompletion`, `triggerGemini`, `triggerGeminiBuilder`), `poc/kilo-transport.js` (`dispatch`, `KILO_TRIGGER_URL`), `services/transport-provider.js` (`getDispatcher`, `dispatch`, `dispatchKilo`, `dispatchBuilder`), `index.js` (`app.use('/poc', pocRouter)`).
- Repository documentation: `ARCHITECTURE.md` Sections 16.4–16.6 (Qwen router → Kilo → ACP boundary; Direct ACP DeepSeek Coordinator), `docs/ai/ARCH_DECISIONS.md` (ADR-005, ADR-010, ADR-015, ADR-016).
- OpenRouter official documentation: `https://openrouter.ai/docs` (API/Client SDK/Agent SDK overview, tool-calling contract in `tools`/`tool_calls`, normalized `finish_reason` including `tool_calls`, "tool support varies by model" and model filter `supported_parameters=tools`), `https://openrouter.ai/docs/agent-sdk/overview` (Agent SDK `callModel` loop, stop conditions `stepCountIs`/`maxCost`/`hasToolCall`, MCP plug-in), `https://openrouter.ai/docs/api-reference/overview` (OpenAI-compatible request/response schema).
- Repository-wide search confirming absence of repository OpenRouter/DeepSeek tool-execution implementation (Section 15).

---

*Document created as part of `TASK-GEMINI-DEEPSEEK-CONTROL-PLANE-RESEARCH-DOCUMENT-001` (RESEARCH_DOCUMENT, Kilo, 2026-09-23). This record documents an architectural direction; the server-side execution runtime and `control_plane` tool are NOT implemented by this task.*
