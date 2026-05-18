# Tabbit2API

Tabbit2API 是一个本地网关，用 Playwright 驱动已安装的 Tabbit 客户端，把 Tabbit Web Chat 能力桥接成 OpenAI `Responses API`、`Chat Completions API`、`Assistants API`、文本版 `Realtime API` 和 Anthropic `Messages API` 风格接口，便于接入 Codex、Claude Code、OpenClaw、Hermes Agent 或其他本地工具。

它不是官方 Tabbit API，也不是托管服务。它运行在你的电脑上，依赖本机 Tabbit 登录态，并通过本地浏览器运行时完成实际请求。

## 项目定位

- 本地运行的 Tabbit -> OpenAI Responses / Chat Completions / Assistants / Realtime WebSocket / Anthropic Messages 兼容网关
- 对外暴露精简 API：
  - `GET /health`
  - `GET /v1/models`
  - `POST /v1/responses`
  - `POST /v1/chat/completions`
  - `POST /v1/assistants`
  - `POST /v1/threads`
  - `POST /v1/threads/{thread_id}/runs`
  - `GET /v1/realtime`
  - `POST /v1/messages`
  - `POST /v1/messages/count_tokens`
  - `GET /v1/models/{model_id}`
- 支持一个虚拟模型别名 `tabbit/priority`
- 支持通过 cc-switch 接入 Codex、Claude Code、OpenClaw、Hermes Agent
- 内置 Tabbit 模型优先级回退链路
- 提供本地 Bearer / `x-api-key` 校验
- 返回 OpenAI Responses、Chat Completions、Assistants 和 Anthropic Messages 风格 SSE 流式输出
- 返回 OpenAI Realtime 风格 WebSocket 文本事件

## 使用教程

临时运行：

```powershell
npx tabbit2api
```

或全局安装后运行：

```powershell
npm i -g tabbit2api
tabbit2api
```

首次没有运行 profile 时，CLI 会自动打开 Tabbit 登录窗口。你在窗口里完成登录后，网关会继续启动。之后也可以手动刷新登录态：

```powershell
tabbit2api login --refresh
```

在 cc-switch 中通常只需要准备 OpenAI Responses 和 Anthropic Messages 两类配置，然后让对应客户端选择该配置即可。其他支持 OpenAI 兼容端点的客户端也可以直接使用 `chat/completions`、`assistants` 或 `realtime` 路径。

OpenAI Responses 配置适用于 Codex 和 Hermes Agent：

```text
Protocol: OpenAI Responses
Base URL: http://127.0.0.1:50124/v1
API Key: sk-tabbit-local
Model: tabbit/priority
```

Anthropic Messages 配置适用于 Claude Code 和 OpenClaw：

```text
Protocol: Anthropic Messages
Base URL: http://127.0.0.1:50124
API Key: sk-tabbit-local
Model: tabbit/priority
```

区别只在协议和 Base URL；API Key 和 Model 固定相同。

OpenAI Chat Completions / Assistants / Realtime 文本兼容层也使用同一个 Base URL：

```text
Base URL: http://127.0.0.1:50124/v1
API Key: sk-tabbit-local
Model: tabbit/priority
```

## 工作原理

1. 启动时，程序会从本机 Tabbit 用户目录复制出一个独立运行 profile 到用户级数据目录。
2. 通过 Playwright 以持久化浏览器上下文启动本机 Tabbit 桌面客户端。
3. 打开 `https://web.tabbitbrowser.com/chat/new`。
4. 通过页面运行时调用 Tabbit Web Chat 内部发送逻辑。
5. 把返回内容重新封装为 OpenAI 或 Anthropic 兼容 JSON / SSE / WebSocket 事件。

这意味着：

- 你不需要 Tabbit 官方开放 API。
- 你需要本机已安装 Tabbit。
- 你需要先在运行 profile 中完成一次登录。
- 这是单机本地桥接方案，不适合直接公开暴露到公网。

## 运行前提

当前正式支持 Windows 和 macOS。默认路径如下：

```text
Windows executable: %USERPROFILE%\AppData\Local\Tabbit\Application\Tabbit.exe
Windows user data : %USERPROFILE%\AppData\Local\Tabbit\User Data
macOS executable  : /Applications/Tabbit.app/Contents/MacOS/Tabbit
macOS user data   : ~/Library/Application Support/Tabbit/User Data
```

