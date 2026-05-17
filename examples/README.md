# Tabbit2API examples

These examples use the local default gateway:

```text
Base URL: http://127.0.0.1:50124
API key: sk-tabbit-local
Model: tabbit/priority
```

Start the gateway before using any client example:

```powershell
tabbit2api start
```

## Clients

- `codex/config.toml.example`
  - Codex Desktop / Codex CLI provider snippet.
  - Uses OpenAI Responses protocol at `http://127.0.0.1:50124/v1`.
  - Set `TABBIT_API_KEY=sk-tabbit-local` before starting Codex.
- `claude-code/env.powershell.example`
  - Claude Code environment variables for Windows PowerShell.
- `claude-code/env.sh.example`
  - Claude Code environment variables for POSIX shells.
- `openclaw/env.powershell.example`
  - OpenClaw environment variables for Windows PowerShell.
- `openclaw/env.sh.example`
  - OpenClaw environment variables for POSIX shells.
- `hermes/config.yaml.example`
  - Hermes Agent config example.

For Anthropic-compatible clients such as Claude Code and OpenClaw, use
`http://127.0.0.1:50124` without a trailing `/v1`.
