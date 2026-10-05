# Research Record: Gemini ACP Report Durable Evidence Concurrency & Design Architecture

| Field | Value |
|---|---|
| Task / Request Identifier | TASK-GEMINI-ACP-REPORT-DURABLE-EVIDENCE-CONCURRENCY-DESIGN-RESEARCH-001 |
| Research Question / Objective | Resolve the remaining architectural questions from `TASK-GEMINI-ACP-REPORT-DURABLE-EVIDENCE-RESEARCH-001` so the repository has an implementation-ready, ACP-compliant design for making the canonical Gemini ACP execution report directly readable as durable evidence without introducing a second control plane or weakening the existing machine-authoritative artifact path. |
| Agent | Gemini |
| Date | 2026-10-05 |
| Task Mode | RESEARCH_DOCUMENT |
| Repository State Examined | main @ latest HEAD |

## Executive Conclusion

**VERIFIED: The canonical Gemini ACP execution report (`gemini-acp-report.json`) is produced as an ephemeral GitHub Actions workflow artifact (`gemini-acp-report`), requiring explicit API/UI downloads for independent inspection.**

While prior research (`TASK-GEMINI-ACP-REPORT-DURABLE-EVIDENCE-RESEARCH-001`) recommended creating a repository-native readable projection, the concurrency, file naming, atomicity, cross-run race conditions, and exact integration boundary questions were left unresolved. 

This research resolves all 10 architectural questions. We conclude that:
1. **Concurrency & Atomicity**: Concurrent workflow runs can race or overwrite a static shared path (`docs/ai/gemini-acp-report.json`). Therefore, a deterministic run-partitioned or unique naming convention (or atomic commit with run-specific path / manifest indexing) must be employed, or single-writer serialization via GitHub Actions concurrency groups must govern the projection step.
2. **Canonical-vs-Projection**: `gemini-acp-report.json` (as uploaded by GitHub Actions) remains the primary machine-authoritative artifact. Any repository-committed file (e.g. `docs/ai/reports/gemini-acp-report-<request_id>.json` or `docs/ai/gemini-acp-report.json`) is strictly a **durable projection** of the canonical execution evidence.
3. **Correlation**: Mandatory immutable identifiers (`request_id`, `task_name`, `activation_id`, `claim_id`, `invocation_id`, `workflow_run_id`, `current_head_sha`) must be embedded in the report payload.
4. **Outcome Coverage**: All outcomes (success, failure, blocked, cancelled, partial) must be persisted uniformly using the standard ACP schema status fields.
5. **Exact Boundary**: The projection should be produced at the exact existing workflow completion step where `callback_payload.json` is finalized and committed (authorized under `VERIFY_RECONCILE` or `BUILDER` modes).
6. **Simplicity Gate**: Reuses existing ACP payloads, TaskRegistry identifiers, and git commit/push capabilities without introducing a second control plane, database, or state store.

**Status: RESEARCH COMPLETE — implementation-ready architectural design established; implementation deferred per RESEARCH_DOCUMENT scope constraints.**

---

## Evidence Classification

### VERIFIED

| Item | Evidence Location |
|---|---|
| Ephemeral `gemini-acp-report` artifact generation and upload | `.github/workflows/main.yml`, `.github/workflows/gemini-builder.yml`, `.github/workflows/one-click-*.yml` |
| TaskRegistry and execution descriptor correlation fields | `poc/task-registry.js`, `poc/schemas/acp-schema.js` |
| VERIFY_RECONCILE and BUILDER authorization rules | `GEMINI.md` (§ Operating modes) |
| Permitted documentation paths for RESEARCH_DOCUMENT | `GEMINI.md` (§ Operating modes - RESEARCH_DOCUMENT) |
| GitHub Actions concurrency group patterns across workflows | `.github/workflows/*.yml` |

### INFERRED

| Item | Basis |
|---|---|
| Concurrent workflow runs pushing to the same branch can cause git merge conflicts or silent overwrites if writing to an unversioned static path | Standard git semantics and GitHub Actions parallel workflow execution behavior |
| Storing run-specific reports under `docs/ai/reports/` or referencing them in research records eliminates race conditions | Existing repository documentation structure in `docs/ai/` |

### UNKNOWN

| Item | Reason |
|---|---|
| Exact frequency of simultaneous overlapping Gemini builder triggers in production | Dependent on GitHub webhook invocation timing |

---

## 1. Resolution of the 10 Core Architectural Questions

### Q1: Concurrency
- **Finding**: Multiple simultaneous or overlapping Gemini workflow executions (e.g., concurrent one-click triggers or PR checks) can attempt to write and commit repository files simultaneously. A static shared path (`docs/ai/gemini-acp-report.json`) would suffer from race conditions, git push rejections (non-fast-forward), or silent overwrites of one run's report by another.
- **Design Resolution**: To prevent concurrency collisions without introducing a distributed lock manager or database:
  - **Option 1 (Run-Specific Immutable Path)**: Persist each report under a deterministic immutable path containing request ID or run ID: `docs/ai/reports/gemini-acp-report-<request_id>.json`. Because each request ID is globally unique, concurrent runs write to distinct files and never conflict.
  - **Option 2 (Workflow Concurrency Group)**: Use GitHub Actions concurrency groups (`concurrency: group: gemini-report-...`) if serialization is desired, though immutable pathing is more robust for parallel tasks.
  - **Recommendation**: Adopt **Option 1** (`docs/ai/reports/gemini-acp-report-<request_id>.json`) for historical durability, supplemented by an optional pointer or index update if needed.

