# Research Record — TASK-CHATGPT-EXTERNAL-ACTIVATION-EXECUTION-CLAIM-RECOVERY-RESEARCH-001

## Task Identity

- **task_name**: TASK-CHATGPT-EXTERNAL-ACTIVATION-EXECUTION-CLAIM-RECOVERY-RESEARCH-001
- **agent**: ChatGPT
- **date**: 2026-10-02
- **task_mode**: RESEARCH_DOCUMENT
- **repository**: fluentwithkyle/openclaw-webhook
- **base_branch**: main
- **current_head**: c98f466e915d3bf5038f09a1cd965379272861c3
- **status**: BLOCKED for implementation

## Executive Conclusion

The admission/authorization architecture is resolved. The execution-carrier architecture is not implementation-ready.

The current TaskRegistry is JSON/file-backed with a process-local `memoryCache`. `atomicWrite()` uses backup-file write plus `fs.renameSync()`, which makes an individual replacement atomic, but existing mutations are read-modify-write operations over process-local state. No inter-process lock, database transaction, compare-and-set/version check, distributed mutex, or equivalent cross-process serialization mechanism was found.

Therefore the current repository cannot safely establish a single cross-process execution claim for concurrent Render processes/instances. A later implementation must first resolve the authoritative persistence/concurrency primitive. This is a real blocker, not an implementation detail that can safely be inferred away.

## Repository Truth

### VERIFIED

Current `main` resolves to `c98f466e915d3bf5038f09a1cd965379272861c3`.

Historical commits directly relevant to this research were inspected:

- `2136c44` — external activation foundation.
- `c2d4810` — replay/idempotency closure.
- `47a758a7` — external producer-bypass closure attempt.
- `c98f466e` — prior architecture-resolution research reconciliation.

The prior record `docs/ai/research/research-TASK-CHATGPT-EXTERNAL-ACTIVATION-ARCHITECTURE-RESOLUTION-RESEARCH-001.md` was inspected.

### VERIFIED — current recursion defect

`routes/poc.js` currently makes `/poc/activation/ingress` call `getDispatcher()(ingressResult.command)` after canonical admission.

For Gemini/Gemini Builder, `services/transport-provider.js` dispatches through `poc/gemini-trigger.js` / `poc/gemini-builder-trigger.js`, which invoke GitHub `workflow_dispatch`.

The workflows then call `/poc/activation/ingress` and proceed to their own Gemini CLI step.

The effective path can therefore recurse:

```
external event
 -> workflow
 -> /poc/activation/ingress
 -> TaskRegistry
 -> dispatcher
 -> same workflow
 -> /poc/activation/ingress
 -> replay
 -> direct agent CLI
```

The validation step does not fix this architecture.

### VERIFIED — TaskRegistry persistence

`poc/task-registry.js` contains:

- `REGISTRY_FILE = poc/task-registry.json`
- process-local `memoryCache = new Map()`
- `fs.readFileSync()` during initialization
- `atomicWrite()` using backup-file write and `fs.renameSync()`
- mutation pattern of cache read → object mutation → `memoryCache.set()` → `persistCache()`

No cross-process synchronization primitive was found.

Atomic file replacement is not equivalent to an atomic logical compare-and-set. Two processes can independently read the same unclaimed task, both decide they may claim it, and both proceed toward external invocation before either persisted replacement is observed by the other.

### VERIFIED — current replay behavior

`replayTask()` and `computePayloadFingerprint()` provide the required admission-level replay semantics:

- identical request/payload recovers the existing task;
- materially changed payload fails closed with `REPLAY_PAYLOAD_MISMATCH`;
- no duplicate TaskRegistry task is created.

This does not solve concurrent first-claim ownership.

### VERIFIED — callback/evidence behavior

Gemini, Gemini Builder, and Kilo callbacks authenticate, validate execution reports, validate task identity/repository/branch, and enter the existing orchestrator/lifecycle path. Agent execution evidence is recorded through the existing TaskRegistry/evidence mechanisms.

Missing callback evidence cannot prove that the agent never started.

### VERIFIED — GitHub carrier identity

The existing Builder workflow already records an invocation identifier derived from `GITHUB_RUN_ID` and `GITHUB_RUN_ATTEMPT`. These provide useful carrier/run correlation.

