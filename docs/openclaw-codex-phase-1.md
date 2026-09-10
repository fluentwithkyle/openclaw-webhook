# OpenClaw → Codex execution lane — Phase 1 preflight

**Status: blocked by missing host prerequisites (2026-09-10).** This is a
record of the verified preflight state, not a claim that an execution lane has
been configured. No application code, production service configuration, or
credential has been changed by this phase.

## Intended supported mechanism

The desired integration is OpenClaw's release-supported native Codex
app-server integration, operating on a dedicated orchestration host. A custom
Codex runner must **not** be introduced as a substitute.

The installed Codex binary exposes the native `app-server` command and its
JSON-RPC protocol includes account, thread, turn, approval, and structured
output capabilities. The local binary is `codex-cli 0.144.0-alpha.4`.

The target execution boundary is:

```text
OpenClaw service account
  → native Codex app-server integration
  → one explicitly named, non-production Git worktree
  → repository branch
  → JSON-RPC thread/turn result returned to OpenClaw
```

Codex must receive only the worktree it is assigned. Do not mount application
secret files, Render configuration, Google Apps Script credentials, Tally,
Cal.com, LINE, or production service credentials in that execution
environment.

## Verification performed

| Check | Result | Evidence |
| --- | --- | --- |
| OpenClaw executable/configuration on this host | Blocked | `openclaw` is not installed and no host configuration is available. |
| Release-matched official OpenClaw documentation | Blocked | The documentation and package-registry endpoints are inaccessible from this environment (HTTP 403), and no OpenClaw release is installed to identify a matching version. No configuration key or adapter was inferred. |
| Native Codex app-server availability | Pass | `/opt/codex/bin/codex app-server --help` succeeds; its generated protocol schemas include `account/read`, `thread/start`, and `turn/start`. |
| Codex authentication | Blocked | `/opt/codex/bin/codex login status` returns `Not logged in`. |
| Programmatic OpenClaw → Codex invocation | Blocked | OpenClaw is absent, so no native adapter can be configured or invoked. |
| Bounded worktree access | Partial | This checkout is a Git worktree on branch `work`, but no separate orchestration worktree or OpenClaw service account exists. |
| Structured result handoff | Partial | Codex app-server protocol supports threads/turns and structured output, but no authenticated OpenClaw invocation was possible. |
| Git operations in the intended scope | Partial | Local Git history and worktree metadata are available; no remote is configured. |
| GitHub credential permission review | Blocked | `gh auth status` reports no authenticated GitHub host and no credential was supplied. |
| Credentials written to the repository | Pass | The tracked-file inventory contains no credential/configuration file for OpenClaw, Codex, or GitHub; no credential was added by this phase. |

## Required authentication and GitHub authorization

Use the authentication route selected by the **installed OpenClaw release's
official native Codex integration documentation**. Prefer Codex's supported
account/OAuth login when that integration supports it; do not assume or commit
an OpenAI API key. Store any resulting account state in the orchestration
service account's protected home/secret store, outside this repository.

For a fine-grained GitHub personal access token restricted only to
`fluentwithkyle/openclaw-webhook`, the minimum repository permissions for the
requested builder lane are:

| Repository permission | Access | Why |
| --- | --- | --- |
| Contents | Read and write | Clone/fetch, create branches, push commits. |
| Pull requests | Read and write | Open and update a pull request. |
| Metadata | Read | Required baseline repository metadata access. |

Do not grant Administration, Actions/Workflows, Secrets, Environments,
Deployments, Webhooks, or organization-wide access. Do not grant Issues unless
OpenClaw will create or update issues; that is outside Phase 1.

## Smallest next action for Kyle

Provide an access-controlled persistent orchestration host (separate from the
webhook application) with network access to the official OpenClaw
documentation/package source, then install the intended OpenClaw release. On
that host, make available:

1. The release-matched documented native Codex app-server integration.
2. A dedicated OpenClaw/Codex service account authenticated through the
   documented Codex account/OAuth route.
3. A clean, explicitly named worktree for this repository with no production
   secrets mounted.
4. A fine-grained GitHub token with only the permissions listed above, stored
   in the host secret store and not exposed to Gemini.

After those prerequisites exist, run the integration's documented
non-destructive dry run: ask Codex to inspect the worktree and return a
structured summary without modifying files. Then validate `git status`, remote
read access, and the returned OpenClaw result. Only after that succeeds should
the lane create a disposable documentation-only branch, commit, and PR.

## Explicit non-goals

This phase does not configure Gemini, Groq, Goose, multi-agent routing, a
custom runner, application source behavior, or production integrations.
