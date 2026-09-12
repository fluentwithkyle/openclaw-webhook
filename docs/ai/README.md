# AI Project State System

## Purpose

This directory (`docs/ai/`) is the persistent, repository-resident memory for AI agents working on the `fluentwithkyle/openclaw-webhook` repository. It replaces reliance on transient conversation memory and provides a durable source of project context, decisions, and history.

## When to Read

**All AI agents** working in this repository must consult the relevant files in `docs/ai/` before planning or implementing work:

- **Before starting any task**: Read `STATE.md` for current project state, active tasks, and blockers.
- **Before making architectural decisions**: Read `ARCH_DECISIONS.md` for recorded decisions and rationale.
- **Before implementing**: Check `TASK_LOG.md` for recent completed work to avoid duplication.
- **When uncertain about operating rules**: Re-read this `README.md`.

## Gemini Task Activation

To initiate a single Gemini work task through the repository's established activation procedure:

1. **Issue description**: Put the full task instructions in the GitHub issue body, conforming to `docs/ai/TASK_STANDARD.md`.
2. **Issue comment**: Post the full task instructions again in an issue comment, beginning with:
   `@gemini-cli`
3. The comment is the Gemini activation trigger.

Future AI systems should follow these requirements when preparing and initiating Gemini tasks.

## File Contents

### `STATE.md` — Current Live Project State
- **Mutable current state**, not immutable history.
- Current status, active tasks, blockers, upcoming/backlog items.
- Current agent roles/state where useful.
- Updated by agents after authorized completed work.

### `ARCH_DECISIONS.md` — Architectural Decisions (ADR-style)
- Significant architectural decisions and rationale.
- Structure: Title, Status, Context, Decision, Rationale, Consequences.
- `ARCHITECTURE.md` remains authoritative for overall architecture.
- This file records decisions for persistent AI project context.

### `TASK_STANDARD.md` — Canonical AI Task Request Standard
- Mandatory, canonical format for all AI task requests initiated by the Director.
- Defines the Task Request Envelope, authorization requirements, instruction precedence, and relationship with ACP.
- All agents must conform to this standard when preparing and initiating tasks.

### `TASK_LOG.md` — Historical Task Record
- **Append-only** historical record of completed AI development tasks.
- Record: task, date, summary, outcome, commit reference.
- Do not use as current-state file.

### `README.md` — This File
- Operating instructions for the AI project-state directory.
- Update rules, security requirements, authoritative vs historical distinctions.

## Update Rules

| File | When to Update | Who Updates |
|------|----------------|-------------|
| `STATE.md` | After any authorized work that changes current project state (active tasks, blockers, status) | Kilo (primary), any authorized agent |
| `ARCH_DECISIONS.md` | When a significant architectural decision is made or reviewed | Gemini (primary), Kilo when implementing |
| `TASK_LOG.md` | After every completed authorized task | Kilo (primary), any agent completing authorized work |
| `README.md` | When operating rules or security requirements change | Kilo (when authorized) |

**Update discipline:**
- Make the smallest change that reflects the new reality.
- Do not rewrite history in `TASK_LOG.md` (append-only).
- Distinguish **CURRENT / IMPLEMENTED** from **PROPOSED / TARGET** clearly.
- Never include secrets, credentials, or sensitive production values.

## Security & Secrecy Requirements

**Never include in any `docs/ai/` file:**
- API keys
- Access tokens
- Webhook secrets
- Passwords
- Private keys
- Credentials
- Sensitive production values (endpoints, internal URLs with auth, etc.)

Do not copy secrets from existing files into this documentation.
Do not introduce a new secret-management mechanism.

## Authoritative vs Historical Information

| Source | Authority | Purpose |
|--------|-----------|---------|
| `ARCHITECTURE.md` | **Authoritative** for intended architecture | Overall system design, boundaries, roadmap |
| Production code | **Authoritative** for implemented behavior | What actually runs in production |
| `docs/ai/STATE.md` | Current AI project state | Live status for AI agents |
| `docs/ai/ARCH_DECISIONS.md` | Recorded decisions + rationale | Context for AI decision-making |
| `docs/ai/TASK_LOG.md` | Historical record | Audit trail of completed AI work |
| `docs/ai/README.md` | Operating rules | How agents use the system |

**Rule**: Documentation is not proof that proposed functionality is implemented. Always verify against production code.