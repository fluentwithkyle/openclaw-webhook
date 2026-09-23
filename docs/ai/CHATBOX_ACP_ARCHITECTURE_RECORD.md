# Chatbox → DeepSeek → ACP Architecture Research Record

**Status**: IMPLEMENTED / VERIFIED — Gateway implemented and verified
**Repository**: `fluentwithkyle/openclaw-webhook`
**Base Branch**: `main`
**Date**: 2026-09-18
**Task ID**: TASK-KILO-CHATBOX-GATEWAY-IMPLEMENT-001

> **IMPLEMENTED / VERIFIED**: The Chatbox gateway has been implemented as an
> authenticated, non-authorizing ingress in `routes/poc.js` (`POST /poc/chatbox`).
> The gateway authenticates via a dedicated `x-chatbox-gateway-secret` header
> (env: `CHATBOX_GATEWAY_SECRET`), accepts OpenAI-compatible requests,
> preserves the user's natural-language intent, builds a bounded REVIEW-mode
> ACP command, and submits it through the existing control plane
> (`validateACPCommand` → `taskRegistry.createTask` → `getDispatcher()`).
> The authentication mechanism that was previously UNKNOWN is now resolved
> (see Section 12.1). The remaining architectural items (Qwen Router
> classification, Security Specialist callback, Security Audit Report
> persistence) remain explicitly UNKNOWN and are NOT implemented.

---

## 1. ORIGINAL PROBLEM

The owner, Kyle, needs a phone-based natural-language control interface for the
AI development/control plane.

A representative future request is:

> "I would like to automate client lesson prep. I can give the system access to
> my Google document so I can upload client notes, then we can paste a new lesson
> on those notes. Go create the system that can accomplish this."

The intended system should eventually allow Kyle to communicate a high-level
desired outcome from a phone — including by natural-language chat or voice — and
have the existing AI control plane translate that intent into legitimate
planning, implementation, testing, review, and deployment work.

This is the **destination-level intent**. It must remain distinct from the
technical route used to accomplish it.

---

## 2. CURRENT DEEPSEEK / CHATBOX STARTING POINT

### 2.1 DeepSeek Access Path

DeepSeek is currently accessible from **Chatbox iOS** through **OpenRouter**
using an **OpenAI-compatible interface**.

The current working mobile interaction is:

```
Chatbox iOS → OpenRouter → DeepSeek
```

This is **not yet** the repository's production/control-plane integration. The **current, implemented** DeepSeek control-plane path is **Direct ACP** (see Section 4): DeepSeek emits canonical ACP JSON directly to the authenticated `POST /poc/coordinator` ingress. DeepSeek does **not** currently make model tool calls against this repository, and the repository contains no OpenRouter model integration or tool-calling loop (verified; see Section 17 and `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-CONTROL-PLANE-RESEARCH-DOCUMENT-001.md`).

The **future target** (newly documented architecture, **not implemented**): a server-side execution runtime that hosts the OpenRouter/DeepSeek tool-calling loop and a narrow `control_plane` tool, submitting validated results to the existing `POST /poc/coordinator` boundary. See Section 17.

### 2.2 Purpose of the Proposed Gateway

The purpose of the proposed gateway is to connect this phone-based
natural-language interface to the **existing canonical ACP control plane**.

---

## 3. MCP INVESTIGATION

### 3.1 Conclusion

Research established that **Chatbox iOS should not be treated as a desktop Work
Mode MCP client**.

The investigated mobile architecture does not provide the desktop-style MCP
tool-execution loop required for the proposed direct remote-MCP approach.

### 3.2 Status

**VERIFIED** — Research conclusion: the desktop-style MCP tool-execution loop
is not available on the mobile Chatbox client.

**INFERRED** — Therefore the selected direction is an ordinary authenticated
HTTP / OpenAI-compatible gateway rather than an MCP bridge.

This conclusion is recorded as architectural research context, **not** as a
claim that MCP is universally unsuitable.

---

## 4. EXISTING COORDINATOR ARCHITECTURE

