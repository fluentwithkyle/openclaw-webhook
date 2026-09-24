# Research Record: Chatbox → OpenRouter → DeepSeek → Render Integration Direction and Five-Step Implementation Roadmap

- **Task ID**: `TASK-GEMINI-CHATBOX-RENDER-INTEGRATION-DIRECTION-001`
- **Request ID**: `REQ-GEMINI-CHATBOX-RENDER-INTEGRATION-DIRECTION-001`
- **Agent**: Gemini (Architect / Reviewer / Researcher)
- **Date**: 2026-09-24
- **Task Mode**: `RESEARCH_DOCUMENT`
- **Scope Examined**: `routes/poc.js`, `poc/schemas/acp-schema.js`, `ARCHITECTURE.md`, `docs/ai/ARCH_DECISIONS.md`, `docs/ai/CHATBOX_ACP_ARCHITECTURE_RECORD.md`, `test/chatbox-gateway.test.js`, `test/schema.test.js`, `test/coordinator.test.js`, `test/verify-reconcile.test.js`.

---

## 1. Research Objective & Question

To research, evaluate, and durably document the current architectural state, gaps, and proposed five-step implementation roadmap for wiring the Chatbox → OpenRouter → DeepSeek path into the existing Render-hosted ACP control plane. The research establishes whether the proposed direction aligns with existing repository architecture, preserves security and authorization boundaries, avoids parallel control planes, and provides a standalone durable reference for future execution.

---

## 2. Current Verified Architecture

1. **Chatbox Gateway (`POST /poc/chatbox`)**:
   - **Status**: IMPLEMENTED / VERIFIED in `routes/poc.js` and tested in `test/chatbox-gateway.test.js` (26 tests passing).
   - **Role**: Authenticated, non-authorizing ingress. Accepts OpenAI-compatible chat requests (`model`, `messages`, optional `target`), authenticates via the `x-chatbox-gateway-secret` header (`CHATBOX_GATEWAY_SECRET` env var), and translates the request into bounded ACP work using the Direct ACP pattern (`validateACPCommand`, `taskRegistry.createTask`, `getDispatcher()`).
   - **Capability Bound**: Defaults to `REVIEW` / read-only / `poc/` permitted paths. It cannot independently grant elevated capabilities or bypass ACP validation.

2. **DeepSeek Coordinator Ingress (`POST /poc/coordinator`)**:
   - **Status**: IMPLEMENTED / VERIFIED in `routes/poc.js` (`ARCHITECTURE.md` Section 16.6).
   - **Role**: Canonical machine-to-machine control-plane ingress. Authenticated via `x-deepseek-coordinator-secret` header (`DEEPSEEK_COORDINATOR_SECRET`), validates canonical ACP commands via `validateACPCommand` in `poc/schemas/acp-schema.js`, registers tasks in `TaskRegistry`, and dispatches through the existing Kilo / Gemini Builder dispatcher.

3. **ACP Control Plane & Task Registry**:
   - **Status**: IMPLEMENTED / VERIFIED (`poc/schemas/acp-schema.js`, `poc/task-registry.js`).
   - **Role**: Authoritative authorization boundary. Enforces state machine transitions, evidence requirements, permitted paths, agent targets (`VALID_AGENTS`: `'Kilo'`, `'Gemini'`, `'Gemini Builder'`), and fail-closed execution rules.

---

## 3. Current Verified Connectivity State

- **End-to-End Status**: **NOT SUCCESSFULLY CONNECTED**.
- **Evidence**: While routing plumbing, gateway endpoints (`POST /poc/chatbox`, `POST /poc/coordinator`), and mock unit/integration tests exist and pass successfully, an actual end-to-end live ping from Chatbox iOS through OpenRouter and DeepSeek to Render has **not** been verified.
- **Historical Failure**: Prior live attempts from mobile Chatbox resulted in network errors (e.g., `"Network Error: Load failed"`).
- **Root Cause**: UNKNOWN (likely a combination of DNS/TLS routing, mobile network boundaries, missing server-side tool-loop execution runtime, or authentication mismatches).
- **Rule**: Existing unit and integration tests (`test/chatbox-gateway.test.js`, `test/coordinator.test.js`) prove internal code correctness under mock conditions, but must **not** be cited as evidence of live mobile connectivity.

