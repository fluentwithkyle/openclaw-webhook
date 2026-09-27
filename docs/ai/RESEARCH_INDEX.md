# AI Research Index

This index provides navigation to all durable research records produced by `RESEARCH_DOCUMENT` task executions. Each entry corresponds to one research record file under `docs/ai/research/`.

Research records are durable research artifacts. They document what was examined, what was found, and what the evidence basis was. They are not current-state files and do not replace `STATE.md` or `ARCHITECTURE.md`.

## Research Record Format

Each research record is a single Markdown file in `docs/ai/research/` following this structure:

| Field | Description |
|-------|-------------|
| Task / Request Identifier | The canonical request/task ID (e.g., `TASK-*-RESEARCH-*-001`) |
| Research Question / Objective | The research question or goal |
| Agent | The agent that performed the research |
| Date | Date of research completion (YYYY-MM-DD) |
| Task Mode | The mode under which the research was performed (always RESEARCH_DOCUMENT) |
| Scope Examined | Files, code, and documentation inspected |
| Findings | Classified findings with repository evidence references |
| Conclusions | Conclusions drawn from the evidence |
| Unresolved Questions / Blockers | Any open questions or blockers |
| Relevant Repository Files / Interfaces | Key files and interfaces referenced |
| Implementation Implications / Recommended Next Action | Downstream implications |
| Verification / Evidence Basis | How findings were verified |

## Index

| Task ID | Date | Agent | Research Record | TASK_LOG Reference |
|---------|------|-------|-----------------|---------------------|
| TASK-KILO-RESEARCH-DOCUMENTATION-SOP-IMPLEMENT-001 | 2026-09-23 | Kilo | `docs/ai/research/research-TASK-KILO-RESEARCH-DOCUMENTATION-SOP-IMPLEMENT-001.md` | `docs/ai/TASK_LOG.md` — summary row (line ~10) and detailed entry |
| TASK-GEMINI-COORDINATOR-RELIABILITY-CONTROL-RESEARCH-001 | 2026-09-23 | Gemini | `docs/ai/research/research-TASK-GEMINI-COORDINATOR-RELIABILITY-CONTROL-RESEARCH-001.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-DEEPSEEK-CONTROL-PLANE-RESEARCH-DOCUMENT-001 | 2026-09-23 | Kilo | `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-CONTROL-PLANE-RESEARCH-DOCUMENT-001.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-CHATBOX-ACP-ARCHITECTURE-RECOVERY-001 | 2026-09-23 | Gemini | `docs/ai/research/research-TASK-GEMINI-CHATBOX-ACP-ARCHITECTURE-RECOVERY-001.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-CHATBOX-RENDER-INTEGRATION-DIRECTION-001 | 2026-09-24 | Gemini | `docs/ai/research/research-TASK-GEMINI-CHATBOX-RENDER-INTEGRATION-DIRECTION-001.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-DEEPSEEK-CHATBOX-RUNTIME-BOUNDARY-RESEARCH-001 | 2026-09-25 | Gemini | `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-CHATBOX-RUNTIME-BOUNDARY-RESEARCH-001.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-DEEPSEEK-COORDINATOR-CAPABILITY-ARCHITECTURE-RESEARCH-001 | 2026-09-26 | Gemini | `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-COORDINATOR-CAPABILITY-ARCHITECTURE-RESEARCH-001.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-DEEPSEEK-PHASE-2-BOUNDED-COORDINATION-RESEARCH-001 | 2026-09-27 | Gemini | `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-PHASE-2-BOUNDED-COORDINATION-RESEARCH-001.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-DEEPSEEK-PHASE-3-AUTONOMOUS-COORDINATION-RESEARCH-001 | 2026-09-27 | Gemini | `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-PHASE-3-AUTONOMOUS-COORDINATION-RESEARCH-001.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-DEEPSEEK-PHASE-3-CONSEQUENTIAL-AUTHORIZATION-AND-SPECIALIST-ROUTING-RESEARCH-001 | 2026-09-27 | Gemini | `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-PHASE-3-CONSEQUENTIAL-AUTHORIZATION-AND-SPECIALIST-ROUTING-RESEARCH-001.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-DEEPSEEK-PHASE-3.1-DIRECTOR-AUTHORIZATION-ARCHITECTURE-DECISION-001 | 2026-09-27 | Gemini | `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-PHASE-3.1-DIRECTOR-AUTHORIZATION-ARCHITECTURE-DECISION-001.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-001 | 2026-09-27 | Gemini | `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-001.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-002 | 2026-09-27 | Gemini | `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-002.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-003 | 2026-09-27 | Gemini | `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-003.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-004 | 2026-09-27 | Gemini | `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-004.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-005 | 2026-09-27 | Gemini | `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-005.md` | `docs/ai/TASK_LOG.md` — appended entry |
| TASK-CHATGPT-DEEPSEEK-STRUCTURED-FAILURE-BLOCKED-DIAGNOSTIC-SUMMARIZATION-FINAL-VERIFY-RECONCILE-001 | 2026-09-27 | ChatGPT Coordinator | `docs/ai/research/research-TASK-CHATGPT-DEEPSEEK-STRUCTURED-FAILURE-BLOCKED-DIAGNOSTIC-SUMMARIZATION-FINAL-VERIFY-RECONCILE-001.md` | `docs/ai/TASK_LOG.md` — final verification/reconciliation entry |

