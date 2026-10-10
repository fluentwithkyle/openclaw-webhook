# Research Record: Phase 4 Bootstrap Repeated Failure Root Cause Analysis

| Field | Value |
|---|---|
| Task / Request Identifier | TASK-GEMINI-PHASE4-BOOTSTRAP-REPEATED-FAILURE-ROOT-CAUSE-RESEARCH-001 |
| Research Question / Objective | Establish the earliest confirmed failure point for the two repeated RESEARCH_DOCUMENT workflow executions of TASK-GEMINI-DEEPSEEK-PHASE4-TRANSITION-BOOTSTRAP-001 (GitHub Actions runs 38024157644 at c179785e and 38056049208 at c5b03216). Trace the exact boundaries where task identity and task mode are lost, verify the `PERMITTED_PATHS` format mismatch in the commit/push step, and document the smallest corrective action. |
| Agent | Kilo |
| Date | 2026-10-10 |
| Task Mode | RESEARCH_DOCUMENT |
| Repository State Examined | main @ HEAD c5b03216d5b6fe6ab2d7f905d3971ea9a7c59b44 |
| Observed Failure Evidence | Workflow run 38024157644 (report request_id: 6093763523): `status: failure`, `task_name: null`, `commit: null`, `push: false`. Workflow run 38056049208 (report request_id: 6098017460): `status: success`, `task_name: "TASK-GEMINI-DEEPSEEK-PHASE4-TRANSITION-BOOTSTRAP-001"`, `commit: null`, `push: false`, `durable_research_record_path` set but file not persisted to repository. |

## Executive Conclusion

**ROOT CAUSE: `PERMITTED_PATHS` format mismatch in `main.yml` commit/push step causes silent staging failure for all research deliverables, preventing any commit or push.**

At both workflow-run commits (c179785e and c5b03216), the orchestration context step outputs `permitted_paths` as a **comma-separated string** via `jq -r '.permitted_paths | join(",")' "$DESCRIPTOR_FILE"`. The commit/push step then iterates over this value with `for dir in $PERMITTED_PATHS; do git add "$dir" 2>/dev/null || true; done` — an **unquoted** variable expansion that splits on whitespace (IFS) only. Since the comma-separated string contains no spaces, the **entire string is treated as a single path** (e.g., `docs/ai/research/,docs/ai/RESEARCH_INDEX.md,docs/ai/TASK_LOG.md,...`). The `git add` command receives this as one non-existent path, fails silently (stderr suppressed by `2>/dev/null`, exit code ignored by `|| true`), and **nothing is staged**. Consequently, `git diff --cached --name-only` returns empty, no commit is created (`commit: null`), and no push occurs (`push: false`).

The task identity propagation fix at c5b03216 (commit c5b03216) resolved the `task_name` propagation issue (Run 2 correctly shows `task_name: "TASK-GEMINI-DEEPSEEK-PHASE4-TRANSITION-BOOTSTRAP-001"`, whereas Run 1 shows `task_name: null`). However, the `PERMITTED_PATHS` format mismatch was **not addressed** by that fix, so the commit/push step continues to silently fail, and no research deliverables are committed to the repository.

---

## Evidence Classification

### VERIFIED

