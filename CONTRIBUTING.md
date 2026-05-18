# Contributing to Tabbit2API

## Commit Messages

This project uses [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

Accepted examples:

```text
feat: add priority route alias
fix: improve responses stream compatibility
docs: rewrite public readme
chore: initialize tabbit2api open source project
```

Recommended types:

- `feat`
- `fix`
- `docs`
- `refactor`
- `test`
- `chore`
- `build`
- `ci`

Local commits are validated through `commitlint` and `husky`.

Install local hooks manually:

```powershell
npm run hooks:install
```

This step is only for contributors. End users installing from npm or `npx` should not run it.

## Local Development

```powershell
npm install
npm run hooks:install
tabbit2api doctor
tabbit2api
```

## Notes

- Do not commit `.lab*` runtime profiles.
- Do not commit `node_modules/` or `output/`.
- Runtime state now defaults to a user-level data directory instead of the repo root.
- The published package intentionally keeps the existing CLI shape: `start`, `doctor`, `login`, and `probe`.
- The current public compatibility surface includes Responses, Chat Completions, Assistants, Realtime text, and Anthropic Messages.