Linux 目前不是正式支持平台，因为 Tabbit 官网只提供 macOS 和 Windows 下载。如果你有可运行的 Tabbit 兼容二进制和 Chromium profile，可以用 `TABBIT_EXECUTABLE` 与 `TABBIT_USER_DATA_DIR` 手动覆盖。

建议环境：

- Windows
- macOS 12+
- Node.js 18 或更高版本
- 本机已安装 Tabbit
- 本机网络可正常访问 `web.tabbitbrowser.com`

如果你的安装路径不同，可以用环境变量覆盖，见下文“环境变量”。

## 快速开始

```powershell
npx tabbit2api
```

建议按下面顺序操作：

1. 运行 `npx tabbit2api`
2. 如首次运行，按自动弹出的 Tabbit 窗口完成登录
3. 等终端输出网关监听地址
4. 将客户端的 Base URL 指向 `http://127.0.0.1:50124/v1`

如果你更喜欢全局命令：

```powershell
npm i -g tabbit2api
tabbit2api start
```

启动成功后，终端会输出：

```text
Tabbit2API gateway listening on http://127.0.0.1:50124
```

## 认证

本地网关默认 API key 为：

```text
sk-tabbit-local
```

请求头示例：

```text
Authorization: Bearer sk-tabbit-local
```

Claude / Anthropic 格式请求也可以使用：

```text
x-api-key: sk-tabbit-local
```

你可以用环境变量覆盖：

```powershell
$env:TABBIT_API_KEY = "your-local-key"
```

说明：这里的 API key 只是本地网关自己的访问口令，不是 Tabbit、OpenAI 或 Anthropic 官方密钥，也不会替代 Tabbit 登录态。

## API 概览

| 接口 | 兼容目标 | 说明 |
| --- | --- | --- |
| `GET /health` | 本地健康检查 | 不需要调用 Tabbit 发送消息 |
| `GET /v1/models` | OpenAI / Anthropic models | 按请求头返回不同模型列表结构 |
| `POST /v1/responses` | OpenAI Responses | 文本输入、文本输出、SSE |
| `POST /v1/chat/completions` | OpenAI Chat Completions | 消息数组、函数工具调用、SSE |
| `POST /v1/assistants` | OpenAI Assistants | 本地 assistant 对象 CRUD |
| `POST /v1/threads` | OpenAI Threads | 本地 thread/message/run 状态 |
| `POST /v1/threads/{thread_id}/runs` | OpenAI Runs | 同步桥接 Tabbit 并追加 assistant message |
| `GET /v1/realtime` | OpenAI Realtime WebSocket | 文本 JSON 事件，不支持音频 |
| `POST /v1/messages` | Anthropic Messages | Claude Code / OpenClaw 兼容 |
| `POST /v1/messages/count_tokens` | Anthropic token count | 近似计数 |

### `GET /health`

用于检查本地桥接进程是否启动，以及浏览器运行时是否已经初始化。

未初始化过运行时时，典型返回类似：

```json
{
  "status": "ok",
  "mode": "tabbit-web-bridge",
  "runtimeInitialized": false,
  "modelCache": {
    "cached": false,
    "modelCount": 0,
    "expiresAt": null,
    "ttlMs": 0
  },
  "queue": {
    "active": 0,
    "busy": false
  },
  "runtimeProfile": {
    "labProfileDir": ".../tabbit2api/tabbit-user-data",
    "defaultProfileDir": ""
  },
  "lastBridgeError": null
}
```

当运行时已初始化且页面可用时，还会附带页面状态、标题和登录态信息。`runtimeProfile` 只返回简短路径摘要，不暴露完整本机路径。

### `GET /v1/models`

返回网关可见模型列表。默认使用 OpenAI `models` 列表结构，并附加一些 Tabbit 特有字段，例如：

- `tabbit_display_name`
- `tabbit_selected_model`
- `supports_images`
- `supports_tools`
- `support_thinking`
- `priority_group`
- `priority_rank`
- `available_in_tabbit_catalog`

该接口需要 API key。如果请求带有 `anthropic-version` 或 `x-api-key`，会返回 Anthropic `models` 列表结构，供 Claude Code / OpenClaw 使用。

