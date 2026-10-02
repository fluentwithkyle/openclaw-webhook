# Research Record: External Activation Architecture Resolution — Independent Reconciliation

| Field | Value |
|---|---|
| Task / Request Identifier | TASK-CHATGPT-EXTERNAL-ACTIVATION-ARCHITECTURE-RESOLUTION-RESEARCH-001 |
| Request Identifier | REQ-TASK-GEMINI-EXTERNAL-ACTIVATION-ARCHITECTURE-RESOLUTION-RESEARCH-001 |
| Agent | ChatGPT Coordinator |
| Date | 2026-10-02 |
| Task Mode | RESEARCH_DOCUMENT |
| Repository State Examined | main @ 47a758a7ef8f4e63b32e699549c21e8976971e40 |
| Result | BLOCKED — admission architecture is resolved; execution-carrier ownership/recovery is not sufficiently resolved for implementation. |

## Executive Conclusion

**VERIFIED:** main contains the correct external-activation foundations: one Agent × Task Mode × Activation Surface policy, canonical activation ingress, ACP validation, one TaskRegistry, server-derived capabilities and permitted paths, Director approval consumption, replay fingerprinting, lineage/provenance, and target-aware transports.

**VERIFIED:** commit 47a758a7 closes the narrow producer-bypass gap by making the GitHub workflows call /poc/activation/ingress before their Gemini/Gemini Builder CLI steps.

**VERIFIED:** the integration is still circular. routes/poc.js calls getDispatcher() after successful canonical ingress. For Gemini/Gemini Builder, that dispatcher launches the same GitHub workflow which then calls /poc/activation/ingress again and can proceed to its own CLI step.

Current effective path:

    GitHub event
      -> workflow-side validator
      -> /poc/activation/ingress
      -> canonical policy/ACP/TaskRegistry
      -> server dispatcher
      -> GitHub workflow_dispatch
      -> new workflow
      -> workflow-side validator
      -> ingress replay
      -> workflow-local CLI decision

This is not one canonical execution path.

The prior Kilo research record correctly identified the double-dispatch gap, but its proposed Option B is incomplete: if ingress dispatches the workflow and that workflow suppresses its CLI because ingress reported execution initiation, the chain can launch a workflow without any component actually invoking the agent CLI exactly once.

**Correct architectural direction:** GitHub external activation must be admission-first and execution-carrier-owned, while remaining inside the same Render control plane and TaskRegistry. The minimum required separation is:

1. canonical admission/recovery;
2. atomic execution claim/resume.

The workflow invokes the agent only when it owns the execution claim and consumes server-derived execution data rather than reconstructing authority from workflow inputs.

**Implementation readiness: BLOCKED.** The unresolved design is the durable execution-claim/recovery contract, including concurrency and the crash window after claim but before agent invocation.

## Evidence Classification

### VERIFIED

- main is 47a758a7ef8f4e63b32e699549c21e8976971e40.
- poc/activation-policy.js contains the server-controlled activation matrix and server-derived capabilities/path scopes.
- poc/activation-ingress.js performs canonicalization, policy evaluation, authority-conflict rejection, server-derived authority, ACP validation, TaskRegistry replay/create, Director authorization, and activation provenance.
- routes/poc.js authenticates /activation/ingress and then calls getDispatcher after successful ingress.
- services/transport-provider.js routes Gemini to gemini-trigger.js and Gemini Builder to gemini-builder-trigger.js.
- gemini-trigger.js dispatches main.yml using workflow_dispatch.
- gemini-builder-trigger.js dispatches gemini-builder.yml using workflow_dispatch.
- main.yml and gemini-builder.yml call validate-external-activation.js before their CLI steps.
- validate-external-activation.js calls /poc/activation/ingress; it does not invoke the agent CLI itself.
- The workflows still populate actual Gemini execution context from workflow/comment-derived values.
- task-registry.js contains replay fingerprinting and changed-payload rejection.
- Consequential commands require a scope-matching, expiring, consumable Director approval.
- Plain @gemini-cli remains REVIEW; explicit FAILOVER_EXECUTE remains supported; Gemini Builder remains a distinct BUILDER lane; Kilo remains the explicit FAILOVER_EXECUTE lane.
- Historical foundation 2136c44, replay/Director closure c2d4810, and producer-bypass closure 47a758a7 are present.
- Prior ChatGPT research established the generic Agent × Task Mode × Activation Surface contract.
- Current Kilo research independently identified the residual double-dispatch problem.

### INFERRED