---

## 4. Relationship Between Chatbox Gateway and DeepSeek Coordinator

- **Chatbox iOS**: Acts as the human conversational ingress layer. The user expresses natural-language intent from a mobile device.
- **OpenRouter / DeepSeek**: Acts as the natural-language coordination and reasoning layer.
- **Server-Side Execution Runtime (PROPOSED/TARGET)**: Acts as the trusted bridge hosting the model tool-calling loop, intercepting model tool calls, and translating them into authorized control-plane operations.
- **`/poc/coordinator`**: The trusted machine ingress that accepts canonical ACP commands.
- **ACP Control Plane**: The definitive security and authorization boundary.

Chatbox is strictly non-authorizing. DeepSeek is an upstream requester, not the authorization authority.

---

## 5. The Five-Step Implementation Roadmap

### Step 1 — Prove the Network Path First
- **Objective**: Establish whether benign HTTP requests can reliably traverse from the caller through OpenRouter/DeepSeek to Render before introducing complex tool-calling logic.
- **Endpoint**: A dedicated lightweight health/ping endpoint or `/poc/chatbox` with a benign echo prompt.
- **Diagnostic Criteria**: Distinguish DNS failures, TLS handshakes, proxy timeouts, gateway auth failures (`401`), and handler errors (`500`). Use unique correlation identifiers (`x-request-id`) in headers and payloads.
- **Verification**: Independently verifiable HTTP 2xx response from Render confirming round-trip reachability.

### Step 2 — Consolidate the Ingress and Control-Plane Roles
- **Objective**: Maintain clean separation of responsibilities across the architecture:
  - *Chatbox*: Captures human input.
  - *Server-side runtime*: Translates model intentions into bounded requests.
  - *`/poc/coordinator`*: Receives structured machine operations.
  - *ACP*: Enforces authorization, capabilities, and paths.
- **Repository Alignment**: Fully supported by existing ingress separation in `routes/poc.js`. No parallel orchestrator or dispatcher is permitted.

### Step 3 — Introduce One Narrow `control_plane` Tool
- **Objective**: Define a single, highly constrained server-side tool interface (`control_plane(action, target, prompt, permitted_paths)`) for OpenRouter/DeepSeek rather than an unrestricted generic HTTP tool (`http_post`).
- **Runtime Responsibility**: The server-side runtime owns the Coordinator endpoint URL, authentication secrets (`DEEPSEEK_COORDINATOR_SECRET`), ACP schema construction, target policy enforcement (`VALID_AGENTS`), capability limits, and execution boundaries.
- **Security Boundary**: Model-generated arguments are treated as untrusted inputs and validated strictly against schema definitions before coordinator submission.

### Step 4 — Prove One Boring End-to-End Operation
- **Objective**: Execute the first model-mediated operation using the lowest-risk progression:
  1. `PING / HEALTH` (benign reachability test)
  2. `STATUS / READ` (read-only inspection of task logs or state)
  3. `REVIEW` (advisory code review)
  4. Bounded implementation / `VERIFY_RECONCILE` (only when explicitly authorized)
- **Constraint**: The success of a PING or STATUS operation does not automatically authorize elevated capabilities (e.g., `FAILOVER_EXECUTE`).

### Step 5 — Progressively Expose Authority
- **Objective**: Enforce least privilege as capabilities expand.
- **Mandates**: Every model-mediated action must preserve explicit ACP capabilities, permitted path restrictions, authenticated coordinator submission, independent verification, durable GitHub state tracking (`docs/ai/STATE.md`, `docs/ai/TASK_LOG.md`), and fail-closed behavior on validation failure.

---

## 6. Simplest Viable Solution Evaluation (Simplicity Gate)

