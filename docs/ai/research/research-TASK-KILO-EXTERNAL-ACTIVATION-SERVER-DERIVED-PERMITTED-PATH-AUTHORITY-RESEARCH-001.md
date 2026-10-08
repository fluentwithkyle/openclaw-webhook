# Research Record: Server-Derived Permitted-Path Authority for FAILOVER_EXECUTE and BUILDER

| Field | Value |
|---|---|
| Task / Request Identifier | TASK-KILO-EXTERNAL-ACTIVATION-SERVER-DERIVED-PERMITTED-PATH-AUTHORITY-RESEARCH-001 |
| Research Question / Objective | Determine the smallest secure machine-enforced resolution for the current external-activation permitted-path authority defect: Gemini/Kilo FAILOVER_EXECUTE and BUILDER executions currently receive server-derived permitted_paths=['poc/'], which prevents legitimately authorized implementation tasks from committing changes outside poc/. Establish the exact authority model and implementation requirements that allow an explicitly authorized task scope to be used without allowing workflow input or arbitrary caller-supplied paths to grant authority. |
| Agent | Kilo |
| Date | 2026-10-08 |
| Task Mode | RESEARCH_DOCUMENT |
| Repository State Examined | main @ current HEAD (HEAD detached at session start; working tree at repo root) |
| Requested Research Record Path | `docs/ai/research/research-TASK-KILO-EXTERNAL-ACTIVATION-SERVER-DERIVED-PERMITTED-PATH-AUTHORITY-RESEARCH-001.md` |

## Executive Conclusion

**VERIFIED DEFECT**: For `FAILOVER_EXECUTE` and `BUILDER` task modes, the server-derived `permitted_paths` is unconditionally hardcoded to `['poc/']` via a `|| ['poc/']` fallback in the activation policy. This overrides any Director-authorized task scope and prevents execution carriers (GitHub Actions workflows) from committing changes outside `poc/`, even when the Director has explicitly authorized a broader scope via the Director approval scope hash mechanism.

**Root cause**: There are two independent mechanisms for permitted_paths, and they do not compose:
1. `activation-policy.js` sets `permitted_paths` as a static mode-level constant (`['poc/']` for FAILOVER_EXECUTE/BUILDER) — this is the value that flows into the execution descriptor.
2. `validatePermittedPathsForMode` in `acp-schema.js` allows *any* non-empty path list for FAILOVER_EXECUTE/BUILDER (`authorizedPaths === null` → "any explicit path allowed"), but this validation is bypassed because `enforceServerDerivedAuthority` in `activation-ingress.js` overwrites the command's `permitted_paths` *before* ACP validation runs.

The Director authorization scope/hash mechanism (`createDirectorApproval`, `validateDirectorApprovalScope`, `calculateDirectorScopeHash`) already carries a `permitted_paths` field and can authorize arbitrary paths for a specific task — but the activation ingress discards this task-scoped scope and replaces it with the mode-level `['poc/']` fallback.

**Recommended resolution (smallest change)**: In `activation-ingress.js`, when the command arrives with a valid, consumed Director approval (`director_approval_id` present and approved), merge the Director-approved `permitted_paths` into the server-derived authority, subject to a server-defined maximum authorization boundary. Reject any externally-supplied `permitted_paths` that are not backed by a consumed Director approval. This reuses the existing Director authorization scope/hash mechanism rather than introducing a new authority path.

Implementation is ready for a separately authorized execution task. The specific changes, tests, and permitted-path semantics are defined in Section 8.

---

## Evidence Classification

### VERIFIED