- activation_validated proves admission, not that the subsequent CLI is the exact TaskRegistry-authorized execution.
- The current workflow path can create/recover a TaskRegistry task and still independently execute from workflow-local values.
- Replay protection alone does not prove exactly-one agent invocation across concurrent workflow runs and crash windows.
- A durable execution claim can live inside the existing TaskRegistry and does not require a second control plane or task store.
- The execution claim should authorize ownership of an already-authorized task; it must not grant capabilities or paths.

### UNKNOWN

- Live concurrent GitHub workflow behavior has not been exercised.
- Live Render deployment behavior and secrets are not independently verified here.
- Live Kilo provider behavior remains partly external.
- Whether the JSON-backed TaskRegistry can safely implement atomic compare-and-set claims under the production process model is not established.
- The correct stable GitHub workflow/run identity for the claim must be verified during implementation.
- Recovery after a carrier dies after claim but before agent invocation is not currently defined.

## Roadmap Alignment

- **authoritative_roadmap**: ARCHITECTURE.md §16.6; docs/ai/STATE.md; docs/ai/DEESEEK_COORDINATOR_LIFECYCLE_ENFORCEMENT_ROADMAP.md; docs/ai/TASK_STANDARD.md §3.1.
- **current_phase**: Phase 3 — Autonomous Coordination Loop, COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED; Phase 4 is PROPOSED / TARGET pending canonical transition evidence.
- **phase_completion_status**: Phase 3 is complete. Phase 4 is not mechanically activated.
- **relevant_prior_work**: Phase 3 final verification; Phase 4 baseline reconciliation; 2136c44; c2d4810; 47a758a7; prior ChatGPT external-activation research; current Kilo architecture-resolution research.
- **proposed_task_classification**: B — Enabling/Foundation Work.
- **roadmap_requirement_addressed**: Safe external recovery/execution-carrier integration for Phase 4 recovery/escalation while preserving ACP, TaskRegistry, Director authorization, lineage, and verification.
- **prerequisites_satisfied**: Admission foundation and prior research exist; execution-ownership semantics remain unresolved.
- **phase_unlock_or_advancement**: Resolve execution ownership/recovery before implementation; this research does not activate or complete Phase 4.
- **alignment_conclusion**: PASS for research; BLOCKED for implementation readiness.

## Prior Attempts and Root Cause

### Foundation — 2136c44
Added activation policy and canonical ingress. Existing GitHub producers still executed Gemini/Gemini Builder directly.

### Gap closure — c2d4810
Added replay fingerprinting/recovery and consequential Director approval enforcement. Existing producers still bypassed canonical ingress before execution.

### Producer-bypass closure — 47a758a7
Added workflow-side validator scripts, validation gates, and bypass tests.

**Root architectural failure:** canonical ingress was used both as the server-side dispatcher and as the admission endpoint called by the execution carrier itself. Those roles create recursion when the execution carrier is a GitHub workflow that the dispatcher launches.

The remaining problem is therefore an execution-boundary problem, not another missing validation check.

## Exact Current Sequence

### Gemini
GitHub event -> main.yml -> validator -> /poc/activation/ingress -> TaskRegistry -> routes/poc.js getDispatcher -> transport-provider.dispatchReview -> gemini-trigger.js -> GitHub workflow_dispatch(main.yml) -> second main.yml run -> second validator -> ingress replay -> workflow-local context -> run-gemini-cli.

### Gemini Builder
The same structure exists through dispatchBuilder -> gemini-builder-trigger.js -> gemini-builder.yml -> validator -> ingress replay -> Builder CLI.

### Consequence
There is no single causally authoritative edge from the TaskRegistry task to exactly one agent invocation. The admission response is not consumed as the authoritative execution descriptor.

## Correct Architectural Boundary

**Decision:** GitHub workflow activation must be admission-first and execution-carrier-owned.

### Operation A — Admission / recovery
1. Authenticate external actor/surface.
2. Parse bounded activation envelope.
3. Resolve Agent × Mode × Surface policy.
4. Derive target, capabilities, paths, repository/branch, workflow stage, and verification requirements.
5. Verify Director authorization where required.
6. Validate ACP.
7. Create or recover one TaskRegistry task.
8. Return canonical task identity and execution eligibility.

### Operation B — Execution claim / resume
1. Authenticate the carrier.
2. Bind carrier identity to the TaskRegistry request/activation.
3. Atomically decide whether this carrier owns execution.
4. Return the server-derived execution descriptor.
5. Return deterministic replay/already-owned/terminal/recovery outcomes.
6. Never grant new authority.

Both operations remain in the same Render/ACP/TaskRegistry control plane.

### Why Kilo Option B is rejected
Kilo proposed that ingress dispatch and the workflow skip its own CLI when execution_initiated is true. That can become:

