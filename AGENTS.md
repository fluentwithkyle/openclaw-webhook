# AGENTS.md

Repository-level operating instructions for Kilo when working in the
`fluentwithkyle/openclaw-webhook` repository.

## Repository overview

- **Project**: `openclaw-webhook`, a webhook listener written in Node.js.
- **Entry point**: `index.js`; started with `npm start` (`node index.js`).
- **Dependencies**: Express, Axios, googleapis, `@xenova/transformers`.
- **Deployment**: Hosted on Render. The application start command is `node index.js`.
- **Configuration note**: `gateway.mode` is an OpenClaw configuration key, not an
  environment variable. Do not add `GATEWAY_MODE` or similar guessed environment
  variables to this application. OpenClaw configuration lives in
  `openclaw-render.json`.

## Kilo operating conventions

- Follow the code style and patterns already present in the repository.
- Do not add comments to code unless explicitly requested.
- Keep responses concise and to the point; prefer direct answers.
- Commit only when explicitly asked. Do not amend, rebase, or push without
  instruction.
- Never commit secrets, API keys, or credentials. Avoid logging them.
- Stage and commit only the files relevant to the requested change.
- When editing, read the surrounding context and existing imports first.
- Run lint/typecheck/test commands if they are defined in `package.json` or the
  repo. This project has no `test` or `lint` scripts; verify changes by reviewing
  them.
- Do not create or modify GitHub Actions workflows unless explicitly requested.
- Do not modify `AGENTS.md` itself unless explicitly requested.

## Verification checklist

Before finishing work in this repository, run:

```sh
git status --short --branch
git diff --check
```

Ensure only the intended files are staged and that there are no whitespace
errors.