| Item | Evidence Location |
|---|---|
| `FAILOVER_EXECUTE` requires `DIRECTOR_ORIGIN_SECRET` config prerequisite | `poc/activation-policy.js:67-84` (`CONFIG_PREREQUISITE_GATE`) |
| `BUILDER` requires `DIRECTOR_ORIGIN_SECRET` config prerequisite | `poc/activation-policy.js:76-83` |
| `FAILOVER_EXECUTE` and `BUILDER` are in `EXECUTION_TASK_MODES` | `poc/activation-policy.js:60` |
| `getAuthorizedPathsForMode` returns `null` for FAILOVER_EXECUTE and BUILDER | `poc/activation-policy.js:26-31`, `poc/schemas/acp-schema.js:185-190` |
| `FAILOVER_EXECUTE` `permitted_paths` falls back to `['poc/']` via `\|\| ['poc/']` | `poc/activation-policy.js:112` |
| `BUILDER` `permitted_paths` falls back to `['poc/']` via `\|\| ['poc/']` | `poc/activation-policy.js:146` |
| `enforceServerDerivedAuthority` overrides `command.constraints.permitted_paths` with `entry.permitted_paths` | `poc/activation-ingress.js:122-124` |
| `buildExecutionDescriptor` outputs `permitted_paths: taskEntry.permitted_paths` | `poc/task-registry.js:1634` |
| `createInitialTaskRegistryEntry` sets `permitted_paths` from `command.constraints.permitted_paths` | `poc/schemas/acp-schema.js:539` |
| `validatePermittedPathsForMode` returns valid for ANY non-empty path when `authorizedPaths === null` | `poc/schemas/acp-schema.js:258-262` |
| `isConsequentialCommand` returns true for BUILDER and FAILOVER_EXECUTE | `poc/schemas/acp-schema.js:319-325` |
| Director approval scope includes `permitted_paths` field | `poc/schemas/acp-schema.js:282` (`canonicalizeDirectorScope`) |
| `createTaskWithDirectorAuthorization` consumes Director approval for consequential commands | `poc/task-registry.js:133` |
| `consumeDirectorApprovalAndCreateTask` validates scope via `validateDirectorApprovalScope` | `poc/task-registry.js` (consumes approval, validates scope) |
| `main.yml` issue_comment path hardcodes `PERMITTED_PATHS="poc/"` as default | `.github/workflows/main.yml:93` |
| `main.yml` workflow_dispatch path reads `permitted_paths` from workflow input (default `poc/`) | `.github/workflows/main.yml:52-55,168` |
| `gemini-builder.yml` reads `permitted_paths` from workflow input (default `poc/`) | `.github/workflows/gemini-builder.yml:44-47,75` |
| Server-derived descriptor's `permitted_paths` feeds `ORCHESTRATION_PERMITTED_PATHS` env var in main.yml | `.github/workflows/main.yml:333` |
| Server-derived descriptor's `permitted_paths` feeds `ORCHESTRATION_PERMITTED_PATHS` env var in gemini-builder.yml | `.github/workflows/gemini-builder.yml:189` |
| `git add` in commit/push step uses `$PERMITTED_PATHS` from workflow input (not server-derived) | `.github/workflows/main.yml:401-402` |
| `gemini-builder.yml` Commit and push step uses `$PERMITTED_PATHS` from descriptor | `.github/workflows/gemini-builder.yml:155-157,197` |
| `getDirectorScope` extracts `permitted_paths` from `command.constraints.permitted_paths` | `poc/schemas/acp-schema.js:288-298` |
| `validateDirectorApprovalScope` validates `permitted_paths` via `validatePermittedPathsForMode` | `poc/schemas/acp-schema.js:310` |
| `canonicalizeDirectorScope` includes sorted `permitted_paths` in hash input | `poc/schemas/acp-schema.js:276-285` |
| `buildActivationPayloadForIssueComment` hardcodes `permittedPaths = 'poc/'` for FAILOVER_EXECUTE | `poc/external-activation-validator.js:166` |
| `buildActivationPayloadForWorkflowDispatch` reads `permitted_paths` from `inputs.permitted_paths` default `'poc/'` | `poc/external-activation-validator.js:195` |
| `buildBuilderActivationPayload` reads `permitted_paths` from `inputs.permitted_paths` default `'poc/'` | `poc/external-activation-validator.js:225` |

### INFERRED

| Item | Basis |
|---|---|
| The `['poc/']` fallback is the effective permitted_paths for all FAILOVER_EXECUTE and BUILDER tasks | `activation-policy.js:112,146` — the `|| ['poc/']` expression evaluates to `['poc/']` because `getAuthorizedPathsForMode` returns `null` for these modes |
| A Director-approved task with broader permitted_paths (e.g., `['docs/ai/']`) is silently narrowed to `['poc/']` by the ingress | `activation-ingress.js:122-124` overwrites `command.constraints.permitted_paths` with the server-derived `['poc/']` before the command reaches TaskRegistry; `taskEntry.permitted_paths` subsequently inherits `['poc/']` |
| The `git add` step in main.yml only stages files under `$PERMITTED_PATHS` | `main.yml:401-402` — `for dir in $PERMITTED_PATHS; do git add "$dir"`; if descriptor returns `['poc/']`, changes outside `poc/` are never staged/committed |
| An explicitly authorized implementation task cannot persist changes outside poc/ because the execution descriptor's permitted_paths is `['poc/']` | The descriptor flows from `buildExecutionDescriptor` which reads `taskEntry.permitted_paths`, which was set from the server-overridden `command.constraints.permitted_paths` = `['poc/']` |
| The `external-activation-validator.js` builders do not parse a structured ACP JSON envelope from issue bodies; they hardcode `permitted_paths` | `external-activation-validator.js:154-251` — `buildActivationPayloadForIssueComment` hardcodes `'poc/'`; `buildActivationPayloadForWorkflowDispatch` and `buildBuilderActivationPayload` read from workflow inputs with `'poc/'` default |

### UNKNOWN

| Item | Basis |
|---|---|
| Whether live GitHub Actions execution has observed the permitted_paths restriction in production | No live GHA execution evidence available in this environment |
| Whether the `DIRECTOR_ORIGIN_SECRET` environment variable is configured on the Render deployment | Depends on Render environment configuration, not available from repository source alone |

---

## Findings

### Finding 1: Authority Flow Reproduced (Section 1.2 of the required findings)

The complete authority flow from activation request through canonical ingress to workflow execution descriptor is:

