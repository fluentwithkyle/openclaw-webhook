# Research Record: Token Budget, Quota Guard, and Pre-Activation Guardrails — Evidence-Backed Gap Closure and Design Addendum

| Field | Value |
|---|---|
| Task / Request Identifier | TASK-GEMINI-RESEARCH-TOKEN-BUDGET-QUOTA-GUARD-GAP-CLOSURE-001 |
| Agent | Gemini |
| Date | 2026-10-17 |
| Task Mode | RESEARCH_DOCUMENT |
| Repository State Examined | main (working tree) |
| Result | GAP CLOSURE COMPLETE — Produced an exhaustive, evidence-backed correction and implementation-ready design addendum for pre-activation token estimation, Gemini quota interpretation, context-versus-path isolation, empirical calibration, error semantics, and machine-enforceable task budgeting. Explicitly linked to `TASK-GEMINI-RESEARCH-TOKEN-BUDGET-PREDICTION-AND-QUOTA-GUARD-001`. No production source code modified. |

---

> **Independent correction status — 2026-10-17:** Review identified overstatements in the original wording. This correction supersedes any conflicting claim below: the incident's reported 250,000 limit and ~11-second retry hint do not establish a sliding-window quota period; neither a character/token ratio nor a generic heuristic is a guaranteed upper bound; total task usage divided by initial prompt tokens is not a valid input-token predictor; repository HTTP status mapping remains open pending source inspection; and the proposed ingress is only a candidate common enforcement point until all activation lanes are traced. This record is a deferred design reference, not implementation authorization.

## 1. Introduction and Purpose

This research record provides targeted gap closure and design hardening for the pre-activation token budgeting and quota guard architecture originally proposed in `TASK-GEMINI-RESEARCH-TOKEN-BUDGET-PREDICTION-AND-QUOTA-GUARD-001`. 

While the original research established a high-level operational model and system architecture, subsequent architectural review identified several critical analytical gaps:
1. Unverified character-to-token upper bound assertions without rigorous tokenizer backing.
2. Ambiguity regarding quota windows, account tiers, and model-specific rate limits versus the observed free-tier error.
3. Conflation between repository file authorization boundaries (`permitted_paths`) and actual model context consumption.
4. Unvalidated reasoning/workload multipliers lacking empirical calibration methodology.
5. Prescriptive HTTP status code recommendations without tracing existing API error conventions.
6. The need for precise, testable decision policies (`PROCEED`, `SUBDIVIDE`, `DEFER`, `BLOCK`) under incomplete or uncertain telemetry.

This document proposes a design addendum. The independent correction status and evidence classifications below supersede earlier overconfident wording; unresolved implementation details remain open.

---

## 2. Claim Classification Framework

To maintain strict architectural rigor, all claims in this research record are explicitly classified into one of four categories:
- **VERIFIED**: Substantiated by authoritative public documentation, official SDK behavior, or direct repository code inspection.
- **INFERRED**: Logically deduced from verified mechanics, error codes, or architectural patterns, but subject to operational conditions.
- **PROPOSED**: Architectural designs, heuristics, or decision rules recommended for future implementation.
- **UNKNOWN**: Factors dependent on external account state, real-time cloud API rate-limit sliding windows, or unobservable live telemetry.

---

## 3. Gemini API Quota, Rate-Limit, and Error Semantics

### 3.1 Authoritative Sources & Verification

- **Google Gemini API rate limits** — https://ai.google.dev/gemini-api/docs/rate-limits (accessed 2026-10-17). Supports general limit dimensions such as requests per minute, input tokens per minute, and requests per day; project/model/tier dependence; and documented reset behavior for daily limits. It does not establish this incident's project-specific quota window.
- **Google Gemini API token counting** — https://ai.google.dev/gemini-api/docs/tokens (accessed 2026-10-17). Supports approximate average token guidance and the request-specific `countTokens` API. An average is not a deterministic conversion or upper bound.
- **Google Cloud API errors** — https://cloud.google.com/apis/design/errors (accessed 2026-10-17). Provides general API error design conventions; the actual provider response and structured details must be inspected to classify a specific failure.

### 3.2 Case Study Analysis: Observed Quota Failure

**Observed incident text:** model `gemini-3.5-flash-lite`; metric `generativelanguage.googleapis.com/generate_content_free_tier_input_token_count`; reported limit `250000`; approximate retry suggestion `11 seconds`.

- **VERIFIED from supplied incident text:** those values were reported.
- **INFERRED:** a provider quota/rate-limit condition associated with the named input-token metric caused rejection.
- **UNKNOWN:** the precise period/window represented by this metric in this incident; active project/tier entitlement; whether the limit is per-minute, daily, or another configured dimension; remaining headroom; concurrent usage; whether one large request or accumulated requests caused the rejection; and whether retrying after ~11 seconds would succeed.
- The retry hint is evidence that the service supplied a retry delay, **not proof** that the metric is a sliding-window TPM bucket. Do not classify it more specifically without the complete structured error payload and project-specific quota evidence.

