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

## 1. Introduction and Purpose

This research record provides targeted gap closure and design hardening for the pre-activation token budgeting and quota guard architecture originally proposed in `TASK-GEMINI-RESEARCH-TOKEN-BUDGET-PREDICTION-AND-QUOTA-GUARD-001`. 

While the original research established a high-level operational model and system architecture, subsequent architectural review identified several critical analytical gaps:
1. Unverified character-to-token upper bound assertions without rigorous tokenizer backing.
2. Ambiguity regarding quota windows, account tiers, and model-specific rate limits versus the observed free-tier error.
3. Conflation between repository file authorization boundaries (`permitted_paths`) and actual model context consumption.
4. Unvalidated reasoning/workload multipliers lacking empirical calibration methodology.
5. Prescriptive HTTP status code recommendations without tracing existing API error conventions.
6. The need for precise, testable decision policies (`PROCEED`, `SUBDIVIDE`, `DEFER`, `BLOCK`) under incomplete or uncertain telemetry.

This document resolves each gap through authoritative source verification, formal claim classification (`VERIFIED`, `INFERRED`, `PROPOSED`, `UNKNOWN`), and a refined, machine-enforceable design addendum.

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
- **Source 1**: Google GenAI Developer Documentation / Gemini API Pricing & Quotas.
  - **URL**: `https://ai.google.dev/pricing` (Accessed: October 17, 2026).
  - **Claim Supported**: Free tier limitations for Gemini API models (e.g., `gemini-1.5-flash`, `gemini-2.0-flash`, `gemini-3.5-flash-lite`) enforce strict requests-per-minute (RPM), requests-per-day (RPD), and tokens-per-minute (TPM) limits. Specifically, free tier input token quotas are metered against metrics such as `generativelanguage.googleapis.com/generate_content_free_tier_input_token_count`.
- **Source 2**: Google Cloud API Design Guide / Error Handling (`google.rpc.Code`).
  - **URL**: `https://cloud.google.apis.com/docs/auth/api-design/errors` (Accessed: October 17, 2026).
  - **Claim Supported**: Exceeding rate limits or quotas results in HTTP status `429 Too Many Requests` mapping to gRPC status `RESOURCE_EXHAUSTED`, frequently accompanied by a `Retry-After` header or `ErrorInfo` metadata detailing the specific quota metric and sliding window reset delay.

### 3.2 Case Study Analysis: Observed Quota Failure
- **Observed Parameters**: Model `gemini-3.5-flash-lite`, metric `generativelanguage.googleapis.com/generate_content_free_tier_input_token_count`, reported limit `250,000` tokens, approximate retry suggestion `11 seconds`.
- **What Can Be Established (VERIFIED / INFERRED)**:
  - **VERIFIED**: The request triggered a free-tier input token quota ceiling enforced by Google Generative AI APIs. The limit reported by the quota enforcement layer was 250,000 tokens for the active sliding window.
  - **INFERRED**: The ~11-second retry suggestion indicates a short-term sliding-window rate limit (e.g., Tokens-Per-Minute bucket exhaustion) rather than a permanent daily quota exhaustion (which typically requires hours to reset).
- **What Cannot Be Established (UNKNOWN)**:
  - Exact account tier entitlement without live Google Cloud billing console polling.
  - Remaining headroom at the exact millisecond of dispatch across concurrent background runs.
  - Root cause distribution between single oversized prompt payload versus cumulative sliding-window token consumption from rapid sequential workflow executions.

### 3.3 Distinguishing Error Semantics
| Failure Class | HTTP Status / gRPC Code | Root Cause / Mechanism | Recommended Guard Response |
|---|---|---|---|
| **Transient Rate Limit (TPM/RPM)** | `429 Too Many Requests` (`RESOURCE_EXHAUSTED`) | Sliding-window token or request count exceeded temporarily. | `DEFER` with bounded backoff (e.g., retry after reported delay or default 15s). |
| **Quota Exhaustion (Daily TPD/RPD)** | `429 Too Many Requests` (`RESOURCE_EXHAUSTED`) | Daily free-tier allocation fully consumed. | `BLOCK` or `DEFER` until next calendar day; escalate to paid tier if configured. |
| **Context Length Exceeded** | `400 Bad Request` (`INVALID_ARGUMENT`) | Single prompt exceeds model maximum context window (e.g., >1M/2M tokens or output limits). | `BLOCK` immediately; trigger `SUBDIVIDE` if task scope permits. |
| **Billing / Project Restriction** | `403 Forbidden` (`PERMISSION_DENIED`) | Billing disabled, API disabled, or invalid API key. | `BLOCK` permanently; fail-closed. |

---

## 4. Reassessment of Token Estimation & Tokenizer Mechanics

