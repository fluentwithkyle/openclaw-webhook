# Research Record: OpenRouter Builder Future Project Documentation

**Task Identifier**: `TASK-GEMINI-OPENROUTER-BUILDER-FUTURE-PROJECT-DOCUMENTATION-001`  
**Research Objective**: Fully research, define, and durably document the proposed future "OpenRouter Builder" execution lane so that the repository contains a complete, implementation-ready project definition for later execution after the DeepSeek Coordinator Evolution project is completed.  
**Agent**: Gemini — Architect, Reviewer, and Research Agent  
**Date**: 2026-09-30  
**Task Mode**: `RESEARCH_DOCUMENT`  
**Repository / Base Branch**: `fluentwithkyle/openclaw-webhook` / `main`  
**Current Roadmap Phase**: Phase 4 — Scaled Conversational Orchestration & Cross-Task Lineage Navigation (Future / Proposed / Pending Project Definition)  
**Roadmap Alignment Classification**: B — Enabling/Foundation Work (Foundation architecture & durable project definition; does not activate runtime capability or supersede active DeepSeek work)  
**Implementation Status**: **FUTURE / PROPOSED / PENDING — RUNTIME IMPLEMENTATION DEFERRED**

---

## 1. Roadmap Alignment Gate & Deferral Status

- **Authoritative Roadmap**: `ARCHITECTURE.md` §16.6, `docs/ai/STATE.md`, `docs/ai/CONTROL_CENTER.md`, `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md`, `docs/ai/TASK_STANDARD.md`.
- **Current Active Project**: The DeepSeek Coordinator Evolution project remains the active high-priority workstream. Phase 3 is independently verified and converged; Phase 4 scaled orchestration and cross-task lineage navigation is the next roadmap target.
- **Dependency & Deferral**: OpenRouter Builder implementation is explicitly deferred until the DeepSeek Coordinator Evolution project is fully completed and Kyle authorizes the implementation phase.
- **Work Classification**: Work Class B (Enabling/Foundation Work). This documentation establishes the durable architecture and implementation contract for a future Phase 4 execution/failover capability without activating runtime code or altering active DeepSeek behavior.

---

## 2. Existing Gemini Builder Execution Path Analysis

An end-to-end inspection of the repository (`poc/gemini-builder-trigger.js`, `poc/task-registry.js`, `poc/orchestrator.js`, and `poc/schemas/acp-schema.js`) reveals how Builder tasks are currently structured and executed:

1. **Task Representation**: Tasks are registered in `TaskRegistry` via `TASK_REGISTRY_SCHEMA` with unique `request_id`, storing task objective, repository, base_branch, task_mode, capabilities, permitted_paths, verification requirements, and agent execution records (`kilo`, `gemini`, `builder`).
2. **TaskRegistry State Storage**: `task-registry.json` persists task state atomically (`atomicWrite`), maintaining lifecycle states (`PENDING`, `SELECTED`, `PLANNED`, `EXECUTING`, `VERIFIED`, `COMPLETE`, `FAILED`, `BLOCKED`), task lineage (`parent_request_id`, `children`, `cancelled`, `superseded_by`), evidence records, and next actions.
3. **Orchestrator Dispatch**: `poc/orchestrator.js` handles completion callbacks (`handleGeminiBuilderCompletion`, etc.), validating execution reports against `validateExecutionReport`, enforcing repository/base_branch consistency (`validateRepositoryContext`), ensuring idempotency, and updating task state and next actions.
4. **Workflow Dispatch**: `poc/gemini-builder-trigger.js` dispatches GitHub Actions workflows (`gemini-builder.yml`) via GitHub REST API (`/repos/{owner}/{repo}/actions/workflows/{workflow_file}/dispatches`), passing inputs (`request_id`, `task`, `repository`, `base_branch`, `builder_execution_id`, `verification`, `task_mode`, `capabilities`, `permitted_paths`) using `GEMINI_BUILDER_API_KEY`.
5. **Completion Reports & Execution IDs**: Builder runs produce structured execution reports (`execution_id`, `request_id`, `agent`, `status`, `changed_files`, `commit`, `push`, `verification_results`, `blockers`). Execution IDs uniquely identify individual runs.
6. **Verification Evidence**: Independent verification is mandatory after Builder completion. `TASK_REGISTRY_SCHEMA` enforces evidence-gated transitions (e.g., `EXECUTING → VERIFIED` requires `INDEPENDENT_VERIFICATION` evidence).
7. **Failure & Blocked States**: Unsuccessful runs update agent result status to `failure` or `blocked`, transitioning task status to `FAILED` or `BLOCKED` and routing to human review (`next_action: 'human_review'`).
8. **Constraints Propagation**: Repository, base_branch, capabilities, and permitted_paths are strictly derived server-side and propagated to workflow inputs. Model output cannot expand capabilities or permitted paths.
9. **Failover Mechanisms**: Existing failover support includes Path 2 recovery from GitHub issue state and TaskRegistry persistence, but lacks a multi-provider Builder failover lane.