### `GET /v1/models/{model_id}`

返回 Anthropic 风格的单个模型详情。当前面向 Claude Code / OpenClaw 文档推荐的模型名为：

- `tabbit/priority`

如果直接请求该模型详情，URL 中的 `/` 需要编码，例如：

```text
GET /v1/models/tabbit%2Fpriority
```

Claude 风格官方模型名不会作为本地兼容别名暴露；请统一使用 `tabbit/priority`。

### `POST /v1/responses`

OpenAI Responses 兼容接口。

支持：

- `model`
- `input`
- `instructions`
- `metadata`
- `tools`
- `tool_choice`
- `temperature`
- `top_p`
- `store`
- `user`
- `reasoning`
- `previous_response_id`
- `max_output_tokens`

目前实际提取 prompt 时，程序只从 `input` 中收集文本内容。`input` 支持两种常见形态：

- 字符串
- 数组，其中每项可包含 `text`、`content` 或嵌套文本片段

如果请求里没有可提取的文本，会返回 `400 invalid_request_error`。

### `POST /v1/chat/completions`

OpenAI Chat Completions 兼容接口。

支持：

- `model`
- `messages`
- `stream`
- `temperature`
- `top_p`
- `max_tokens`
- `max_completion_tokens`
- `tools`
- `tool_choice`
- `metadata`
- `user`

`system` 和 `developer` 消息会作为系统指令传给 Tabbit；`user`、`assistant`、`tool` 消息会被转换为同一条结构化会话。函数工具以 OpenAI `tool_calls` 形式返回，由客户端执行后再通过 `tool` 消息传回。

### Assistants / Threads / Runs

OpenAI Assistants 文本工作流兼容接口，状态默认保存在：

```text
Windows: %LOCALAPPDATA%\tabbit2api\openai-assistants-state.json
macOS: ~/Library/Application Support/tabbit2api/openai-assistants-state.json
Linux: ~/.local/share/tabbit2api/openai-assistants-state.json
```

常用路径：

- `POST /v1/assistants`
- `GET /v1/assistants`
- `GET|POST|DELETE /v1/assistants/{assistant_id}`
- `POST /v1/threads`
- `GET|POST|DELETE /v1/threads/{thread_id}`
- `POST|GET /v1/threads/{thread_id}/messages`
- `GET /v1/threads/{thread_id}/messages/{message_id}`
- `POST|GET /v1/threads/{thread_id}/runs`
- `GET /v1/threads/{thread_id}/runs/{run_id}`
- `POST /v1/threads/{thread_id}/runs/{run_id}/submit_tool_outputs`
- `POST /v1/threads/runs`

Run 创建后会同步调用 Tabbit。普通文本回复会追加为 assistant message，并把 run 标记为 `completed`。如果 Tabbit 返回函数工具调用，run 会进入 `requires_action`，客户端提交 `tool_outputs` 后继续执行。

### `GET /v1/realtime`

OpenAI Realtime 风格 WebSocket 文本接口。

连接示例：

```text
ws://127.0.0.1:50124/v1/realtime?model=tabbit/priority
```

支持 JSON 事件：

- `session.update`
- `conversation.item.create`
- `response.create`

返回事件包括：

- `session.created`
- `session.updated`
- `conversation.item.created`
- `response.created`
- `response.output_item.added`
- `response.text.delta`
- `response.text.done`
- `response.output_item.done`
- `response.done`
- `error`

这是文本兼容层，不支持音频输入输出、WebRTC SDP 或 SIP。收到音频相关事件时会返回明确的 unsupported error。

### `POST /v1/messages`

Anthropic Messages 兼容接口，主要用于 Claude Code / OpenClaw。

支持：

- `model`
- `messages`
- `system`
- `max_tokens`
- `stream`
- `tools`
- `tool_choice`
- `metadata`
- `thinking`

Anthropic 路径会把 `messages + tools + tool_result` 转为结构化提示发给 Tabbit，再把 Tabbit 回复解析回 Anthropic `text` / `tool_use` / `server_tool_use` 内容块。

客户端工具、本地工具和 MCP 工具由 Claude Code 自己执行。网关只负责返回标准 `tool_use`，并在下一轮接收 `tool_result`。