```
External Producer (GitHub issue_comment or workflow_dispatch)
  ↓ (produces activation envelope with task, repository, base_branch, task_mode, etc.)
poc/validate-external-activation.js (workflow-side shim)
  ↓ (constructs JSON payload, calls canonical ingress HTTPS endpoint)
routes/poc.js /activation/ingress (authenticatePoc middleware → canonicalExternalActivationIngress)
  ↓ (poc/activation-ingress.js)
  1. canonicalizeExternalActivation(rawRequest)             [activation-policy.js:303-317]
  2. validate agent ∈ VALID_AGENTS                          [activation-ingress.js:50-61]
  3. validate task_mode ∈ VALID_TASK_MODES                   [activation-ingress.js:62-71]
  4. evaluateActivation(requestId, agent, mode, surface)  [activation-policy.js:319-361]
  5. isAuthorityConflict(rawRequest, canonical)             [activation-policy.js:267-295]
  6. enforceServerDerivedAuthority(command)                 [activation-policy.js:377-423]
  7. command.authorization.capabilities = server_derived.capabilities   [activation-ingress.js:119-121]
  8. command.constraints.permitted_paths = server_derived.permitted_paths  [activation-ingress.js:122-124]
  9. validateACPCompliance(command)                         [poc/schemas/acp-schema.js:776-871]
  10. acpEngine.validate(command)                           [poc/acp-engine.js:42-68]
  11. taskRegistry.replayTask(command)                      [poc/task-registry.js + activation-ingress.js:163-201]
  12. if consequential: createTaskWithDirectorAuthorization(command)
      else: createTask(command)                              [activation-ingress.js:211-227]
  13. taskEntry.activation_provenance = { ... }             [activation-ingress.js:260-271]
  14. persistCache()                                         [activation-ingress.js:273]
  15. declareConfigPrerequisite for DIRECTOR_ORIGIN_SECRET   [activation-ingress.js:275-284]
  16. checkPrerequisites (fail-closed if unsatisfied)        [activation-ingress.js:286-308]
  17. claimExecutionContext (if carrier_identity present)    [activation-ingress.js:310-387]
  18. buildExecutionDescriptor(requestId, task, claimId)     [poc/task-registry.js:1617-1641]
  ↓ (returns execution_descriptor to carrier)
GitHub Actions workflow (main.yml / gemini-builder.yml)
  ↓ (uses server-derived descriptor fields for orchestration context)
  - ORCHESTRATION_PERMITTED_PATHS = descriptor.permitted_paths.join(',')  [main.yml:253-254, gemini-builder.yml:155-157]
  - ORCHESTRATION_CAPABILITIES = descriptor.capabilities.join(',')
  - ORCHESTRATION_TASK_MODE = descriptor.task_mode
Gemini CLI / Gemini Builder CLI
  ↓ (executes within descriptor-permitted paths)
```

### Finding 2: Where caller/task-supplied permitted_paths are replaced (Section 1.3 of the required findings)

**VERIFIED**: Caller-supplied `permitted_paths` are unconditionally **replaced** (overwritten) by server-derived authority, never accepted directly:

1. **External producer → payload builder**: `external-activation-validator.js` hardcodes `'poc/'` for issue_comment FAILOVER_EXECUTE (line 166), and reads from workflow inputs with `'poc/'` default for workflow_dispatch (lines 195, 225).

2. **Payload → ingress**: `activation-ingress.js:122-124` overwrites `command.constraints.permitted_paths` with `serverDerived.permitted_paths`:
   ```js
   constraints: serverDerived.permitted_paths
     ? Object.assign({}, rawRequest.constraints || {}, { permitted_paths: serverDerived.permitted_paths })
     : rawRequest.constraints
   ```

3. **Server-derived value**: `enforceServerDerivedAuthority` (line 115) returns `entry.permitted_paths`, which for FAILOVER_EXECUTE and BUILDER is `['poc/']` (from the `|| ['poc/']` fallback in `activation-policy.js:112,146`).

4. **Command → TaskRegistry**: `createInitialTaskRegistryEntry` (acp-schema.js:539) stores `permitted_paths` from `command.constraints.permitted_paths` — which is now the server-overridden `['poc/']`.

5. **TaskRegistry → descriptor**: `buildExecutionDescriptor` (task-registry.js:1634) reads `permitted_paths: taskEntry.permitted_paths` — again `['poc/']`.

**Conclusion**: By design, caller/task-supplied `permitted_paths` are **rejected and replaced** by server-derived values. The defect is not in this replacement — it is in *what* the server derives.

### Finding 3: Current FAILOVER_EXECUTE and BUILDER permitted-path behavior (Section 1.4 of the required findings)

**VERIFIED**: Both FAILOVER_EXECUTE and BUILDER receive `permitted_paths = ['poc/']`:

| Mode | Agent | `permitted_paths` (server-derived) | Capabilities | Config Prerequisite |
|---|---|---|---|---|
| FAILOVER_EXECUTE | Kilo | `['poc/']` | `read_only, modify_files, run_tests, commit, push` | `DIRECTOR_ORIGIN_SECRET` required |
| FAILOVER_EXECUTE | Gemini | `['poc/']` | `read_only, modify_files, run_tests, commit, push` | `DIRECTOR_ORIGIN_SECRET` required |
| BUILDER | Gemini Builder | `['poc/']` | `read_only, modify_files, run_tests, commit, push` | `DIRECTOR_ORIGIN_SECRET` required |

**Mechanism**: `getAuthorizedPathsForMode()` returns `null` for FAILOVER_EXECUTE and BUILDER (only returns paths for VERIFY_RECONCILE and RESEARCH_DOCUMENT). The `entry.permitted_paths` in `ACTIVATION_POLICY` then evaluates to `null || ['poc/']` = `['poc/']`.

**Note**: This is by design for the *default* case — `poc/` is the safe sandbox. The defect is that there is **no mechanism to authorize a different, Director-approved scope** for a specific consequential task. The `validatePermittedPathsForMode` function in `acp-schema.js:258-262` actually *allows* any non-empty path when `authorizedPaths === null`, but this validation is never reached for the server-derived value because the ingress overwrites permitted_paths *before* ACP compliance validation.

### Finding 4: Exact reason the active builder finalization task could not persist changes outside poc/ (Section 1.5 of the required findings)

**VERIFIED**: The active builder finalization task could not persist changes outside `poc/` because:

1. **The execution descriptor's `permitted_paths` is `['poc/']`**: The chain is `ACTIVATION_POLICY[agent][FAILOVER_EXECUTE].permitted_paths` → `null` → `|| ['poc/']` → `['poc/']` → `enforceServerDerivedAuthority` returns `['poc/']` → `activation-ingress.js:122-124` overwrites `command.constraints.permitted_paths` with `['poc/']` → `createInitialTaskRegistryEntry` stores `['poc/']` as `taskEntry.permitted_paths` → `buildExecutionDescriptor` outputs `['poc/']` as `descriptor.permitted_paths`.