### 3.3 Distinguishing Error Semantics

| Provider evidence | Safe interpretation | Proposed guard decision |
|---|---|---|
| 429 / `RESOURCE_EXHAUSTED` with retry details | Quota/rate limit exceeded; classify the dimension only when the metric/details and documentation support it | `DEFER` for confirmed transient conditions with bounded retry; otherwise `BLOCK` or `DEFER` according to authoritative reset evidence |
| 400 / `INVALID_ARGUMENT` with context/input-size details | Request shape or size constraint; inspect actual provider message and model limits | `BLOCK` this payload; `SUBDIVIDE` only if task semantics permit |
| 403 / `PERMISSION_DENIED` | Permission, API, credential, or project-access failure may be involved; do not assume one cause | `BLOCK` pending configuration/authorization correction |
| Missing, ambiguous, or unrecognized details | Root cause cannot be classified safely | Fail closed; do not blindly retry or invent a reset window |

These are provider-error interpretations, not a prescription for the repository's HTTP status. The guard should return a typed internal decision and stable error code first. HTTP mapping must follow the existing route/API contract after source-level inspection; this research does not authorize a new status mapping.

---

## 4. Reassessment of Token Estimation & Tokenizer Mechanics

### 4.1 Evaluation of the Character/Token Heuristic

Google describes roughly four characters per Gemini token **on average**. This implies an average ratio near 0.25 tokens per character, not 0.75; neither ratio is a safe upper bound. The original `0.33 tokens/character` claim is withdrawn as an upper-bound guarantee. The follow-up's proposed 2.5 characters/token ratio is also **unvalidated** and must not be called conservative, exact, or guaranteed.

### 4.2 Comparison of Counting Methodologies

| Method | What it can establish | Limitations / failure behavior |
|---|---|---|
| Provider `countTokens` on the exact available request | Provider-calculated input count for supported request contents | Network/API dependency; request/model support must be checked; cannot predict future tool turns or generated output |
| Model-compatible local tokenizer | Exact count only if compatibility with the provider/model and serialization is established; otherwise an estimate | Do not assume generic tokenizers match Gemini; pin/version and validate against provider counts |
| Character/byte heuristic | Rough preflight risk estimate | No universal upper-bound guarantee; text, code, JSON, URLs, multilingual and multimodal content vary |
| Empirical calibration | Historical estimation-error distribution for a defined model, lane and task mode | Does not guarantee unseen behavior; needs enough telemetry and drift monitoring |

**Proposed policy:** use provider counting for the exact available input when supported and permitted. Otherwise treat heuristics as uncertain estimates only. If uncertainty exceeds the configured policy envelope, return `DEFER` or `BLOCK`; never silently treat a heuristic as an exact count. Evaluate tokenizer dependencies only after compatibility, maintenance and runtime costs are assessed.

---

## 5. Context vs. Permitted Paths Disambiguation

### 5.1 Correcting the Conflation
The original research conflated `permitted_paths` (the repository security boundary limiting what files an agent is allowed to read/modify) with model context consumption. This is architecturally incorrect:
- **`permitted_paths`**: Defines the *governance boundary* (e.g., `docs/ai/research/`, `routes/poc.js`). It restricts filesystem access.
- **Model Context ($T_{context}$)**: Defines the *actual text payloads* transmitted to the model inference endpoint in a given turn.

### 5.2 Tracing Model Context Contributors
At each activation lane (RESEARCH_DOCUMENT, BUILDER, VERIFY_RECONCILE), total input tokens comprise:
1. **System Instructions & Operating Protocol**: Core prompt files (`GEMINI.md`, `TASK_STANDARD.md`, operating rules).
2. **Task Envelope**: ACP task JSON, request metadata, and objective statement.
3. **Retrieved Repository Files**: Files loaded into context because they fall within `permitted_paths` or are explicitly required reference files. *Crucial distinction*: An agent authorized for `docs/ai/research/` does not load the entire repository; it loads only the specific files opened or injected into the prompt.
4. **Tool Outputs & Conversation History**: Multi-turn grep results, test execution stderr/stdout logs, git diffs, and intermediate reasoning steps accumulated during execution.
5. **Generated Output**: Expected model response tokens ($T_{output}$).

---

## 6. Workload Multipliers & Empirical Calibration

### 6.1 Re-evaluating Multipliers

The ratio `total task usage / initial static prompt tokens` is not a valid future input-token estimator when total usage includes output, thinking, tool calls, retries or repeated turns. Do not present arbitrary reasoning/workload multipliers as validated estimates.

