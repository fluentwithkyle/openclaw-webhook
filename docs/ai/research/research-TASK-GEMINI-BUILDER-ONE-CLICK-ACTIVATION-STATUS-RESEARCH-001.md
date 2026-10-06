# Research Record: Gemini Builder One-Click Activation Status Research

| Field | Value |
|---|---|
| Task / Request Identifier | TASK-GEMINI-BUILDER-ONE-CLICK-ACTIVATION-STATUS-RESEARCH-001 |
| Research Question / Objective | Independently determine the current VERIFIED status of Gemini Builder one-click activation in the repository and GitHub Actions using the existing Gemini Researcher one-click activation path. Inspect the actual current implementation, workflows, tests, durable records, and recent execution evidence; identify what is working, what is not, and the single remaining blocker or next action, if any. |
| Agent | Gemini |
| Date | 2026-10-06 |
| Task Mode | RESEARCH_DOCUMENT |
| Repository State Examined | main @ latest HEAD |

## Executive Conclusion

**FINAL VERDICT: NOT VERIFIED / BLOCKED**

Gemini Builder one-click activation workflows exist and correctly implement zero-input `workflow_dispatch`, canonical ingress validation (`poc/validate-external-activation.js`), Director approval gating, server-derived authority, ACP compliance checking, TaskRegistry correlation, and execution-claim enforcement (`claimExecutionContext()`). However, because **live GitHub Actions execution evidence** of a successful end-to-end builder one-click run is unavailable in repository records, and because **Render service lifecycle restarts and ephemeral task-registry state persistence** introduce a known callback-correlation boundary (HTTP 404 "Unknown request_id" if Render restarts between activation and completion), Gemini Builder one-click activation cannot be called `VERIFIED`.

It is classified as **NOT VERIFIED / BLOCKED** pending durable TaskRegistry persistence (or persistent datastore backing) and live end-to-end GitHub Actions workflow execution verification.

---

## Evidence Classification

### VERIFIED

| Item | Evidence Location |
|---|---|
| Zero-input `workflow_dispatch` definitions for Gemini Builder one-click workflows | `.github/workflows/one-click-gemini-builder-smoke.yml`, `.github/workflows/one-click-gemini-builder-callback-correlation.yml` |
| Canonical ACP task embedding and carrier binding | `.github/workflows/one-click-gemini-builder-smoke.yml`, `.github/workflows/one-click-gemini-builder-callback-correlation.yml` |
| Canonical ingress routing and validation shim (`validate-external-activation.js`) | `poc/validate-external-activation.js`, `poc/activation-ingress.js` |
| Activation policy and server-derived authority enforcement | `poc/activation-policy.js`, `poc/acp-engine.js` |
| Execution claim enforcement (`claimExecutionContext`) and TaskRegistry | `poc/task-registry.js` |
| Unit test coverage for builder trigger and validation | `test/gemini-builder-trigger.test.js`, `test/external-activation-procedure.test.js` |

### INFERRED

| Item | Basis |
|---|---|
| Render service restart / ephemeral in-memory state loss can cause callback failure (HTTP 404 "Unknown request_id") | Repository analysis of `TaskRegistry` using process-local memory cache (`research-TASK-GEMINI-TASK-REGISTRY-PERSISTENCE-CONCURRENCY-ARCHITECTURE-DECISION-RESEARCH-001.md`) |
| Consequential `BUILDER` activation requires Director approval (`/poc/director/approve`) | Workflow steps in `one-click-gemini-builder-smoke.yml` and `gemini-builder.yml` |

### UNKNOWN

| Item | Reason |
|---|---|
| Actual live GitHub Actions workflow execution logs for a successful builder one-click run | Not present in repository historical records or recent CI run artifacts |

---

## 1. Evaluation of the 10 Core Research Questions

### Q1: Whether the Gemini Builder one-click workflow exists and is zero-input workflow_dispatch
- **Finding**: **YES**. Dedicated one-click wrapper workflows exist in `.github/workflows/` (e.g., `one-click-gemini-builder-smoke.yml`, `one-click-gemini-builder-callback-correlation.yml`). They specify `workflow_dispatch` with **no required inputs**, allowing the Director to select and trigger them from the GitHub Actions UI with zero manual parameter entry. (Note: The core runtime workflow `gemini-builder.yml` still defines required inputs for programmatic/chained invocation, but the dedicated one-click wrappers satisfy the zero-input contract).

### Q2: Whether its embedded task/carrier binding is exact and machine-verifiable
- **Finding**: **YES**. Each one-click builder workflow constructs and embeds an exact canonical ACP task carrier in a shell step containing `request_id`, `target_agent: Gemini Builder`, `task_mode: BUILDER`, capabilities, objective, scope, verification, and constraints.