The repository already has a canonical Coordinator ingress. The established
architecture includes:

- Authenticated Coordinator ingress
- Canonical ACP validation
- TaskRegistry registration
- Existing orchestration / dispatch
- Kilo implementation lane
- Gemini research / review lane
- Security Specialist lane
- Qwen router direction

The Chatbox integration is intended to **enter this existing control plane**
rather than create a parallel execution architecture.

### Verified Components

| Component | Path | Status |
|-----------|------|--------|
| ACP Schema | `poc/schemas/acp-schema.js` | CURRENT / IMPLEMENTED |
| Task Registry | `poc/task-registry.js` | CURRENT / IMPLEMENTED |
| Orchestrator | `poc/orchestrator.js` | CURRENT / IMPLEMENTED |
| Transport Provider | `services/transport-provider.js` | CURRENT / IMPLEMENTED |
| POC Routes | `routes/poc.js` | CURRENT / IMPLEMENTED |
| Kilo Transport | `poc/kilo-transport.js` | CURRENT / IMPLEMENTED |
| Gemini Workflow | `.github/workflows/main.yml` | CURRENT / IMPLEMENTED |
| DeepSeek Coordinator Ingress | `POST /poc/coordinator` | CURRENT / IMPLEMENTED / VERIFIED |
| Kilo External Trigger | Kilo Cloud Agent HTTP webhook | CURRENT / IMPLEMENTED (capability) |

### 4.1 Existing ACP Execution Modes

The current architecture defines:

- **REVIEW** — read-only, no file modification
- **VERIFY_RECONCILE** — `read_only` + `modify_files` + `commit` + `push`;
  bounded permitted paths
- **FAILOVER_EXECUTE** — all 5 capabilities; explicit permitted paths;
  protected by the project's security architecture

### 4.2 Existing DeepSeek Coordinator Ingress

The authenticated machine-to-machine Coordinator ingress (`POST /poc/coordinator`)
has been **IMPLEMENTED / VERIFIED**. It accepts canonical ACP JSON from DeepSeek,
authenticates via `x-deepseek-coordinator-secret` header (env:
`DEEPSEEK_COORDINATOR_SECRET`), validates it through the existing ACP schema
(`validateACPCommand`), and registers it through the existing TaskRegistry
(`taskRegistry.createTask`). After successful registration, the command is
dispatched through the existing Kilo dispatcher via `getDispatcher()` — the
same mechanism used by `/poc/kilo`.

The implemented DeepSeek flow is:

```
DeepSeek Coordinator → authenticated POST /poc/coordinator → existing ACP validation → existing TaskRegistry → existing Kilo dispatcher → existing Kilo execution path
```

**VERIFIED** — The DeepSeek Coordinator ingress boundary is implemented and
verified per `ARCHITECTURE.md` Section 16.6 and the implementation commits.

**INFERRED** — The Chatbox ingress is intended to follow the same Direct ACP
pattern as the DeepSeek Coordinator ingress, entering through the same existing
control plane rather than creating a parallel path.

---

## 5. CANONICAL ACP BOUNDARY

### 5.1 ACP as Authorization Boundary

**VERIFIED** — ACP is the structured authorization boundary. Research verified
that ACP serves as the validation and authorization boundary between natural
language intent and specialist execution.

### 5.2 ACP Concepts

The important ACP concepts include:

- task intent
- task mode / execution authority
- capabilities
- permitted paths
- authorization
- verification
- reporting
- repository
- base branch
- target agent

### 5.3 Execution Agent Constraints

The execution agent must act **only** within the explicit capabilities and
constraints represented by the validated ACP command.

### 5.4 Status

**VERIFIED** — ACP execution modes and the ACP boundary are established in the
current repository (`poc/schemas/acp-schema.js`, `poc/acp-engine.js`).

**VERIFIED** — Kilo and Gemini agents operate only within explicitly authorized
ACP commands. Commit/push authority is never assumed; it requires explicit ACP
authorization.

---

## 6. ACP EXECUTION MODES