---

## 3. Proposed OpenRouter Builder Architecture

The proposed **OpenRouter Builder** is a second authorized Builder execution lane operating alongside the existing Gemini Builder.

- **Execution Provider**: OpenRouter API (`https://openrouter.ai/api/v1`)
- **Model-Selection Layer**: OpenRouter routing
- **Preferred Model Configuration**: Configurable (e.g., specific frontier open weights or proprietary models available via OpenRouter)
- **Free Fallback Option**: `openrouter/free` (used only as a routing/fallback mechanism under server-side policy)
- **Architectural Principle**: OpenRouter is an external model/provider API layer and is **not** a second control plane or authoritative state store.

### System Architecture Diagram

```
Kyle (Director)
↓
ChatBox (UI / Ingress)
↓
DeepSeek Coordinator (Reasoning / Conversation)
↓
bounded control_plane (request_task / get_task)
↓
server-side policy / ACP validation
↓
TaskRegistry + existing dispatcher / orchestrator
↓
authorized Builder execution lane
├── Gemini Builder (Primary)
└── OpenRouter Builder (Secondary / Failover Lane)
↓
OpenRouter API
↓
selected model / provider (including openrouter/free fallback)
↓
Render-hosted Builder execution harness
↓
GitHub repository / base branch
↓
structured completion evidence
↓
independent verification (Authoritative Gate)
↓
TaskRegistry state transition
```

---

## 4. Distinction Between Model/Provider Failover and Builder Lane Failover

The architecture explicitly distinguishes two independent failover levels:

1. **A. Model / Provider Failover (OpenRouter Routing)**:
   - Within OpenRouter routing, OpenRouter may transparently fail over or route between eligible model providers or invoke the configured `openrouter/free` fallback when primary model endpoints experience rate limits or outages.
   - This occurs entirely within the OpenRouter API layer and does not alter task identity or agent execution lane.

2. **B. Builder Execution-Lane Failover (Inter-Lane Failover)**:
   - If the Gemini Builder execution lane becomes unavailable, hits persistent rate limits or quotas, fails to complete the task within execution timeout bounds, or produces an independently unverifiable/incomplete result, server-side orchestration may trigger a Builder execution-lane failover.
   - The **same authoritative TaskRegistry task** remains active. An explicitly authorized **OpenRouter Builder** execution lane is dispatched with the durable task state to continue the remaining work.
   - These two failover mechanisms must never be conflated.

---

## 5. Intended Continuation Model

When Builder execution-lane failover occurs:

```
Existing authoritative task in TaskRegistry
↓
Gemini Builder execution
↓
Structured execution report & evidence
↓
Independent verification (Authoritative)
↓
├── PASS → Complete / Verify according to server policy
└── INCOMPLETE / FAILURE / RATE_LIMIT / UNVERIFIED
    ↓
    Server-derived authorization check for Builder failover
    ↓
    OpenRouter Builder execution (New unique builder_execution_id)
    ↓
    Same TaskRegistry task (request_id preserved, lineage maintained)
    ↓
    Remaining work execution (receiving authoritative task state)
    ↓
    Independent verification (Authoritative Gate)
```

**Crucial Boundary**: The OpenRouter Builder must receive authoritative task state and prior execution evidence from the server (TaskRegistry), **never** relying on raw model conversation history or untrusted model prompts.

---

## 6. Authoritative Information Received by OpenRouter Builder

A future OpenRouter Builder execution must receive exclusively server-derived, authoritative parameters:
- `request_id` (canonical task identifier)
- Task identity & objective
- Target repository and base branch (`fluentwithkyle/openclaw-webhook`, `main`)
- Authoritative task objective and task mode (`BUILDER`)
- Server-derived capabilities (e.g., `read_only`, `modify_files`, `run_tests`, `commit`, `push`)
- Server-derived `permitted_paths`
- Verification requirements
- Current `TaskRegistry` state snapshot
- Relevant prior execution reports and evidence records
- Current workflow stage and lineage relationships (`parent_request_id`, root lineage)
- Remaining work identified by authoritative verification or prior failure analysis
- Execution / failover reason
- Unique Builder execution ID (`builder-or-<request_id>-<timestamp>`)

