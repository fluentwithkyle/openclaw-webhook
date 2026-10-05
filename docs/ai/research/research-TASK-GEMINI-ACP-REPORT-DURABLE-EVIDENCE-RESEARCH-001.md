# Research Record: Gemini ACP Report Durable Evidence Architecture

| Field | Value |
|---|---|
| Task / Request Identifier | TASK-GEMINI-ACP-REPORT-DURABLE-EVIDENCE-RESEARCH-001 |
| Research Question / Objective | Research and document the smallest repository-native, ACP-compliant mechanism that makes the canonical Gemini ACP execution report directly readable as durable project evidence after a one-click execution, eliminating dependence on downloading GitHub Actions artifacts for independent verification while preserving the existing one-click activation architecture. |
| Agent | Gemini |
| Date | 2026-10-05 |
| Task Mode | RESEARCH_DOCUMENT |
| Repository State Examined | main @ latest HEAD |

## Executive Conclusion

**VERIFIED: The canonical Gemini ACP execution report (`gemini-acp-report.json`) is currently produced as an ephemeral GitHub Actions artifact (`gemini-acp-report`) during workflow execution.**

While this artifact provides machine verification when retrieved via GitHub API/UI, external coordinators (such as ChatGPT or independent review agents) must perform explicit artifact downloads and extractions to inspect report contents, violating the principle of direct durable readability in project documentation paths. 

However, introducing a persistent repository copy of the report (e.g., committing `docs/ai/gemini-acp-report.json` or a durable research evidence record during workflow completion under authorized VERIFY_RECONCILE or BUILDER execution modes) provides direct repository-native readability **without** creating a second control plane, authority path, TaskRegistry, or verification mechanism.

**Status: RESEARCH COMPLETE — architectural mechanism identified and documented; implementation deferred per RESEARCH_DOCUMENT scope constraints.**

---

## Evidence Classification

### VERIFIED

| Item | Evidence Location |
|---|---|
| Canonical `gemini-acp-report.json` is generated as `callback_payload.json` during workflow execution | `.github/workflows/main.yml`, `.github/workflows/gemini-builder.yml`, `.github/workflows/one-click-*.yml` |
| Uploaded as GitHub Actions artifact named `gemini-acp-report` | `.github/workflows/main.yml` (`path: gemini-acp-report.json`) |
| Mandatory project-wide completion gate requires artifact retrieval and inspection | `docs/ai/README.md`, `docs/ai/TASK_STANDARD.md`, `docs/ai/CHATGPT_PROJECT_OPERATING_PROTOCOL.md` |
| Current retrieval path requires GitHub Actions artifact download / REST API access | `docs/ai/README.md` (*Terminology and Artifact Retrieval*) |
| TaskRegistry and execution descriptor maintain server-derived authority and correlation | `poc/task-registry.js`, `poc/activation-ingress.js` |
| Permitted paths for RESEARCH_DOCUMENT include research docs, research index, and task log | `GEMINI.md` (§ Operating modes - RESEARCH_DOCUMENT) |

### INFERRED

| Item | Basis |
|---|---|
| Persisting a copy of `gemini-acp-report.json` into `docs/ai/gemini-acp-report.json` during workflow completion would make results directly readable via standard `read_file` | Existing repository conventions for documentation files in `docs/ai/` |
| Such persistence requires commit and push capabilities, which are already authorized in VERIFY_RECONCILE and BUILDER modes | `GEMINI.md` authorization rules for VERIFY_RECONCILE and BUILDER |
| Storing the report in the repository does not alter authority or replace TaskRegistry because the payload is generated post-execution | Architecture of ACP execution and callback separation |

### UNKNOWN

| Item | Reason |
|---|---|
| Potential race conditions or concurrency conflicts if multiple workflows attempt to write to `docs/ai/gemini-acp-report.json` simultaneously | Requires dedicated workflow serialization or unique run naming if parallel runs occur |
| Whether external consumers prefer a single static path (`docs/ai/gemini-acp-report.json`) overwriting per run or a history of run-specific files (`docs/ai/research/gemini-acp-report-<run_id>.json`) | Design trade-off between simplicity and audit history |

---

## 1. Current Canonical Report Generation and Filing Architecture

### 1.1 Where the Canonical Report is Produced and Filed

In the current repository architecture (`main.yml`, `gemini-builder.yml`, and one-click workflows), the canonical Gemini ACP report is produced at the end of agent execution:
1. The agent executes via the Gemini CLI (`run-gemini-cli` step).
2. The workflow constructs a canonical ACP callback payload (`callback_payload.json`) using `jq`, embedding request identifiers, changed files, verification results, block status, and commit/push summaries.
3. The workflow copies `callback_payload.json` to `gemini-acp-report.json`:
   ```bash
   cp callback_payload.json gemini-acp-report.json
   ```