### 6.1 Current Modes

The current architecture defines:

- **REVIEW**: read-only, no file modification
- **VERIFY_RECONCILE**: `read_only` + `modify_files` + `commit` + `push`;
  bounded permitted paths
- **FAILOVER_EXECUTE**: all 5 capabilities; explicit permitted paths;
  protected by the project's security architecture

### 6.2 Research Finding: Permanent REVIEW Rejected

The research initially considered making Chatbox **permanently** emit REVIEW
commands.

**VERIFIED** — That approach was **rejected**.

A permanent REVIEW-only Chatbox ingress would turn the phone interface into a
read-only terminal and prevent the intended future control-plane capability.

### 6.3 Conclusion

REVIEW is understood as the **initial bounded state** for an unverified request,
**not** the permanent capability ceiling of the phone interface.

**INFERRED** — An unauthenticated or untrusted ingress should initially be
restricted to REVIEW, but authenticated ingress following the Coordinator
pattern (two-stage authorization) may permit elevated modes after trusted
authorization.

---

## 7. CORRECT CHATBOX BOUNDARY — RESEARCH CONCLUSION

### 7.1 Final Decision

**PROPOSED / TARGET** — The final architectural conclusion from Gemini research
is:

> Chatbox must be an **authenticated, non-authorizing ingress / translation
> layer**.

### 7.2 The Gateway Must NOT Grant

The Chatbox gateway must **NOT** independently grant:

- `modify_files`
- `commit`
- `push`
- arbitrary `permitted_paths`
- `FAILOVER_EXECUTE`
- other elevated capabilities

### 7.3 Intent Preservation

The gateway must **preserve the user's natural-language intent** and pass it
into the **trusted control-plane boundary**.

### 7.4 Security Boundary

Security-sensitive authorization decisions belong to the **trusted
Coordinator / orchestration / ACP layer**, not to the Chatbox ingress.

**VERIFIED** — This boundary is consistent with existing ADR-009 (No Secrets in
Documentation), ADR-010 (Qwen Router Under Validation), ADR-011 (OpenClaw
Independence), and ADR-014 (Security Specialist Architectural Foundation).

---

## 8. INTENDED CONTROL-PLANE FLOW

**PROPOSED / TARGET** — The intended end-to-end architectural flow:

```
Phone / Chatbox
  → authenticated Chatbox ingress
  → bounded initial request
  → Coordinator / orchestration authorization and classification
  → canonical ACP command
  → ACP validation / TaskRegistry
  → authorized specialist execution
  → Kilo for implementation / testing
  → Gemini for architecture / review where required
  → Security Specialist when the established risk model requires it
  → verification / reconciliation
  → durable GitHub result
```

**VERIFIED** (partial) — Each component in this flow exists as an individual
element in the current repository:

| Step | Component | Current Status |
|------|-----------|----------------|
| 1. Phone ingress | Chatbox gateway | PROPOSED / TARGET (not implemented) |
| 2. Authenticated ingress | Coordinator auth boundary | CURRENT / IMPLEMENTED (DeepSeek pattern) |
| 3. ACP command | ACP schema validation | CURRENT / IMPLEMENTED |
| 4. TaskRegistry | Task registration | CURRENT / IMPLEMENTED |
| 5. Specialist dispatch | Orchestrator dispatch | CURRENT / IMPLEMENTED |
| 6. Kilo execution | Kilo implementation lane | CURRENT / IMPLEMENTED |
| 7. Gemini review | Gemini workflow | CURRENT / IMPLEMENTED |
| 8. Security review | Security Specialist lane | PROPOSED / TARGET (foundation only) |
| 9. Verification | Delivery verification lane | CURRENT / IMPLEMENTED |
| 10. Durable result | GitHub commit / push | CURRENT / IMPLEMENTED |

**INFERRED** — The Chatbox ingress is intended to follow the same Direct ACP
pattern as the DeepSeek Coordinator ingress, entering through the same
existing control plane.

### 8.1 Gateway Must Not Become a Second Authorization System

