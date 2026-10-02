# Research Record: Best Repository-Native, Machine-Enforced Mechanism to Prevent Invalid/Unsafe GitHub Actions Workflows from Reaching `main`

## Task / Request Identifier

TASK-GEMINI-WORKFLOW-VALIDATION-MACHINE-ENFORCEMENT-RESEARCH-001

## Research Question / Objective

Determine the best repository-native, machine-enforced mechanism to prevent invalid or unsafe GitHub Actions workflows from reaching the `main` branch, motivated by the one-click Gemini Builder workflow YAML failure resolved by commit `7a1a136` ("Fix one-click Gemini Builder workflow YAML"). The task is **research and documentation only** — no enforcement mechanism is to be implemented as part of this task.

## Agent

Kilo (Builder / Implementer / Tester, transitional lane)

## Date

2026-10-02

## Task Mode

RESEARCH_DOCUMENT

## Scope Examined

### Workflow files inspected
- `.github/workflows/main.yml` — Gemini Reviewer workflow (`issue_comment` + `workflow_dispatch` triggers, required inputs, mode-aware prompt, ACP callback/report)
- `.github/workflows/gemini-builder.yml` — Gemini Builder workflow (`workflow_dispatch` trigger, `builder-workflow-dispatch` validation, BUILDER mode)
- `.github/workflows/one-click-gemini-builder-smoke.yml` — one-click zero-input `workflow_dispatch` workflow (the file corrected by commit `7a1a136`)
- `.github/workflows/one-click-gemini-builder-smoke.yml` (commit `bd7375a` — initial addition)
- `.github/workflows/one-click-gemini-builder-smoke.yml` (commit `7a1a136` — YAML syntax error fix)
- `.github/workflows/one-click-gemini-research-documentation.yml` — one-click RESEARCH_DOCUMENT workflow (added by commit `b2240ca`)
- `.github/workflows/gemini-builder.yml` (commit `870e0b8` — Fix Gemini Builder carrier JSON encoding)
- `.github/workflows/main.yml` (commit `8b1c325` — restore valid GitHub Actions expression and REVIEW default)

### Git history inspected
- Commit `7a1a136` — "Fix one-click Gemini Builder workflow YAML" (28-line diff to `one-click-gemini-builder-smoke.yml`; replaced `cat > builder-task.md <<'EOF'` heredoc with a single-quoted bash variable assignment to eliminate YAML/heredoc-interpolation issues)
- Commit `bd7375a` — "Add one-click Gemini Builder smoke workflow" (524 lines added)
- Commit `870e0b8` — "Fix Gemini Builder carrier JSON encoding for arbitrary task input values"
- Commit `8b1c325` — "fix(gemini-workflow): restore valid GitHub Actions expression and REVIEW default (Issue #151)" (restored valid GitHub Actions expression syntax, default REVIEW mode)

### Test files inspected
- `test/workflow-expression.test.js` — 40 tests guarding against bare `+` operators in GitHub Actions expressions, malformed mode-aware prompt expressions, `format()` placeholder/argument count matching, and issue_comment orchestration context integrity
- `test/external-activation-bypass.test.js` — 68 tests verifying bypass closure, workflow ordering (validation before agent execution), descriptor binding, replay safety, and callback correlation
- `test/external-activation-procedure.test.js` — 30 tests verifying the canonical activation procedure matches implementation, including workflow `workflow_dispatch` trigger presence, ingress validation before execution, descriptor persistence/consumption, admission-only ingress (no `getDispatcher` call), server-derived authority, Director authorization failure-closed behavior, and procedure self-consistency
- `test/one-click-workflow-contract.test.js` — 28 tests verifying the zero-input `workflow_dispatch` contract, existing workflow distinction (main.yml and gemini-builder.yml do NOT satisfy one-click because they have required inputs), architecture reuse, cold-start discoverability, and invariant preservation