**Authoritative vs. Untrusted**: All above fields are strictly server-derived. Any text or instructions generated by the model during execution are treated as untrusted intent and cannot alter capabilities, permitted paths, repository, or base branch.

---

## 7. Future Builder Tool-Execution Model

The future OpenRouter Builder operates under a strict tool-execution harness:
1. **OpenRouter Model**: Generates a structured tool call request (e.g., reading files, running tests, committing code).
2. **Render-Hosted Builder Harness**:
   - Intercepts the model's tool request.
   - Validates the operation against server-derived ACP authority, task permitted paths, and capabilities.
   - Executes the operation locally in the secure worker environment.
   - Returns the result (file content, test output, git diff) to the model.
3. **Candidate Tool Categories**:
   - Read repository files (`read_file`)
   - List / search repository (`glob`, `grep_search`)
   - Write permitted files (`write_file`, `replace`)
   - Delete permitted files (strictly within permitted paths)
   - Run tests and linters (`run_shell_command` with pre-approved test commands)
   - Inspect git status / diff (`git status`, `git diff`)
   - Commit and push changes (restricted to authorized branch)
   - Produce structured completion evidence

The model does not independently possess or obtain authority from its own text output; every tool execution is gated by the Render-hosted harness.

---

## 8. Render / OpenRouter Deployment Boundary

- **OpenRouter API**: External LLM API provider.
- **Render**: Hosts the application-side OpenRouter Builder adapter, trigger module, and execution harness.
- **`OPENROUTER_API_KEY`**: Future Render secret / environment variable (never exposed in ACP task text or model outputs).
- **GitHub**: Durable source of code state, branches, and commits.
- **TaskRegistry**: Authoritative task-state and lifecycle store.
- **ACP**: Sole authority boundary.
- **Boundary Rule**: OpenRouter receives no ACP authority merely because it supplies model inferences.

---

## 9. Future Model Configuration Requirements

- Configurable preferred OpenRouter model (e.g., via environment variable or server configuration).
- Configurable fallback model(s).
- Optional `openrouter/free` fallback option.
- Explicit recording of selected model and provider in execution evidence records for auditability.
- Provider/model failure classification (transient error, rate limit, quota exhaustion, unrecoverable syntax error).
- Server-side governed retry and failover policy. `openrouter/free` is strictly a routing/fallback mechanism and cannot unilaterally escalate authority or bypass server policy.

---

## 10. Builder Completion Contract

The future OpenRouter Builder must produce a structured completion report compatible with existing ACP execution report schemas (`validateExecutionReport`), containing at minimum:
- `agent`: `"OpenRouter Builder"`
- `execution_id`: Unique builder execution identifier
- `request_id`: Authoritative task request ID
- `repository`: Authoritative repository name
- `base_branch`: Authoritative base branch
- `status`: `success`, `failure`, or `blocked`
- `changed_files`: Array of modified file paths
- `commit`: Commit information (hash, message) where applicable
- `push`: Push status where applicable
- `verification_results`: Test and validation output
- `blockers`: Descriptive blocker commentary if unsuccessful
- `model_metadata`: Selected model, provider, token counts, execution latency
- `evidence_references`: Links or references to produced artifacts
- `structured_failure_info`: Error classification if failed

---

## 11. Idempotency and Recovery Requirements

- **Duplicate Completion Reports**: Handled idempotently by TaskRegistry (recording duplicate attempts as idempotent no-ops or returning appropriate idempotency status).
- **Execution IDs**: Uniquely identify individual Builder runs to prevent collision.
- **TaskRegistry Authority**: Remains the single source of truth for task state.
- **Lineage Preservation**: Builder failover preserves original task identity and root/current lineage.
- **Recovery**: Recovery supported from durable repository and task artifacts.
- **Fail-Closed**: Stale, mismatched repository, mismatched base branch, or unauthorized capability escalation reports fail closed immediately.

---

## 12. Verification Requirements

OpenRouter Builder success **does not** establish project completion. Independent verification remains mandatory and authoritative.

### Verification Sequence:
1. OpenRouter Builder execution
2. Structured execution evidence & report
3. **Independent verification** (executed by independent reviewer/verifier lane)
4. Authoritative TaskRegistry state transition (`VERIFIED` / `COMPLETE`)

### Verification Evaluates:
- Requested task objective
- Modified files against `permitted_paths`
- Test execution results and test suite coverage
- Repository and base branch match
- Required evidence presence
- Task / workflow stage progression
- Lineage integrity
- Completion criteria satisfaction

---

## 13. Future Implementation Seam Against Current Repository