服务器工具由网关本地仿真，当前支持：

- `web_search`
- `web_fetch`
- `code_execution`

未知服务器工具会返回明确的不支持错误。

### `POST /v1/messages/count_tokens`

Anthropic token 计数兼容接口。该接口使用 `@anthropic-ai/tokenizer` 对网关实际规范化后的提示进行近似计数，用于让 Claude Code 工作流可跑通；它不是 Anthropic 官方精确计数。

## 模型路由

### 虚拟模型 `tabbit/priority`

这是项目内置的虚拟别名，不一定存在于 Tabbit 官方模型列表中，但会始终由网关暴露出来。

当前固定优先级如下：

1. `tabbit/Claude-Opus-4.7`
2. `tabbit/GPT-5.5`
3. `tabbit/Claude-Sonnet-4.6`
4. `tabbit/GPT-5.4`
5. `tabbit/DeepSeek-V4-Pro`
6. `tabbit/GLM-5.1`
7. `tabbit/Gemini-3.1-Pro`

行为规则：

- 前 4 个属于主链路
- 后 3 个属于兜底链路
- 当某次失败被判断为“可重试 / 可回退”的上游可用性问题时，网关会尝试下一个模型
- 如果失败被判断为登录失效或请求本身非法，则不会继续回退

### 直接指定模型

你也可以直接传具体模型，例如：

- `tabbit/GPT-5.5`
- `tabbit/Claude-Opus-4.7`
- `tabbit/Default`

如果指定了一个未知模型，网关会返回：

- `400 invalid_request_error`

并提示先调用 `GET /v1/models` 查看可用模型。

### 统一模型名

Codex、Claude Code、OpenClaw 和 Hermes Agent 的文档示例统一使用：

- `tabbit/priority`

这是本网关的本地虚拟模型名，会按上面的优先级链路选择 Tabbit 内的实际模型。Claude 风格官方模型名不会作为本地兼容别名暴露；该模型名不代表 Anthropic 官方服务，也不改变 Tabbit 账号实际可用模型范围。

## 响应与流式输出

`POST /v1/responses` 返回的是 OpenAI `Responses API` 风格输出。

当前实现重点是文本响应和函数工具桥接：

- 非流式场景：返回一个完整 `response` 对象
- 流式场景：返回 `text/event-stream`

流式输出会发出一组与 Responses 风格对齐的事件，例如：

- `response.created`
- `response.in_progress`
- `response.output_item.added`
- `response.content_part.added`
- `response.output_text.delta`
- `response.output_text.done`
- `response.output_item.done`
- `response.completed`
- `response.failed`

`POST /v1/chat/completions` 返回 OpenAI `Chat Completions API` 风格输出：

- 非流式场景：返回 `chat.completion`
- 流式场景：返回 `chat.completion.chunk` SSE，并以 `data: [DONE]` 结束
- 函数工具调用以 `tool_calls` 返回，工具执行仍由客户端完成

Assistants run 的 `stream: true` 会返回 Assistants 风格 SSE，例如：

- `thread.run.created`
- `thread.run.completed`
- `thread.run.requires_action`
- `thread.message.created`
- `thread.message.delta`
- `thread.message.completed`
- `data: [DONE]`

Realtime 通过 WebSocket 返回 JSON 事件；当前只实现文本 `response.text.delta` / `response.text.done`。

`POST /v1/messages` 返回 Anthropic `Messages API` 风格输出。`stream: true` 时会先完成结构化解析，再合成 Anthropic SSE 事件：

- `message_start`
- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `message_delta`
- `message_stop`

## PowerShell 调用示例

### 请求回答

Windows PowerShell 5.1 下，建议显式发送 UTF-8 字节，避免中文请求体乱码：

```powershell
$headers = @{ Authorization = "Bearer sk-tabbit-local" }
$body = @{
  model = "tabbit/priority"
  input = "你是谁？现在实际命中了哪个模型？"
} | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

(Invoke-WebRequest `
  -Uri "http://127.0.0.1:50124/v1/responses" `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json; charset=utf-8" `
  -Body $bytes `
  -UseBasicParsing).Content
```

### 获取模型列表

```powershell
$headers = @{ Authorization = "Bearer sk-tabbit-local" }

(Invoke-WebRequest `
  -Uri "http://127.0.0.1:50124/v1/models" `
  -Headers $headers `
  -UseBasicParsing).Content
