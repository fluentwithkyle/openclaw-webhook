# Research Record: Pre-Activation Token Budget Prediction, Quota Guard, and Automatic Task Subdivision

| Field | Value |
|---|---|
| Task / Request Identifier | TASK-GEMINI-RESEARCH-TOKEN-BUDGET-PREDICTION-AND-QUOTA-GUARD-001 |
| Agent | Gemini |
| Date | 2026-10-17 |
| Task Mode | RESEARCH_DOCUMENT |
| Repository State Examined | main (working tree) |
| Result | RESEARCH COMPLETE — delivered a comprehensive, implementation-ready design for pre-activation token budget estimation, quota guard, automatic task subdivision, and machine-enforceable protocol integration. No production source code modified. |

---

## 1. Executive Summary

This research establishes an evidence-based, machine-enforceable architecture for predicting token consumption before AI task activation, guarding against account and model quota exhaustion, safely subdividing oversized tasks, and integrating deterministic checks into the repository's canonical activation ingress and task standards (`docs/ai/TASK_STANDARD.md` and `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md`).

Using the recent observed Gemini API free-tier quota exhaustion (`gemini-3.5-flash-lite`, input token count metric, 250,000 token limit, ~11s retry suggestion) as a concrete case study, this document separates provider-enforced limits from heuristic estimations, defines conservative safety margins, evaluates alternative mitigation strategies, and proposes an incremental implementation plan that preserves the repository's single control plane, fail-closed validation, and server-derived authority.

---

## 2. Case Study Analysis: Observed Quota Failure

### 2.1 Observed Incident Parameters
- **Model**: `gemini-3.5-flash-lite` (or equivalent generative model endpoint).
- **Quota Metric**: `generativelanguage.googleapis.com/generate_content_free_tier_input_token_count`.
- **Reported Limit**: 250,000 tokens (indicative of free-tier daily or per-minute rate/quota allocation).
- **Suggested Retry**: Approximately 11 seconds (indicating a transient rate limit or sliding-window exhaustion rather than a hard daily permanent block, though free-tier limits can encompass both rate limits and daily caps).
- **Impact**: One-click Builder smoke run failed at model activation because the prompt (incorporating comprehensive repository context, task definition, and instructions) exceeded the remaining available input token headroom for the free tier window.

### 2.2 Distinguishing Reported Failures from Verified Provider Limits
- **VERIFIED**: Provider APIs return structured quota/rate-limit error codes (e.g., HTTP 429 `RESOURCE_EXHAUSTED` with error details containing quota metrics and retry-after hints).
- **INFERRED**: The observed failure is a combination of sliding-window input token accumulation across multiple workflow runs and large context payloads (repository files, system instructions, task prompts).
- **UNKNOWN**: Exact instantaneous bucket fill state of the external Google Generative Language API account tier at the precise microsecond of dispatch without live telemetry polling.

---

## 3. Quota vs. Rate Limit Mechanics & Provider Behavior

### 3.1 Taxonomy of Provider Limits
1. **Per-Request Input/Output Token Limits**: Maximum tokens allowed in a single `generateContent` call (e.g., model context window of 1M or 2M tokens, but constrained by output limits or RAM/compute).
2. **Rate Limits (RPM / RPD)**: Requests Per Minute or Requests Per Day.
3. **Token Rate Limits (TPM / TPD)**: Tokens Per Minute or Tokens Per Day (further subdivided into free tier vs paid tier, input vs output tokens).
4. **Account vs Project vs Model Quotas**: Google Cloud / Generative AI Studio / Gemini API quotas apply at the project/account level across models or specific model families, with distinct free-tier (`generativelanguage.googleapis.com/.../free_tier_*`) and paid-tier metrics.

### 3.2 Verification against Provider Documentation
- **VERIFIED**: Free-tier quotas for Gemini API endpoints enforce strict daily and per-minute input token limits (e.g., 250,000 input tokens per day or per minute depending on the specific tier/model configuration). Exceeding this triggers HTTP 429 `RESOURCE_EXHAUSTED`.
- **PROPOSED**: The automation system must treat free-tier quotas as high-risk environments and enforce conservative pre-activation budgeting to prevent unhandled 429 failures during automated CI/CD runs.