| Item | Evidence Location |
|---|---|
| `permitted_paths` is output as comma-separated string in orchestration context | `.github/workflows/main.yml:263` (c179785e) and `.github/workflows/main.yml:330` (c5b03216) — `jq -r '.permitted_paths | join(",")' "$DESCRIPTOR_FILE"` |
| `PERMITTED_PATHS` env var consumes the comma-separated output | `.github/workflows/main.yml:395` (c179785e) and `.github/workflows/main.yml:410` (c5b03216) — `PERMITTED_PATHS: ${{ steps.orchestration_context_ic.outputs.permitted_paths \|\| 'poc/' }}` |
| Unquoted `for dir in $PERMITTED_PATHS` split only on whitespace | `.github/workflows/main.yml:431` (c179785e) and `.github/workflows/main.yml:447` (c5b03216) — `for dir in $PERMITTED_PATHS; do` |
| `git add` errors suppressed with `2>/dev/null \|\| true` | `.github/workflows/main.yml:432` (c179785e) and `.github/workflows/main.yml:448` (c5b03216) — `git add "$dir" 2>/dev/null || true` |
| Same format mismatch exists at both run commits | Verified by `git show` of both c179785e and c5b03216 workflow file — identical pattern at both |
| `RESEARCH_DOCUMENT` is NOT a consequential command | `poc/schemas/acp-schema.js:334-340` — `isConsequentialCommand` returns true only for `BUILDER` or `FAILOVER_EXECUTE` |
| RESEARCH_DOCUMENT server-derived permitted paths | `poc/activation-policy.js:12` — `RESEARCH_DOCUMENT_PATHS = ['docs/ai/research/', 'docs/ai/RESEARCH_INDEX.md', 'docs/ai/TASK_LOG.md', 'docs/ai/STATE.md', 'docs/ai/CONTROL_CENTER.md', 'docs/ai/README.md', 'docs/ai/ARCH_DECISIONS.md', 'poc/schemas/acp-schema.js', 'test/schema.test.js']` |
| `execution-descriptor.json` includes `task_name` at c5b03216 but NOT at c179785e | `buildExecutionDescriptor` at c5b03216 includes `task_name: taskEntry.task_name \|\| null` (task-registry.js:1633); at c179785e the field is absent |
| `createInitialTaskRegistryEntry` stores `task_name` at c5b03216 but NOT at c179785e | c5b03216: `task_name: command.task_name || null` (acp-schema.js:588); c179785e: field absent |
| `buildActivationPayloadForIssueComment` includes `task_name` at c5b03216 but NOT at c179785e | c5b03216: `task_name: taskName` in return (external-activation-validator.js:371); c179785e: field absent |
| Canonical ingress rejects consequential commands without `task_name` at c5b03216 | `activation-ingress.js:201-214` — `MISSING_TASK_NAME` check; this check does NOT exist at c179785e |
| Report 1 (run 38024157644) shows `status: failure`, `task_name: null` | Canonical artifact from workflow run artifact ID 11660525191, request_id 6093763523 |
| Report 2 (run 38056049208) shows `task_name` preserved but `commit: null`, `push: false` | Canonical artifact from workflow run artifact ID 11671687399, request_id 6098017460 |
| Research record file does NOT exist in repository or Git history | `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-PHASE4-TRANSITION-BOOTSTRAP-001.md` — verified: `git log --all --oneline -- docs/ai/research/research-TASK-GEMINI-DEEPSEEK-PHASE4-TRANSITION-BOOTSTRAP-001.md` returns no commits; file does not exist on main |
| Both workflow runs have `conclusion: success` but commit/push step ran instantaneously | GitHub API jobs data: `started_at` and `completed_at` identical for "Commit and push Gemini changes" step in both runs; `outcome: null` |
| Comment format: `@gemini-cli RESEARCH_DOCUMENT\n\n{...JSON...}` | GitHub issue comment 6093763523 and 6098017460 — verified via `gh api` |
| `RESEARCH_DOCUMENT` task_mode is NOT in `EXECUTION_TASK_MODES` | `poc/activation-policy.js:60` — `EXECUTION_TASK_MODES = ['FAILOVER_EXECUTE', 'BUILDER']` |

### INFERRED

| Item | Basis |
|---|---|
| The `PERMITTED_PATHS` comma-vs-whitespace mismatch causes ALL permitted_paths to be treated as a single non-existent path | Bash IFS splitting: unquoted `$PERMITTED_PATHS` splits on spaces/tabs/newlines but not commas; comma-joined string has no spaces → single token; `git add` on non-existent path fails but is silently suppressed by `2>/dev/null || true` |
| Gemini CLI created research files in the workspace but they were never committed because staging failed | Report 2 shows `durable_research_record_path` set (file existed during workflow run at report time), but file does not exist in repository (never committed); `commit: null` and `push: false`; commit/push step ran instantaneously |
| The task identity fix (c5b03216) correctly resolved `task_name` propagation but did NOT fix the `PERMITTED_PATHS` staging issue | Report 2 shows `task_name` correctly propagated; `PERMITTED_PATHS` format mismatch unchanged at c5b03216 (same `join(",")` and unquoted `for dir` pattern) |
| Run 1 was blocked at the report step fail-closed check (missing `task_name`); Run 2 passed the report step but the commit/push step still failed to stage/commit | Run 1 report: `status: failure`, blocker about missing task_name; Run 2 report: `status: success` with `durable_research_record_path` set |
| The `changed_files` field in both reports lists the fix-commit files, NOT research deliverables | `changed_files` is computed from `git diff --name-only HEAD~1 HEAD` — shows the fix commit's changes, not Gemini-created files |

