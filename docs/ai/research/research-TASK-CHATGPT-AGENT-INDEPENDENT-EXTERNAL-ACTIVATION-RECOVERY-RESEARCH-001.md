# Research Record: Agent-Independent External Activation and Recovery Contract

| Field | Value |
|---|---|
| Task / Request Identifier | TASK-CHATGPT-AGENT-INDEPENDENT-EXTERNAL-ACTIVATION-RECOVERY-RESEARCH-001 |
| Agent | ChatGPT Coordinator |
| Date | 2026-10-01 |
| Task Mode | RESEARCH_DOCUMENT |
| Repository State Examined | main @ 08313c5e060e5c2313aa7303e14c7d060c8e59f1 |
| Objective | Determine whether every currently authorized AI agent, and future authorized agents, can independently receive and execute every task mode they are authorized for through an approved external recovery surface while preserving the existing ACP/TaskRegistry authority model. |

## Executive conclusion

**VERIFIED: The current architecture does not yet satisfy the central recovery requirement.**

Capability routing is server-controlled and the canonical task-mode capability sets are correctly enforced. The gap is the **external activation layer**: activation is currently modeled partly as a special property of `FAILOVER_EXECUTE` and `BUILDER`, while the actual GitHub recovery workflows contain agent-specific parsing and, critically, can invoke Gemini execution directly from an `issue_comment` or `workflow_dispatch` event without first creating the same authoritative TaskRegistry record and consuming the same Director authorization used by `/poc/coordinator`.

The clean target is an **agent-independent external activation contract**:

`authorized agent × authorized task mode × approved activation surface` → authenticated activation envelope → one existing ACP validation/authorization boundary → one TaskRegistry entry → existing dispatcher/transport → agent → evidence/verification/reconciliation.

External activation should be a transport/ingress capability of an already-authorized agent/task-mode pair, not a special property of only two task modes.

## Evidence classification

### VERIFIED

- main HEAD is `08313c5e060e5c2313aa7303e14c7d060c8e59f1`.
- `VALID_TASK_MODES` contains REVIEW, VERIFY_RECONCILE, FAILOVER_EXECUTE, BUILDER, and RESEARCH_DOCUMENT.
- Mode capabilities and mode-specific permitted paths are server/schema controlled.
- The model-facing DeepSeek policy prohibits authority-bearing task fields from model input.
- `EXECUTION_TASK_MODES` currently contains only FAILOVER_EXECUTE and BUILDER.
- Gemini issue-comment activation is agent-specific and currently recognizes plain `@gemini-cli` as REVIEW and an explicit `FAILOVER_EXECUTE` keyword as FAILOVER_EXECUTE.
- The Gemini issue-comment workflow derives its own mode/capabilities/paths and runs Gemini directly; it does not call `/poc/coordinator` or create a TaskRegistry task before execution.
- Gemini Builder is exposed through a dedicated `workflow_dispatch` workflow and likewise receives workflow inputs directly rather than entering TaskRegistry through the external activation event itself.
- The normal `/poc/coordinator` path validates ACP, consumes Director authorization for consequential commands, creates the TaskRegistry entry, and then dispatches through the existing target-aware dispatcher.
- Kilo's repository contract identifies `/poc/kilo` → `KILO_TRIGGER_URL` as the active repository-controlled Kilo dispatch path and states that the external Kilo webhook is provider-controlled.
- Kilo's documented external webhook currently has Pushes + Issues enabled while issue_comment is disabled; issue body is documented as the sole candidate ACP request for that webhook.
- Plain `@gemini-cli` REVIEW behavior is preserved by the current workflow.
- Gemini Builder is the primary Builder/Implementer/Tester lane; Kilo is the explicitly targeted execution/failover lane.

### INFERRED