**PROPOSED / TARGET** — The gateway must not become a second authorization
system. It must submit natural-language intent into the trusted control plane
and let the existing orchestration layer determine the legitimate execution path.

---

## 9. TWO-STAGE AUTHORIZATION CONCEPT

### 9.1 Stage 1 — Ingress

**PROPOSED / TARGET**

- Authenticate the caller
- Preserve the user's intent
- Submit the request to the trusted control plane
- Do **not** independently escalate capabilities

### 9.2 Stage 2 — Authorization / Orchestration

**VERIFIED** — The trusted authorization model already exists in the current
repository:

- Classify the request
- Determine the appropriate ACP mode (REVIEW / VERIFY_RECONCILE / FAILOVER_EXECUTE)
- Determine capabilities and permitted paths
- Apply the existing security model
- Issue / validate the authorized ACP command
- Dispatch to the appropriate specialist

**INFERRED** — The Chatbox gateway's Stage 1 ingress feeds into the existing
Stage 2 authorization model that is already established for DeepSeek Coordinator
ingress and Kilo/Gemini orchestration.

### 9.3 Intent Preservation

This two-stage model preserves user intent without allowing natural-language
input itself to grant authority.

---

## 10. FAILOVER_EXECUTE PROTECTION

### 10.1 Constraint

**VERIFIED** — FAILOVER_EXECUTE is an exceptional / high-authority mode.

### 10.2 Gateway Must Not Grant

**PROPOSED / TARGET** — The Chatbox gateway must **not** grant FAILOVER_EXECUTE
directly.

### 10.3 Security Specialist Gate

The existing Security Specialist architecture and its required security gate
must remain intact.

**VERIFIED** — The Security Specialist lane is defined in `AGENTS.md` Section 4
and `ARCHITECTURE.md` Sections 12.7, 16.3, 17.2 (PROPOSED / TARGET — architectural
foundation established; activation mechanism not implemented).

### 10.4 Elevated Execution Path

**PROPOSED / TARGET** — Any future Chatbox-originated request requiring elevated
execution must pass through the project's existing authorization / security
architecture rather than being granted by the gateway itself.

---

## 11. USER-INTENT PRESERVATION

### 11.1 Four-Way Distinction

The architecture must maintain a clear distinction between:

1. **What Kyle asked for** — the destination-level natural-language intent
2. **How the system classified the request** — REVIEW / VERIFY_RECONCILE /
   FAILOVER_EXECUTE, with capabilities and permitted paths
3. **What Kyle explicitly authorized** — the ACP authorization fields
4. **What capabilities the resulting ACP command actually grants** — the
   validated capabilities and permitted paths

### 11.2 Natural-Language Is Not Authority

Natural-language wording must **never** itself become an implicit permission
grant.

**VERIFIED** — This principle is enforced by the existing ACP schema validation
(`poc/schemas/acp-schema.js`) and ACP engine enforcement (`poc/acp-engine.js`),
which require explicit capabilities and permitted paths in the ACP command
envelope.

---

## 12. Resolved and Remaining Unknowns

### 12.1 Resolved: Chatbox Gateway Authentication Mechanism

The previously UNKNOWN Chatbox gateway authentication mechanism has been
**resolved and implemented**:

- **Header**: `x-chatbox-gateway-secret`
- **Environment variable**: `CHATBOX_GATEWAY_SECRET`
- **Boundary**: A dedicated credential boundary for Chatbox ingress, distinct
  from `KILO_CALLBACK_SECRET`, `GEMINI_CALLBACK_SECRET`, `DEEPSEEK_COORDINATOR_SECRET`,
  and `ACP_POC_TRIGGER_SECRET`.
- **Behavior**: Fail-closed — missing or invalid secret returns 401 without
  registering a task or dispatching.
- **Resolution date**: 2026-09-18 (TASK-KILO-CHATBOX-GATEWAY-IMPLEMENT-001)

### 12.2 Remaining Unresolved Items

The following items remain **unresolved architectural / implementation
items** rather than silently resolved:

