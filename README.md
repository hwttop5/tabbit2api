# Tabbit2API

Tabbit2API 是一个将 Tabbit Web Chat 桥接为 OpenAI Responses 兼容接口的本地网关，适合接入 Codex、Hermes Agent，以及其他支持 OpenAI Responses API 的本地客户端。

## 项目定位

- 本地运行的 Tabbit 到 API 网关
- 对外暴露 OpenAI Responses 兼容接口
- 保留 Tabbit 模型优先级路由能力
- 提供 Codex Manager / Hermes Agent 集成示例

## API

当前仅提供以下接口：

- `GET /health`
- `GET /v1/models`
- `POST /v1/responses`

本项目不提供 `chat/completions`。

## 主要能力

- `tabbit/priority` 虚拟模型别名
- 原始 Tabbit 模型直连
- 主链路加兜底模型回退
- 本地 Bearer API key 校验
- OpenAI Responses 风格 SSE 输出

## 默认认证

默认本地 API key：

```text
sk-tabbit-local
```

可通过环境变量覆盖：

```powershell
$env:TABBIT_API_KEY = 'your-local-key'
```

请求头示例：

```text
Authorization: Bearer sk-tabbit-local
```

说明：`sk-tabbit-local` 只是本地默认占位 key，不是外部服务密钥。

## `tabbit/priority` 路由顺序

`tabbit/priority` 按以下固定顺序尝试模型：

1. `tabbit/Claude-Opus-4.7`
2. `tabbit/GPT-5.5`
3. `tabbit/Claude-Sonnet-4.6`
4. `tabbit/GPT-5.4`
5. `tabbit/DeepSeek-V4-Pro`
6. `tabbit/GLM-5.1`
7. `tabbit/Gemini-3.1-Pro`

前 4 个为主链路，后 3 个仅在前 4 个因可回退错误不可用时进入。

## 快速开始

```powershell
npm install
npm run login
npm start
```

建议流程：

1. 运行 `npm run login`
2. 在弹出的 Tabbit 窗口中完成登录
3. 登录完成后用 `Ctrl+C` 结束登录进程
4. 运行 `npm start`
5. 将客户端指向 `http://127.0.0.1:50124/v1`

## PowerShell 测试示例

Windows PowerShell 5.1 建议发送 UTF-8 字节，避免中文请求体变成乱码：

```powershell
$headers = @{ Authorization = 'Bearer sk-tabbit-local' }
$body = @{ model = 'tabbit/priority'; input = '你是谁？现在实际命中了哪个模型？' } | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
(Invoke-WebRequest -Uri 'http://127.0.0.1:50124/v1/responses' -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes -UseBasicParsing).Content
```

模型列表：

```powershell
$headers = @{ Authorization = 'Bearer sk-tabbit-local' }
(Invoke-WebRequest -Uri 'http://127.0.0.1:50124/v1/models' -Headers $headers -UseBasicParsing).Content
```

## Codex Manager 接入示例

- Base URL: `http://127.0.0.1:50124/v1`
- Model: `tabbit/priority`
- API key: `sk-tabbit-local`

## Hermes Agent 接入示例

仓库内提供了示例配置：

- `hermes-home/config.yaml`

使用方式示例：

```powershell
$env:HERMES_HOME = (Resolve-Path .\hermes-home).Path
python path\to\hermes-agent\cli.py
```

请将 `path\to\hermes-agent\cli.py` 替换为你自己的 Hermes Agent 安装路径。

示例配置中的关键字段为：

- `provider: custom`
- `base_url: http://127.0.0.1:50124/v1`
- `api_key: sk-tabbit-local`
- `api_mode: codex_responses`
- `model: tabbit/priority`
- alias: `tabbit`

## 仓库边界

以下内容不属于开源仓库的一部分：

- `.lab/`
- `.lab-auth-verify/`
- `.lab-verify/`
- `node_modules/`
- `output/`

其中 `.lab*` 是本地浏览器运行时 profile 目录，包含本机状态，不会纳入仓库。

## 当前限制

- 这是本地桥接项目，不是托管服务
- 依赖本机可用的 Tabbit 登录状态
- 仅保证 OpenAI Responses 兼容接口
- 不承诺所有第三方客户端的私有扩展字段都可兼容

## Commit 规范

本项目使用 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)。

示例：

```text
feat: add priority route alias
fix: handle responses input array payload
docs: rewrite public setup guide
chore: initialize tabbit2api open source project
```

本地提交默认会通过 `commitlint` 和 `husky` 自动校验 commit message。

更多贡献约定见 `CONTRIBUTING.md`。