- **Evaluated Approach A (Complex)**: Deploying heavy agent frameworks, remote MCP servers on mobile devices, or generic model-controlled HTTP executors. *Rejected* (violates security boundaries and increases attack surface).
- **Evaluated Approach B (Simple)**: A minimal Node.js server-side script using the standard OpenRouter/OpenAI SDK with a hardcoded tool definition (`control_plane`), enforcing validation and submitting directly to the existing authenticated `POST /poc/coordinator` endpoint. *Selected as the Simplest Viable Solution*.

---

## 7. Recommended Architecture & Direction (PROPOSED / TARGET)

```
[Chatbox iOS (Human UI)]
       │ (OpenAI-compatible request)
       ▼
[OpenRouter / DeepSeek]
       │ (Tool call: control_plane)
       ▼
[Trusted Server-Side Runtime] (Validates & constructs canonical ACP)
       │ (POST /poc/coordinator with x-deepseek-coordinator-secret)
       ▼
[Render Node.js / Express Control Plane]
       │ (validateACPCommand → TaskRegistry → Dispatcher)
       ▼
[Kilo / Gemini Builder Execution Lane]
```

---

## 8. Exact First Milestone & Acceptance Criteria

- **Milestone**: End-to-End Connectivity Ping Proof (`TASK-GEMINI-CHATBOX-PING-PROOF-001`).
- **Acceptance Criteria**:
  1. A test script successfully initiates a request via OpenRouter/DeepSeek targeting a benign ping handler on Render.
  2. Render logs and client response confirm successful round-trip authentication and request processing without "Network Error: Load failed."
  3. No secrets or credentials are exposed in logs or model prompts.

---

## 9. Dependencies, Blockers & Unresolved Questions

- **OpenRouter API Key & DeepSeek Model Endpoint**: Required for live testing (managed via environment secrets, never committed).
- **Render Deployment Host URL**: Must be accessible and correctly configured with `CHATBOX_GATEWAY_SECRET` and `DEEPSEEK_COORDINATOR_SECRET`.
- **Root Cause of "Network Error: Load failed"**: Remains UNKNOWN until live network diagnostics (Step 1) are executed in a non-production test environment.

---

## 10. Security & Authorization Implications

- **No Implicit Trust**: Natural-language model output is untrusted input.
- **Fail-Closed**: Malformed tool arguments or invalid ACP commands are rejected immediately.
- **Secret Isolation**: `DEEPSEEK_COORDINATOR_SECRET` and `CHATBOX_GATEWAY_SECRET` reside exclusively in server environment variables and are never passed to models or clients.

---

## 11. What is VERIFIED vs. INFERRED vs. UNKNOWN

| Category | Item | Status | Evidence |
|----------|------|--------|----------|
| **VERIFIED** | Chatbox gateway ingress (`POST /poc/chatbox`) | IMPLEMENTED | `routes/poc.js`, `test/chatbox-gateway.test.js` |
| **VERIFIED** | DeepSeek coordinator ingress (`POST /poc/coordinator`) | IMPLEMENTED | `routes/poc.js`, `ARCHITECTURE.md` Section 16.6 |
| **VERIFIED** | ACP schema validation & TaskRegistry dispatch | IMPLEMENTED | `poc/schemas/acp-schema.js`, `test/coordinator.test.js` |
| **INFERRED** | Server-side runtime tool-loop architecture | PROPOSED / TARGET | ADR-017, `docs/ai/CHATBOX_ACP_ARCHITECTURE_RECORD.md` |
| **UNKNOWN** | Exact root cause of mobile "Network Error: Load failed" | UNKNOWN | Requires live network diagnostics (Step 1) |

---

## 12. Recommended Next Action

1. Proceed with **Step 1 (Prove the Network Path First)** in an isolated test environment to diagnose and resolve the "Network Error: Load failed" connectivity barrier.
2. Implement the minimal server-side OpenRouter tool-calling runner locally before deploying or connecting production Chatbox iOS.

---

## 13. Statement of Non-Implementation

*No implementation, production code modification, workflow editing, or deployment action was performed during this `RESEARCH_DOCUMENT` task execution. All outputs are strictly durable research documentation.*