| # | Unresolved Item | Status |
|---|-----------------|--------|
| 1 | Exact Qwen Router classification / trigger implementation | **UNKNOWN** |
| 2 | Exact Security Specialist callback mechanism to the Orchestrator | **UNKNOWN** |
| 3 | Exact Security Audit Report persistence mechanism | **UNKNOWN** |

These are additionally recorded in `docs/ai/STATE.md` Open Architectural
Decisions (Security Specialist) and `ARCH_DECISIONS.md` ADR-014 consequences.

**Rule**: Do not invent solutions for these unresolved items.

---

## 13. IMPORTANT ARCHITECTURAL DISTINCTION

### 13.1 Distinct Components

The architecture must preserve the distinction between:

| Component | Role | Status |
|-----------|------|--------|
| **Chatbox gateway** | Authenticated non-authorizing ingress / translation layer | IMPLEMENTED / VERIFIED |
| **Coordinator** | Trusted authorization / orchestration boundary | CURRENT / IMPLEMENTED (DeepSeek pattern) |
| **ACP validation** | Canonical command validation | CURRENT / IMPLEMENTED |
| **TaskRegistry** | Task registration and state persistence | CURRENT / IMPLEMENTED |
| **Orchestrator / dispatcher** | Task orchestration and dispatch | CURRENT / IMPLEMENTED |
| **Kilo agent** | Implementation / testing lane | CURRENT / IMPLEMENTED |

### 13.2 No Collapse

**VERIFIED** — Do not collapse these into a generic "Kilo authorization"
concept.

The trusted server-side control plane is responsible for enforcing the
canonical ACP authorization model; Kilo executes within the resulting authorized
scope.

---

## 14. IMPLEMENTATION DIRECTION

### 14.1 What This Task Does

This task **records the architectural contract** that the implementation
must follow. That contract has now been implemented.

### 14.2 What the Implementation Produced

**IMPLEMENTED / VERIFIED** — The Chatbox gateway was implemented as the
**smallest** authenticated ingress that:

- Accepts an OpenAI-compatible request from Chatbox iOS (`model` + `messages`)
- Authenticates the caller via `x-chatbox-gateway-secret` header / `CHATBOX_GATEWAY_SECRET`
- Preserves the user's natural-language intent in the ACP `task` field and a
  `natural_language_intent` structured field
- Submits the request into the existing control plane (following the DeepSeek
  Coordinator ingress pattern: `validateACPCommand` → `taskRegistry.createTask`
  → `getDispatcher()`)
- Does **not** create a parallel authorization architecture
- Does **not** grant elevated capabilities directly from natural-language input
  (issues only REVIEW-mode ACP commands with `read_only` capability)
- Preserves the existing ACP / security boundaries
- Allows the existing orchestration layer to determine the legitimate execution
  path

### 14.3 What This Task Does NOT Do

This task does **NOT**:

- Implement Qwen Router classification
- Implement Security Specialist callback
- Modify application code outside the gateway route (`routes/poc.js`)
- Modify workflows
- Add dependencies
- Modify `poc/acp-engine.js`, `poc/schemas/acp-schema.js`, `poc/task-registry.js`,
  or `poc/orchestrator.js` (all reused unmodified)

### 14.4 Implementation Record

- **Endpoint**: `POST /poc/chatbox` (mounted on the existing POC router at `/poc`)
- **Authentication**: `x-chatbox-gateway-secret` header, `CHATBOX_GATEWAY_SECRET` env var
- **Request shape**: OpenAI-compatible `model` + `messages` array (minimum: one user message)
- **Translation**: OpenAI natural-language request → REVIEW-mode ACP command (`read_only`, `poc/` paths)
- **Control-plane path**: `validateACPCommand` → `taskRegistry.createTask` → `getDispatcher()`
- **Tests**: `test/chatbox-gateway.test.js` (23 tests, all passing)
- **Total project tests**: 259 (all passing)

---

## 15. STATUS DISTINCTION SUMMARY