- A generic external activation ingress can be implemented by normalizing all approved external surfaces into one canonical activation envelope and then routing through the existing ACP/TaskRegistry path.
- The existing `activation_syntax` / `activation_surface` fields are suitable concepts but should be generalized from execution-mode metadata into a complete activation contract.
- RESEARCH_DOCUMENT and VERIFY_RECONCILE should become externally activatable only after their target-agent authorization and Director-authorization requirements are resolved by the same server-side policy used for internal dispatch.
- A future agent can inherit the contract by registering its authorized task modes and approved activation surfaces in one policy registry rather than adding a new workflow parser.

### UNKNOWN

- Live provider-side Kilo webhook behavior cannot be independently verified from repository code because its trigger configuration and prompt are external.
- Live GitHub permission behavior for every possible workflow_dispatch actor is not independently exercised here.
- The exact future activation surface set (issue body, issue comment, workflow_dispatch, signed webhook, etc.) remains an architecture decision; this research establishes the contract rather than selecting an external provider configuration.
- Whether a future external surface can authenticate a Director decision cryptographically depends on the surface's available identity/signature mechanism and must be validated before implementation.

## 1. Verified agent × task-mode authorization matrix

| Agent | REVIEW | VERIFY_RECONCILE | RESEARCH_DOCUMENT | FAILOVER_EXECUTE | BUILDER |
|---|---|---|---|---|---|
| Gemini | VERIFIED | VERIFIED | VERIFIED | VERIFIED, exceptional failover role | Not the Gemini Reviewer lane |
| Gemini Builder | Not the Builder role | Not currently authorized | Not currently authorized | Not currently authorized as its normal mode | VERIFIED |
| Kilo | Not canonically routed | Not canonically routed | Not canonically routed | VERIFIED, explicit execution/failover lane | Builder capability exists historically, but current canonical routing uses FAILOVER_EXECUTE; do not equate Kilo with the Gemini Builder identity |

The Gemini role definitions in `GEMINI.md` explicitly define REVIEW, VERIFY_RECONCILE, RESEARCH_DOCUMENT, FAILOVER_EXECUTE, and a separate BUILDER section for the Gemini Builder lane. `services/deepseek-runtime.js` currently routes Gemini Reviewer to REVIEW, Gemini Builder to BUILDER, and Kilo to FAILOVER_EXECUTE.

## 2. Verified current activation matrix

| Agent | Surface | Current externally reachable modes | Evidence / status |
|---|---|---|---|
| Gemini | GitHub issue comment `@gemini-cli` | REVIEW | VERIFIED; plain comment defaults to REVIEW/read_only/poc/ |
| Gemini | GitHub issue comment `@gemini-cli FAILOVER_EXECUTE ...` | FAILOVER_EXECUTE | VERIFIED; recently added and present on main |
| Gemini | workflow_dispatch | REVIEW and arbitrary input modes are accepted by workflow inputs | VERIFIED as workflow capability; **NOT VERIFIED as safe external activation**, because workflow inputs bypass the normal ACP/TaskRegistry ingress |
| Gemini Builder | workflow_dispatch | BUILDER by default; workflow accepts task_mode/capabilities/path inputs | VERIFIED as workflow capability; **NOT VERIFIED as safe external activation** for the same authority-boundary reason |
| Kilo | `/poc/kilo` → external Kilo trigger | FAILOVER_EXECUTE via current canonical coordinator routing | VERIFIED as repository-controlled dispatch architecture |
| Kilo | external GitHub issue/body webhook | Candidate ACP activation path | VERIFIED as documented external configuration; live provider execution is UNKNOWN |
| Kilo | issue comment webhook | None currently, because documented webhook selection disables issue_comment | VERIFIED from repository documentation |

The schema currently declares activation surfaces for Kilo as github_issue_comment, github_issue_body, and github_push_event; Gemini and Gemini Builder as github_issue_comment and workflow_dispatch. That declaration is broader than the actually implemented safe ingress behavior and therefore should be treated as a policy inventory, not proof that each combination is operational.

## 3. Where activation is hard-coded

The principal hard-coded points are:

