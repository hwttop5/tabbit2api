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

## Local Development

```powershell
npm install
npm run login
npm start
```

## Notes

- Do not commit `.lab*` runtime profiles.
- Do not commit `node_modules/` or `output/`.
- Keep the public API surface limited to `/health`, `/v1/models`, and `/v1/responses` unless there is a clear project decision to expand it.
