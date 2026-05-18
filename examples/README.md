# Tabbit2API examples

These examples assume you already have a local Tabbit2API gateway running.

Start it with either:

```powershell
tabbit2api
```

or:

```powershell
tabbit2api start
```

Default local values:

```text
OpenAI Responses base URL: http://127.0.0.1:50124/v1
Anthropic Messages base URL: http://127.0.0.1:50124
API key: sk-tabbit-local
Model: tabbit/priority
```

## Which base URL to use

- Codex and Hermes Agent: use `http://127.0.0.1:50124/v1`
- Claude Code and OpenClaw: use `http://127.0.0.1:50124`

## Clients

- `codex/config.toml.example`
  - Codex Desktop / Codex CLI provider snippet
  - Uses OpenAI Responses at `http://127.0.0.1:50124/v1`
- `claude-code/env.powershell.example`
  - Claude Code environment variables for Windows PowerShell
- `claude-code/env.sh.example`
  - Claude Code environment variables for POSIX shells
- `openclaw/env.powershell.example`
  - OpenClaw environment variables for Windows PowerShell
- `openclaw/env.sh.example`
  - OpenClaw environment variables for POSIX shells
- `hermes/config.yaml.example`
  - Hermes Agent config example