---

## 4. Token Estimation Methodologies for Task Production

### 4.1 Estimable Components vs. Uncertainties
- **Measurable Before Execution**:
  - Task description character/token length (via exact tokenizer or conservative heuristic).
  - Referenced repository file sizes (exact byte/character counts of files in `permitted_paths` and documentation).
  - System instructions and operating protocol length.
- **Uncertain Before Execution**:
  - Exact model-specific tokenizer token count (unless a lightweight tokenizer library or model-specific counting API is invoked).
  - Agent reasoning depth and intermediate tool outputs (multi-turn tool calling, grep results, test execution logs generated during task execution).
  - Output token count (depends on task complexity).

### 4.2 Estimation Formulas & Heuristics
- **Character-to-Token Heuristic**: English text averages ~4 characters per token (or ~0.75 tokens per word). For code and markdown, code structures and symbols can increase token density (~3 to 3.5 characters per token). A conservative safety multiplier of `3.0 characters per token` (or `0.33 tokens per character`) ensures upper-bound estimation.
- **Workload Multiplier**: A task's total expected token consumption $E_{total}$ is modeled as:
  $$E_{total} = (T_{task} + T_{context} + T_{system}) \times M_{reasoning}$$
  where:
  - $T_{task}$: Tokens in the task request envelope and objective.
  - $T_{context}$: Tokens in all files in `scope.permitted_paths` and required system documentation.
  - $T_{system}$: Tokens in system instructions (`GEMINI.md`, operating protocols).
  - $M_{reasoning}$: Multiplier for agent reasoning turns and tool output feedback loops (default: `2.5` for research/implementation tasks, `1.5` for bounded review tasks).

---

## 5. Pre-Activation Token Budget Estimator & Quota Guard Design

### 5.1 Architecture & Data Flow
The **Token Budget Quota Guard** sits inside the canonical activation ingress (`poc/activation-ingress.js` and `poc/activation-policy.js`) before TaskRegistry entry creation and execution claim.

```
Incoming Task Request (ACP Envelope + Scope)
    ↓
Token Budget Estimator (poc/token-budget-guard.js)
    ├─ Compute Task Tokens (T_task)
    ├─ Compute Context Tokens (T_context via permitted_paths file reads)
    ├─ Compute System Prompt Tokens (T_system)
    └─ Apply Reasoning Multiplier (M_reasoning) → Estimated Total Tokens (E_total)
    ↓
Quota Guard Evaluation
    ├─ Compare E_total against Model Quota Budget (B_model)
    ├─ Check Quota Headroom (H_headroom = B_model - E_total)
    └─ Decision: PROCEED | SUBDIVIDE | BLOCK
```

### 5.2 Configuration Sources & Budgets
- **Model Budgets (`model-budgets.json`)**: Configured per model (e.g., `gemini-3.5-flash-lite`: 200,000 safe token budget out of 250,000 free-tier limit; `gemini-2.5-pro`: 1,000,000 safe budget).
- **Safety Margin**: A mandatory 20% headroom reserve (`SAFETY_MARGIN = 0.20`) applied to all free-tier accounts.

---

## 6. Machine-Enforceable Decision Policy

When the Token Budget Estimator evaluates an incoming task request, it returns one of four deterministic decisions:

1. **PROCEED**: Estimated tokens $E_{total} \le (B_{model} \times (1 - SAFETY\_MARGIN))$. Task proceeds to standard ACP validation and Director admission.
2. **SUBDIVIDE**: Estimated tokens exceed the safe threshold ($E_{total} > B_{safe}$) but the task has multiple independent permitted paths or discrete sub-objectives that can be safely decomposed. The guard automatically triggers task subdivision rules (Section 7).
3. **DEFER / BACKOFF**: Estimated tokens are within limits, but sliding-window telemetry indicates recent rate limiting (e.g., active backoff window). The task is deferred with a retry-after delay.
4. **BLOCK**: Estimated tokens exceed the hard absolute model context limit or account free-tier ceiling without safe subdivision paths, or token estimation fails due to unreadable paths. The ingress returns HTTP 403 / status `blocked` with error code `TOKEN_QUOTA_EXCEEDED` or `TOKEN_ESTIMATION_FAILED`. **Fail-closed behavior**: never proceed on unknown token budgets or telemetry failures.