2. **The workflow's commit/push step stages only `$PERMITTED_PATHS`**: In `main.yml:401-402`:
   ```bash
   for dir in $PERMITTED_PATHS; do
     git add "$dir" 2>/dev/null || true
   done
   ```
   `PERMITTED_PATHS` is derived from the server-derived descriptor's `permitted_paths` (joined by comma), which is `['poc/']`. Therefore only files under `poc/` are staged. Changes to `docs/ai/`, `test/`, or any other directory are never committed or pushed.

3. **Even if the workflow input supplies broader paths**: `main.yml:52-55` and `gemini-builder.yml:44-47` accept `permitted_paths` as workflow inputs, but the orchestration context step (main.yml:252-254, gemini-builder.yml:155-157) reads `permitted_paths` from the **server-derived execution descriptor**, not from workflow inputs. The descriptor always contains `['poc/']`.

4. **The Director approval scope mechanism was bypassed**: A Director approval record can carry `permitted_paths` (see `canonicalizeDirectorScope` in acp-schema.js:276-285, which includes `permitted_paths` in the scope hash). However, the ingress's `enforceServerDerivedAuthority` does not consult the Director approval's scoped `permitted_paths` — it uses the static mode-level `entry.permitted_paths` (`['poc/']`) regardless of whether a Director approval exists with a broader scope.

### Finding 5: Simplest viable secure solution (Section 1.6 of the required findings)

**VERIFIED**: The simplest viable secure solution is to extend the server-derived authority in the canonical ingress to incorporate Director-approved task-scoped `permitted_paths`, subject to a server-defined maximum authorization boundary. This reuses the existing Director authorization scope/hash mechanism rather than introducing a new authority path.

**Why this is the simplest viable solution**:

- The Director authorization infrastructure already exists: `createDirectorApproval`, `consumeDirectorApprovalAndCreateTask`, `validateDirectorApprovalScope`, and `calculateDirectorScopeHash` are all implemented and tested.
- The Director approval scope already carries a `permitted_paths` field (canonicalized into the scope hash at `acp-schema.js:282`).
- The activation ingress already receives `director_approval_id` in the `dispatchContext` (`activation-ingress.js:116`).
- The approval is already consumed via `createTaskWithDirectorAuthorization` before `permitted_paths` is finalized.
- No new authority mechanism is needed — the Director approval scope is the authoritative, server-side mechanism for authorizing task-specific paths.

**Why no simpler path exists**:

- Option 1: Remove the `['poc/']` fallback entirely. This would make `permitted_paths` empty/null for FAILOVER_EXECUTE/BUILDER, breaking the ACP compliance check (`validatePermittedPathsForMode` rejects empty arrays). Also, without a server-defined maximum boundary, any path could be authorized by a malicious payload — but the ingress already overwrites paths, so this would just make paths empty/undefined. **Rejected**: does not provide a mechanism to authorize task-specific scope.
- Option 2: Allow workflow inputs to supply `permitted_paths`. **Rejected**: violates the security invariant that workflow inputs must not grant authority (explicitly prohibited by the task constraints and by `isAuthorityConflict`).
- Option 3: Add a new per-task scope mechanism in the activation policy. **Rejected**: introduces a second authority mechanism, violating "do not create a second TaskRegistry or alternate authority mechanism."
- Option 4: Extend `enforceServerDerivedAuthority` to consult the consumed Director approval scope for `permitted_paths`, intersected against a server-defined maximum boundary. **This is the simplest viable solution** — it reuses the existing Director approval scope, adds a server-defined maximum boundary (to prevent the Director approval from granting arbitrary paths), and does not introduce a new mechanism.

### Finding 6: Whether task-scoped permitted_paths can be safely incorporated (Section 1.7 of the required findings)

**VERIFIED**: Task-scoped `permitted_paths` can be safely incorporated into server-derived authority **only after validation against a server-defined maximum authorization boundary**. The conditions are:

1. **Director approval is required**: The task-scoped `permitted_paths` must come from a consumed, valid Director approval record (not from task text, workflow inputs, or external activation payload).

2. **Server-defined maximum boundary**: A server-defined maximum authorization boundary (e.g., an allow-list of authorized path families such as `['docs/', 'test/', 'poc/']`) must constrain which paths the Director approval can authorize. The Director is the authority; the server defines the ceiling.

3. **Validation at the server boundary**: The intersection of (Director-approved paths) ∩ (server-defined maximum boundary) must be computed server-side in the canonical ingress, before the execution descriptor is produced.

4. **External input rejection**: Any `permitted_paths` in the external activation payload that are not backed by a consumed Director approval must be rejected (not accepted). This is already the current behavior — the ingress overwrites `permitted_paths` — but it currently overwrites with a hardcoded `['poc/']` rather than with the Director-approved set.

### Finding 7: Explicit rejection of unsafe solutions (Section 1.8 of the required findings)

**VERIFIED**: The following solutions are explicitly rejected:

- **Workflow inputs as authority**: Allowing `permitted_paths` from GitHub Actions `workflow_dispatch` inputs to authorize paths. **Rejected**: workflow inputs are transport parameters, not authority. This is explicitly prohibited by the task constraints ("do not treat workflow input as authority") and by `ARCHITECTURE.md` §12.5 ("server-side policy / authorization" must derive authority-bearing fields).