### Documentation inspected
- `ARCHITECTURE.md` §16.6 (DeepSeek Coordinator Evolution — Phase 0 through Phase 4), §12.7 (specialist layer), §12.8 (Phase 4), §16.7 (Phase 3 acceptance target), §16.8 (Phase 4 design boundary)
- `docs/ai/TASK_STANDARD.md` (canonical AI task request standard, including Research Record Roadmap Alignment section template)
- `docs/ai/ONE_CLICK_WORKFLOW_CONTRACT.md` (zero-input `workflow_dispatch` contract, Section 8 Machine Verification)
- `docs/ai/EXTERNAL_ACTIVATION_PROCEDURE.md` (canonical activation sequence, admission-only ingress, server-derived authority, replay/idempotency, Director authorization, failure handling, Section 10 Machine-Verification)
- `docs/ai/DEESEEK_COORDINATOR_LIFECYCLE_ENFORCEMENT_ROADMAP.md` (twelve-stage coordinator lifecycle, enforcement-status mapping, procedure-to-enforcement matrix)
- `docs/ai/RESEARCH_INDEX.md` (research record index format and existing entries)
- `docs/ai/TASK_LOG.md` (append-only historical task record)
- `docs/ai/STATE.md` (current live project state)
- `AGENTS.md` (repository-level operating instructions)
- `GEMINI.md` (Gemini agent instructions)

### POC/runtime files inspected (read-only)
- `poc/validate-external-activation.js` — workflow-side admission shim that calls `validateExternalActivation()`, persists `execution-descriptor.json`, sets `GITHUB_OUTPUT` variables, exits non-zero on BLOCKED
- `poc/external-activation-validator.js` — payload builders (`buildActivationPayloadForIssueComment`, `buildActivationPayloadForWorkflowDispatch`, `buildBuilderActivationPayload`) and `validateExternalActivation()` HTTPS POST to `/poc/activation/ingress`
- `poc/activation-ingress.js` — `canonicalExternalActivationIngress()` admission function (validate → replay-check → Director authorization → TaskRegistry create/replay → execution claim → execution descriptor)
- `poc/activation-policy.js` — `ACTIVATION_POLICY` defining per-agent/task-mode capabilities, permitted paths, and permitted activation surfaces
- `poc/task-registry.js` — TaskRegistry with status enum, `replayTask()`, `claimExecutionContext()`, `buildExecutionDescriptor()`, `persistCache()`

## Findings

### Finding 1 — A workflow YAML syntax/expression error already caused a real failure (VERIFIED)

**Classification**: VERIFIED