Where the provider exposes the relevant fields, collect separate per-request observations for input tokens, output tokens, thinking/reasoning tokens, tool-turn/request count, retries, task mode, preflight count/estimate and uncertainty, model/provider version, error class and retry outcome. Normalize provider-specific response fields into a versioned internal schema rather than assuming a field is universally available.

### 6.2 Calibration Method

**PROPOSED:** for each compatible model + activation lane + task mode, compare the preflight input estimate against the provider-reported input count for that same request. Track absolute and relative error, underestimation frequency, and high-percentile error over an adequate sample. Use held-out observations to set an uncertainty margin. Keep output, turn, tool and retry budgets separate. Mark calibration insufficient when samples are sparse, telemetry is missing, or model/prompt serialization changes. Production thresholds need minimum sample counts, outlier handling, versioning and rollback; a simple moving average is not sufficient.

A static prompt count cannot predict arbitrary future tool output or reasoning. Bound those separately through maximum turns/output, context reduction and lane-specific observed distributions. **No numeric multiplier is validated by this research.**

---

## 7. Mitigation Strategies Comparison

| Mitigation Strategy | Prerequisites | Trade-offs & Operational Limitations | Verdict |
|---|---|---|---|
| **Context Reduction (Selective Retrieval)** | File chunking logic | May omit crucial semantic context if granularity is too aggressive. | **Primary Recommendation** |
| **Bounded Task Decomposition** | Clean path boundaries | Increases orchestration overhead and merge coordination. | **Recommended for oversized scopes** |
| **Provider Counting APIs** | Network connectivity | Adds pre-flight network latency and depends on API availability. | **Recommended secondary verification** |
| **Billing / Quota Tier Upgrade** | Cloud billing account | Financial cost; does not solve runaway prompt inefficiency. | **Operational Fallback** |
| **Exponential Backoff & Retry** | Asynchronous retry harness | Increases total wall-clock execution time (~11s+ delay). | **Essential for transient 429s** |
| **Explicit Deferral / Blocking** | Ingress validation gate | Delays task execution; requires Director re-submission. | **Fail-Closed Baseline** |

---

## 8. Concrete Machine-Enforceable Decision Policy

The guard must distinguish request-size estimation from live provider quota headroom. A local character count cannot reveal current project-wide quota consumption, concurrency, tier limits or reset time.

Inputs: server-configured provider/model identity; exact serialized request contents available before dispatch; provider count result where supported; authoritative model context/output limits; configured safety policy; recent provider error evidence; and calibration quality/version. Treat quota values and reset times as unknown unless obtained from authoritative live evidence or trusted configuration.

1. **PROCEED** — input count is known, or its estimate falls within an explicitly approved uncertainty envelope; known context/output limits are satisfied; no current provider signal requires deferral; and execution/output are bounded.
2. **SUBDIVIDE** — the request exceeds a safe budget and can be decomposed without changing objective, acceptance criteria, authority, dependency order or independent verification. Child tasks still require normal ACP validation and authorization.
3. **DEFER** — a transient provider condition or temporarily unavailable required counting/telemetry service is expected to recover, and retry is bounded using authoritative timing or an explicit conservative cap. Do not infer a reset time from the metric value.
4. **BLOCK** — a known hard context limit is exceeded; required estimation is unavailable and policy requires certainty; quota/permission state is unsafe or unclassifiable; or safe subdivision is impossible.

Unknown quota headroom is not proof that a request exceeds quota. The configured policy must explicitly decide whether to allow a bounded request, defer for telemetry or block; it must not fabricate a quota value. Return a typed internal decision and stable error code. HTTP status mapping remains **OPEN** until existing route/API conventions are traced and tested.

---

## 9. Safe Task Subdivision Criteria

### 9.1 When Subdivision Is Safe
- **Path Independence**: Permitted paths can be partitioned into mutually exclusive subsets (e.g., Sub-task A: `docs/ai/research/file1.md`; Sub-task B: `docs/ai/research/file2.md`).
- **Independent Verification**: Each sub-task has clear acceptance criteria and can be independently verified.
- **Preserved Lineage**: Child tasks carry `parent_request_id` and sequence indices.

### 9.2 When Subdivision Is Unsafe (Must Block/Defer)
- **Transactional Coupling**: Interface definitions and implementations must change atomically.
- **Indivisible Context**: The core prompt instructions and base context exceed the model budget even without auxiliary files.
- **Increased Token Inflation**: If splitting the task into $N$ parts causes total system prompt duplication that exceeds the monolithic token cost, subdivision is rejected as wasteful.

---

## 10. Earliest Shared Enforcement Point & Architecture Integration