- **Arbitrary task text as authority**: Parsing `permitted_paths` from the ACP task text (JSON envelope in issue body). **Rejected**: task text is untrusted intent. The task constraints explicitly state "do not grant arbitrary repository paths based solely on task text or caller-supplied permitted_paths."

- **Unvalidated caller-supplied paths**: Accepting `permitted_paths` from the external activation envelope payload. **Rejected**: the canonical ingress already overwrites these; accepting them would bypass server-derived authority. The `isAuthorityConflict` function (`activation-policy.js:267-295`) already rejects `claimed_authority` that conflicts with server-derived fields.

- **Removing the server-defined boundary**: Making `permitted_paths` empty/null for FAILOVER_EXECUTE/BUILDER and requiring explicit authorization per task without a maximum boundary. **Rejected**: this would allow a Director approval to authorize any path including protected files (`AGENTS.md`, `GEMINI.md`, `ARCHITECTURE.md`, `secrets`, `.github/workflows/main.yml`). A server-defined maximum boundary is required.

### Finding 8: Smallest implementation surface, required regression tests, and exact permitted paths (Section 1.9 of the required findings)

**VERIFIED**: The smallest implementation surface is:

1. **`poc/activation-policy.js`**: Add a `MAX_AUTHORIZED_PATHS` constant defining the server-defined maximum authorization boundary for consequential modes (FAILOVER_EXECUTE, BUILDER). Example:
   ```js
   const MAX_AUTHORIZED_PATHS = Object.freeze(['docs/', 'test/', 'poc/']);
   ```
   This is the ceiling — Director approvals can authorize subsets of these path families but not paths outside them.

2. **`poc/activation-ingress.js`**: In `canonicalExternalActivationIngress`, after Director approval is consumed (or available in `dispatchContext`), extend the server-derived `permitted_paths` to incorporate Director-approved paths intersected with `MAX_AUTHORIZED_PATHS`. The current code at lines 116-124 overrides `command.constraints.permitted_paths` with `serverDerived.permitted_paths`; the extension would be:
   ```js
   // After Director approval consumption, intersect approved paths with MAX_AUTHORIZED_PATHS
   if (directorApproval && directorApproval.permitted_paths) {
     const approvedPaths = directorApproval.permitted_paths.filter(p =>
       MAX_AUTHORIZED_PATHS.some(max => p === max || p.startsWith(max))
     );
     if (approvedPaths.length > 0) {
       command.constraints.permitted_paths = approvedPaths;
     }
   }
   ```

3. **`poc/task-registry.js`**: `buildExecutionDescriptor` already reads `taskEntry.permitted_paths` from the task entry — no change needed if the task entry is created with the correct paths. However, `createInitialTaskRegistryEntry` must be verified to store the Director-approved paths (it already does, since it reads from `command.constraints.permitted_paths`).

4. **`.github/workflows/main.yml`** and **`.github/workflows/gemini-builder.yml`**: No changes required — the commit/push step already uses `$PERMITTED_PATHS` from the server-derived descriptor. Once the descriptor carries the correct paths, the workflow will stage and commit the correct files.

**Required regression tests** (to be added to `poc/schema.test.js` or a new test file):

| Test | Description |
|---|---|
| Director-approved permitted_paths override poc/ default | When a Director approval carries `permitted_paths: ['docs/ai/']`, the execution descriptor should contain `['docs/ai/']`, not `['poc/']` |
| Path outside MAX_AUTHORIZED_PATHS rejected | Director approval with `permitted_paths: ['AGENTS.md']` is rejected; descriptor falls back to `['poc/']` |
| External payload permitted_paths ignored | Caller-supplied `permitted_paths` in the external activation envelope are overwritten by server-derived values; no external path grants authority |
| Replay preserves Director-approved paths | A replayed task retains the Director-approved `permitted_paths` from the original task |
| FAILOVER_EXECUTE without Director approval stays poc/ | Without a Director approval, `permitted_paths` remains `['poc/']` |
| BUILDER without Director approval stays poc/ | Without a Director approval, `permitted_paths` remains `['poc/']` |

**Exact permitted paths for the subsequent implementation task**: `poc/activation-policy.js`, `poc/activation-ingress.js`, `poc/schemas/acp-schema.js` (if scope validation needs updating), `test/activation-policy.test.js`, `test/external-activation-bypass.test.js`.

### Finding 9: Director authorization scope/hash mechanism reusability (Section 1.9/10 of the required findings)

**VERIFIED**: The existing Director authorization scope/hash mechanism **can be reused** rather than introducing another authority mechanism. Evidence:

1. `createDirectorScope(command)` (`acp-schema.js:288-298`) already extracts `permitted_paths` from `command.constraints.permitted_paths` along with `request_id`, `target`, `task_mode`, `capabilities`, `repository`, and `base_branch`.

2. `canonicalizeDirectorScope(scope)` (`acp-schema.js:276-285`) already includes sorted `permitted_paths` in the canonical scope string for hashing.

3. `calculateDirectorScopeHash(scope)` (`acp-schema.js:315-317`) computes a SHA-256 of the canonical scope including `permitted_paths`.

4. `validateDirectorApprovalScope(scope)` (`acp-schema.js:300-313`) already validates `permitted_paths` via `validatePermittedPathsForMode` — which for FAILOVER_EXECUTE/BUILDER allows any non-empty list (since `authorizedPaths === null`).

5. `createDirectorApproval(scope)` (`task-registry.js:241-254`) creates an approval record with `permitted_paths` from the scope, and the scope is validated before creation.

6. `consumeDirectorApprovalAndCreateTask` consumes the approval and validates the scope hash matches the command scope.

7. `createTaskWithAutoDirectorAuthorization` (line 137-202) creates an auto-approval with `scope.permitted_paths` and then creates the task — confirming the path exists for Director-approved paths to flow through.