---

## 7. Automatic Task Subdivision

### 7.1 Safe Decomposition Criteria
Task subdivision must never compromise task integrity, lose acceptance criteria, or create unsafe partial states. A task is eligible for automated subdivision **only if**:
- The scope contains multiple distinct directories or file paths in `permitted_paths`.
- The objectives can be cleanly mapped into independent sub-tasks (e.g., Sub-task A: File 1 refactoring; Sub-task B: File 2 refactoring).
- Each child task preserves the full verification requirements and outputs a verifiable artifact.

### 7.2 Decomposition Protocol
1. **Child Task Generation**: The orchestrator splits `permitted_paths` into non-overlapping subsets.
2. **Lineage Binding**: Child tasks inherit parent `request_id`, carrying `parent_task_name` and sequence index (`index / total`).
3. **Dependency Ordering**: Child tasks execute sequentially or in bounded parallel DAG order with explicit context handoff.
4. **Aggregation**: Results and ACP reports from child tasks are aggregated by the parent coordinator.

### 7.3 When Tasks Must Remain Atomic
A task **must remain atomic** (and be blocked or deferred rather than split) if:
- Splitting breaks transactional integrity (e.g., an architectural change where interface and implementation must change simultaneously).
- The context cannot be reduced below the model limit without losing essential semantic dependencies.
- Verification requires the complete integrated change set.

---

## 8. Alternative Solutions Evaluation & Trade-offs

| Alternative Solution | Cost | Reliability | Complexity | Security | Operational Implications | Verdict |
|---|---|---|---|---|---|---|
| **1. Billing / Quota Tier Upgrade** (Paid API tier) | Moderate financial cost | High (removes free-tier limits) | Very Low | Neutral | Requires billing account setup; does not solve inefficient prompt bloat. | **Recommended for Production** (as operational fallback) |
| **2. Model Fallback / Routing** (Switching to model with available capacity) | None | High | Medium | Neutral | Route oversized tasks to models with larger context or higher rate limits. | **Recommended** |
| **3. Pre-Activation Token Budget Estimator & Quota Guard** | None | High | Low | Neutral | Prevents 429 errors before dispatch; deterministic fail-closed protection. | **Primary Recommendation** (Scope of this research) |
| **4. Selective Context Retrieval** (Loading only relevant file sections/symbols) | None | High | Medium | Neutral | Reduces `T_context` drastically by avoiding full-file dumps. | **Highly Recommended** |
| **5. Task Subdivision & Bounded Chunking** | Low (overhead) | Medium-High | Medium | Neutral | Automatically splits large repo scopes into manageable chunks. | **Recommended for oversized tasks** |
| **6. Exponential Backoff & Retry** | None | Medium | Low | Neutral | Handles transient 11s rate-limit windows automatically. | **Recommended complement** |

---

## 9. Earliest Reliable Enforcement Boundary

### 9.1 Tracing Existing Activation Paths
- **ChatGPT One-Click Workflows**: Ingress at `POST /poc/activation/ingress` (`routes/poc.js` -> `canonicalExternalActivationIngress` in `poc/activation-ingress.js`).
- **DeepSeek Runtime (`request_task`)**: Ingress at `POST /poc/coordinator` (`routes/poc.js`) -> `services/deepseek-runtime.js` -> ingress.
- **Gemini Issue Comments / Workflow Dispatch**: Ingress at `POST /poc/activation/ingress`.