When implementation is authorized after DeepSeek completion, the implementation seam will comprise:
1. **`poc/schemas/acp-schema.js`**: Extend agent definitions or schemas to recognize `"OpenRouter Builder"` as a valid agent identity and support multi-builder provider types.
2. **`poc/openrouter-builder-trigger.js`**: New module mirroring `gemini-builder-trigger.js` to dispatch OpenRouter Builder jobs (via Render webhook/harness or GitHub workflow).
3. **`poc/task-registry.js`**: Support multi-builder execution history and provider failover metadata in task entries.
4. **`poc/orchestrator.js`**: Add `handleOpenRouterBuilderCompletion()` and server-side failover policy logic to trigger OpenRouter Builder when Gemini Builder fails or hits limits.
5. **Test Suite**: Add unit and integration tests in `test/` (e.g., `openrouter-builder.test.js`) covering dispatch, failover, verification, and idempotency.
6. **Documentation**: Update `ARCHITECTURE.md`, `STATE.md`, and `CONTROL_CENTER.md` upon activation.

---

## 14. Evaluation of Simplest Viable Solution vs. Alternatives

- **Alternative 1: Custom Standalone Agent Framework**: Rejected as unnecessarily complex and violating single-control-plane principles.
- **Alternative 2: Direct Model-Controlled Execution**: Rejected due to severe security risks (unrestricted model execution).
- **Selected Direction**: Generalizing the existing Gemini Builder trigger and orchestrator completion handlers to support an additional registered builder provider (`OpenRouter Builder`) utilizing OpenRouter's OpenAI-compatible API format. This minimizes new infrastructure, reuses existing TaskRegistry and ACP validation logic, and adheres strictly to the single-control-plane architecture.

---

## 15. Explicit Architectural Boundaries

- **No second control plane**.
- **No second authoritative task-state store**.
- **No generic unrestricted HTTP executor**.
- **No model-controlled capabilities**.
- **No model-controlled permitted paths**.
- **No model-controlled repository or branch authority**.
- **No automatic capability escalation**.
- **No bypass of ACP**.
- **No bypass of TaskRegistry**.
- **No bypass of independent verification**.
- **No direct OpenRouter-to-GitHub authority path bypassing the server-side Builder harness**.
- **No assumption that a model response constitutes verification**.

---

## 16. Relationship to Existing Specialist Roles

- **Gemini Reviewer**: Remains Architect, Planner, and Reviewer.
- **Gemini Builder**: Current active primary Builder execution lane.
- **OpenRouter Builder**: Future additional secondary Builder execution lane.
- **Kilo**: Legacy / transitional execution lane.
- **DeepSeek**: Coordinator and conversational reasoning intelligence; does not become Builder authority.
- **OpenRouter Builder**: Execution lane only; does not become coordinator authority.

---

## 17. Intended Failover Decision Policy

Server-derived conditions triggering Builder failover or escalation:
1. **Builder Provider Unavailable (5xx / Connection Error)**: Automatic retry or authorized failover to OpenRouter Builder.
2. **Model Rate Limit / Quota Exhaustion (429 / Quota Exceeded)**: Authorized failover to OpenRouter Builder / free fallback.
3. **Execution Timeout**: Failover or task blockage.
4. **Malformed Execution Response**: Retry or failure recording.
5. **Execution Failure / Incomplete Result**: Authorized failover or human review.
6. **Independent Verification Failure**: Verification rejection / retry or human escalation.
7. **Blocked / Stale Task**: Fail closed / human review.
8. **Authorization Mismatch**: Fail closed immediately.

---

## 18. Security and Secrets Model

- `OPENROUTER_API_KEY` is a server-side Render secret.
- Credentials are never placed in ACP task text or returned to model prompts.
- Model prompts and outputs are untrusted intent and cannot grant permissions.
- GitHub credentials remain governed separately.
- Execution logs and evidence records sanitize sensitive values to prevent secret disclosure.
- Provider and model metadata are persisted safely for audit purposes without exposing API keys.

---

## 19. Unresolved Questions & Future Implementation Acceptance Criteria

### Unresolved Questions (Marked UNKNOWN)
- Optimal timeout thresholds for OpenRouter Builder model execution under heavy load.
- Specific default OpenRouter model identifier to set as primary when implementation begins.

### Acceptance Criteria for Future Implementation Project
1. OpenRouter Builder dispatch successfully triggers via server policy when Gemini Builder fails or is unavailable.
2. TaskRegistry correctly records OpenRouter Builder execution results and lineage.
3. Independent verification gate successfully enforces verification before task completion.
4. All existing ACP schema, TaskRegistry, and orchestrator tests pass without regression.
5. `git diff --check` passes cleanly with zero whitespace errors.