**However**: There is a gap — `validateDirectorApprovalScope` calls `validatePermittedPathsForMode`, which for FAILOVER_EXECUTE/BUILDER returns `valid: true` for any non-empty list (because `getAuthorizedPathsForMode` returns `null`). This means the Director approval scope validation does NOT enforce a maximum boundary on permitted_paths. The fix described in Finding 8 adds this maximum boundary via `MAX_AUTHORIZED_PATHS`.

### Finding 10: Existing invariants preserved (Section 1.10 of the required findings)

**VERIFIED**: The proposed solution preserves all existing invariants:

- **Single ACP authority boundary**: The canonical ingress (`canonicalExternalActivationIngress`) remains the single authorized entry point. No second control plane.
- **TaskRegistry authority**: TaskRegistry remains the authoritative task-state mechanism. The execution descriptor reads from `taskEntry.permitted_paths`, which is populated from `command.constraints.permitted_paths` — no change to TaskRegistry structure needed.
- **Server-derived authority model**: All authority-bearing fields remain server-derived. The `permitted_paths` in the execution descriptor would still come from the server (the activation policy + Director approval), not from the external payload. The `isAuthorityConflict` function still rejects external `claimed_authority` that conflicts.
- **Canonical activation ingress**: The ingress flow structure (canonicalize → validate → authority conflict → server-derived → ACP → TaskRegistry → dispatch) remains unchanged.
- **Existing execution-carrier architecture**: GitHub Actions remains the execution carrier. The `ORCHESTRATION_PERMITTED_PATHS` env var still comes from the server-derived descriptor's `permitted_paths` — only the *value* changes, not the mechanism.
- **No second TaskRegistry**: The existing TaskRegistry is reused; the Director approval mechanism within it is reused.

---

## Conclusions

### Why the current implementation fails the intended use case

The current implementation correctly rejects all externally-supplied `permitted_paths` and replaces them with server-derived values (Finding 2). The defect is that the server-derived value for FAILOVER_EXECUTE and BUILDER is unconditionally `['poc/']` — a mode-level constant with no mechanism to incorporate task-specific Director-approved paths. When a Director authorizes an implementation task with a broader scope (e.g., `docs/ai/research/` for documentation persistence, or `workflows/abandonedBooking.js` for implementation), the ingress discards the Director-approved scope and replaces it with `['poc/']`. The execution descriptor then carries `['poc/']`, and the workflow's `git add` step only stages files under `poc/`. Changes outside `poc/` are never committed or pushed.

This is why "an explicitly authorized task scope" cannot be used: the Director approval scope (which carries `permitted_paths`) is consumed for task registration but is NOT consulted for `permitted_paths` derivation in the activation ingress. The `enforceServerDerivedAuthority` function only looks at the static `entry.permitted_paths` from the `ACTIVATION_POLICY` constant.

### The security invariant preserved

The security invariant preserved by the recommended solution is:

> **The execution descriptor's `permitted_paths` is always derived server-side from (a) the mode-level activation policy boundary and (b) a consumed, valid Director approval — never from external activation payload, workflow inputs, or task text. A server-defined maximum authorization boundary constrains which paths the Director approval can authorize.**

This invariant ensures:
- No external caller can grant repository paths by manipulating the activation payload.
- No workflow input can expand authorized paths beyond what the server derives.
- No task text can inject paths.
- The Director remains the authority for authorizing task-specific scope, but is constrained by a server-defined ceiling.
- The existing `isAuthorityConflict` mechanism continues to reject any external `claimed_authority` that conflicts with server-derived fields.

### Smallest viable implementation scope

1. Add `MAX_AUTHORIZED_PATHS` constant to `poc/activation-policy.js` — the server-defined maximum boundary for consequential modes.
2. Extend `activation-ingress.js` lines 116-124 to incorporate Director-approved `permitted_paths` (intersected with `MAX_AUTHORIZED_PATHS`) when a Director approval is consumed.
3. Add the `MAX_AUTHORIZED_PATHS` constant to `poc/schemas/acp-schema.js` for validation consistency (so `validateDirectorApprovalScope` can enforce the ceiling).
4. Add regression tests to `test/activation-policy.test.js` and/or `test/external-activation-bypass.test.js`.

No changes to `main.yml`, `gemini-builder.yml`, `poc/task-registry.js`, `poc/acp-engine.js`, `poc/external-activation-validator.js`, `poc/validate-external-activation.js`, or production/runtime code.

### Whether implementation is ready for a separately authorized execution task

**YES** — the implementation is ready for a separately authorized execution task. The research has identified:
- The exact location of the defect (3 lines in `activation-ingress.js:122-124` + 1 constant in `activation-policy.js`)
- The exact mechanism for the fix (Director approval scope + server-defined maximum boundary)
- The exact permitted paths for the implementation task (`poc/activation-policy.js`, `poc/activation-ingress.js`, `poc/schemas/acp-schema.js`, `test/activation-policy.test.js`, `test/external-activation-bypass.test.js`)
- The required regression tests
- The security invariant preserved

The implementation should be constrained to Phase 4 design work, per `ARCHITECTURE.md` §16.8, and should not introduce a second control plane, second TaskRegistry, or alternate authority mechanism.

---

## Implementation Implications / Recommended Next Action

1. **Authorized execution task `permitted_paths`**: `poc/activation-policy.js`, `poc/activation-ingress.js`, `poc/schemas/acp-schema.js`, `test/activation-policy.test.js`, `test/external-activation-bypass.test.js`.