### UNKNOWN

| Item | Reason |
|---|---|
| Whether the Gemini CLI actually created the research record file and `RESEARCH_INDEX.md`/`TASK_LOG.md` updates in the workspace during Run 2 | The workflow workspace is ephemeral; no persistent workspace artifact was available for inspection; the file-existence check in the report step passed, suggesting the file existed at report time, but repository history confirms it was never committed |
| Whether GitHub Actions job-level `outputs` for the commit/push step would reveal the `PERMITTED_PATHS` value | GitHub Actions API does not expose step outputs in the jobs endpoint response; only the canonical report JSON (which does not include `PERMITTED_PATHS`) is available |
| Whether the `PERMITTED_PATHS` format mismatch also affects `VERIFY_RECONCILE` and `FAILOVER_EXECUTE` activations | Same code path and format mismatch exists for all three modes in the commit/push step; specific workflow-run evidence for those modes is not available in the current artifact set |

---

## 1. Failure Trace: Two Runs, One Root Cause

### Run 1 — Workflow 38024157644 (commit c179785e, "shallow checkout fix")

**Activation path:** `@gemini-cli RESEARCH_DOCUMENT\n\n{...ACP JSON...}` issue comment → `buildActivationPayloadForIssueComment` → canonical ingress → TaskRegistry → execution descriptor → workflow.

**Status at c179785e:**
- `buildActivationPayloadForIssueComment` does NOT include `task_name` in the payload return object (verified: `git show c179785e:poc/external-activation-validator.js`)
- `createInitialTaskRegistryEntry` does NOT store `task_name` (verified: `git show c179785e:poc/schemas/acp-schema.js`)
- `buildExecutionDescriptor` does NOT emit `task_name` (verified: `git show c179785e:poc/task-registry.js`)
- `execution-descriptor.json` therefore has NO `task_name` field
- Canonical ingress has NO `MISSING_TASK_NAME` validation for consequential commands (verified: `git show c179785e:poc/activation-ingress.js` — lines 201-214 absent)

**Report result:** Report step reads `TASK_NAME` from descriptor → empty → fail-closed triggers:
- `status: failure`
- `blockers: ["RESEARCH_DOCUMENT task is missing task_name in task JSON; cannot verify durable research record path"]`
- `durable_research_record_path: null`

**Commit/push result:** The commit/push step at line 466 (`if [ "$TASK_MODE" = "RESEARCH_DOCUMENT" ] && [ -n "$TASK_JSON" ]`) tries to extract `task_name` from `TASK_JSON` (the task string `"RESEARCH_DOCUMENT\n\n{...}"`) using `jq -r '.task_name'`. Since the string is not valid JSON, `jq` fails, `TASK_NAME` remains empty, and the `if [ -n "$TASK_NAME" ]` check at line 470 is false — the research record check is **skipped entirely**. The commit proceeds but the `PERMITTED_PATHS` format mismatch causes silent staging failure (see §2 below). No commit or push occurs.

### Run 2 — Workflow 38056049208 (commit c5b03216, "task identity propagation fix")

**Status at c5b03216:** The task identity fix adds `task_name` to:
- `buildActivationPayloadForIssueComment` return object
- `createInitialTaskRegistryEntry`
- `buildExecutionDescriptor`
- Workflow orchestration context output
- Report step and commit/push step

**Report result:** `TASK_NAME` correctly extracted from descriptor → `"TASK-GEMINI-DEEPSEEK-PHASE4-TRANSITION-BOOTSTRAP-001"` → report step finds research record file exists (created by Gemini CLI in workspace) → `status: success`, `durable_research_record_path` set correctly, no blockers.