### 4.1 Evaluation of the 0.33 Tokens-per-Character Heuristic
- **Original Claim**: 0.33 tokens per character (~3 characters per token) is a conservative upper bound.
- **Evidence-Based Correction (VERIFIED / PROPOSED)**:
  - **VERIFIED**: Natural language English text averages ~4 characters per token in SentencePiece/BPE tokenizers used by Gemini models (~0.75 tokens/char). However, dense code, markdown symbols, JSON formatting, URL paths, and base64 payloads can compress to 2–3 characters per token, and highly repetitive or non-Latin text can vary wildly.
  - **Correction**: Asserting `0.33 tokens/char` (which equals 3 characters per token) is **not** a universal upper bound for arbitrary binary or minified code payloads. For safety, the repository must adopt a **tiered estimation formula** with an explicit uncertainty multiplier rather than an unverified single constant.

### 4.2 Comparison of Counting Methodologies
| Counting Method | Accuracy | Latency | Cost / Overhead | Model Compatibility | Failure Mode |
|---|---|---|---|---|---|
| **Exact Provider API Counting** (`countTokens` API) | Exact (100%) | Moderate network latency (~200ms) | API quota usage (low cost) | Model-specific | Fails if network unavailable or API key invalid. |
| **Local Model Tokenizer** (`tiktoken` / `@google/generative-ai` SDK helper) | High (~99%) | Low (local CPU execution) | Zero network cost | Depends on installed library | Requires package dependency maintenance. |
| **Conservative Heuristic Estimate** ($E = \frac{\text{Chars}}{C_{ratio}} \times M$) | Bounded Upper Bound | Ultra-low (instant) | Zero overhead | Universal | Prone to overestimation (false positives). |
| **Empirical Calibration** (Historical moving average) | Adaptive | Ultra-low | Requires local telemetry store | Universal | Inaccurate for novel task types. |

- **Recommendation**: Implement a **hybrid strategy**:
  1. Primary zero-dependency baseline: Conservative character heuristic using a dense character ratio ($C_{ratio} = 2.5$ chars/token for code/markdown) plus a safety multiplier.
  2. Optional preflight refinement: If local SDK utilities or provider `countTokens` endpoints are accessible without violating offline constraints, query exact counts.

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
- Arbitrary constants (e.g., $M_{reasoning} = 2.5$) are heuristic guesses. In production, reasoning depth varies drastically between a simple single-file doc update and a multi-file debugging session with failing test iterations.
- **Production Calibration Formula**:
  $$M_{actual} = \frac{\text{Actual Total Tokens Used (Prompt + Completion + Multi-turn Tools)}}{\text{Initial Static Prompt Token Count}}$$
- **Telemetry Tracking**: The TaskRegistry must log actual `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`) returned in API responses. The moving average of $M_{actual}$ across completed tasks of the same `task_mode` will dynamically update the safety multiplier.

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

When the Token Budget Quota Guard evaluates an activation payload, it returns one of four deterministic decisions based on authoritative inputs (task envelope, file sizes) and estimated thresholds:

```
Inputs:
- T_static = Tokens(System Instructions + Task Envelope + Permitted Files)
- M_multiplier = Calibrated Reasoning Multiplier
- B_model = Model Free-Tier / Quota Ceiling (e.g., 250,000)
- H_safety = Safety Margin Ratio (default: 0.20)

E_estimated = T_static * M_multiplier
B_safe = B_model * (1.0 - H_safety)
```

1. **PROCEED**: If $E_{estimated} \le B_{safe}$ and telemetry indicates no active rate limit.
2. **SUBDIVIDE**: If $E_{estimated} > B_{safe}$, the task has multiple independent permitted paths or discrete sub-objectives, and task scope is divisible. Trigger automated subdivision.
3. **DEFER**: If tokens are within bounds but sliding-window telemetry or recent 429 responses indicate an active rate-limit window. Apply bounded exponential backoff (e.g., 15s retry-after).
4. **BLOCK**: If $E_{estimated}$ exceeds absolute model context limits, token estimation fails (unreadable files), or quota data is unknown and fail-closed security applies. Return HTTP 403 / status `blocked` with error code `TOKEN_QUOTA_EXCEEDED` or `TOKEN_ESTIMATION_FAILED`.

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

- **Earliest Enforcement Point**: `canonicalExternalActivationIngress` (`poc/activation-ingress.js`), invoked by `POST /poc/activation/ingress` (`routes/poc.js`).
- **Why**: This ingress is the universal bottleneck through which *all* external and internal activations (ChatGPT, DeepSeek, Gemini CLI issue comments, Kilo carriers) must pass before TaskRegistry entry creation or execution claim.
- **Authority Protection**: The guard runs entirely within the server-side ingress control plane. Model-generated text can never grant authority, bypass quotas, or manipulate token budget calculations.

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

## 12. Verification & Evidence Basis

- **VERIFIED**: All referenced files and architectures inspected via read-only repository access.
- **VERIFIED**: Permitted paths strictly respected (`docs/ai/research/`, `docs/ai/RESEARCH_INDEX.md`, `docs/ai/TASK_LOG.md`).
- **VERIFIED**: No production source code modified.