GitHub Actions `workflow_dispatch` inputs are transport inputs, not an application authorization authority. GitHub Actions concurrency can limit scheduling overlap, but it does not replace server-side TaskRegistry authority or establish exactly-once external side effects.

## Identity Model

The final design needs four distinct identities:

1. **activation_id** — external activation/admission identity.
2. **request_id** — authoritative TaskRegistry task identity.
3. **execution_claim_id** — identity of one execution ownership claim.
4. **carrier_invocation_id** — concrete GitHub run/attempt identity.

The TaskRegistry remains authoritative. GitHub identities are carrier correlation data.

## Claim Protocol

The intended sequence is:

```
external event
 -> authenticated canonical admission/recovery
 -> one TaskRegistry task
 -> atomic execution claim
 -> one authorized carrier invocation
 -> target-agent execution
 -> evidence/reporting
 -> independent verification/reconciliation
```

A claim may only establish ownership of an already-authorized task. It cannot grant capabilities, paths, target-agent authority, Director authority, repository/branch authority, or workflow-stage authority.

Required deterministic outcomes:

| Outcome | Meaning | Agent execution |
|---|---|---|
| CLAIMED | This carrier owns the task | allowed |
| ALREADY_CLAIMED | Another carrier owns it | prohibited |
| COMPLETE | Task already complete | prohibited |
| FAILED/BLOCKED | Terminal failure | prohibited |
| RECOVERABLE | Explicit recovery policy permits reclaim | conditional |
| MISMATCH | Carrier/task identity mismatch | prohibited |
| UNAUTHORIZED | Authority invalid | prohibited |

## Failure Windows and Recovery

| Window | What is known | Required behavior |
|---|---|---|
| Before claim | No claim exists | another authorized carrier may claim |
| After claim, before agent invocation | Claim exists; invocation may or may not exist | no blind duplicate; explicit lease/recovery policy required |
| After agent invocation, before callback/evidence | Claim exists; external execution may have occurred | do not infer non-execution from missing callback |
| Callback duplicated | Existing invocation/evidence exists | idempotent reconciliation |
| Terminal task | Task is terminal | no implicit re-execution |

The hardest uncertainty is:

`claim persisted -> carrier dies -> agent may or may not have started`.

The repository does not currently provide authoritative evidence that always distinguishes those states.

## Exactly-Once Assessment

### VERIFIED

Literal exactly-once external side effects are not established.

There is no repository/provider contract proving that Gemini, Gemini Builder, or Kilo external invocation is transactionally idempotent across arbitrary carrier crashes and retries.

GitHub concurrency can reduce duplicate carrier execution but cannot prove whether an already-running CLI crossed the invocation boundary before cancellation or runner loss.

### Strongest honest guarantee

The target should be:

**At-most-one authoritative execution owner per task, deterministic replay suppression, and no blind re-invocation when external invocation status is uncertain.**

Even that guarantee is not currently implementable because the existing TaskRegistry lacks a safe cross-process atomic claim primitive.

## Prior Execution-Claim Direction

**RETAINED in principle, BLOCKED at implementation boundary.**

The prior research direction remains correct:

```
admission
 -> TaskRegistry create/recover
 -> execution claim
 -> carrier owns claim
 -> server-derived execution descriptor
 -> agent CLI
 -> existing callback/evidence
 -> verification/reconciliation
```

Rejected designs remain rejected:

- validation-only shim;
- workflow-local authority;
- recursive ingress → dispatcher → same workflow;
- bare `execution_initiated` boolean;
- treating accepted/validated as proof of agent execution.

The new result is that the claim itself requires a persistence primitive capable of cross-process atomicity.

## Workflow Authority

Current workflows reconstruct orchestration values from workflow inputs and pass them into the CLI environment. The final design must instead consume a bounded server-derived execution descriptor associated with the authoritative task and claim.

Workflow inputs remain correlation/transport data only.

## GitHub Concurrency

GitHub Actions concurrency is suitable as a secondary carrier safeguard, for example by grouping on the authoritative task identity.

It cannot replace TaskRegistry because it does not:

- authorize the task;
- persist lifecycle state;
- perform ACP validation;
- consume Director authorization;
- establish cross-process Render ownership;
- prove whether the agent was invoked before cancellation.

## Minimum Decision Before Implementation