**Commit/push result:** Despite the fix, the `PERMITTED_PATHS` format mismatch (unchanged at c5b03216) causes `git add` to silently fail on all paths. No files are staged, no commit is created. `commit: null`, `push: false`.

---

## 2. Root Cause: `PERMITTED_PATHS` Format Mismatch

### The Defect

The orchestration context step outputs `permitted_paths` as a **comma-separated string**:

```bash
# main.yml orchestration context (issue_comment path), c179785e:263 and c5b03216:330
echo 'permitted_paths<<EOF'
jq -r '.permitted_paths | join(",")' "$DESCRIPTOR_FILE"
echo 'EOF'
```

For `RESEARCH_DOCUMENT` mode, the server-derived `permitted_paths` is:
```
['docs/ai/research/', 'docs/ai/RESEARCH_INDEX.md', 'docs/ai/TASK_LOG.md', 'docs/ai/STATE.md', 'docs/ai/CONTROL_CENTER.md', 'docs/ai/README.md', 'docs/ai/ARCH_DECISIONS.md', 'poc/schemas/acp-schema.js', 'test/schema.test.js']
```

After `join(",")`, this becomes:
```
docs/ai/research/,docs/ai/RESEARCH_INDEX.md,docs/ai/TASK_LOG.md,docs/ai/STATE.md,docs/ai/CONTROL_CENTER.md,docs/ai/README.md,docs/ai/ARCH_DECISIONS.md,poc/schemas/acp-schema.js,test/schema.test.js
```

### How This Value Reaches the Commit/Push Step

```yaml
# c5b03216:410
PERMITTED_PATHS: ${{ steps.orchestration_context_ic.outputs.permitted_paths || 'poc/' }}
```

The GitHub Actions expression output preserves the comma-separated string. `PERMITTED_PATHS` env var is set to the entire comma-joined string.

### The Silent Failure

```bash
# c5b03216:447-449
# main.yml line 445 comment says: "space-separated, e.g. "poc/""
for dir in $PERMITTED_PATHS; do
  git add "$dir" 2>/dev/null || true
done
```

The comment at line 445 explicitly says "space-separated" but the output is **comma-separated**. The `for dir in $PERMITTED_PATHS` (unquoted) splits on IFS (whitespace: space, tab, newline). Since the comma-separated string has no whitespace, it is treated as **one single path**:

```
dir = "docs/ai/research/,docs/ai/RESEARCH_INDEX.md,docs/ai/TASK_LOG.md,docs/ai/STATE.md,docs/ai/CONTROL_CENTER.md,docs/ai/README.md,docs/ai/ARCH_DECISIONS.md,poc/schemas/acp-schema.js,test/schema.test.js"
```

`git add` attempts to add a file/directory with this entire string as its path name — which does not exist. The `2>/dev/null` suppresses the error message, and `|| true` suppresses the non-zero exit code. No files are staged.

### Consequence

After the `for` loop, `STAGED_FILES=$(git diff --cached --name-only)` returns empty. The commit/push step finds no changes to commit, exits with code 0 (success) but `COMMIT_SHA` remains `"null"` and `PUSH_STATUS` remains `"false"`. The report step then reports `commit: null, push: false`.

### Verification

This exact pattern is verified at both run commits:
- **c179785e**: `main.yml:263` outputs `join(",")`; `main.yml:395` sets `PERMITTED_PATHS`; `main.yml:431-432` runs unquoted `for dir in $PERMITTED_PATHS` with `git add "$dir" 2>/dev/null || true`
- **c5b03216**: `main.yml:330` outputs `join(",")`; `main.yml:410` sets `PERMITTED_PATHS`; `main.yml:447-448` runs identical unquoted `for dir in $PERMITTED_PATHS` with `git add "$dir" 2>/dev/null || true`

The `join(",")` output format and the unquoted `for` loop are **identical** at both commits — the task identity fix did not address this separate, pre-existing defect.

---

## 3. Smallest Corrective Action

**File:** `.github/workflows/main.yml` (commit/push step, lines 445-449 at c5b03216)

