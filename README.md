# Tabbit2API

Tabbit2API is a local gateway that turns an installed Tabbit client into OpenAI Responses, Chat Completions, Assistants, Realtime text, and Anthropic Messages compatible endpoints for local tools such as Codex, Claude Code, OpenClaw, and Hermes Agent.

It runs on your own machine, depends on your local Tabbit login state, and is intended for local single-user automation rather than public deployment.

## Quick start

Temporary run:

```powershell
npx tabbit2api
```

Global install:

```powershell
npm i -g tabbit2api
tabbit2api
```

If no runtime profile exists yet, Tabbit2API will open a Tabbit login window and wait for sign-in before starting the gateway.

## Verify your setup

Check local paths and gateway health:

```powershell
tabbit2api doctor
```

Start the gateway on the default port:

```powershell
tabbit2api start
```

Health check:

```powershell
curl.exe http://127.0.0.1:50124/health
```

List models with the local placeholder key:

```powershell
curl.exe -H "Authorization: Bearer sk-tabbit-local" http://127.0.0.1:50124/v1/models
```

## Supported platforms

- Windows: officially supported
- macOS: officially supported
- Linux: manual override only through `TABBIT_EXECUTABLE` and `TABBIT_USER_DATA_DIR`

Default paths:

```text
Windows executable: %USERPROFILE%\AppData\Local\Tabbit\Application\Tabbit.exe
Windows user data : %USERPROFILE%\AppData\Local\Tabbit\User Data
macOS executable  : /Applications/Tabbit.app/Contents/MacOS/Tabbit
macOS user data   : ~/Library/Application Support/Tabbit/User Data
```

Runtime state defaults:

```text
Windows: %LOCALAPPDATA%\tabbit2api
macOS: ~/Library/Application Support/tabbit2api
Linux: ~/.local/share/tabbit2api
```

## Common commands

```powershell
tabbit2api
tabbit2api start --port 50125
tabbit2api login --refresh
tabbit2api probe
tabbit2api doctor
```

## Docs

- [API reference](docs/api.md)
- [Client integrations](docs/integrations.md)
- [Publishing guide](docs/publishing.md)
- [Examples](examples/README.md)
- [Contributing](CONTRIBUTING.md)

## Limits

- This is not an official Tabbit API.
- It relies on a local Tabbit desktop installation and login state.
- It is designed for local use and should not be exposed directly to the public internet.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