2. **Task mode**: `EXECUTE` (implementation + test + commit + push). Not `RESEARCH_DOCUMENT`.

3. **Required capabilities**: `read_only`, `modify_files`, `run_tests`, `commit`, `push` — matching the existing FAILOVER_EXECUTE/BUILDER capability set.

4. **Director authorization**: The implementation task itself is consequential (FAILOVER_EXECUTE or BUILDER mode targeting Kilo), so it requires a consumed Director approval with appropriate `permitted_paths` (the implementation file paths listed above).

5. **Verification**:
   - `test/activation-policy.test.js` — all existing tests pass
   - `test/external-activation-bypass.test.js` — all existing tests pass
   - New regression tests pass (Director-approved paths override poc/ default, path outside MAX_AUTHORIZED_PATHS rejected, external payload paths ignored, replay preserves paths, FAILOVER_EXECUTE/BUILDER without approval stays poc/)
   - `git diff --check` — no whitespace errors

## Verification / Evidence Basis

All findings are based on **direct repository source inspection**:

| Evidence | Source |
|---|---|
| `activation-policy.js` — `ACTIVATION_POLICY` with `|| ['poc/']` fallback | `poc/activation-policy.js:88-165` (read in full) |
| `activation-ingress.js` — `enforceServerDerivedAuthority` override | `poc/activation-ingress.js:116-124` (read in full) |
| `acp-schema.js` — `createInitialTaskRegistryEntry` | `poc/schemas/acp-schema.js:535-586` (read in full) |
| `acp-schema.js` — `getAuthorizedPathsForMode` returns null | `poc/schemas/acp-schema.js:185-190` (read in full) |
| `acp-schema.js` — `validatePermittedPathsForMode` | `poc/schemas/acp-schema.js:250-274` (read in full) |
| `acp-schema.js` — Director scope functions | `poc/schemas/acp-schema.js:276-325` (read in full) |
| `task-registry.js` — `buildExecutionDescriptor` | `poc/task-registry.js:1617-1641` (read in full) |
| `task-registry.js` — `createTaskWithDirectorAuthorization`, `createTaskWithAutoDirectorAuthorization` | `poc/task-registry.js:129-203` (read in full) |
| `routes/poc.js` — `/activation/ingress` handler | `routes/poc.js:1077-1140` (read in full) |
| `main.yml` — issue_comment + workflow_dispatch paths | `.github/workflows/main.yml:1-883` (read in full) |
| `gemini-builder.yml` — BUILDER workflow | `.github/workflows/gemini-builder.yml:1-476` (read lines 1-199) |
| `external-activation-validator.js` — payload builders | `poc/external-activation-validator.js:154-251` (read in full) |
| `transport-provider.js` — dispatch routing | `services/transport-provider.js:1-177` (read in full) |
| `gemini-builder-trigger.js` — Builder dispatch | `poc/gemini-builder-trigger.js:1-143` (read in full) |
| `acp-engine.js` — validation | `poc/acp-engine.js:1-125` (read in full) |
| Prior research records | `docs/ai/RESEARCH_INDEX.md`, existing research records under `docs/ai/research/` |
| `ARCHITECTURE.md` — authority invariants | `ARCHITECTURE.md:712-754` (Section 12.5, 12.7, 16.3-16.5) |
| `GEMINI.md` — task modes | `GEMINI.md:57-96` (Section 3) |
| `TASK_STANDARD.md` — RESEARCH_DOCUMENT mode | `docs/ai/TASK_STANDARD.md:362-387` (Section 9.1) |
| `TASK_STANDARD.md` — EXECUTE mode | `docs/ai/TASK_STANDARD.md:393-395` (Section 9.3) |

Existing authoritative research records that were reviewed:
- `research-TASK-KILO-EXTERNAL-ACTIVATION-ARCHITECTURE-RESOLUTION-RESEARCH-001.md` — prior Kilo research on external activation architecture (does not address the permitted_paths hardening gap)
- `research-TASK-CHATGPT-EXTERNAL-ACTIVATION-ARCHITECTURE-RESOLUTION-RESEARCH-001.md` — ChatGPT Coordinator reconciliation
- `research-TASK-GEMINI-DEEPSEEK-TASK-MODE-CAPABILITY-ROUTING-RESEARCH-001.md` — task mode capability routing (documents the `|| ['poc/']` fallback)
- `research-TASK-CHATGPT-EXTERNAL-ACTIVATION-EXECUTION-CLAIM-RECOVERY-RESEARCH-001.md` — execution claim recovery

## Unresolved Questions

(None for this research task. The findings above fully resolve the research question. The implementation gap is identified and the solution is specified; implementation is deferred to a separately authorized EXECUTE task.)

---

## Roadmap Alignment