4. The workflow uploads `gemini-acp-report.json` as a GitHub Actions artifact named `gemini-acp-report`:
   ```yaml
   - name: Upload Gemini ACP Report Artifact
     uses: actions/upload-artifact@v4
     with:
       name: gemini-acp-report
       path: gemini-acp-report.json
       retention-days: 7
   ```

### 1.2 Why Artifact Retrieval is Required

Because GitHub Actions artifacts are ephemeral storage managed by GitHub's artifact service, they are not part of the Git working tree or repository history. Consequently:
- External agents or coordinators cannot inspect `gemini-acp-report.json` via standard repository file reads (`read_file`).
- They must use GitHub Actions REST APIs, GitHub CLI (`gh run download`), or UI artifact downloads to retrieve the file.
- This creates an external dependency on GitHub Actions artifact storage and REST connectivity, which can be blocked in environments without direct GitHub API token access.

---

## 2. Evaluation of Repository-Native Durable Evidence Mechanisms

To eliminate artifact-download dependence without introducing a second control plane, we evaluated three potential mechanisms:

### Option A: Persistent Committed Report Path (`docs/ai/gemini-acp-report.json`)
- **Mechanism**: During the workflow completion step (where commit/push is already authorized in VERIFY_RECONCILE / BUILDER modes), the workflow copies `callback_payload.json` to `docs/ai/gemini-acp-report.json`, commits it, and pushes it to `main`.
- **Pros**: Directly readable via `read_file` in any environment with repository access; zero API overhead; preserves exact ACP envelope; cryptographically bound to the commit SHA.
- **Cons**: Overwrites the single file on each run (unless suffixed), though git history preserves past reports.

### Option B: Run-Specific Durable Research Record (`docs/ai/research/gemini-acp-report-<request_id>.json`)
- **Mechanism**: Persists each execution report as a unique file in `docs/ai/research/`.
- **Pros**: Preserves historical execution audit trails without git log inspection.
- **Cons**: Clutters the research directory with transient execution reports.

### Option C: Job Summary / PR Comment Integration
- **Mechanism**: Posting the JSON summary into GitHub Actions Job Summary or PR comment.
- **Pros**: Visible in CI UI.
- **Cons**: Still ephemeral/UI-bound; not directly readable via repository file structure.

**Recommendation**: **Option A** (persistent committed report path at `docs/ai/gemini-acp-report.json`) is the smallest repository-native, ACP-compliant mechanism. It makes the execution report instantly readable via repository file read tools while preserving the single control plane and TaskRegistry authority.

---

## 3. Preserving ACP Authority and Single Control Plane Integrity

The proposed durable evidence mechanism adheres strictly to project constraints:
1. **No Second Control Plane**: The report is purely an *output observation* produced *after* execution completes and passes through the canonical ingress and ACP engine. It does not make policy decisions or accept incoming control directives.
2. **TaskRegistry Correlation**: The report payload retains all upstream identifiers (`request_id`, `task_name`, `activation_id`, `claim_id`, `invocation_id`, `current_head_sha`), maintaining perfect correlation with `TaskRegistry` and workflow runs.
3. **Handling Execution States**: Success, failure, blocked, and partial-execution reports are fully represented within the standard ACP schema (`status`, `blockers`, `result`), so persisting the payload handles all states uniformly.

---

## 4. Roadmap Alignment

| Roadmap Field | Value |
|---|---|
| authoritative_roadmap | ARCHITECTURE.md §16.6; docs/ai/STATE.md; docs/ai/DEESEEK_COORDINATOR_LIFECYCLE_ENFORCEMENT_ROADMAP.md |
| current_phase | Phase 3 — Autonomous Coordination Loop; Phase 4 — Scaled Conversational Orchestration & Cross-Task Lineage Navigation is the next target phase |
| phase_completion_status | Phase 3 complete/converged; this task researches evidence durability for the existing one-click activation foundation |
| relevant_prior_work | Canonical external activation, server-derived execution descriptors, Gemini RESEARCH_DOCUMENT carrier capability fixes, and independently verified Gemini one-click VERIFY_RECONCILE execution |
| proposed_task_classification | B — Enabling/Foundation Work |
| roadmap_requirement_addressed | Machine-verifiable execution evidence and durable coordinator state |
| prerequisites_satisfied | Existing one-click contract, canonical ingress, ACP validation, TaskRegistry, execution descriptor, Gemini callback/evidence path, and durable records are present |
| phase_unlock_or_advancement | Establishes the research/design basis for a narrowly scoped durable-evidence improvement |
| alignment_conclusion | PASS — bounded research/documentation foundation work |