```

### 健康检查

```powershell
(Invoke-WebRequest `
  -Uri "http://127.0.0.1:50124/health" `
  -UseBasicParsing).Content
```

### Chat Completions

```powershell
$headers = @{ Authorization = "Bearer sk-tabbit-local" }
$body = @{
  model = "tabbit/priority"
  messages = @(
    @{ role = "system"; content = "回答要简洁。" },
    @{ role = "user"; content = "用一句话介绍 Tabbit2API。" }
  )
} | ConvertTo-Json -Depth 8 -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

(Invoke-WebRequest `
  -Uri "http://127.0.0.1:50124/v1/chat/completions" `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json; charset=utf-8" `
  -Body $bytes `
  -UseBasicParsing).Content
```

### Assistants run

```powershell
$headers = @{ Authorization = "Bearer sk-tabbit-local" }

$assistant = Invoke-RestMethod `
  -Uri "http://127.0.0.1:50124/v1/assistants" `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{ model = "tabbit/priority"; instructions = "回答要简洁。" } | ConvertTo-Json)

$thread = Invoke-RestMethod `
  -Uri "http://127.0.0.1:50124/v1/threads" `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{ messages = @(@{ role = "user"; content = "你好" }) } | ConvertTo-Json -Depth 6)

Invoke-RestMethod `
  -Uri "http://127.0.0.1:50124/v1/threads/$($thread.id)/runs" `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{ assistant_id = $assistant.id } | ConvertTo-Json)
```

### Realtime WebSocket

```javascript
import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:50124/v1/realtime?model=tabbit/priority", {
  headers: { Authorization: "Bearer sk-tabbit-local" },
});

ws.on("message", (data) => console.log(JSON.parse(data)));
ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "你好" }],
    },
  }));
  ws.send(JSON.stringify({ type: "response.create" }));
});
```

## 与 Codex / Claude Code / OpenClaw / Hermes Agent 集成

推荐统一通过 cc-switch 管理客户端配置。按客户端协议选择 Base URL：

| 客户端 | cc-switch 协议 | Base URL | Model |
| --- | --- | --- | --- |
| Codex | OpenAI Responses | `http://127.0.0.1:50124/v1` | `tabbit/priority` |
| Claude Code | Anthropic Messages | `http://127.0.0.1:50124` | `tabbit/priority` |
| OpenClaw | Anthropic Messages | `http://127.0.0.1:50124` | `tabbit/priority` |
| Hermes Agent | OpenAI Responses / `codex_responses` | `http://127.0.0.1:50124/v1` | `tabbit/priority` |
| OpenAI SDK 兼容客户端 | Chat Completions / Assistants | `http://127.0.0.1:50124/v1` | `tabbit/priority` |
| Realtime 文本客户端 | Realtime WebSocket | `ws://127.0.0.1:50124/v1/realtime` | `tabbit/priority` |

API key 都使用：

```text
sk-tabbit-local
```

Claude Code 和 OpenClaw 通常会通过 Anthropic 风格请求头发送 `x-api-key`。Codex 和 Hermes Agent 通常会通过 OpenAI 风格请求头发送 `Authorization: Bearer ...`。本网关两种认证头都支持。

### Codex

Codex 走 OpenAI Responses 兼容面。在 cc-switch 中选择上面的 OpenAI Responses 配置：

```text
Protocol: OpenAI Responses
Base URL: http://127.0.0.1:50124/v1
API Key: sk-tabbit-local
Model: tabbit/priority
```

如果不经过 cc-switch，也可以在支持自定义 OpenAI Responses provider 的 Codex 配置里填写同样的 Base URL、API key 和 model。
仓库内也提供了 Codex provider 片段示例：

- [examples/codex/config.toml.example](examples/codex/config.toml.example)

### Claude Code

Claude Code 走 Anthropic Messages 兼容面。在 cc-switch 中选择上面的 Anthropic Messages 配置：

```text
Protocol: Anthropic Messages
Base URL: http://127.0.0.1:50124
API Key: sk-tabbit-local
Model: tabbit/priority
```

如果不经过 cc-switch，也可以直接用环境变量配置 Claude Code：

```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:50124"
$env:ANTHROPIC_API_KEY = "sk-tabbit-local"
$env:ANTHROPIC_MODEL = "tabbit/priority"
claude
```

仓库内也提供了环境变量示例：

- [examples/claude-code/env.powershell.example](examples/claude-code/env.powershell.example)
- [examples/claude-code/env.sh.example](examples/claude-code/env.sh.example)

Claude Code 工具兼容说明：

- 本地编辑、Shell、MCP 等客户端工具由 Claude Code 执行，网关只返回 `tool_use`
- `web_search`、`web_fetch`、`code_execution` 由网关本地仿真
- `code_execution` 在系统临时目录运行，不直接在仓库工作区运行
- `thinking`、prompt caching、service tier 等字段会被接收，但不会完全复刻 Anthropic 官方行为

### OpenClaw

OpenClaw 按 Claude Code 兼容客户端处理，走 Anthropic Messages 兼容面。在 cc-switch 中选择：

```text
Protocol: Anthropic Messages
Base URL: http://127.0.0.1:50124
API Key: sk-tabbit-local
Model: tabbit/priority
```

OpenClaw 的本地工具或 MCP 工具仍由 OpenClaw 客户端执行；网关只负责返回 Anthropic 风格的 `tool_use`，并在下一轮接收 `tool_result`。如果 OpenClaw 支持直接填写 Anthropic Base URL，也使用 `http://127.0.0.1:50124`，不要附加 `/v1`。
仓库内也提供了环境变量示例：

- [examples/openclaw/env.powershell.example](examples/openclaw/env.powershell.example)
- [examples/openclaw/env.sh.example](examples/openclaw/env.sh.example)

### Hermes Agent

Hermes Agent 走 OpenAI Responses 兼容面。在 cc-switch 中选择 OpenAI Responses 配置：

```text
Protocol: OpenAI Responses
Base URL: http://127.0.0.1:50124/v1
API Key: sk-tabbit-local
Model: tabbit/priority
```

如果 Hermes Agent 不走 cc-switch，也可以参考仓库内示例配置：

- [examples/hermes/config.yaml.example](examples/hermes/config.yaml.example)

关键配置如下：

```yaml
model:
  default: "tabbit/priority"
  provider: "custom"
  base_url: "http://127.0.0.1:50124/v1"
  api_key: "sk-tabbit-local"
  api_mode: "codex_responses"
```

使用方式示例：

```powershell
New-Item -ItemType Directory -Force .\hermes-home | Out-Null
Copy-Item .\examples\hermes\config.yaml.example .\hermes-home\config.yaml
$env:HERMES_HOME = (Resolve-Path .\hermes-home).Path
python path\to\hermes-agent\cli.py
```

把 `path\to\hermes-agent\cli.py` 替换成你自己的 Hermes Agent 安装路径即可。

## 环境变量

### 网关监听与认证

- `PORT`
  - 默认值：`50124`
- `HOST`
  - 默认值：`127.0.0.1`
- `TABBIT_API_KEY`
  - 默认值：`sk-tabbit-local`

### Tabbit 安装与用户目录

- `TABBIT_EXECUTABLE`
  - Windows 默认值：`%USERPROFILE%\AppData\Local\Tabbit\Application\Tabbit.exe`
  - macOS 默认值：`/Applications/Tabbit.app/Contents/MacOS/Tabbit`
  - Linux 默认值：`tabbit`，仅作为手动覆盖场景的 fallback
- `TABBIT_USER_DATA_DIR`
  - Windows 默认值：`%USERPROFILE%\AppData\Local\Tabbit\User Data`
  - macOS 默认值：`~/Library/Application Support/Tabbit/User Data`
  - Linux 默认值：`$XDG_CONFIG_HOME/Tabbit/User Data` 或 `~/.config/Tabbit/User Data`，不代表官方支持

### 运行 profile 与调试输出

- `TABBIT_LAB_ROOT`
  - Windows 默认值：`%LOCALAPPDATA%\tabbit2api`
  - macOS 默认值：`~/Library/Application Support/tabbit2api`
  - Linux 默认值：`~/.local/share/tabbit2api`
  - 实际运行 profile 位于该目录下的 `tabbit-user-data`
- `TABBIT_ASSISTANTS_STATE_PATH`
  - 默认值：`TABBIT_LAB_ROOT/openai-assistants-state.json`
  - 用于保存 Assistants / Threads / Runs 本地状态
- `TABBIT_OUTPUT_DIR`
  - 默认值：`TABBIT_LAB_ROOT/output/playwright`
  - 用于保存 `probe` 产物

### 发送与模型缓存

- `TABBIT_SEND_TIMEOUT_MS`
  - 默认值：`180000`
- `TABBIT_MODEL_CACHE_MS`
  - 默认值：`300000`

## CLI 命令

### `tabbit2api` / `tabbit2api start`

启动本地网关。常用参数：

- `--port <port>`
  - 覆盖监听端口
- `--host <host>`
  - 覆盖监听地址
- `--api-key <key>`
  - 覆盖本地网关 API key
- `--refresh`
  - 启动前重新复制运行 profile

### `tabbit2api login`

打开一个带独立 profile 的 Tabbit 窗口，供你手动完成登录。

常用参数：

- `--refresh`
  - 强制重新复制 profile

### `tabbit2api probe`

打开 Tabbit Web Chat 页面并输出调试信息，同时保存探针产物到：

```text
TABBIT_LAB_ROOT/output/playwright
```

产物包括：

- 页面截图
- 页面 HTML
- 页面交互元素摘要 JSON

常用参数：

- `--refresh`
  - 强制重新复制 profile
- `--keep-open`
  - 探针结束后保持浏览器窗口打开

### 其他参数

- `--help`
  - 显示命令帮助
- `--version`
  - 显示当前包版本

## 登录态与 profile 说明

程序不会直接操作你正在使用的主 Tabbit 用户目录，而是复制一份较轻量的运行 profile 到用户级运行目录。

这样做的目的：

- 降低对主运行环境的干扰
- 允许把桥接运行时和日常使用隔离开
- 避免 `npx` 和全局安装时把运行态写入临时包目录

如果你在主 Tabbit 里已经登录，但桥接运行时仍然提示未登录，通常意味着：

- `TABBIT_LAB_ROOT/tabbit-user-data` 是旧副本
- 登录是在另一个 profile 中完成的
- 复制出的运行 profile 尚未完成首次登录

这时通常直接重新执行：

```powershell
tabbit2api login --refresh
```

然后在新弹出的窗口里重新登录一次即可。

## 常见问题

### 1. `POST /v1/responses` 返回 401

先检查：

- 是否带了 `Authorization: Bearer ...`
- `Bearer` 后面的值是否与 `TABBIT_API_KEY` 一致

### 2. 返回 `login_required`

说明本地 Tabbit 运行 profile 尚未登录。

处理方式：

```powershell
tabbit2api login
```

如果仍无效，再尝试：

```powershell
tabbit2api login --refresh
```

### 3. 启动时报找不到 Tabbit 可执行文件

说明默认安装路径不匹配。Windows PowerShell 示例：

```powershell
$env:TABBIT_EXECUTABLE = "D:\path\to\Tabbit.exe"
```

macOS zsh/bash 示例：

```bash
export TABBIT_EXECUTABLE="/Applications/Tabbit.app/Contents/MacOS/Tabbit"
```

如果你的 Tabbit 用户数据目录也不在默认位置，同时设置 `TABBIT_USER_DATA_DIR`。

### 4. 模型列表里没有某些优先级模型

这并不一定是程序错误。`tabbit/priority` 会始终被暴露出来，但其中某些候选模型可能当前不在你的 Tabbit 模型目录里，或当前账号不可用。

网关会根据回退规则尝试下一个候选项。

### 5. 请求卡很久后超时

当前默认发送超时是 180 秒，可通过：

```powershell
$env:TABBIT_SEND_TIMEOUT_MS = "240000"
```

进行覆盖。

## 仓库结构

```text
src/
  anthropic.js             Anthropic Messages 响应与 SSE 输出
  cli.js                   npm CLI 入口
  cli-options.js           CLI 参数解析与帮助文本
  config.js                配置与默认路径
  gateway-app.js           可测试的 HTTP app 与路由
  gateway.js               HTTP 网关入口
  http-utils.js            HTTP 读写、认证与错误响应工具
  login.js                 登录辅助脚本
  models.js                OpenAI / Anthropic 模型映射
  openai-assistants.js     Assistants / Threads / Runs 本地状态与执行
  openai-chat.js           Chat Completions 请求与响应适配
  openai-realtime.js       Realtime WebSocket 文本事件适配
  openai-responses.js      Responses 风格封装与 SSE 输出
  probe.js                 调试探针
  profile.js               运行 profile 复制逻辑
  server-tools.js          Claude 服务器工具本地仿真
  session-core.js          协议无关的会话规范化与结构化解析
  tabbit-session.js        Playwright / Tabbit 会话封装
  tabbit-web-bridge.js     Tabbit Web Chat 桥接与模型路由
test/
  cli-options.test.js      CLI 参数契约测试
  gateway-contract.test.js HTTP 与协议契约测试
  package-contract.test.js npm 包元数据契约测试
examples/
  README.md                示例目录索引
  codex/
    config.toml.example    Codex provider 示例片段
  claude-code/
    env.powershell.example Claude Code PowerShell 环境变量示例
    env.sh.example         Claude Code POSIX shell 环境变量示例
  hermes/
    config.yaml.example    Hermes Agent 示例配置
  openclaw/
    env.powershell.example OpenClaw PowerShell 环境变量示例
    env.sh.example         OpenClaw POSIX shell 环境变量示例
```

## 当前限制

- 这是本地桥接项目，不是云托管 API 服务
- 依赖本机 Tabbit 安装与登录态；当前正式支持 Windows 和 macOS，Linux 需要自行提供可运行的 Tabbit 兼容环境并手动覆盖路径
- 当前保证 OpenAI `Responses API`、`Chat Completions API`、文本版 `Assistants API`、文本版 `Realtime API` 与 Anthropic `Messages API` 的本地兼容层
- Claude 工具调用依赖 Tabbit 模型按网关结构化提示稳定输出 JSON；解析失败时网关会尝试一次 repair pass
- `count_tokens` 是近似估算，不是 Anthropic 官方精确计数
- 当前实现重点是文本与工具协议桥接，不支持音频、WebRTC SDP、SIP、文件上传、向量库、Code Interpreter 或 File Search
- 请求实际是串行发送的，同一时刻不会并发驱动多个 Tabbit 请求
- 兼容目标是“可被支持 OpenAI / Anthropic 文本协议的本地客户端接入”，不是逐字段复刻 OpenAI 或 Anthropic 全量行为

官方接口形状参考：

- [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create-chat-completion)
- [OpenAI Assistants](https://platform.openai.com/docs/api-reference/assistants/create)
- [OpenAI Threads](https://platform.openai.com/docs/api-reference/threads)
- [OpenAI Realtime](https://platform.openai.com/docs/api-reference/realtime?api-mode=chat)

## 开发

安装依赖：

```powershell
npm install
```

可用脚本：

```powershell
npm run login
npm run probe
npm start
npm test
npm run hooks:install
```

本仓库不使用 npm 生命周期脚本自动安装 husky hooks，避免终端用户通过 npm 安装或 `npx` 运行时触发开发者钩子。开发者需要提交校验时手动运行 `npm run hooks:install`。

## npm 发布

发布前确认包名和 registry：

```powershell
npm view tabbit2api --registry=https://registry.npmjs.org
npm login --registry=https://registry.npmjs.org
```

如果 `npm view` 返回 404，表示官方 registry 当前没有该包名。发布前运行：

```powershell
npm test
npm pack --dry-run --json --registry=https://registry.npmjs.org
```

检查 dry-run 文件列表时，应只包含 `src/`、`README.md`、`LICENSE`、`CONTRIBUTING.md`、`package.json` 和必要示例；不应包含 `.lab`、`.husky`、`test`、`node_modules`、`output` 等本地开发或运行态目录。

正式发布：

```powershell
npm publish --registry=https://registry.npmjs.org --access public
npm view tabbit2api version --registry=https://registry.npmjs.org
npx tabbit2api --version
```

提交规范采用 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)。

示例：

```text
feat: add priority route alias
fix: improve responses stream compatibility
docs: rewrite public readme
chore: initialize tabbit2api open source project
```

本地提交会通过 `husky` 和 `commitlint` 做校验。更多约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[GPL-3.0-only](LICENSE)