A bounded persistence/concurrency decision is required:

**Which single authoritative persistence mechanism can safely serialize TaskRegistry create/recover/claim mutations across the actual Render process/instance topology?**

Acceptable resolution:

1. an existing authoritative transactional/concurrency mechanism already available and demonstrably usable by TaskRegistry; or
2. a separately authorized hardening task that upgrades the existing TaskRegistry authority without creating a second task store/control plane.

No new persistence dependency should be introduced silently inside the execution-claim implementation.

## Implementation Handoff to Kilo

### Exact claim protocol

1. Authenticate carrier.
2. Resolve authoritative task by activation/request identity.
3. Validate replay fingerprint and server-derived authority.
4. Confirm Director authorization is valid/consumed for consequential execution.
5. Atomically compare task state with the allowed unclaimed/recoverable state in the approved persistence authority.
6. Persist claim identity, carrier identity, timestamps and canonical execution descriptor.
7. Return `CLAIMED` with server-derived descriptor.
8. Only the claim owner invokes the agent.

### Exact recovery protocol

- No claim: another authorized carrier may claim.
- Active live claim: return `ALREADY_CLAIMED`.
- Explicitly stale claim: recover only through authoritative TaskRegistry transaction.
- Unknown post-claim invocation: preserve uncertainty; reconcile provider/run evidence before any non-idempotent re-invocation.
- Terminal task: no implicit retry.
- Replay mismatch, carrier mismatch, or authority mismatch: fail closed.

### Exact authority/data ownership

- ACP: sole authorization boundary.
- TaskRegistry: task identity, lineage, lifecycle, replay, execution claim and recovery state.
- Director approval: consequential scope authorization.
- Activation policy: Agent × Mode × Surface policy.
- Server: all authority-bearing execution fields.
- Dispatcher/orchestrator: execution authority.
- GitHub Actions: carrier only.
- Agent: execution only.
- Existing callbacks/evidence: result ingestion and verification/reconciliation.

### Exact server changes

After persistence resolution:

- add durable claim/recovery state;
- implement atomic claim/recover;
- separate admission from carrier invocation;
- return a server-derived execution descriptor;
- bind carrier identity;
- preserve ACP, Director approval, lineage, workflow stage and replay controls.

### Exact trigger changes

`poc/gemini-trigger.js` and `poc/gemini-builder-trigger.js` remain thin carrier adapters. They dispatch only an already-authorized carrier request and do not reinterpret workflow inputs as authority.

### Exact workflow changes

- remove recursive validation/dispatch pattern;
- consume server-derived execution descriptor;
- establish/confirm carrier claim once;
- gate CLI on claim ownership;
- record run/attempt/invocation identity;
- retain callback/artifact lifecycle;
- optionally add task-keyed GitHub concurrency as a secondary safeguard.

### Required tests

At minimum:

1. concurrent claims converge on one owner;
2. duplicate owner cannot invoke twice;
3. identical replay is idempotent;
4. changed replay fails closed;
5. terminal task cannot claim;
6. claim cannot alter authority;
7. carrier identity mismatch fails;
8. workflow inputs cannot expand capabilities/paths;
9. server-derived descriptor is what CLI consumes;
10. claim survives process reload/restart;
11. pre-claim failure is retryable;
12. post-claim/pre-invocation failure follows explicit recovery;
13. post-invocation/callback-loss does not trigger blind duplicate execution;
14. duplicate callbacks are idempotent;
15. CLI invocation occurs only after claim;
16. recursive workflow path is impossible;
17. GitHub concurrency is supplementary;
18. Director approval remains single-use/scope-bound;
19. lineage/workflow-stage remain enforced;
20. REVIEW, FAILOVER_EXECUTE, BUILDER and Kilo FAILOVER_EXECUTE semantics remain intact;
21. no second control plane/store;
22. focused and full regression tests pass.

### Migration order

1. Resolve/authorize persistence concurrency.
2. Implement atomic TaskRegistry claim/recovery.
3. Separate admission and carrier dispatch.
4. Convert triggers to carrier-only adapters.
5. Convert workflows to claim-owned execution.
6. Add GitHub concurrency safeguard.
7. Add crash-window/recovery tests.
8. Run focused/full regression.
9. Independently verify and reconcile.

### Failure/rollback

