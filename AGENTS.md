# AGENTS.md

Repository-level operating instructions for Kilo when working in the
`fluentwithkyle/openclaw-webhook` repository.

## 1. Repository

- **Repository**: `fluentwithkyle/openclaw-webhook`
- **Default branch**: `main`
- **Project**: `openclaw-webhook`, a webhook listener written in Node.js.
- **Entry point**: `index.js`; started with `npm start` (`node index.js`).
- **Dependencies**: Express, Axios, googleapis, `@xenova/transformers`.
- **Deployment**: Hosted on Render. The application start command is `node index.js`.
- **Configuration note**: `gateway.mode` is an OpenClaw configuration key, not an
  environment variable. Do not add `GATEWAY_MODE` or similar guessed environment
  variables to this application. OpenClaw configuration lives in
  `openclaw-render.json`.

## 2. Role of Kilo

Kilo Cloud Agent is an external development execution lane. Kilo is not the
production application and does not replace any existing lane.

Kilo performs implementation, testing, debugging, and reporting for assigned
tasks. Before modifying any code, inspect the relevant existing implementation
and interfaces. Preserve existing functionality unless the task explicitly
authorizes a change.

## 3. Architecture Boundaries

- Render / Node.js remains the production webhook and business-logic layer.
- Google Apps Script remains the Google-specific integration layer.
- `workflows/abandonedBooking.js` remains Render-side.
- GitHub Actions is not the production server.
- Do not move production business logic into GitHub Actions.
- Do not introduce Kilo as a GitHub Actions workflow.

## 4. Existing AI Lanes

- Kilo Cloud Agent is the primary Builder / Implementer / Tester.
- Gemini remains the Architect / Planner / Reviewer / Researcher lane.
- Security Specialist — Independent specialist lane for dedicated security analysis and security-focused work (PROPOSED / TARGET).
- Do not replace, disable, or rewrite Gemini workflows unless
  explicitly authorized.

## 5. Change Discipline

- Make the smallest change that satisfies the task.
- Task requests initiated by the Director must conform to `docs/ai/TASK_STANDARD.md`.
- No unrelated refactors.
- Do not invent missing architecture.
- Do not claim proposed functionality is implemented.
- Do not add dependencies unless explicitly required.
- Do not modify secrets or credentials.
- Do not commit or push unless explicitly instructed.

## 6. Verification

Before finishing, inspect the resulting diff and run the narrowest relevant
checks available. Run:

```sh
git status --short --branch
git diff --check
```

Ensure only the intended files are staged and that there are no whitespace
errors. Report exactly what changed and what verification was performed. Stop
and report a blocker rather than improvising an architectural workaround.

## 7. Source of Truth

- `ARCHITECTURE.md` is authoritative for intended architecture.
- Existing production code is authoritative for implemented behavior.
- Documentation is not proof that proposed functionality is implemented.

## 8. Persistent AI Project State (`docs/ai/`)

The repository maintains a durable AI project-state system in `docs/ai/`. All agents working in this repository must consult the relevant files before planning or implementing work.

**Files and Purpose:**

- `docs/ai/README.md` — Operating instructions for the AI project-state directory. Defines when agents read the directory, what each file contains, update rules, security/secrecy requirements, and authoritative vs historical information.
- `docs/ai/STATE.md` — Current live project state (mutable). Contains current status, active tasks, blockers, upcoming/backlog items, current agent roles/state.
- `docs/ai/ARCH_DECISIONS.md` — Significant architectural decisions and rationale in ADR-style format (Title, Status, Context, Decision, Rationale, Consequences). `ARCHITECTURE.md` remains authoritative for overall architecture; this file records decisions for persistent AI context.
- `docs/ai/TASK_LOG.md` — Append-only historical record of completed AI development tasks. Records task, date, summary, outcome, and commit reference. Not a current-state file.

**Source of Truth Hierarchy (Updated):**

- `ARCHITECTURE.md` — Authoritative for intended architecture.
- Production code — Authoritative for implemented behavior.
- `docs/ai/STATE.md` — Current AI project state.
- `docs/ai/ARCH_DECISIONS.md` — Recorded architectural decisions and rationale.
- `docs/ai/TASK_LOG.md` — Historical completed-task records.
- `docs/ai/README.md` — Defines how agents use and maintain the system.

**Agent Requirements:**

- Agents should read the relevant `docs/ai/` state before planning work.
- Kilo should update the appropriate state/history files after authorized completed work.
- Do not weaken or replace the existing Source of Truth rules.
- Never include secrets, credentials, or sensitive production values in any `docs/ai/` file.

## Operating conventions

- Follow the code style and patterns already present in the repository.
- Do not add comments to code unless explicitly requested.
- Keep responses concise and to the point; prefer direct answers.
- Never commit secrets, API keys, or credentials. Avoid logging them.
- Stage and commit only the files relevant to the requested change.
- When editing, read the surrounding context and existing imports first.
- Run lint/typecheck/test commands if they are defined in `package.json` or the
  repo. This project has no `test` or `lint` scripts; verify changes by
  reviewing them.
- Do not create or modify GitHub Actions workflows unless explicitly requested.
- Do not modify `AGENTS.md` itself unless explicitly requested.