## Implementation Status Note

Increment 4.5 from `TASK-GEMINI-DEEPSEEK-NEXT-COORDINATOR-INCREMENT-RESEARCH-005` is **IMPLEMENTED / AGENT-REPORTED VERIFICATION** by `TASK-CODEX-DEEPSEEK-CHILD-TASK-AGGREGATE-PROGRESS-SUMMARY-IMPLEMENT-001`: it adds only read-only aggregate lifecycle counts across authoritative TaskRegistry children while preserving the bounded detailed-child projection and all control-plane and authority invariants.

The Phase 3 consequential-authorization and specialist-routing research record remains the architectural basis. Its Phase 3.2 routing increment is **IMPLEMENTED / VERIFIED** under `TASK-CODEX-DEEPSEEK-PHASE-3.2-SPECIALIST-ROUTING-FINAL-VERIFY-RECONCILE-001`. Correction commit `11d057bc756739f111aab9c0189108ca2e678e14` was independently verified by executed focused, relevant regression, and complete-suite tests; `git diff --check` passed. The canonical verification report is filed at `docs/ai/gemini-acp-report.json`. Historical failure and blocked-verification records remain in `TASK_LOG.md`.

## Update Rules

- Every `RESEARCH_DOCUMENT` task must add a new entry to this index when its research record is created.
- The index entry, research record, and TASK_LOG reference must be created/updated during the same authorized research execution.
- Remove entries only if the corresponding research record file is deleted (never silently).
- Never include secrets, credentials, or sensitive production values in any research record or index entry.


- **TASK-CHATGPT-DEEPSEEK-AUTOMATIC-RESULT-CONSUMPTION-FINAL-VERIFY-RECONCILE-001** — Independent source/test review of the merged automatic same-execution result-consumption implementation. Main HEAD `65cdf972c53f176cbea1bfd7d76eece98060cadf` is present and structurally consistent; runtime execution remains BLOCKED because Node/npm repository execution is unavailable. Durable verification record: `docs/ai/research/research-TASK-CHATGPT-DEEPSEEK-AUTOMATIC-RESULT-CONSUMPTION-FINAL-VERIFY-RECONCILE-001.md`.

- **TASK-GEMINI-DEEPSEEK-BOUNDED-RESULT-DRIVEN-CONTINUATION-FINAL-VERIFY-RECONCILE-001** — Independent source/test review of the merged bounded result-driven continuation implementation. Main HEAD `dec780bc9e9bd3b71a8eff506663780fc96e78a6` verified; authority and continuation boundaries are structurally consistent. Runtime test execution remains UNKNOWN/BLOCKED in the coordinator environment. Durable verification record: `docs/ai/research/research-TASK-GEMINI-DEEPSEEK-BOUNDED-RESULT-DRIVEN-CONTINUATION-FINAL-VERIFY-RECONCILE-001.md`.
\n\n- **TASK-CHATGPT-DEEPSEEK-PARENT-CHILD-LINEAGE-NAVIGATION-FINAL-VERIFY-RECONCILE-001** — Final verification/reconciliation for Increment 4.2 Parent-Child Lineage Navigation & Multi-Task Observation. Status: **IMPLEMENTED / STATICALLY VERIFIED; RUNTIME EXECUTION BLOCKED**. Main commit: `ec6370c7e899f3100d6733d84c833561595004f5`.\n

- **TASK-CHATGPT-DEEPSEEK-STRUCTURED-SPECIALIST-EVIDENCE-SUMMARIZATION-FINAL-VERIFY-RECONCILE-001** — Final independent source review of Increment 4.3 after PR #236 merge. Status: **IMPLEMENTED / STATICALLY VERIFIED; RUNTIME EXECUTION BLOCKED**. Main HEAD at verification: `3d0a5519f56e9027bac27089e13133c6c95ca2aa`; implementation commit: `f6df467e749202f23922188e19f52b1aea31cbea`. Runtime execution was unavailable and no CI run/status was exposed. Durable verification record: `docs/ai/research/research-TASK-CHATGPT-DEEPSEEK-STRUCTURED-SPECIALIST-EVIDENCE-SUMMARIZATION-FINAL-VERIFY-RECONCILE-001.md`.

- **TASK-CHATGPT-DEEPSEEK-CHILD-TASK-AGGREGATE-PROGRESS-SUMMARY-FINAL-VERIFY-RECONCILE-001** — Final independent source verification of merged Increment 4.5 on main `7b6b5b312439bd7ba724d8bf02a6e63fd77dabba`. Status: **IMPLEMENTED / STATICALLY VERIFIED; RUNTIME EXECUTION BLOCKED**. Agent-reported focused/full test results remain agent evidence. Durable record: `docs/ai/research/research-TASK-CHATGPT-DEEPSEEK-CHILD-TASK-AGGREGATE-PROGRESS-SUMMARY-FINAL-VERIFY-RECONCILE-001.md`.