ingress -> dispatch workflow -> workflow validator -> ingress replay -> workflow sees execution already initiated -> workflow skips CLI.

That can launch the workflow without invoking the agent. It does not prove exactly one agent execution.

### Why bare Option A is insufficient
Making ingress admission-only and immediately running the CLI removes recursion, but two workflow runs can still reach the execution step unless the TaskRegistry authoritatively claims one carrier.

## Canonical Execution Contract

New activation:

external event -> canonical admission -> TaskRegistry create/recover -> execution claim -> workflow owns claim -> workflow uses canonical server-derived descriptor -> agent CLI -> existing callback/evidence -> existing verification/reconciliation.

Identical replay:

external event -> canonical admission/recovery -> existing task -> claim returns ALREADY_CLAIMED / COMPLETE / another deterministic state -> no second CLI.

Changed replay:

same activation/request identity + different canonical payload -> REPLAY_PAYLOAD_MISMATCH -> BLOCKED.

Workflow inputs are transport/correlation data, not authority. The workflow must not independently determine capabilities, permitted paths, target, task mode, repository, base branch, workflow stage, or Director authorization.

GitHub documents that workflow_dispatch inputs are values supplied to the triggered workflow; they are therefore transport inputs rather than an independent authorization source. citeturn0search0turn0search1

## Execution Ownership and Failure Model

The TaskRegistry needs an execution-ownership concept. Exact field names are an implementation decision.

Required outcomes:

| Claim outcome | Meaning | Agent invocation |
|---|---|---|
| CLAIMED | This carrier owns the task | Yes |
| ALREADY_CLAIMED | Another carrier owns it | No |
| COMPLETE | Terminal success | No |
| FAILED/BLOCKED | Terminal failure | No |
| RECOVERABLE | Explicit recovery policy allows reclaim | Conditional |
| MISMATCH | Carrier/task mismatch | No; BLOCK |
| UNAUTHORIZED | Authority invalid | No; BLOCK |

Minimum semantic lifecycle:

PENDING -> CLAIMED -> EXECUTING -> VERIFIED -> COMPLETE

CLAIMED -> RECOVERABLE/EXPIRED or FAILED/BLOCKED

Critical failure window:

TaskRegistry claim succeeds -> carrier crashes -> agent may or may not have started.

A boolean cannot distinguish these states safely.

The implementation must explicitly choose a lease/recovery rule, permanent interruption/escalation, or another bounded mechanism. Literal physical exactly-once execution across an arbitrary crash after process start cannot be established solely by the current Render + GitHub boundary without a stronger provider/idempotency contract. Distributed-systems guidance similarly distinguishes at-most-once from exactly-once effects and recommends explicit idempotency/recovery semantics. citeturn1search0turn1search6

The repository should therefore claim one canonical execution claim / at-most-one non-idempotent agent invocation under the supported failure model, with deterministic replay and explicit recovery, unless a stronger provider contract is established.

## Director Authorization

Existing Director approval remains authoritative:

external activation -> policy -> exact Director scope validation/consumption -> TaskRegistry create/recover -> execution claim -> agent.

Claiming execution must not create or alter authority. It only binds one carrier to an already-authorized task.

## Agent × Mode × Surface

The existing generic policy direction remains correct:

| Agent | Mode | Surface/carrier |
|---|---|---|
| Gemini | REVIEW | @gemini-cli / approved workflow carrier |
| Gemini | FAILOVER_EXECUTE | approved external recovery surface |
| Gemini | VERIFY_RECONCILE | only when explicitly authorized |
| Gemini | RESEARCH_DOCUMENT | only when explicitly authorized |
| Gemini Builder | BUILDER | workflow_dispatch / approved recovery surface |
| Kilo | FAILOVER_EXECUTE | existing approved Kilo transport |

Plain @gemini-cli remains REVIEW/read-only. FAILOVER_EXECUTE remains explicit. Gemini Builder remains distinct from Gemini Reviewer. Kilo remains explicitly authorized for FAILOVER_EXECUTE.

## File Responsibilities

- poc/activation-policy.js: Agent × Mode × Surface policy and server-derived authority.
- poc/activation-ingress.js: canonical admission/recovery; no recursive self-dispatch.
- routes/poc.js: authenticated admission/claim HTTP boundary.
- poc/task-registry.js: task identity, lineage, replay, Director approval, execution ownership/recovery.
- poc/schemas/acp-schema.js: ACP/lifecycle/evidence validation.
- services/transport-provider.js: target-to-provider mapping for server-driven paths.
- poc/gemini-trigger.js: server-to-GitHub workflow carrier trigger.
- poc/gemini-builder-trigger.js: Builder carrier trigger.
- poc/external-activation-validator.js: thin workflow adapter.
- poc/validate-external-activation.js: admission/claim adapter; no independent authority.
- .github/workflows/main.yml: Gemini execution carrier.
- .github/workflows/gemini-builder.yml: Builder execution carrier.
- poc/coordinator.js / DeepSeek runtime: internal coordinator path; no special external authority.
- Kilo provider integration: external execution carrier; provider-specific behavior remains partly UNKNOWN.

