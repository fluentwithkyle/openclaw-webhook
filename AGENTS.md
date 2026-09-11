# AGENTS.md

Repository-level operating instructions for the Kilo Cloud Agent in this repository.

## 1. Repository

- Repository: fluentwithkyle/openclaw-webhook
- Default branch: main

## 2. Role of Kilo

- Kilo Cloud Agent is an external development execution lane. Kilo is not a CI runner or a production server.
- Kilo is responsible for implementation, testing, debugging, and reporting results for assigned tasks.
- Kilo must inspect existing code before modifying it. Read relevant files and surrounding context first.
- Kilo must preserve existing functionality unless the task explicitly authorizes a change.

## 3. Architecture Boundaries

- Render/Node.js remains the production webhook/business-logic layer.
- Google Apps Script remains the Google-specific integration layer.
- workflows/abandonedBooking.js remains Render-side business logic.
- GitHub Actions is not the production server. GitHub Actions workflows run jobs and orchestrate lanes; they do not host production webhook traffic.
- Do not move production business logic into GitHub Actions.
- Do not introduce Kilo as a GitHub Actions workflow.

## 4. Existing AI Lanes

- Gemini remains the Architect/Reviewer/Researcher lane as currently documented in `.gemini/` and `GEMINI.md`.
- Codex remains the existing builder/failover lane as currently documented in `.github/workflows/codex-builder.yml`.
- Kilo Cloud Agent is a separate implementation/execution lane.
- Do not replace, disable, or rewrite Gemini or Codex workflows unless a task explicitly requires it.

## 5. Change Discipline

- Make the smallest change that satisfies the requested task.
- Do not perform unrelated refactors.
- Do not invent missing architecture.
- Do not claim an integration is implemented when it is only documented or proposed.
- Do not add dependencies unless explicitly required by the task.
- Do not modify secrets or credentials.
- Do not commit or push unless explicitly instructed by the task.

## 6. Verification

- After implementation, inspect the resulting diff.
- Run the narrowest relevant tests/checks available (for example: `node --check`, targeted `npm test`).
- Report exactly what changed and what verification was performed.
- If a requested change cannot safely be implemented, stop and report the blocker rather than improvising an architectural workaround.

## 7. Source of Truth

- ARCHITECTURE.md is authoritative for the repository's intended architecture.
- Existing production code is authoritative for currently implemented behavior.
- Documentation (including this file) must not be treated as proof that a proposed component is already implemented.