| Label | Meaning | Applies To |
|-------|---------|------------|
| **VERIFIED** | Present and confirmed in current repository code/state | Chatbox gateway (`POST /poc/chatbox`), Chatbox authentication, ACP, TaskRegistry, Orchestrator, DeepSeek Coordinator ingress (Direct ACP), Kilo/Gemini lanes, existing execution modes |
| **INFERRED** | Reasoned from verified architecture but not explicitly documented as the Chatbox path | Two-stage authorization model for Chatbox, Direct ACP ingress pattern for Chatbox |
| **PROPOSED / TARGET** | Agreed architectural direction not yet implemented | Qwen Router classification/trigger, Security Specialist callback, server-side DeepSeek execution runtime hosting the OpenRouter tool-calling loop, narrow `control_plane` tool (see Section 17) |
| **NOT YET IMPLEMENTED** | Documented architectural direction; no repository implementation | OpenRouter model integration, `control_plane` tool/schema, server-side execution runtime endpoint/deployment, Chatbox production integration with the future runtime |
| **UNKNOWN** | Unresolved items requiring future authorized work | Exact Qwen trigger logic, Security Specialist callback, Security Audit Report persistence, exact `control_plane` schema, minimal tool-loop vs. OpenRouter Agent SDK, MCP applicability |

---

## 16. RELATED DOCUMENTATION

| Document | Purpose |
|----------|---------|
| `ARCHITECTURE.md` | Authoritative architecture (Section 16.6 DeepSeek Coordinator; Direct ACP) |
| `docs/ai/README.md` | AI project-state system operating rules |
| `docs/ai/ARCH_DECISIONS.md` | ADR-001 through ADR-017 (ADR-015 Chatbox Gateway IMPLEMENTED / VERIFIED; ADR-017 DeepSeek control-plane tool-execution direction PROPOSED / TARGET) |
| `docs/ai/STATE.md` | Current project state (updated by this task) |
| `docs/ai/TASK_LOG.md` | Historical task record (appended by this task) |
| `docs/ai/RESEARCH_INDEX.md` | Index of research records |
| `docs/ai/research/research-TASK-KILO-RESEARCH-DOCUMENTATION-SOP-IMPLEMENT-001.md` | RESEARCH_DOCUMENT task-mode & research-system SOP (first record) |
| `docs/ai/research/research-TASK-GEMINI-COORDINATOR-RELIABILITY-CONTROL-RESEARCH-001.md` | Durable controls for ChatGPT coordinator failure modes |
| `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-CONTROL-PLANE-RESEARCH-DOCUMENT-001.md` | This record's companion research record: DeepSeek control-plane tool-execution architecture |
| `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md` | Prior Control Gate research (related concepts) |
| `docs/ai/CONTROL_CENTER.md` | Human-facing presentation of project state |
| ADR-014 | Security Specialist architectural foundation (related) |
| ADR-005 | AI Development System — Specialist Lanes with ACP Boundary (related) |

---

## 17. DEEPSEEK CONTROL-PLANE TOOL-EXECUTION ARCHITECTURE (FUTURE TARGET)

This section reconciles this record with the **newly discovered** server-side execution-runtime architecture, distinguishing the **current, implemented** DeepSeek path (Direct ACP) from the **future target** (model tool calling via an execution runtime). The full story, evidence, and verification are in `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-CONTROL-PLANE-RESEARCH-DOCUMENT-001.md` and `docs/ai/ARCH_DECISIONS.md` (ADR-017).

### 17.1 Key Discovery

The obstacle was **tool execution**, not DeepSeek's intelligence or OpenRouter's ability to expose tools:

- DeepSeek can request a tool through OpenRouter's tool-calling interface.
- The model itself does **not** execute the HTTP request.
- The application that hosts the model interaction executes the requested tool and returns the result to the model (OpenRouter official documentation, `https://openrouter.ai/docs` and `https://openrouter.ai/docs/agent-sdk/overview`).
- Therefore Chatbox (a mobile conversational client) must **not** be the trusted tool executor; a **server-side application runtime** is required to host the model-interaction loop.