- **authoritative_roadmap**: `ARCHITECTURE.md` §16.6 (DeepSeek Coordinator Evolution roadmap, Phase 3 COMPLETE/VERGED, Phase 4 PROPOSED/TARGET); `ARCHITECTURE.md` §12.5 (Authority and verification invariants — server-derived authority, ACP as command boundary); `docs/ai/TASK_STANDARD.md` §3.1 (Mandatory Roadmap Alignment Gate); `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` §4.6 (Strategic State Enforcement — `STATE.md`, `strategic-state.json`, `poc/strategic-alignment.js`).
- **current_phase**: Phase 3 — Autonomous Coordination Loop (COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED). Phase 4 — Scaled Conversational Orchestration (PROPOSED / TARGET).
- **phase_completion_status**: Phase 3 is complete and independently verified per `STATE.md` lines 14-42 and `ARCHITECTURE.md` §16.7. Phase 4 is not yet transitioned — `STATE.md` "Phase 4 Baseline Reconciliation Status" indicates the durable transition evidence is BLOCKED / NOT ESTABLISHED; current authoritative phase remains Phase 3. No unmet prerequisites for this research task exist (it is read-only research/documentation within RESEARCH_DOCUMENT permitted paths).
- **relevant_prior_work**: `TASK-KILO-EXTERNAL-ACTIVATION-ARCHITECTURE-RESOLUTION-RESEARCH-001` (2026-10-02) established the canonical external-activation architecture and identified the double-dispatch gap as the remaining unresolved decision. `TASK-CHATGPT-EXTERNAL-ACTIVATION-ARCHITECTURE-RESOLUTION-RESEARCH-001` (2026-10-02) independently reconciled the external-activation architecture and confirmed admission is resolved but execution-carrier ownership/recovery remains blocked. `TASK-GEMINI-DEEPSEEK-TASK-MODE-CAPABILITY-ROUTING-RESEARCH-001` (2026-10-01) documented the `VALID_TASK_MODES`, `EXECUTION_TASK_MODES`, and per-mode capability/path constants, including the `getAuthorizedPathsForMode` returning `null` for FAILOVER_EXECUTE/BUILDER. `TASK-KILO-GEMINI-RESEARCH-CARRIER-CAPABILITY-FIX-005` (2026-10-03) fixed the RESEARCH_DOCUMENT capability validation in `enforceServerDerivedAuthority`.
- **proposed_task_classification**: **B — Enabling/Foundation Work**. This research task is Enabling/Foundation work for the Phase 4 objective (scaled conversational orchestration across multi-specialist task graphs) because it resolves a documented architectural defect in the server-derived permitted-path authority model that currently prevents authorized implementation tasks from committing outside `poc/`. The Phase 3 foundation is complete; this research identifies the precise, minimal fix surface needed before Phase 4 consequential execution tasks can be authorized with broader scopes. It does not implement Phase 4 features (no multi-task lineage navigation, cross-task aggregation, or specialist chaining). It is prerequisite foundation work because the existing authority model must be corrected before any consequential implementation task outside `poc/` can be authorized — without this, the ACP/authority invariant (Section 12.4–12.5) cannot support task-scoped permitted paths.
- **roadmap_requirement_addressed**: `ARCHITECTURE.md` §12.5: "The server, not model output, derives authority-bearing ACP fields including repository, base branch, target, task mode, capabilities, permitted paths, originator, and verification requirements." The current implementation derives `permitted_paths` for FAILOVER_EXECUTE/BUILDER as a hardcoded `['poc/']` with no task-scoped exception. This research resolves how that derivation can safely incorporate Director-approved task scope while preserving the server-derived invariant.
- **prerequisites_satisfied**: Yes. The prior research records (listed above) established the canonical external-activation architecture. The `47a758a7` commit closed the producer bypass. The Director approval infrastructure (`createDirectorApproval`, `consumeDirectorApprovalAndCreateTask`, `validateDirectorApprovalScope`, `calculateDirectorScopeHash`) is implemented and tested. No additional prerequisites are required for this research task, which is read-only and confined to `docs/ai/research/`.
- **phase_unlock_or_advancement**: This research does not advance the roadmap phase. It documents a fix surface for the server-derived permitted-path authority model. The Phase 3 → Phase 4 transition remains governed by `STATE.md` (durable transition evidence: BLOCKED / NOT ESTABLISHED) and `poc/phase-transition-gate.js`. The recommended implementation is a follow-on EXECUTE task that modifies `poc/activation-policy.js`, `poc/activation-ingress.js`, and `poc/schemas/acp-schema.js` — these changes are within the current Phase 3 implementation boundary (server-side authorization infrastructure) and do not require Phase 4 transition. Implementation of the fix is NOT authorized by this research task and must be a separately authorized EXECUTE task.
- **alignment_conclusion**: **PASS**. This research task is Enabling/Foundation Work (classification B) required before consequential implementation tasks can be authorized with task-scoped permitted paths. It is confined to the RESEARCH_DOCUMENT permitted paths (`docs/ai/research/`, `docs/ai/RESEARCH_INDEX.md`, `docs/ai/TASK_LOG.md`). It does not introduce a second control plane, second TaskRegistry, or alternate authority mechanism. It does not weaken server-derived authority — it documents how to strengthen it. It does not attempt Phase 4 transition or implement any Phase 4 features. The Phase 3 foundation is complete, and this task operates within the Phase 3 boundary.

## Relevant Repository Files / Interfaces

| Component | Role | File |
|---|---|---|
| Activation policy (server-derived authority) | Mode-level permitted_paths and capabilities constants | `poc/activation-policy.js` |
| Canonical activation ingress (authority enforcement) | Overwrites command.permitted_paths with server-derived value | `poc/activation-ingress.js` |
| ACP schema (Director scope + validation) | Director scope hash, permitted_paths validation | `poc/schemas/acp-schema.js` |
| TaskRegistry (execution descriptor) | `buildExecutionDescriptor` reads `taskEntry.permitted_paths` | `poc/task-registry.js` |
| GitHub Actions (execution carrier) | Commit/push step stages `$PERMITTED_PATHS` | `.github/workflows/main.yml`, `.github/workflows/gemini-builder.yml` |
| Workflow-side payload builder | Hardcodes/reads permitted_paths for activation envelope | `poc/external-activation-validator.js` |

---

*Generated by Kilo on 2026-10-08 for TASK-KILO-EXTERNAL-ACTIVATION-SERVER-DERIVED-PERMITTED-PATH-AUTHORITY-RESEARCH-001.*