**Change:** Replace the comma-separated `join(",")` output with space-separated output, OR change the `for` loop to split on commas. The smallest change that preserves all existing semantics:

**Option A (preferred):** Change the orchestration context output from `join(",")` to `join(" ")`:
```yaml
# In both orchestration context steps (issue_comment and workflow_dispatch)
jq -r '.permitted_paths | join(" ")' "$DESCRIPTOR_FILE"
```

**Option B:** Change the `for` loop to split on commas:
```bash
IFS=',' read -ra PATHS <<< "$PERMITTED_PATHS"
for dir in "${PATHS[@]}"; do
  git add "$dir" 2>/dev/null || true
done
```

Option A is the smallest change — it corrects the comment's stated assumption ("space-separated") to match the actual output format, with a single character change `join(",")` → `join(" ")` in 4 locations (2 orchestration context steps × 2 paths). No shell logic change is needed; the unquoted `for dir in $PERMITTED_PATHS` correctly splits on whitespace.

**Authorization note:** This is a workflow-level code correction, not a research documentation change. It requires a separate authorized EXECUTE task (e.g., FAILOVER_EXECUTE) and is documented here for a subsequent authorized implementation task. This research task is RESEARCH_DOCUMENT only and does not modify workflow or runtime files.

---

## 4. Verified Facts vs. Unknowns

### Verified Facts (from canonical artifacts, git history, and source code)

1. **Run 1 (c179785e):** `status: failure`, `task_name: null`, `commit: null`, `push: false`. Blocker: "RESEARCH_DOCUMENT task is missing task_name in task JSON; cannot verify durable research record path."
2. **Run 2 (c5b03216):** `status: success`, `task_name: "TASK-GEMINI-DEEPSEEK-PHASE4-TRANSITION-BOOTSTRAP-001"`, `commit: null`, `push: false`. No blockers. `durable_research_record_path` set.
3. **At c179785e:** `buildActivationPayloadForIssueComment`, `createInitialTaskRegistryEntry`, and `buildExecutionDescriptor` do NOT include `task_name` — verified via `git show`.
4. **At c5b03216:** All three functions DO include `task_name` — verified via `git show`. The task identity propagation fix is correctly implemented.
5. **`PERMITTED_PATHS` format mismatch exists at BOTH commits** — verified via `git show` of `main.yml` at both c179785e and c5b03216. The `join(",")` output and unquoted `for dir` loop are identical.
6. **Research record file does not exist in repository or Git history** — verified via `git log --all -- docs/ai/research/research-TASK-GEMINI-DEEPSEEK-PHASE4-TRANSITION-BOOTSTRAP-001.md` (no results) and filesystem check.
7. **Both workflow runs have `conclusion: success`** but the commit/push step ran instantaneously (identical start/completed timestamps), consistent with no files being staged.
8. **`RESEARCH_DOCUMENT` is read-only mode** (`READ_ONLY_TASK_MODES` includes `RESEARCH_DOCUMENT`; `isConsequentialCommand` returns false for it) — verified in `activation-policy.js:99` and `acp-schema.js:334`.

### Unknowns

1. Whether the Gemini CLI actually created research files in the workspace during Run 2. The report step's file-existence check (`if [ -f "$RESEARCH_RECORD_FILE" ]`) passed, suggesting the file existed at report time. But the workflow workspace is ephemeral and the file was never committed to the repository.
2. Whether the `PERMITTED_PATHS` mismatch also causes silent failure for `VERIFY_RECONCILE` and `FAILOVER_EXECUTE` activations. The same code path and bug exist for all three modes.

---

## 5. Relationship to Existing Research

This record complements `docs/ai/research/research-TASK-KILO-GEMINI-RESEARCH-DOCUMENT-TASK-MODE-DOWNGRADE-ROOT-CAUSE-001.md` (commit 9736b92), which documented the `task_mode` downgrade from `RESEARCH_DOCUMENT` to `REVIEW` when routed through `issue_comment` instead of `workflow_dispatch`. That research identified the `issue_comment` authority boundary as intentional design. This record identifies a **separate, orthogonal defect**: the `PERMITTED_PATHS` format mismatch that prevents commit/push of any research deliverables regardless of task mode correctness.