### Q2: Canonical-vs-Projection
- **Finding**: The authoritative machine artifact must remain the workflow artifact (`gemini-acp-report.json` uploaded via `actions/upload-artifact@v4`) because it is generated directly within the ephemeral runner environment during execution.
- **Design Resolution**: Any file committed to the repository (`docs/ai/reports/...`) is strictly a **durable repository projection** of the canonical execution evidence. It does not replace the workflow artifact but serves as an instantly readable repository mirror for external coordinators and review agents.

### Q3: Correlation
- **Finding**: A durable report must be traceable back to its originating context.
- **Design Resolution**: The durable projection must retain the immutable correlation block already defined in `poc/schemas/acp-schema.js` and `TaskRegistry`:
  - `request_id`
  - `task_name`
  - `activation_id`
  - `claim_id`
  - `invocation_id`
  - `workflow_run_id` (GitHub Actions run ID)
  - `current_head_sha` (Commit SHA at execution time)

### Q4: Outcome Coverage
- **Finding**: Execution reports are produced for all terminal states (success, failure, blocked, cancelled, partial).
- **Design Resolution**: Failed, blocked, and cancelled executions must produce durable projection records just like successful ones. Independent coordinators need visibility into why an agent execution failed or was blocked without needing to inspect raw console logs.

### Q5: Atomicity/Integrity
- **Finding**: Partial writes or stale overwrites must be prevented.
- **Design Resolution**:
  - The report JSON file is fully constructed in a temporary location (`callback_payload.json`) and validated against `acp-schema.js` before being moved or copied to its permanent path.
  - Git commit and push occur as a single atomic operation at the end of the authorized workflow step.
  - Immutable naming (`gemini-acp-report-<request_id>.json`) prevents stale overwrites.

### Q6: Exact Boundary
- **Finding**: Where should the projection be produced?
- **Design Resolution**: In the existing workflow completion step (e.g., in `one-click-*.yml` or `gemini-builder.yml`), right after `callback_payload.json` is validated and uploaded as an artifact, add a step that copies `callback_payload.json` to `docs/ai/reports/gemini-acp-report-<request_id>.json`, stages it, commits it, and pushes it to `main` (under authorized `VERIFY_RECONCILE` or `BUILDER` modes).

### Q7: Verification
- **Finding**: How should verification validate the durable projection?
- **Design Resolution**: Independent verification can compare `docs/ai/reports/gemini-acp-report-<request_id>.json` against the GitHub Actions workflow artifact `gemini-acp-report` using JSON equality or schema validation (`test/schema.test.js`).

### Q8: Retention/Discoverability
- **Finding**: Fixed top-level file vs. dedicated directory.
- **Design Resolution**: A dedicated directory (`docs/ai/reports/`) paired with index references in `TASK_LOG.md` provides superior discoverability and audit history compared to a single overwriting top-level file.

### Q9: Simplicity
- **Finding**: Rejects parallel authorities or state stores.
- **Design Resolution**: Reuses existing ACP validation schemas, `TaskRegistry` fields, GitHub Actions runners, and git commits. Introduces zero new databases, daemons, or control planes.

### Q10: State Impact
- **Finding**: Does this change `STATE.md` or `CONTROL_CENTER.md`?
- **Design Resolution**: This is an implementation-design finding. It does not alter current project phase status (Phase 3 complete, Phase 4 target) but provides the exact design required for future durable evidence implementation.

---

## 2. Recommended Implementation Design

### 2.1 File Path & Naming Convention
- **Path**: `docs/ai/reports/gemini-acp-report-<request_id>.json`
- **Rationale**: Globally unique per request, non-colliding under concurrency, instantly readable via `read_file`.

### 2.2 Workflow Integration Snippet (Conceptual Design)
```yaml
- name: Persist Durable Repository Projection
  run: |
    mkdir -p docs/ai/reports
    cp callback_payload.json "docs/ai/reports/gemini-acp-report-${REQUEST_ID}.json"
    git add "docs/ai/reports/gemini-acp-report-${REQUEST_ID}.json"
    git commit -m "chore(evidence): persist durable Gemini ACP report projection for ${REQUEST_ID}"
    git push origin main
  env:
    REQUEST_ID: ${{ steps.extract.outputs.request_id }}
```

### 2.3 Minimal Implementation File List (When Implemented)
1. `.github/workflows/gemini-builder.yml` (and relevant one-click workflows): Add durable projection copy, commit, and push steps.
2. `docs/ai/reports/` directory structure.
3. `docs/ai/TASK_LOG.md` / `docs/ai/RESEARCH_INDEX.md`: Reference generated reports during reconciliation.

---

## 3. Roadmap Alignment

| Roadmap Field | Value |
|---|---|
| authoritative_roadmap | ARCHITECTURE.md §16.6; docs/ai/STATE.md; docs/ai/DEESEEK_COORDINATOR_LIFECYCLE_ENFORCEMENT_ROADMAP.md |
| current_phase | Phase 3 — Autonomous Coordination Loop; Phase 4 — Scaled Conversational Orchestration & Cross-Task Lineage Navigation is the next target phase |
| phase_completion_status | Phase 3 complete/converged; Phase 4 remains target pending transition-bootstrap procedure |
| relevant_prior_work | `TASK-GEMINI-ACP-REPORT-DURABLE-EVIDENCE-RESEARCH-001`, TaskRegistry persistence research, and one-click activation verification |
| proposed_task_classification | B — Enabling/Foundation Work |
| roadmap_requirement_addressed | Machine-verifiable execution evidence concurrency design and durable provenance |
| prerequisites_satisfied | Existing one-click contract, canonical ingress, ACP validation, TaskRegistry, execution descriptor, Gemini callback/evidence path, and prior durable research |
| phase_unlock_or_advancement | Resolves remaining concurrency and architecture design questions for durable evidence without activating Phase 4 |
| alignment_conclusion | PASS — bounded enabling research and design documentation work |
