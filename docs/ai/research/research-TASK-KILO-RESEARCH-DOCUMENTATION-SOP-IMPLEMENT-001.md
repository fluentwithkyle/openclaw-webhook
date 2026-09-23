# Research Record: RESEARCH_DOCUMENT Task Mode Implementation

## Task / Request Identifier

TASK-KILO-RESEARCH-DOCUMENTATION-SOP-IMPLEMENT-001

## Research Question / Objective

Replace the current read-only research-task model with a mandatory research-and-documentation task mode (RESEARCH_DOCUMENT) that automatically requires every research execution to persist its research findings into the repository, index that research, and reference it from the task log before the research task can be considered complete.

## Agent

Kilo (Builder / Implementer / Tester)

## Date

2026-09-23

## Task Mode

FAILOVER_EXECUTE (authorized via GitHub issue #198 body from Kyle — Director)

## Scope Examined

### Files modified

- `poc/schemas/acp-schema.js` — ACP schema: task modes, capabilities, authorized paths, validation functions
- `test/schema.test.js` — Schema validation tests
- `test/verify-reconcile.test.js` — Task mode and authorization validation tests
- `docs/ai/TASK_STANDARD.md` — Canonical AI Task Request Standard
- `docs/ai/KILO_INTEGRATION.md` — Kilo integration contract documentation
- `docs/ai/README.md` — AI project-state directory operating instructions
- `docs/ai/STATE.md` — Current live project state
- `docs/ai/CONTROL_CENTER.md` — Derived human-facing dashboard
- `docs/ai/TASK_LOG.md` — Historical task record
- `docs/ai/RESEARCH_INDEX.md` — (new) Navigational index for research records
- `docs/ai/research/research-TASK-KILO-RESEARCH-DOCUMENTATION-SOP-IMPLEMENT-001.md` — (new) This research record

### Runtime code inspected (read-only, no changes)

- `poc/acp-engine.js` — ACP engine that dispatches on `task_mode`; uses `schema.VALID_TASK_MODES` and `schema.validateAuthorization`
- `poc/orchestrator.js` — Task registry / orchestration; references `task_mode` defaults
- `poc/gemini-trigger.js` — Gemini trigger dispatch; uses `task_mode` inputs
- `poc/gemini-builder-trigger.js` — Gemini Builder trigger dispatch; uses `task_mode` inputs
- `poc/github-webhook.js` — GitHub webhook handler; references `task_mode` default
- `routes/poc.js` — POC route handlers
- `index.js` — Application entry point (not modified)
- `.github/workflows/main.yml` — Gemini workflow (not modified; protected file)

### Documentation inspected (read-only)

- `AGENTS.md` — Repository-level operating instructions
- `ARCHITECTURE.md` — Authoritative architecture document
- `GEMINI.md` — Gemini agent instructions
- `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` — Project protocol
- `docs/ai/CHATGPT_CONTROL_GATE_RESEARCH.md` — Prior Control Gate research
- `docs/ai/KILO_INTEGRATION.md` — Kilo integration documentation
- `docs/ai/KILO_GEMINI_ORCHESTRATION_PLAN.md` — Orchestration plan
- `docs/ai/CONTROL_CENTER.md` — Control center dashboard

## Findings

### 1. Existing task modes in the ACP schema

Repository evidence (`poc/schemas/acp-schema.js:65`):

```js
const VALID_TASK_MODES = ['REVIEW', 'VERIFY_RECONCILE', 'FAILOVER_EXECUTE', 'BUILDER'];
```

The runtime ACP schema does **not** contain a `RESEARCH` task mode. The modes currently accepted are REVIEW, VERIFY_RECONCILE, FAILOVER_EXECUTE, and BUILDER.

### 2. RESEARCH appears only in documentation, not in the runtime schema

Repository evidence (grep across `poc/`, `routes/`, `services/`, `workflows/`, `test/`, `index.js`):

No JavaScript code references `RESEARCH` as a task mode value. The string `RESEARCH` appears only in documentation files:

- `docs/ai/TASK_STANDARD.md:13` — lists "RESEARCH" as a valid `task_mode`
- `docs/ai/TASK_STANDARD.md:236` — Section 9.1 defines RESEARCH as a read-only mode
- `docs/ai/KILO_INTEGRATION.md:238` — references "RESEARCH, PLAN, EXECUTE" as example task modes

The `RESEARCH` task mode was never added to `VALID_TASK_MODES` in the schema. It exists only as a documentation concept in `_docs/ai/TASK_STANDARD.md`. There is no runtime code path that accepts or processes `RESEARCH` as a task mode. Therefore removing it from the canonical task standard does **not** break any active production path.

### 3. Existing capability and path validation patterns

Repository evidence (`poc/schemas/acp-schema.js`):

- `getRequiredCapabilitiesForMode(mode)` uses a switch statement to map modes to their required capability arrays. Adding a new case for `RESEARCH_DOCUMENT` is the established pattern.
- `getAuthorizedPathsForMode(mode)` returns a restricted paths array for `VERIFY_RECONCILE` and `null` for other modes. A new case for `RESEARCH_DOCUMENT` follows the same pattern.
- `validateCapabilitiesForMode` enforces exact capability matching for `REVIEW` (exactly `['read_only']`) and required-subset matching for other modes. `RESEARCH_DOCUMENT` should enforce an exact fixed set of 4 capabilities.
- `validatePermittedPathsForMode` uses exact string matching (`authorizedPaths.includes(p)`). Directory-path prefix support is not currently implemented; adding prefix matching for paths ending in `/` is a backward-compatible extension.

### 4. Test structure

Repository evidence (`test/schema.test.js`, `test/verify-reconcile.test.js`):

- `test/schema.test.js` — Tests schema validation functions directly; uses `node test/schema.test.js` as the runner (no test framework dependency).
- `test/verify-reconcile.test.js` — Tests task mode validation, capability validation, path validation, and full authorization; follows the same standalone-runner pattern.
- Both test files use `process.exit(1)` on failure and print `PASS:`/`FAIL:` lines.

### 5. No existing `docs/ai/research/` directory or `docs/ai/RESEARCH_INDEX.md`

Repository evidence (`ls docs/ai/`):

The `docs/ai/` directory contains no `research/` subdirectory and no `RESEARCH_INDEX.md` file. These must be created from scratch.

### 6. Documentation hierarchy and consistency requirements

Repository evidence (`docs/ai/AGENTS.md` Section 8, `ARCHITECTURE.md` Section 16.3):

- `ARCHITECTURE.md` is authoritative for intended architecture.
- Production code is authoritative for implemented behavior.
- `docs/ai/TASK_STANDARD.md` must be reconciled with the actual runtime ACP schema, not documenting modes the runtime does not accept.
- `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` is the governing project protocol and must remain consistent with the implementation.

### 7. RESEARCH_DOCUMENT capability requirement

The task requires RESEARCH_DOCUMENT to inherently require `read_only`, `modify_files`, `commit`, and `push` — exactly 4 capabilities, identical to `VERIFY_RECONCILE_CAPABILITIES` but with exact-match enforcement (no `run_tests`). Research persistence is an intrinsic requirement, not optional.

## Conclusions

1. **RESEARCH was never a runtime schema mode.** It existed only in `TASK_STANDARD.md` documentation. Its removal from the canonical task standard has no runtime impact — it is a pure documentation correction.

2. **RESEARCH_DOCUMENT must be added to the runtime schema** (`poc/schemas/acp-schema.js`) as a new valid task mode with a fixed capability set and restricted authorized paths.

3. **The implementation is a documentation-schema coordination task:** adding a schema mode, updating its tests, and updating all documentation that references the old RESEARCH mode to reference RESEARCH_DOCUMENT with its new persistence semantics.

4. **No existing runtime code path breaks.** No JS code uses `RESEARCH` as a task mode. No production behavior changes beyond adding a new valid mode to the schema validation.

5. **Research persistence must be intrinsic.** The RESEARCH_DOCUMENT completion contract requires: research record → index entry → TASK_LOG reference, all persisted, committed, and pushed in the same execution. This is now codified in TASK_STANDARD.md.

## Unresolved Questions / Blockers

None at the implementation level. The task explicitly authorizes modifications to `poc/schemas/acp-schema.js`, `test/schema.test.js`, and all listed `docs/ai/` files. No authorization conflicts were identified.

## Relevant Repository Files / Interfaces

- `poc/schemas/acp-schema.js` — ACP command schema; the authoritative runtime definition of valid task modes, capabilities, and authorized paths.
- `poc/acp-engine.js` — ACP engine that consumes the schema; validates task modes and authorization before dispatch.
- `test/schema.test.js` — Schema validation tests (standalone Node.js runner).
- `test/verify-reconcile.test.js` — Task mode and authorization validation tests (standalone Node.js runner).
- `docs/ai/TASK_STANDARD.md` — Canonical AI Task Request Standard; the documentation that must be reconciled with the runtime schema.
- `docs/ai/README.md` — AI project-state directory operating instructions.
- `docs/ai/KILO_INTEGRATION.md` — Kilo integration contract documentation.

## Implementation Implications / Recommended Next Action

The RESEARCH_DOCUMENT mode is now defined in the runtime schema. Future designated research agents (Gemini, or any future agent) should use `task_mode: RESEARCH_DOCUMENT` instead of the removed `RESEARCH`. The research record format and index are established; future research tasks should create records under `docs/ai/research/` and update `docs/ai/RESEARCH_INDEX.md` and `docs/ai/TASK_LOG.md` as part of their definition of done.

## Verification / Evidence Basis

- `node test/schema.test.js` — 46 passed, 0 failed (18 new RESEARCH_DOCUMENT tests added to original 28)
- `node test/verify-reconcile.test.js` — 67 passed, 0 failed (15 new RESEARCH_DOCUMENT tests added to original 52)
- Full test suite: all 18 test files pass (449 total tests across schema + verify-reconcile + all other suites)
- `git diff --check` — no whitespace errors
- No runtime code path references `RESEARCH` as a task mode (verified via grep across poc/, routes/, services/, workflows/, test/)
- RESEARCH was never in `VALID_TASK_MODES`; removal is purely a documentation correction