1. `poc/schemas/acp-schema.js`
   - `EXECUTION_TASK_MODES = ['FAILOVER_EXECUTE', 'BUILDER']`.
   - `VALID_ACTIVATION_SURFACES` is keyed by agent.
   - `validateActivationSyntax()` hard-codes `@kilo` and `@gemini-cli`.
2. `.github/workflows/main.yml`
   - issue_comment is explicitly restricted to `@gemini-cli` plus OWNER/MEMBER/COLLABORATOR.
   - plain `@gemini-cli` becomes REVIEW.
   - only a `FAILOVER_EXECUTE` keyword changes the mode.
3. `.github/workflows/gemini-builder.yml`
   - Builder is a separate agent-specific workflow_dispatch workflow.
4. `services/deepseek-runtime.js`
   - specialist routing hard-codes Gemini Reviewer → REVIEW, Gemini Builder → BUILDER, Kilo → FAILOVER_EXECUTE.
5. `services/transport-provider.js`
   - target-to-transport mapping is agent-specific, as expected for provider selection, but it is not currently paired with a generic external activation registry.
6. Kilo's external integration is partly outside the repository, so the provider prompt and trigger configuration are not fully enforceable from repository code.

## 4. Is EXECUTION_TASK_MODES too narrow?

**VERIFIED: Yes, for the stated recovery requirement.**

The name and behavior currently mean "modes that require activation metadata at ACP compliance time." That is narrower than the desired architectural concept of "task modes that may be independently activated through an approved recovery surface."

RESEARCH_DOCUMENT and VERIFY_RECONCILE are already consequential modes with write/commit/push capabilities and Director authorization requirements. Their absence from `EXECUTION_TASK_MODES` means the ACP schema does not require activation metadata for them, even though the recovery architecture requires a way to invoke those modes independently.

The correct generalization is not simply to append all modes to the existing array. It should replace the mode-only boolean concept with a server-side **external activation policy** that answers whether a given agent × mode × surface combination is authorized and what canonical activation requirements apply.

## 5. Target architecture

Use one generic external activation contract:

**External surface**
→ authenticate/identify actor and surface
→ parse a bounded activation envelope
→ resolve target agent + task mode against server-side agent/mode policy
→ derive capabilities + permitted paths + verification requirements server-side
→ verify Director authorization where required
→ construct canonical ACP command
→ `validateACPCompliance()`
→ TaskRegistry create/lineage/idempotency
→ existing dispatcher/transport
→ agent execution
→ existing evidence/reporting
→ existing verification/reconciliation.

The external envelope should carry **intent and correlation**, not authority. At minimum:

- activation_id / replay nonce
- surface identity
- actor identity / authenticated collaborator identity
- target agent
- task mode
- task/request body
- repository
- base branch
- parent_request_id when applicable
- Director authorization reference/provenance when required
- activation timestamp/expiry
- optional external source reference (issue number/comment id/workflow run id).

The server must derive:

- capabilities
- permitted_paths
- originator
- verification requirements
- authorization class
- provider transport
- workflow stage
- whether the combination is externally activatable.

The external text must never be able to add capabilities, paths, target authority, repository scope, or Director approval.

## 6. Safe activation of each mode

### REVIEW

Keep current plain `@gemini-cli` semantics intact. Normalize it into a canonical REVIEW activation envelope, then pass it through the same ACP validation/TaskRegistry path. This preserves the user-visible behavior while unifying the control plane.

### VERIFY_RECONCILE

Require an explicit mode marker in the activation envelope and a valid server-issued Director authorization reference bound to the exact task scope and mode. Derive the existing three documentation paths and four capabilities server-side. Require the normal predecessor/evidence/workflow-stage checks before accepting a verification or reconciliation activation. The external activation must create a TaskRegistry task whose workflow stage is verification or reconciliation, not execute documentation mutation directly from the workflow.

### RESEARCH_DOCUMENT

Require explicit RESEARCH_DOCUMENT activation plus Director authorization because the mode can modify and push. Derive the existing research/documentation path allow-list and exact four-capability set server-side. Require the task to be registered in TaskRegistry before the agent runs, with research persistence and TASK_LOG/RESEARCH_INDEX requirements remaining part of the existing task contract.