### 17.2 Current Implemented Path (Direct ACP) — NOT changed by this research

```
DeepSeek emits canonical ACP JSON
  → authenticated POST /poc/coordinator (x-deepseek-coordinator-secret / DEEPSEEK_COORDINATOR_SECRET)
  → validateACPCommand (poc/schemas/acp-schema.js)
  → taskRegistry.createTask (poc/task-registry.js)
  → getDispatcher() (services/transport-provider.js) → Kilo / Gemini Builder
  → existing Kilo execution path
```

This path is `VERIFIED` / `IMPLEMENTED` and is the current DeepSeek control-plane integration. It is **not** a model tool-calling integration; DeepSeek does not currently call `control_plane` tooling, and no OpenRouter model integration exists in repository source (verified; see companion research record Section 15). This research documents a **future, additional** ingress that feeds the **same** `/poc/coordinator` boundary — it does not replace or bypass Direct ACP.

### 17.3 Future Target — Server-Side Execution Runtime

The future path adds **one** trusted component — the **server-side execution runtime** that hosts the OpenRouter/DeepSeek tool-calling loop and the narrow `control_plane` tool. It executes the tool and submits to the **existing** `/poc/coordinator` boundary; it is an executor, **not** a second control plane.

```
Chatbox iOS → conversation
   ↓
server-side execution runtime
   │ OpenRouter model interaction  (POST /api/v1/chat/completions)
   │ + control_plane executor      (bounded tool loop)
   ↓ model request
OpenRouter → DeepSeek
   ↓ tool_call(control_plane(...))
server-side execution runtime     (validates args; never model-supplied secrets/capabilities/target)
   ↓ authenticated POST /poc/coordinator  (canonical ACP command)
existing ACP → TaskRegistry → dispatcher → Gemini Builder / Kilo
   ↓ tool result / final response
DeepSeek → final natural-language response → Chatbox
```

Relationship among components (future target):

- **Chatbox** = user-facing client (unchanged).
- **DeepSeek** = intelligence / decision of *when* to call a tool.
- **OpenRouter** = model API / provider-routing layer (unchanged).
- **Server-side execution runtime** = trusted executor of `control_plane`; hosts the model loop and a bounded tool loop.
- **`control_plane`** = narrow, server-defined tool (NOT `http_post(url, headers, body)`).
- **`/poc/coordinator`** = existing authorization / control-plane boundary (unchanged) — the runtime submits ACP commands here.
- **Existing ACP / TaskRegistry / Dispatcher** = unchanged; the runtime must feed into them, not parallel them.
- **Gemini Builder / Kilo** = existing execution agents (unchanged).

### 17.4 What Changes vs. Current

- **None** of the existing components are replaced. `/poc/coordinator`, ACP validation, TaskRegistry, dispatcher, Kilo, Gemini Builder, and the Chatbox gateway remain exactly as implemented.
- **Added (future, authorized only by a separate implementation task)**: a trusted server-side execution runtime exposing `control_plane` and the OpenRouter model-loop host.
- The runtime is **trust-isolated**: DeepSeek receives only the narrow `control_plane` interface; coordinator secrets, GitHub/Render credentials, endpoints, targets, capabilities, and permitted paths remain server-side.

### 17.5 Prohibited (Explicit, Perpetuated)

There must be **no**: a second `TaskRegistry`; a second orchestrator (`poc/orchestrator.js` remains sole); a second dispatcher (`getDispatcher()` remains sole); a parallel control plane; a generic unrestricted HTTP executor; any bypass around ACP validation (`validateAuthorization`); model-supplied secrets, credentials, capabilities, endpoints, targets, or paths.

### 17.6 Open Questions (To Be Resolved by a Future Implementation Task)

Exact runtime placement, `control_plane` argument schema, the exact ACP translation strategy, and whether the minimal application-side tool loop, the OpenRouter Agent SDK (`callModel` + stop conditions), or MCP best serves this narrowly-scoped requirement. See the companion research record (Sections 17–19, 24) and ADR-017.