Admission failure → no execution.

Replay mismatch → BLOCKED.

Claim conflict → no second execution.

Terminal task → no execution.

Authority mismatch → BLOCKED.

Pre-claim carrier failure → task remains recoverable.

Post-claim uncertain invocation → preserve claim/evidence and follow explicit recovery; never infer non-execution.

Callback loss after known invocation → reconcile later; do not blindly invoke again.

Persistence/concurrency failure → fail closed; no agent dispatch.

### Bounded acceptance checklist

- [ ] one activation → one authoritative TaskRegistry task
- [ ] one task → one execution owner at a time
- [ ] claim atomic under actual production process/instance model
- [ ] duplicate claim cannot invoke agent
- [ ] identical replay idempotent
- [ ] changed replay fails closed
- [ ] Director approval single-use/scope-bound
- [ ] server-derived authority only
- [ ] workflow inputs are correlation data
- [ ] no workflow → ingress → dispatcher → same-workflow recursion
- [ ] CLI only after claim ownership
- [ ] carrier identity durably correlated
- [ ] post-claim uncertainty has explicit safe policy
- [ ] no blind duplicate after callback loss
- [ ] GitHub concurrency supplementary only
- [ ] existing agent semantics preserved
- [ ] existing evidence/verification/reconciliation preserved
- [ ] no second control plane/store
- [ ] concurrency/replay/invocation tests pass
- [ ] full regression passes
- [ ] independent verification passes

## Roadmap Alignment

- **authoritative_roadmap**: `ARCHITECTURE.md` §16.6; `docs/ai/STATE.md`; `docs/ai/KILO_GEMINI_ORCHESTRATION_PLAN.md`; `docs/ai/ARCH_DECISIONS.md`
- **current_phase**: Phase 4 — Scaled Conversational Orchestration & Cross-Task Lineage Navigation — PROPOSED / TARGET
- **phase_completion_status**: Phase 3 COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED. Phase 4 durable transition evidence is not established in STATE.md. This research does not bypass the phase-transition gate.
- **relevant_prior_work**: Phase 3 completion; `2136c44`; `c2d4810`; `47a758a7`; prior external-activation architecture-resolution research.
- **proposed_task_classification**: B — Enabling/Foundation Work.
- **roadmap_requirement_addressed**: Safe lifecycle recovery/replay/convergence for external specialist execution, prerequisite to Phase 4 recovery/escalation and scaled orchestration.
- **prerequisites_satisfied**: Admission policy, ACP validation, replay fingerprinting, TaskRegistry lifecycle, dispatcher/transport and callback/evidence paths exist. Cross-process atomic execution claim is not established.
- **phase_unlock_or_advancement**: Resolve execution ownership/recovery so Phase 4 recovery/escalation and scaled orchestration can proceed without parallel authority.
- **alignment_conclusion**: PASS for enabling research; BLOCKED for implementation readiness.

## Exact Files Kilo Should Change After the Persistence Decision

Expected candidates:

- `poc/task-registry.js`
- `poc/activation-ingress.js`
- `routes/poc.js`
- `services/transport-provider.js`
- `poc/gemini-trigger.js`
- `poc/gemini-builder-trigger.js`
- `.github/workflows/main.yml`
- `.github/workflows/gemini-builder.yml`
- relevant ACP schema files only if required
- relevant tests under `test/`

Expected untouched:

- `services/deepseek-runtime.js`
- strategic-state and phase-transition authority
- unrelated coordinator/control-plane files
- governance files except explicitly authorized reconciliation.

## Atomic Kilo Task Assessment

**BLOCKED — not yet suitable for one atomic Kilo implementation task.**

If the existing runtime can provide a safe atomic claim primitive without architectural expansion, the resulting claim/recovery/carrier conversion can be one atomic Kilo implementation task.

If not, minimum decomposition is:

1. separately authorized persistence/concurrency hardening decision/implementation;
2. separately authorized execution-claim/carrier-recovery implementation.

## Final Architectural Resolution

**PARTIAL / IMPLEMENTATION BLOCKED.**

The exact unresolved decision is:

**What single authoritative persistence/concurrency mechanism will serialize TaskRegistry execution claims across the actual Render process/instance topology?**

Until that is resolved and authorized, the execution-claim implementation should remain blocked.