### FAILOVER_EXECUTE

Retain explicit FAILOVER_EXECUTE activation. The current Gemini keyword behavior can remain as a compatibility syntax, but the workflow should translate it into the generic activation envelope and then enter ACP/TaskRegistry. Kilo remains the canonical failover lane unless a separately authorized Gemini failover task targets Gemini.

### BUILDER

Retain Gemini Builder as the Builder lane and workflow_dispatch as an approved transport surface if desired. The workflow dispatch should be a transport invoked after ACP/TaskRegistry authorization, not itself an authority source. Direct workflow inputs should be rejected or ignored unless they correspond to a server-issued activation/task record.

## 7. Gemini Builder and Kilo recovery

Gemini Builder should have a registered policy entry such as:

- target: Gemini Builder
- authorized mode: BUILDER
- approved surfaces: workflow_dispatch and any separately approved recovery surface
- provider: gemini-builder workflow
- capabilities/paths: server-derived
- authorization: Director-required
- verification: Builder report + existing Reviewer verification.

Kilo should have a registered policy entry such as:

- target: Kilo
- authorized mode: FAILOVER_EXECUTE
- approved surfaces: the existing authenticated Kilo trigger plus an explicitly approved external recovery surface
- provider: Kilo external trigger
- capabilities/paths: server-derived
- authorization: Director-required
- verification: existing Kilo execution/evidence/verification flow.

A Kilo issue-body webhook can remain an external transport, but its candidate ACP text must be converted into the same canonical activation request and cannot become a second authorization mechanism.

## 8. Future-agent compatibility

Add a policy registry whose records are declarative:

`agent` → authorized modes → approved surfaces → provider transport → activation syntax → authorization class.

When a future agent is added, it receives external recovery automatically only for policy entries explicitly registered for that agent/mode/surface. No workflow-specific parser should decide authority.

The test suite should enumerate the registry and require a valid activation contract for every authorized combination marked recoverable.

## 9. Director authorization

Consequential external activation must reference a server-issued Director approval record or equivalent cryptographically bound provenance. The authorization must bind at minimum:

- request/activation identity
- target
- task mode
- repository
- base branch
- capabilities
- permitted paths
- verification requirements
- expiry
- issuer.

The existing `createDirectorApproval()` / `consumeDirectorApprovalAndCreateTask()` / scope-hash mechanism is the natural authority boundary. External activation should feed that mechanism rather than introduce a new "comment authorization" or "workflow authorization" system.

## 10. Actor/collaborator authorization

For GitHub issue/comment surfaces, GitHub's authenticated actor identity and association should be checked before accepting an activation. OWNER/MEMBER/COLLABORATOR is a useful existing baseline, but it is not a substitute for Director authorization on consequential work.

For workflow_dispatch, the triggering actor must be authenticated by GitHub and the workflow must not treat arbitrary input fields as authority. A workflow dispatch should reference an already-authorized task/activation identity and reject mismatches.

For Kilo provider webhooks, provider authentication and the external webhook secret remain transport authentication. ACP remains task authorization.

## 11. Replay and idempotency

Use a durable activation identity distinct from the human-readable task text. Recommended binding:

`activation_id = hash(surface, source_event_id, repository, target, task_mode, canonical_task_payload)`.

Persist the activation identity with the TaskRegistry task. Repeated delivery of the same activation returns the existing task/result instead of creating a second execution. A changed payload under an existing source-event identity must fail closed as a conflict.

Use source-specific identifiers where available: GitHub comment ID, issue ID + body revision, workflow dispatch run/reference, or provider invocation ID. Include expiry for authorization artifacts.

## 12. Malformed/unsupported activation behavior

All malformed, unsupported, ambiguous, expired, unauthorized, mismatched, replay-conflicting, or scope-expanding activations must fail closed before dispatch.

Examples:

- unknown agent → BLOCKED
- unauthorized agent/mode pair → BLOCKED
- mode not registered for external activation → BLOCKED
- unsupported surface → BLOCKED
- missing Director authorization where required → BLOCKED
- authorization scope hash mismatch → BLOCKED
- capabilities supplied by external text → ignore as authority and reject if they conflict with derived policy
- paths supplied by external text outside derived scope → BLOCKED
- duplicate activation identity → return existing task or deterministic duplicate result
- ambiguous task-mode syntax → BLOCKED.

## 13. TaskRegistry and lineage

Every externally activated task should enter TaskRegistry through the same creation function used by the internal coordinator path. The activation envelope becomes provenance metadata, not a second task authority.

The TaskRegistry entry should preserve:

- request_id
- parent_request_id
- current_agent
- task_mode
- workflow_stage
- capabilities
- permitted_paths
- activation provenance
- Director authorization proof
- source/surface identity.

This allows external recovery to remain inside the same parent/child lineage and evidence model.

## 14. Workflow-stage and predecessor controls

External activation must not bypass workflow-stage sequencing.

For VERIFY_RECONCILE, the server should require the authoritative predecessor and independent-verification evidence already required by `WORKFLOW_STEP_POLICY`.

For RESEARCH_DOCUMENT, the server should derive the research stage/contract and ensure the task is a legitimate research/documentation increment.

For FAILOVER_EXECUTE, the server should determine whether the activation is a new authorized task or recovery of an existing incomplete task. Recovery should bind to the existing request/lineage rather than create an unrelated replacement.

For BUILDER, the external activation should bind to the existing implementation task or a newly authorized implementation task and preserve the existing Builder → Reviewer → verification lifecycle.

## 15. Recovery scenarios

### DeepSeek unavailable

A GitHub or other approved external surface can still create an activation request. The request must enter the existing ACP/TaskRegistry path directly rather than depending on DeepSeek. This is the required recovery property.

### Gemini unavailable

Kilo can independently execute tasks only where Kilo is authorized for the requested task mode and an approved Kilo activation transport exists. Current canonical policy authorizes Kilo for FAILOVER_EXECUTE, so it can recover execution tasks of that mode. It cannot currently be treated as an authorized substitute for Gemini's REVIEW/VERIFY_RECONCILE/RESEARCH_DOCUMENT roles.

### Kilo unavailable

Gemini can independently execute modes for which Gemini is authorized, including REVIEW, VERIFY_RECONCILE, RESEARCH_DOCUMENT, and explicitly authorized FAILOVER_EXECUTE. The activation path still needs to reach Gemini without depending on DeepSeek.

### Gemini Builder unavailable

Another agent can recover only if it is separately authorized for BUILDER. Current canonical routing does not authorize Gemini Reviewer or Kilo as BUILDER. Therefore Builder replacement is currently a policy decision, not an automatic recovery capability.

## 16. Security risks and existing mitigations

Making more modes externally activatable increases exposure to:

- unauthorized actor activation
- capability/path escalation through external inputs
- forged Director authorization
- replay/duplicate execution
- workflow_dispatch input tampering
- issue-comment injection
- cross-agent confusion
- cross-repository or branch confusion
- bypass of predecessor/evidence requirements
- duplicate TaskRegistry lineage
- provider impersonation.

Existing mitigations include ACP schema validation, exact mode capabilities, mode path restrictions, capability hierarchy checks, server-derived authority, Director scope hashes/expiry/consumption, TaskRegistry duplicate request IDs, lineage validation, GitHub actor association checks in the Gemini workflow, provider secrets, and fail-closed validation.

The missing mitigation is **uniform ingress normalization through those controls before external execution**.

## 17. Required implementation surfaces

Generalize now:

1. ACP external-activation policy registry keyed by agent × mode × surface.
2. Canonical activation-envelope parser/validator.
3. Shared external-ingress adapter that constructs the canonical ACP command from server policy.
4. TaskRegistry activation provenance/idempotency fields.
5. Director authorization binding to activation identity and exact scope.
6. Shared dispatch entry that all external surfaces call.
7. Generic test matrix generated from the policy registry.
8. Gemini issue-comment compatibility adapter preserving plain REVIEW.
9. Gemini Builder workflow-dispatch adapter.
10. Kilo activation adapter at the existing Kilo transport boundary.
11. Fail-closed rejection of direct workflow inputs that lack a valid authorized TaskRegistry/activation reference.

Defer:

- adding external activation surfaces for agents that do not yet have a stable provider/transport;
- provider-specific UX syntax beyond the compatibility syntax required for current users;
- replacing GitHub issue comments, issue bodies, or workflow_dispatch with a new platform unless an existing surface cannot satisfy authentication/provenance requirements;
- changing task-mode capability sets themselves.

## 18. Required test matrix

The implementation must prove, for every registered agent × task-mode combination:

1. approved surface activates successfully;
2. unsupported surface is rejected;
3. unauthorized agent/mode pair is rejected;
4. mode derives the exact server-side capabilities;
5. mode derives the exact server-side permitted paths;
6. external input cannot add capabilities;
7. external input cannot add paths;
8. external input cannot change target;
9. external input cannot change repository/base branch;
10. missing/expired/mismatched Director authorization fails closed;
11. actor authorization is enforced;
12. replay is idempotent;
13. replay with changed payload conflicts;
14. TaskRegistry entry is created exactly once;
15. activation provenance is retained;
16. parent_request_id/lineage is preserved;
17. predecessor/workflow-stage controls are enforced;
18. execution uses the existing dispatcher/transport;
19. external path and coordinator path produce equivalent ACP authority;
20. normal plain `@gemini-cli` REVIEW remains unchanged.

Cross-product tests must cover Gemini, Gemini Builder, Kilo, and a synthetic future-agent registration. The future-agent test should prove that adding a policy record produces the activation contract without adding another agent-specific parser.

## 19. Central answer

**Can every currently authorized AI, and every future authorized AI, independently receive and execute every task mode it is authorized for through an approved external recovery surface without depending on another AI and without bypassing the existing ACP authority model?**

**VERIFIED: Not yet.**

The capability/authorization model is substantially in place. The recovery ingress is not generalized and is not yet uniformly attached to the ACP/TaskRegistry authority boundary. Gemini has a working agent-specific issue-comment recovery path for REVIEW and FAILOVER_EXECUTE, but that path directly invokes the Gemini workflow. Gemini Builder has workflow_dispatch transport, but the workflow itself is not the canonical authorization boundary. Kilo has the established external execution lane and ACP dispatch contract, but its provider boundary is partly external and its canonical current routing is FAILOVER_EXECUTE only.

The minimum architecture needed for a genuinely agent-independent recovery path is therefore **one generic external activation contract + one shared ACP/TaskRegistry ingress + an explicit agent × mode × surface policy registry**, while preserving all current server-derived authority, Director authorization, lineage, verification, and one-control-plane invariants.

## Repository evidence inspected

- `docs/ai/CHATGPT_START_HERE.md`
- `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md`
- `docs/ai/TASK_STANDARD.md`
- `docs/ai/STATE.md`
- `docs/ai/CONTROL_CENTER.md`
- `docs/ai/TASK_LOG.md`
- `docs/ai/ARCHITECTURE.md`
- `docs/ai/RESEARCH_INDEX.md`
- `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-TASK-MODE-CAPABILITY-ROUTING-RESEARCH-001.md`
- `poc/schemas/acp-schema.js`
- `poc/acp-engine.js`
- `services/deepseek-runtime.js`
- `services/transport-provider.js`
- `poc/gemini-trigger.js`
- `poc/gemini-builder-trigger.js`
- `poc/task-registry.js`
- `routes/poc.js`
- `.github/workflows/main.yml`
- `.github/workflows/gemini-builder.yml`
- `GEMINI.md`
- `AGENTS.md`
- `docs/ai/KILO_INTEGRATION.md`

No production implementation was changed by this research.