## Producer Migration Matrix

| Producer | Current | Required | Status |
|---|---|---|---|
| Gemini issue_comment | validator -> ingress -> dispatcher -> workflow | admission -> claim -> CLI | OPEN |
| Gemini workflow_dispatch | validator -> ingress -> dispatcher -> workflow | admission -> claim -> CLI | OPEN |
| Gemini Builder workflow_dispatch | validator -> ingress -> dispatcher -> workflow | admission -> claim -> CLI | OPEN |
| gemini-trigger.js | server workflow trigger | retain as carrier trigger; prevent recursive self-admission | OPEN |
| gemini-builder-trigger.js | server workflow trigger | same | OPEN |
| Kilo external provider | provider-controlled | canonical task/claim at transport boundary | PARTLY OPEN / UNKNOWN |
| Future agents | generic policy | same admission + claim contract | DESIGN DEFINED |

## Required Implementation Tests

### Admission and authority
1. Valid activation creates one TaskRegistry task.
2. Consequential activation requires exact Director approval.
3. Unknown agent/mode/surface fails closed.
4. Authority expansion fails closed.
5. Changed replay payload fails closed.
6. Identical replay recovers existing task.

### Claim/execution
7. New task can be claimed once.
8. Concurrent second claim returns ALREADY_CLAIMED.
9. Terminal task cannot be claimed.
10. Carrier identity mismatch fails closed.
11. Claim cannot alter authority.
12. CLI executes only after successful claim.
13. Replay does not invoke CLI again.
14. Workflow does not recursively call an ingress that dispatches itself.
15. Server-triggered workflow still executes once.

### Recovery
16. Failure before claim allows another authorized claim.
17. Failure after claim follows explicit lease/interruption policy.
18. Missing callback does not automatically cause blind duplicate execution.
19. Terminal state prevents re-execution.
20. Concurrent duplicate deliveries converge deterministically.

### Compatibility
21. Plain @gemini-cli remains REVIEW.
22. Explicit FAILOVER_EXECUTE remains FAILOVER_EXECUTE.
23. Gemini Builder remains BUILDER.
24. Kilo remains FAILOVER_EXECUTE.
25. Synthetic future-agent policy registration requires no second control plane.

Existing external-activation-bypass, activation-policy, schema, transport, callback, and replay tests remain regression requirements.

## Subsequent Kilo Implementation Acceptance Criteria

- One canonical admission operation.
- One TaskRegistry task per activation identity.
- One durable execution owner/claim in TaskRegistry.
- No workflow -> ingress -> dispatcher -> same-workflow recursion.
- Workflow consumes server-derived execution data.
- Duplicate claims cannot invoke the agent.
- Replay cannot create another execution.
- Changed replay fails closed.
- Director approval remains single-use and scope-bound.
- Lineage/workflow-stage/evidence controls remain authoritative.
- Plain REVIEW, FAILOVER_EXECUTE, BUILDER, and Kilo semantics remain intact.
- Internal coordinator dispatch remains functional.
- Existing bypass/replay/policy/schema tests remain green.
- New tests prove actual execution sequence and concurrency behavior.
- Failure-window semantics are explicit.
- No second control plane/task store/authorization store.
- No secrets introduced.
- git diff --check passes.
- Atomic commit/push in the authorized implementation execution.

## Rejected Approaches

1. Add another validation shim while leaving actual authority/execution unchanged.
2. Keep /poc/activation/ingress recursively dispatching the same GitHub workflow that calls it.
3. Use a boolean execution_initiated without durable ownership semantics.
4. Treat workflow inputs as canonical authority.
5. Create a second TaskRegistry or workflow-local authority store.
6. Let GitHub Actions decide Director authorization.
7. Let model output grant capabilities or paths.
8. Treat replay detection alone as exactly-once execution.
9. Blindly retry an uncertain agent invocation.
10. Expand Kilo beyond its explicit authorized modes.

## Atomic Implementation Boundary

A single implementation task is appropriate only if execution claiming can be safely implemented using the existing TaskRegistry without a new persistence system.

Likely implementation files:

- poc/activation-ingress.js
- routes/poc.js
- poc/task-registry.js
- poc/validate-external-activation.js
- poc/external-activation-validator.js
- .github/workflows/main.yml
- .github/workflows/gemini-builder.yml
- relevant tests.

Preserve policy and transport contracts unless implementation evidence requires a narrowly scoped change.

If the JSON-backed TaskRegistry cannot safely provide the required atomic claim semantics under the actual Render process model, stop and escalate for a bounded concurrency/storage research decision. Do not silently introduce a new persistence layer.

## Durable-Record Reconciliation

The prior ChatGPT research remains valid for the generic Agent × Mode × Surface contract, server-derived authority, Director scope binding, replay fingerprinting, fail-closed admission, and TaskRegistry provenance/lineage.

The Kilo research remains valid for identifying the producer-bypass closure and residual double-dispatch gap.

This record corrects the Kilo research's implementation conclusion: Option B does not establish one agent execution because ingress dispatches the workflow while the workflow re-enters ingress and may suppress its own CLI. The correct remaining design problem is execution ownership and recovery.

No application/runtime code was changed by this research.

## Unresolved Questions / Blockers

1. What exact TaskRegistry operation atomically claims execution for a carrier?
2. Can the current JSON-backed registry safely provide that atomicity in the production process model?
3. What stable GitHub run identity should bind the claim?
4. What happens when the carrier dies after claim but before agent invocation?
5. What evidence distinguishes agent-never-started from agent-started-but-callback-lost?
6. What bounded recovery/lease policy is safe for that uncertainty?

These are implementation-critical architectural questions.

## Conclusion

**ADMISSION / AUTHORIZATION ARCHITECTURE: RESOLVED.**

**EXECUTION-CARRIER / EXECUTION-OWNERSHIP ARCHITECTURE: NOT RESOLVED.**

**IMPLEMENTATION READINESS: BLOCKED.**

The next work is a focused execution-claim/recovery design decision, not another producer-validation task.

## Implementation Handoff to Kilo

### Exact proposed sequence

GitHub external event -> authenticated canonical admission -> server policy + ACP + Director approval -> TaskRegistry create/recover -> atomic execution claim -> GitHub workflow owns claim -> workflow consumes canonical server-derived execution descriptor -> agent CLI -> existing callback/evidence -> existing verification/reconciliation.

### Authority/data ownership

Activation policy owns Agent × Mode × Surface policy. ACP owns command validation/authorization. Director approval owns consequential scope authorization. TaskRegistry owns task identity, lineage, replay, execution ownership, and recovery state. Render owns authenticated admission/claim. GitHub Actions is execution carrier only. Agent executes authorized work but grants no authority. Existing verification/reconciliation determines verified outcome.

### Exact producer changes

Gemini issue_comment, Gemini workflow_dispatch, and Gemini Builder workflow_dispatch use admission + claim with no recursive dispatch. Server-triggered workflows preserve existing trigger modules but must not self-reenter a dispatcher that launches the same carrier.

### Exact server changes

Define admission versus claim semantics; add execution ownership to TaskRegistry; bind claim to request/activation identity and carrier identity; define stale/recovery behavior; return canonical server-derived execution descriptor.

### Exact workflow changes

Stop reconstructing authority from workflow inputs. Perform admission once. Perform execution claim once. Execute only when this run owns the claim. Report invocation/claim identity in existing evidence.

### Exact tests

Use the 25-test matrix above plus existing activation-policy, schema, transport, callback, replay, and bypass suites.

### Migration order

1. Resolve TaskRegistry atomic-claim feasibility and failure-window semantics.
2. Implement claim/recovery contract.
3. Convert workflow adapter to admission + claim.
4. Make workflow consume server-derived execution data.
5. Remove recursive self-dispatch.
6. Add concurrency/replay/failure-window tests.
7. Run focused/regression verification.
8. Commit and push one atomic implementation change.

### Rollback/failure behavior

Admission failure -> no execution. Claim failure -> no execution. Duplicate claim -> no second execution. Authority mismatch -> BLOCKED. Terminal task -> no execution. Uncertain post-start invocation -> no blind duplicate; follow explicit recovery/evidence policy. No second control plane or persistence authority.

### Bounded implementation-readiness checklist

The research remains blocked until the unresolved execution-claim questions are answered and the design demonstrates one TaskRegistry task, one execution owner, one execution-carrier invocation under the supported failure model, server-derived authority consumed by the carrier, deterministic duplicate suppression, explicit crash/recovery semantics, no workflow -> ingress -> dispatcher -> workflow recursion, and preservation of ACP, Director approval, lineage, workflow-stage, verification, and reconciliation.
