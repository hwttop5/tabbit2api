# 客户端集成

## 默认本地网关

```text
OpenAI Responses base URL: http://127.0.0.1:50124/v1
Anthropic Messages base URL: http://127.0.0.1:50124
API key: sk-tabbit-local
Model: tabbit/priority
```

开始前先启动本地网关：

```powershell
tabbit2api start
```

如果你还没有 runtime profile，直接运行 `tabbit2api` 也可以，它会自动拉起登录并等待完成。

## Codex

示例文件：

- [../examples/codex/config.toml.example](../examples/codex/config.toml.example)

Codex 使用 OpenAI Responses 兼容面：

```text
Base URL: http://127.0.0.1:50124/v1
API key env: TABBIT_API_KEY
Model: tabbit/priority
```

## Claude Code

示例文件：

- [../examples/claude-code/env.powershell.example](../examples/claude-code/env.powershell.example)
- [../examples/claude-code/env.sh.example](../examples/claude-code/env.sh.example)

Claude Code 使用 Anthropic 风格接口：

```text
Base URL: http://127.0.0.1:50124
API key: sk-tabbit-local
Model: tabbit/priority
```

注意：这里不要带 `/v1`。

## OpenClaw

示例文件：

- [../examples/openclaw/env.powershell.example](../examples/openclaw/env.powershell.example)
- [../examples/openclaw/env.sh.example](../examples/openclaw/env.sh.example)

OpenClaw 也走 Anthropic 风格接口，因此同样使用：

```text
Base URL: http://127.0.0.1:50124
```

## Hermes Agent

示例文件：

- [../examples/hermes/config.yaml.example](../examples/hermes/config.yaml.example)

Hermes Agent 使用 OpenAI Responses 兼容面：

```text
Base URL: http://127.0.0.1:50124/v1
API mode: codex_responses
Model: tabbit/priority
```

## 常见差异

- Codex / Hermes Agent：通常用 `/v1`
- Claude Code / OpenClaw：通常不用 `/v1`
- 所有客户端都建议统一用 `tabbit/priority`

## 首次接入建议

1. 运行 `tabbit2api doctor`
2. 运行 `tabbit2api start`
3. 访问 `/health`
4. 再接客户端配置