### Q3: Whether it dispatches the canonical activation carrier rather than creating a parallel path
- **Finding**: **YES**. The workflows route through the canonical ingress (`POST /poc/activation/ingress` via `poc/validate-external-activation.js`), reusing the canonical external-activation path (`poc/activation-ingress.js`) rather than establishing a parallel control plane or alternate state store.

### Q4: Whether activation policy, ACP validation, server-derived authority, and TaskRegistry execution claims are correctly applied
- **Finding**: **YES**. `activation-policy.js` validates agent and task mode (`BUILDER`), `acp-engine.js` validates ACP compliance, server-derived authority enforces security boundaries (preventing client-supplied authority overrides), and `task-registry.js` enforces exactly-once execution claims via `claimExecutionContext()`.

### Q5: Whether Builder execution survives the known Render restart/callback-correlation boundary
- **Finding**: **NO (BLOCKED)**. Render web service instances spin down on idle or restart on deployment. Because `TaskRegistry` relies on process-local memory (`memoryCache`), a Render restart between external activation ingress and agent completion wipes in-memory task records, causing the final callback to fail with HTTP 404 "Unknown request_id". This boundary remains unresolved unless durable backing storage (e.g., Render Postgres or persistent datastore) is implemented.

### Q6: Whether the Builder callback/evidence path currently completes successfully
- **Finding**: **UNKNOWN / NOT VERIFIED LIVE**. In offline repository inspection and test runs, the code paths are logically complete and unit-tested, but live callback execution against Render production requires active runtime service availability and secrets that are outside static repository verification.

### Q7: Whether recent GitHub Actions runs provide current evidence of successful end-to-end execution
- **Finding**: **NO**. There are no recent GitHub Actions run records in the repository demonstrating a successful live end-to-end execution of Gemini Builder one-click activation.

### Q8: Whether any remaining persistence/concurrency/recovery issue prevents calling Builder one-click activation VERIFIED
- **Finding**: **YES**. Ephemeral state persistence across Render restarts and lack of durable TaskRegistry backing storage prevent classifying Builder one-click activation as VERIFIED.

### Q9: The exact minimum next action required if it is not VERIFIED
- **Finding**: Implement durable TaskRegistry backing storage (or persistent database backing) for execution claims and task state across Render restarts, followed by live GitHub Actions end-to-end verification.

### Q10: Which conclusions are VERIFIED, INFERRED, or UNKNOWN
- **VERIFIED**: Workflow definitions, zero-input dispatch structure, canonical ingress validation, activation policy rules, ACP schema compliance, and TaskRegistry unit tests.
- **INFERRED**: Vulnerability to Render service restart / ephemeral memory state loss and callback 404 correlation failure.
- **UNKNOWN**: Live GitHub Actions execution status and Render production runtime behavior without active execution telemetry.

---

## 2. Roadmap Alignment

| Field | Value |
|---|---|
| Authoritative Roadmap Phase | DeepSeek Coordinator Evolution / External Activation / One-Click Workflows |
| Current Phase State | Foundation complete; one-click contracts and ingress verified for research workflows; Builder one-click workflows constructed but unverified in live runtime due to persistence constraints. |
| Phase Completion Criteria | End-to-end live GitHub Actions execution of Gemini Builder one-click activation with successful callback correlation and durable evidence projection. |
| Required Next Work | Implement durable TaskRegistry backing storage across Render restarts and perform live end-to-end GitHub Actions workflow verification. |
| Proposed Task Mapping | TASK-GEMINI-BUILDER-DURABLE-TASK-REGISTRY-AND-LIVE-VERIFICATION-001 |
| Prerequisite Status | Prerequisites met (canonical ingress, activation policy, one-click coordinator contract, wrapper workflows). |
| Expected Advancement | Transition Gemini Builder one-click activation status from NOT VERIFIED / BLOCKED to VERIFIED. |
| Four-Category Work Classification | **Category A** — Roadmap-Required Work (completing live activation verification and persistence hardening). |

---

## 3. Verification and Compliance

- **Research-Only Scope**: This task performed repository research and documentation persistence only. No runtime source code, production workflows, or secrets were modified.
- **Compliance**: Adheres strictly to `GEMINI.md`, `ARCHITECTURE.md`, `docs/ai/ONE_CLICK_WORKFLOW_CONTRACT.md`, and `docs/ai/TASK_STANDARD.md`.
- **Durable Persistence**: Documented in `docs/ai/research/research-TASK-GEMINI-BUILDER-ONE-CLICK-ACTIVATION-STATUS-RESEARCH-001.md`, indexed in `RESEARCH_INDEX.md`, and logged in `TASK_LOG.md`.