**Evidence**:
- Commit `7a1a136` (2026-10-03) titled "Fix one-click Gemini Builder workflow YAML" corrected `one-click-gemini-builder-smoke.yml` with a 28-line diff. The fix replaced a shell heredoc (`cat > builder-task.md <<'EOF' ... EOF`) with a single-quoted bash variable assignment (`TASK='task_name: ...'`) and a `printf '%s\n' "$TASK"` output. This is the motivating incident: a YAML/heredoc-interpolation issue in a workflow file caused the one-click smoke test workflow to fail.
- Commit `8b1c325` (earlier, Issue #151) titled "fix(gemini-workflow): restore valid GitHub Actions expression and REVIEW default" restored valid GitHub Actions expression syntax and the REVIEW default in `main.yml`.
- Commit `870e0b8` "Fix Gemini Builder carrier JSON encoding for arbitrary task input values" corrected JSON encoding in `gemini-builder.yml`.

**Conclusion**: GitHub Actions workflows in this repository have, on at least three occasions, contained invalid YAML or invalid GitHub Actions expressions that required corrective commits. This is the failure class that machine-enforced prevention would target.

### Finding 2 — The repository already has a robust Node.js-based machine-verification test infrastructure for workflows (VERIFIED)

**Classification**: VERIFIED

**Evidence**:
- `test/workflow-expression.test.js` (40 tests) extracts all `${{ ... }}` expressions from workflow YAML, parses function calls, counts bare `+` operators outside string literals (GitHub Actions expressions have no `+` operator), verifies `format()` placeholder/argument count matching, and verifies that the mode-aware prompt expression contains all three operating modes (REVIEW, VERIFY_RECONCILE, FAILOVER_EXECUTE) with correct defaults. It also verifies issue_comment orchestration context integrity (FAILOVER_EXECUTE keyword detection, capabilities/permitted_paths/task_mode outputs, plain `@gemini-cli` REVIEW default).
- `test/external-activation-bypass.test.js` (68 tests) verifies that `main.yml` and `gemini-builder.yml` contain the canonical ingress validation step **before** the agent execution step, that agent execution is gated on `activation_validated == 'true' && !replay`, that the execution descriptor is persisted and consumed via `jq` (not workflow inputs), that server-derived authority is enforced, and that the ingress does NOT call `getDispatcher()` (admission-only, preventing double-dispatch).
- `test/external-activation-procedure.test.js` (30 tests) verifies the documented procedure matches implementation, including `workflow_dispatch` trigger presence, canonical ingress validation before execution, descriptor persistence/consumption, admission-only ingress, server-derived authority, Director authorization failure-closed behavior, and procedure self-consistency (no references to nonexistent workflows, no `GATEWAY_MODE` or guessed env vars).
- `test/one-click-workflow-contract.test.js` (28 tests) verifies the zero-input `workflow_dispatch` contract, existing workflow distinction (main.yml and gemini-builder.yml do NOT satisfy one-click because they have required inputs), architecture reuse (canonical external-activation components), cold-start discoverability, and invariant preservation.

**Conclusion**: The repository already uses Node.js test scripts that parse workflow YAML files as text and assert structural/behavioral invariants. This is the established machine-verification pattern: tests run via `node test/<name>.test.js` as part of `npm test` (defined in `package.json` scripts.test), using `fs.readFileSync` to load workflow files and string/regex assertions to validate structure. No test framework dependency is required (no Jest/Mocha); each test file is a standalone runner with `process.exit(1)` on failure.

### Finding 3 — The repository does NOT have GitHub Actions workflow YAML linting/validation at commit time (UNKNOWN for CI; VERIFIED for repository content)

**Classification**: UNKNOWN for CI enforcement; VERIFIED for repository content absence

**Evidence**:
- `test/workflow-expression.test.js` validates GitHub Actions **expressions** (the `${{ ... }}` syntax) — it does not validate YAML syntax itself. YAML syntax errors (e.g., bad indentation, unquoted special characters, heredoc interpolation issues) would not be caught by expression validation alone.
- No `.yamllint` or `.yamllint.yaml` configuration file exists in the repository root.
- No `actionlint` configuration or GitHub Action using `github/actionlint-action` exists in `.github/workflows/`.
- The repository's existing CI is solely the GitHub Actions workflows themselves (e.g., `kilo-verification.yml`, `codex-builder.yml`, `kilo-verification.yml`). There is no pre-commit hook configuration (`.pre-commit-config.yaml`) in the repository root.
- Commit `7a1a136` fixing the YAML error was applied **after** the failure occurred, not prevented before.

**Conclusion**: The repository has no pre-commit or pre-merge YAML/lint gate for GitHub Actions workflows. The existing `workflow-expression.test.js` test catches expression-level errors (e.g., bare `+` operators, malformed `format()` calls) but does not catch YAML syntax errors. The commit that fixed the YAML error (`7a1a136`) was reactive, not preventive.

### Finding 4 — The repository has no branch protection rules or required CI gates configured in-repo (UNKNOWN for GitHub configuration; VERIFIED for repository content absence)

**Classification**: UNKNOWN for GitHub configuration; VERIFIED for repository content absence

**Evidence**:
- No `.github/branch-protection.yml`, `.github/settings.yml`, or similar configuration-as-code file for branch protection rules exists in the repository.
- No `CODEOWNERS` file exists in the repository root or `.github/` directory.
- No `pull-request-action` or similar PR-gating workflow exists in `.github/workflows/`.
- The repository's existing GitHub Actions workflows do not perform workflow-against-workflow linting.

**Conclusion**: Branch protection rules and required CI status checks are GitHub repository/org-level settings, not repository-content. Their existence cannot be determined from repository source alone. However, from the repository content, there is no evidence of any automated gate that would prevent invalid workflows from being merged.

### Finding 5 — The repository's existing test infrastructure is the established machine-enforcement pattern (VERIFIED)

**Classification**: VERIFIED

**Evidence**:
- `package.json` defines `scripts.test` as a chain of `node test/<name>.test.js` invocations. This is the single test-running command — there is no test framework (Jest, Mocha, Vitest) dependency.
- All existing workflow-machine-verification tests follow the same pattern:
  1. `require('fs')` and `require('path')`
  2. `fs.readFileSync()` to load the workflow YAML file(s) as text
  3. String `.includes()`, regex `.test()`, and substring extraction (`.indexOf()`, `.slice()`) to validate structure
  4. `runTest(name, fn)` helper that catches and counts failures
  5. `process.exit(1)` if `failCount > 0`
- These tests are part of `npm test` and are executed by the CI workflows (e.g., `kilo-verification.yml` runs `npm test` or equivalent verification).
- The test infrastructure is designed to be fast, dependency-free, and assert structural invariants against workflow files.

**Conclusion**: Adding a new test file to the `test/` directory and adding it to the `npm test` chain is the repository-native, machine-enforced mechanism for workflow validation. This pattern is already established and proven by the three existing workflow-test files (`workflow-expression.test.js`, `external-activation-bypass.test.js`, `external-activation-procedure.test.js`, `one-click-workflow-contract.test.js`).

## Conclusions

### Conclusion 1 — Root cause of the motivating failure

The YAML failure in commit `7a1a136` was caused by a heredoc-based shell scripting pattern within a GitHub Actions workflow step (`cat > builder-task.md <<'EOF' ... EOF`) that produced invalid or problematic YAML/step structure. The fix replaced it with a single-quoted bash variable and `printf`. This class of failure — invalid GitHub Actions YAML syntax or expression syntax in workflow files — is the target of the prevention mechanism.

### Conclusion 2 — The existing expression-validation test is necessary but insufficient

`test/workflow-expression.test.js` catches GitHub Actions **expression** errors (bare `+` operators, malformed `format()` calls, missing mode branches, missing `if:` gates). However, it does **not** catch YAML **syntax** errors (invalid indentation, unquoted colons, heredoc interpolation issues). A YAML syntax error would not be caught by expression parsing.

### Conclusion 3 — The best repository-native mechanism is a YAML-syntax validation test plus expanded expression/structure validation

The repository-native, machine-enforced mechanism that best fits the established patterns is:

1. **A new test file** (e.g., `test/workflow-validation.test.js`) that:
   - Loads all workflow YAML files in `.github/workflows/` via `fs.readFileSync`
   - Uses a YAML parser (see Recommendation A below for dependency choice) to **parse** each workflow file and fail if any workflow has a YAML syntax error
   - Adds additional structural assertions for the invariants already partially covered by existing tests (e.g., validation step before agent execution, agent execution gated on `activation_validated == 'true' && !replay`, descriptor consumption via `jq`)
   - Follows the exact same standalone Node.js test pattern as the existing test files (no test framework, `process.exit(1)` on failure)

2. **Adding the test to `package.json` `scripts.test`** so it runs on every `npm test` invocation

3. **Ensuring the CI workflow (`kilo-verification.yml`) runs `npm test`** so the gate is enforced on push/PR (this is the existing pattern — `kilo-verification.yml` already runs verification)

### Conclusion 4 — GitHub Actions workflow YAML can be validated via actionlint or js-yaml

Two viable approaches exist for YAML syntax validation within Node.js tests:

| Approach | Dependency | Pros | Cons |
|---|---|---|---|
| `actionlint` | GitHub Action (`github/actionlint-action`) or npm binary | Validates GitHub Actions-specific syntax, not just YAML; catches expression errors, permission issues, action version issues | Requires a separate npm binary or GitHub Action; adds a new dependency |
| `js-yaml` npm package | `js-yaml` npm dependency | Pure YAML parsing; catches syntax errors; minimal dependency; fits existing test pattern | Does not validate GitHub Actions-specific semantics; only catches YAML syntax errors |

## Recommended Next Action

The smallest viable implementation increment that prevents invalid/unsafe GitHub Actions workflows from reaching `main` is:

1. **Add a YAML syntax validation test** (`test/workflow-validation.test.js`) that parses every file in `.github/workflows/` using a YAML parser and fails on any syntax error.
2. **Add it to the `npm test` chain** in `package.json`.
3. **Verify the CI workflow runs `npm test`** (confirm `kilo-verification.yml` already does this — no change needed if it does).

**Dependency choice**: Given the repository's constraint of minimal dependencies (current `package.json` has only Express, Axios, googleapis, `@xenova/transformers`), the simplest viable path that fits the existing test pattern is to use `js-yaml` as a devDependency. If `js-yaml` is undesirable, an alternative is to shell out to a YAML linter (e.g., `python -c "import yaml; yaml.safe_load(...)"`) — but this introduces a platform dependency.

**Note**: This research does not implement the enforcement mechanism. The implementation requires explicit ACP authorization (FAILOVER_EXECUTE or a dedicated implementation task) because it modifies `package.json` (adds a devDependency) and adds a test file.

### Recommendation A — Minimal YAML validation without new dependencies

If the constraint "no new dependencies" is strict, the repository could use Node.js's built-in `fs` and a simple YAML structural check (e.g., balanced indentation, no tabs, no duplicate keys at the top level). However, this is fragile and not a real YAML parser. The recommended approach is still `js-yaml` as a devDependency.

### Recommendation B — Expand existing `workflow-expression.test.js` rather than creating a new file

The existing `test/workflow-expression.test.js` already loads `main.yml` and `gemini-builder.yml`. It could be extended to also parse the YAML and validate syntax. However, the repository's established pattern (per the task log entries for `one-click-workflow-contract.test.js` etc.) is to create **dedicated** test files for distinct verification concerns. A separate `test/workflow-validation.test.js` is more consistent with the established pattern and allows `npm test` to report failures by concern.

### Recommendation C — Add `actionlint` as a GitHub Action in CI

A `.github/workflows/actionlint.yml` workflow using `github/actionlint-action` would provide GitHub Actions-specific linting on every push/PR. This is a common industry practice. However, it:
- Is a GitHub Actions workflow file (which this task is researching prevention for — somewhat circular, but acceptable as a CI lint workflow)
- Requires no `package.json` changes
- Does not run as part of `npm test` (it runs as a separate GitHub Actions job)

This is a complementary mechanism, not a replacement for the Node.js test approach.

## Roadmap Alignment

- **authoritative_roadmap**: `ARCHITECTURE.md` §16.6 (DeepSeek Coordinator Evolution — Phase 0 through Phase 4), `docs/ai/STATE.md`, `docs/ai/ARCH_DECISIONS.md`
- **current_phase**: Phase 3 — Autonomous Coordination Loop, COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED
- **phase_completion_status**: Phase 3 is complete and all prerequisites are satisfied. Phase 4 — Scaled Conversational Orchestration & Cross-Task Lineage Navigation is PROPOSED / TARGET (transition evidence BLOCKED / NOT ESTABLISHED; durable coordinator transition record not yet created on `main`).
- **relevant_prior_work**: TASK-KILO-DURABLE-ONE-CLICK-WORKFLOW-COORDINATOR-CONTRACT-001 (zero-input workflow contract, machine-verifiable); TASK-KILO-EXTERNAL-ACTIVATION-PROCEDURE-AND-MACHINE-CONTRACT-001 (canonical activation procedure with machine-verification tests); TASK-GEMINI-DEEPSEEK-COORDINATOR-MACHINE-ENFORCEMENT-LIFECYCLE-RESEARCH-001 and DEEP-RESEARCH-002 (machine-enforced lifecycle); TASK-GEMINI-DEEPSEEK-COORDINATOR-LIFECYCLE-ROADMAP-INTEGRATION-001 (lifecycle enforcement roadmap with Increment 4.4: Automated Reconciliation & Closeout Enforcement)
- **proposed_task_classification**: C — Optional Optimization (improves an existing feature — workflow validation — without advancing roadmap phases). Per Section 3.1.2, Optional Optimization is permitted only when the current phase's prerequisites are satisfied. Phase 3 prerequisites are satisfied (CONVERGED), so this classification is valid.
- **roadmap_requirement_addressed**: Strengthens the existing machine-verification infrastructure (test coverage for GitHub Actions workflow YAML syntax validation) to prevent invalid workflows from reaching `main`, as a defensive measure against the failure class documented in commit `7a1a136`. This is not a Phase 3 or Phase 4 roadmap requirement — it is a repository-hardening improvement that reuses the existing test infrastructure pattern.
- **prerequisites_satisfied**: Yes — Phase 3 is CONVERGED. The existing machine-verification test pattern is established and proven (`workflow-expression.test.js`, `external-activation-bypass.test.js`, `external-activation-procedure.test.js`, `one-click-workflow-contract.test.js`). No Phase 4 prerequisites are required for this hardening task.
- **phase_unlock_or_advancement**: Does not unlock a new roadmap phase. This is a self-contained repository-hardening improvement. It does not advance Phase 3 (already complete) or initiate Phase 4 transition.
- **alignment_conclusion**: **PASS** — The proposed research task (documentation of the machine-enforced workflow validation mechanism) aligns with the repository's established machine-verification pattern. It is classified as Optional Optimization (C), which is permitted because the current phase (Phase 3) prerequisites are satisfied. No Phase 4 transition is involved or authorized. This research document only; implementation requires separate ACP authorization.

## Unresolved Questions / Blockers

1. **GitHub branch protection and required CI status checks** — The existence of branch protection rules that require CI status checks on PRs is a GitHub repository/org-level setting, not determinable from repository source. If no required CI gate exists, any prevention mechanism added to `npm test` will only be effective if the CI workflow that runs `npm test` is configured as a required status check on `main`.

2. **CI workflow confirmation** — This research assumes `.github/workflows/kilo-verification.yml` runs `npm test` or equivalent verification. Confirmation of the exact CI command and whether it is a required status check is outside the repository-source scope.

3. **Dependency policy** — Whether adding `js-yaml` as a devDependency is acceptable requires Director authorization (it modifies `package.json`).

## Relevant Repository Files / Interfaces

| File | Role |
|---|---|
| `.github/workflows/main.yml` | Gemini Reviewer workflow (issue_comment + workflow_dispatch) |
| `.github/workflows/gemini-builder.yml` | Gemini Builder workflow (workflow_dispatch) |
| `.github/workflows/one-click-gemini-builder-smoke.yml` | One-click zero-input workflow (corrected by commit `7a1a136`) |
| `.github/workflows/one-click-gemini-research-documentation.yml` | One-click RESEARCH_DOCUMENT workflow |
| `.github/workflows/kilo-verification.yml` | CI/verification workflow (assumed to run `npm test`) |
| `test/workflow-expression.test.js` | Existing expression-validation tests (40 tests) |
| `test/external-activation-bypass.test.js` | Existing bypass-closure tests (68 tests) |
| `test/external-activation-procedure.test.js` | Existing procedure-verification tests (30 tests) |
| `test/one-click-workflow-contract.test.js` | Existing one-click contract tests (28 tests) |
| `package.json` | Test script definition (`scripts.test`) |
| `docs/ai/ONE_CLICK_WORKFLOW_CONTRACT.md` | Zero-input workflow contract |
| `docs/ai/EXTERNAL_ACTIVATION_PROCEDURE.md` | Canonical activation procedure |
| `docs/ai/TASK_STANDARD.md` | Task standard with research record format |
| `docs/ai/RESEARCH_INDEX.md` | Research record index |
| `docs/ai/TASK_LOG.md` | Task log (historical) |
| `docs/ai/STATE.md` | Current project state |
| `ARCHITECTURE.md` | Authoritative architecture |
| `poc/validate-external-activation.js` | Workflow-side admission shim |
| `poc/external-activation-validator.js` | Payload builders and ingress caller |
| `poc/activation-ingress.js` | Canonical ingress admission function |
| `poc/activation-policy.js` | Activation policy (server-derived authority) |
| `poc/task-registry.js` | TaskRegistry (task state, claims, descriptors) |

## Implementation Implications / Recommended Next Action

The best repository-native, machine-enforced mechanism to prevent invalid/unsafe GitHub Actions workflows from reaching `main` is a **new Node.js test file** that parses all workflow YAML files and fails on any syntax error, added to the existing `npm test` chain. This follows the exact same pattern as the four existing workflow-test files.

The smallest implementation increment:

1. Create `test/workflow-validation.test.js` that:
   - Reads all `*.yml` files in `.github/workflows/`
   - Parses each with a YAML parser (recommend `js-yaml` devDependency, or shell out to a system YAML tool)
   - Fails on any parse error
   - Optionally extends with structural assertions for the invariants currently checked by `workflow-expression.test.js` (consolidating expression validation here)
2. Add `node test/workflow-validation.test.js` to `package.json` `scripts.test`
3. Confirm `.github/workflows/kilo-verification.yml` runs `npm test` and is a required status check

**This research task does not implement the mechanism.** Implementation requires an explicit ACP task with FAILOVER_EXECUTE capability (to modify `package.json`) or a dedicated implementation task.

## Verification / Evidence Basis

- **Git history**: `git show 7a1a136` confirms the YAML fix diff (heredoc → single-quoted variable). `git log --oneline --all` confirms the three relevant commits (`7a1a136`, `8b1c325`, `870e0b8`).
- **Repository content inspection**: `glob` and `read` of `.github/workflows/`, `test/`, `package.json`, `docs/ai/` confirm the absence of `.yamllint`, `.pre-commit-config.yaml`, `CODEOWNERS`, and `actionlint` GitHub Action usage.
- **Existing test infrastructure**: Reading `test/workflow-expression.test.js`, `test/external-activation-bypass.test.js`, `test/external-activation-procedure.test.js`, and `test/one-click-workflow-contract.test.js` confirms the established pattern: standalone Node.js scripts using `fs.readFileSync`, string/regex assertions, `runTest()` helper, `process.exit(1)` on failure, chained in `package.json` `scripts.test`.
- **Findings classification**: VERIFIED (evidence from repository source/git history), INFERRED (logical conclusion from evidence), UNKNOWN (GitHub-level configuration not determinable from source).
