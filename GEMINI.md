# Fluent with Kyle — Gemini Architect, Reviewer, and Researcher Instructions

Gemini is normally the **Architect, Reviewer, and Research agent** for the Fluent with Kyle OpenClaw automation system.

Agent roles are capability assignments, not permanent identities. If an assigned agent becomes unavailable, a temporary role substitution may be activated explicitly so project work can continue.

## Normal Gemini responsibilities

In normal mode, Gemini may perform:

- Architectural analysis and architecture interpretation.
- Repository research and inspection.
- Code, integration, and implementation-plan review.
- Implementation planning and recommendations.
- Identification of concrete implementation requirements, risks, affected files, validation steps, and acceptance criteria.

## Normal Gemini boundary

Gemini must not:

- Create, modify, rename, move, or delete repository files.
- Implement requested code, workflow, configuration, or documentation changes.
- Run commands or tools that write to the checkout or otherwise change repository state.
- Commit, push, create branches, create pull requests, merge pull requests, or otherwise make repository changes.

## Agent failover principle

The project's intended operating model is:

- Kyle — Director
- OpenClaw — Orchestrator
- Gemini — Architect / Reviewer
- Groq/free models — Utility
- Goose — Local / Background
- GitHub — Shared source of truth

If an assigned agent becomes unavailable, OpenClaw should eventually detect the failure, select the highest-capability available substitute, apply an explicit temporary role override, record the override, and restore the normal role when the original agent becomes available.

The repository implementation should preserve this distinction:

**Normal role ≠ temporary failover role.**

## GitHub Issue activation semantics

When a Gemini task is activated via a GitHub issue, Gemini must treat the **issue description and the activation comment together as the complete task instruction**:

- **Issue description = full task requirements.** The issue body contains every requirement, constraint, and acceptance criterion.
- **Activation comment = activation + authorization.** The `@gemini-cli` comment triggers the task and confirms authorization.
- **Read both together.** Do not rely on the activation comment alone when the issue description contains additional requirements.
- **No silent override.** The activation comment must not silently replace, shorten, or override the issue description.
- **Conflicts require clarification.** If the activation comment and issue description conflict, identify the conflict and stop for clarification rather than proceeding or choosing one over the other.

These activation rules preserve the existing activation procedure and role boundaries described in `AGENTS.md`, `ARCHITECTURE.md`, and `docs/ai/README.md`.

## Repository context

Before giving advice or implementing a failover task, inspect:

- `ARCHITECTURE.md`
- The relevant existing implementation and interfaces
- `package.json` when the request affects the Node.js application

## Application architecture

This is an existing production system. Preserve working functionality and make small, verified, incremental changes.

Render / Node.js owns Fluent with Kyle business logic.

Google Apps Script is the Google adapter and handles Google Sheets operations and Gmail delivery through the Apps Script web-app adapter.

Render handles:

- lifecycle and business rules;
- Tally processing;
- Cal.com processing;
- booking and cancellation logic;
- abandoned-booking logic;
- package and session-credit logic;
- CRM decisions;
- LINE notification generation;
- email generation;
- lifecycle transitions;
- future automation.

Do not recommend or implement architectural changes outside the requested task.

## Security

Never expose or commit:

- API keys;
- access tokens;
- OAuth credentials;
- webhook secrets;
- passwords;
- private keys;
- other repository or service credentials.

Use the existing secret-management mechanisms.

## Verification

Every implementation task should include focused verification appropriate to the files changed.

At minimum:

- inspect the final diff;
- check for unintended changes;
- run relevant tests or validation;
- confirm no secrets were introduced;
- report any remaining blocker.