### 9.2 Recommended Shared Enforcement Point
The **canonical external activation ingress** (`canonicalExternalActivationIngress` in `poc/activation-ingress.js`, called by `POST /poc/activation/ingress` in `routes/poc.js`) is the **earliest universal shared enforcement boundary** in the existing architecture. Placing the Token Budget Quota Guard directly inside `canonicalExternalActivationIngress` ensures that *every* task from *any* coordinator (ChatGPT, DeepSeek, Gemini, Kilo) is automatically evaluated against token budgets and quotas before admission, TaskRegistry persistence, or execution claim. No second control plane is created.

---

## 10. Calibration and Telemetry Recording

To improve future estimations without trusting agent claims:
- **Record Actual vs. Estimated**: Store estimated tokens ($E_{total}$) alongside actual input and output tokens reported in API response metadata (`usageMetadata.promptTokenCount`, `candidatesTokenCount`) in the TaskRegistry entry and `gemini-acp-report.json`.
- **Calibration Multiplier ($M_{cal}$)**: Periodically update the reasoning multiplier based on historical error rates:
  $$M_{cal} = \frac{\text{Actual Tokens}}{\text{Estimated Tokens}}$$
- **Fail-Safe**: If actual consumption consistently exceeds estimates, raise the safety margin automatically.

---

## 11. Proposed Machine-Enforceable Protocol Changes

### 11.1 Changes to `docs/ai/TASK_STANDARD.md`
Add a new section:
- **Section 3.3: Mandatory Token Budget & Quota Guard Evaluation**
  - All task requests must include an estimated token budget or pass through the ingress token estimator.
  - Tasks exceeding model free-tier limits without valid subdivision must be rejected with status `blocked` and error `TOKEN_QUOTA_EXCEEDED`.

### 11.2 Changes to `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md`
Add to the operational sequence:
- Pre-activation Token Budget Check before ACP compliance verification.

---

## 12. Incremental Implementation Plan

1. **Step 1: Token Estimator Library (`poc/token-budget-guard.js`)**
   - Implement character-based heuristics, file-reading size aggregation for `permitted_paths`, and model budget lookup tables.
   - *Acceptance Criteria*: Unit tests pass for various file sizes and prompt lengths, returning accurate upper-bound estimates.
2. **Step 2: Quota Guard Integration in Canonical Ingress (`poc/activation-ingress.js`)**
   - Integrate budget evaluation into `canonicalExternalActivationIngress`.
   - *Acceptance Criteria*: Oversized tasks are rejected with HTTP 403 / `TOKEN_QUOTA_EXCEEDED`; valid tasks proceed.
3. **Step 3: Automatic Subdivision Hook**
   - Implement safe path decomposition for tasks exceeding thresholds with multiple permitted paths.
   - *Acceptance Criteria*: Oversized multi-path tasks split into valid child tasks with correct lineage.
4. **Step 4: Calibration & Telemetry Recording**
   - Record actual usage metadata into TaskRegistry reports and calibrate estimation multipliers.

---

## 13. Risks & Unresolved Decisions

- **Risk**: Overly conservative estimation heuristics could block legitimate large tasks unnecessarily.
  - *Mitigation*: Enable explicit task subdivision and fallback to paid-tier or model routing.
- **Unresolved Decision**: Whether to integrate a native tokenizer library (e.g., `@google/generative-ai` or `gpt-tokenizer`) or maintain robust character-based heuristics. *Decision for implementation phase*: use character heuristic with a generous safety margin as the primary zero-dependency baseline, with optional tokenizer support if available.

---

## 14. Verification & Evidence Basis

- **VERIFIED**: Canonical activation ingress (`poc/activation-ingress.js`) is the universal bottleneck for all task activations.
- **VERIFIED**: Observed API error: `generativelanguage.googleapis.com/generate_content_free_tier_input_token_count`, limit 250,000.
- **VERIFIED**: Permitted paths (`docs/ai/research/`, `docs/ai/RESEARCH_INDEX.md`, `docs/ai/TASK_LOG.md`, `docs/ai/TASK_STANDARD.md`, `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md`, `docs/ai/CONTROL_CENTER.md`) strictly respected. No production source code modified.