The prior `TASK-KILO-ACP-TASK-IDENTITY-PROPAGATION-REGRESSION-FIX-001` (commit c5b03216) fixed `task_name` propagation but did not address the `PERMITTED_PATHS` staging format mismatch. Both defects must be resolved for RESEARCH_DOCUMENT activations to successfully persist deliverables to the repository.

---

## 6. Research Record Roadmap Alignment

| Field | Value |
|---|---|
| Authoritative Roadmap Phase | DeepSeek Coordinator Evolution / External Activation / Task-Mode Authority Boundaries |
| Current Phase State | Phase 3 — Autonomous Coordination Loop, COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED. Phase 4 PROPOSED / TARGET. |
| Phase 4 Transition Status | BLOCKED — mechanical transition gate requires durably established Director transition-decision provenance and matching TaskRegistry identity |
| Required Next Work | Resolve `PERMITTED_PATHS` format mismatch in `main.yml` commit/push step (separate authorized EXECUTE/RESEARCH_DOCUMENT task) |
| Four-Category Work Classification | **Category D** — Research/documentation only; defect identified for subsequent authorized implementation |

---

## 7. Relevant Repository Files / Interfaces

| File | Role |
|---|---|
| `.github/workflows/main.yml` (c179785e:263, c5b03216:330) | Orchestration context outputs `permitted_paths` as `join(",")` — comma-separated |
| `.github/workflows/main.yml` (c5b03216:410) | Commit/push step sets `PERMITTED_PATHS` from orchestration context output |
| `.github/workflows/main.yml` (c5b03216:445-449) | Commit/push step: `for dir in $PERMITTED_PATHS; do git add "$dir" 2>/dev/null || true; done` — unquoted, splits on whitespace only |
| `poc/activation-policy.js:12` | `RESEARCH_DOCUMENT_PATHS` — server-derived permitted paths for RESEARCH_DOCUMENT mode |
| `poc/activation-policy.js:60` | `EXECUTION_TASK_MODES = ['FAILOVER_EXECUTE', 'BUILDER']` — RESEARCH_DOCUMENT is NOT consequential |
| `poc/activation-policy.js:99` | `READ_ONLY_TASK_MODES` includes RESEARCH_DOCUMENT |
| `poc/activation-ingress.js:201-214` | `MISSING_TASK_NAME` check (added at c5b03216, absent at c179785e) |
| `poc/external-activation-validator.js:371` | `task_name: taskName` in return (at c5b03216 only) |
| `poc/schemas/acp-schema.js:588` | `task_name: command.task_name || null` in `createInitialTaskRegistryEntry` (at c5b03216 only) |
| `poc/task-registry.js:1633` | `task_name: taskEntry.task_name || null` in `buildExecutionDescriptor` (at c5b03216 only) |
| `docs/ai/research/research-TASK-KILO-GEMINI-RESEARCH-DOCUMENT-TASK-MODE-DOWNGRADE-ROOT-CAUSE-001.md` | Related research on task_mode downgrade through issue_comment path |

---

## 8. Verification / Evidence Basis

- **Canonical artifacts:** Downloaded and inspected `gemini-acp-report.json` from both workflow run artifacts (IDs 11660525191 and 11671687399) via authenticated `gh api` calls. Both reports verified for all relevant fields.
- **Git history:** Verified `permitted_paths` output format (`join(",")`) and unquoted `for dir` loop pattern at both c179785e and c5b03216 via `git show`. Verified `task_name` field absence at c179785e and presence at c5b03216 across `external-activation-validator.js`, `acp-schema.js`, `task-registry.js`, and `activation-ingress.js`.
- **Repository state:** Verified `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-PHASE4-TRANSITION-BOOTSTRAP-001.md` does not exist in working tree or any git branch via `git log --all`.
- **GitHub Actions metadata:** Verified workflow run conclusions (`success`), job step outcomes (`null`), and commit/push step execution duration (instantaneous, identical start/completed timestamps) via `gh api`.
- **Source code:** All activation path code traced at both commits. Server-derived authority mechanism verified in `activation-ingress.js` and `activation-policy.js`.