`canonicalExternalActivationIngress` in `poc/activation-ingress.js`, reached through `POST /poc/activation/ingress` in `routes/poc.js`, is a **candidate** common admission boundary, not yet proven to cover every internal and external model activation.

Before implementation, trace and test each relevant lane (Gemini RESEARCH_DOCUMENT, Gemini Builder, DeepSeek Coordinator, and Kilo/failover carriers) from dispatch entry to provider invocation. Confirm where model identity and exact serialized request content are available. If calls bypass the candidate boundary or occur later through another transport, define a shared server-owned budget interface at the narrowest genuinely common layer or add explicit checks at provider dispatch without creating a second control plane.

Do not equate `permitted_paths` with model context. Path permissions govern access; actual context comprises only content actually read/serialized, plus system/developer instructions, task envelope, included conversation history, tool results, multimodal payloads and provider wrappers. Count or bound what the lane actually sends. Model-generated text must never grant budget, authority or path permissions.

---

## 11. Testable Enforcement Rules & Implementation Roadmap

### 11.1 Testable Rules
1. **Rule 1 (Fail-Closed Quota Check)**: Any task whose estimated token count exceeds the configured model budget must be rejected with status `blocked` and error `TOKEN_QUOTA_EXCEEDED`.
2. **Rule 2 (No Model Authority)**: Client payloads or model-generated text cannot override server-derived token budget limits.
3. **Rule 3 (Telemetry Recording)**: Completed tasks must record `usageMetadata` to calibrate future multiplier estimates.

### 11.2 Phased Implementation Plan
- **Phase 1 (Deterministic Baseline)**: Implement `poc/token-budget-guard.js` with heuristic estimation and model budget tables.
- **Phase 2 (Ingress Integration)**: Wire guard into `canonicalExternalActivationIngress` (`poc/activation-ingress.js`).
- **Phase 3 (Telemetry & Calibration)**: Store actual token usage in TaskRegistry and compute moving average multipliers.
- **Phase 4 (Automated Subdivision)**: Add path-partitioning logic for oversized multi-path tasks.

---

## 11. DeepSeek Coordinator Evolution Integration

**Status: DEFERRED REFERENCE ONLY — NOT IMPLEMENTATION AUTHORIZATION.**

This cross-cutting token-budget/quota-guard design belongs as a candidate reference in the existing DeepSeek Coordinator Evolution project; it must not create a second coordinator, dispatcher or control plane. Project roadmap: `docs/ai/DEESEEK_COORDINATOR_LIFECYCLE_ENFORCEMENT_ROADMAP.md`.

Do not silently add it to Increment 4.2: that increment's stated scope is mandatory state inspection and applicable-requirements extraction. Before scheduling this work, reconcile it with current roadmap/state and the actual provider-call graph. Required design gates:
1. Verify the common admission/dispatch boundary for every relevant model lane.
2. Trace repository error/HTTP conventions and available quota telemetry.
3. Prefer exact-request provider counting where supported; define uncertainty behavior otherwise.
4. Separate input, output, tool-turn, retry and live-quota signals.
5. Specify tests for all four decisions, unknown quota, estimator undercount, provider errors, concurrency, and attempts by model output to influence authority.
6. Obtain a separate Director-authorized ACP implementation task.

## 12. Verification & Evidence Basis

- **VERIFIED**: Official Google documentation supports approximate average token guidance, request-specific counting, and general project/model/tier-dependent rate-limit dimensions; see Section 3.
- **VERIFIED from supplied incident text**: the model, metric, reported limit and retry hint in Section 3.2 were reported; these alone do not prove quota window or root cause.
- **PROPOSED**: Decision policy, telemetry schema, calibration method and common-boundary integration require design review and tests.
- **UNKNOWN**: Actual project quota window/tier/headroom, complete structured error payload, and whether every activation lane crosses the candidate ingress boundary.
- **VERIFIED**: This record is documentation only; no production source code was modified.


## Implementation Assignment — DeepSeek Lifecycle Increment 4.6

**Assignment: REQUIRED ROADMAP DELIVERABLE — PLANNED, not yet authorized for execution.** This corrected research and the original research `research-TASK-GEMINI-RESEARCH-TOKEN-BUDGET-PREDICTION-AND-QUOTA-GUARD-001.md` are both assigned to **DeepSeek Coordinator lifecycle-enforcement Increment 4.6 — Pre-Activation Token Budget & Provider Quota Guard**, sequenced after Increment 4.5 is implemented, independently verified, and reconciled. This corrected record takes precedence where it conflicts with the original. Increment 4.6 must reconcile both records against current code/provider evidence, implement the guard, and satisfy the roadmap acceptance criteria. This assignment is not implementation authorization. See `docs/ai/DEESEEK_COORDINATOR_LIFECYCLE_ENFORCEMENT_ROADMAP.md`, Increment 4.6.
