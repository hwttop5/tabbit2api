# AGENTS.md

本文件是给 AI 编码代理看的项目维护说明。用户聊天中的明确指令优先级最高；其次遵循本文件；再参考 `README.md` 和 `CONTRIBUTING.md`。不要把这里的规则解释为运行时功能变更。

## Project Overview

- Tabbit2API 是本地运行的 Tabbit -> OpenAI / Anthropic 兼容网关。
- 它通过 Playwright 驱动本机已安装并已登录的 Tabbit 客户端，把 Tabbit Web Chat 能力封装为本地 HTTP / WebSocket 接口。
- 它不是官方 Tabbit API，也不是托管服务；默认只应作为单机本地桥接方案使用。
- 不要默认把网关暴露到公网，也不要把本地 `TABBIT_API_KEY` / `sk-tabbit-local` 解释为 Tabbit、OpenAI 或 Anthropic 官方密钥。

## Development Commands

- 安装依赖：`npm install`
- 启动网关：`npm start` 或 `node src/cli.js start`
- 刷新登录态：`npm run login` 或 `node src/cli.js login --refresh`
- 运行探测：`npm run probe`
- 运行测试：`npm test`
- 安装本地 git hooks：`npm run hooks:install`
- 打包检查：`npm pack --dry-run --json --registry=https://registry.npmjs.org`

## Architecture Notes

- 项目使用 Node.js ESM，`package.json` 中 `"type": "module"`。
- CLI 入口是 `src/cli.js`，命令行参数解析在 `src/cli-options.js`。
- HTTP 路由和兼容层调度主要在 `src/gateway-app.js`。
- Tabbit 页面桥接、模型目录和消息发送逻辑在 `src/tabbit-web-bridge.js` 及相关 session 模块中。
- 测试位于 `test/`，使用 Node 内置测试运行器 `node --test`。
- 示例客户端配置位于 `examples/`，用于 Codex、Claude Code、OpenClaw 和 Hermes Agent。

## API Compatibility Rules

- 现有兼容层包括 OpenAI Responses、Chat Completions、Assistants、文本版 Realtime WebSocket，以及 Anthropic Messages。
- 修改 `/v1/responses`、`/v1/chat/completions`、`/v1/assistants`、`/v1/threads`、`/v1/realtime`、`/v1/messages` 或 `/v1/models` 行为时，必须补充或更新回归测试。
- `tabbit/priority` 是公开推荐的虚拟模型别名；不要随意移除或改名。
- 新增公开 API 路径前，先确认 README、示例配置和测试是否需要同步更新。
- 保持 OpenAI 风格错误、Anthropic 风格错误、SSE 事件和 WebSocket 文本事件的兼容输出，不要为了内部实现简化而破坏客户端预期。

## Runtime and Security Boundaries

- 不要提交 `.lab*`、`node_modules/`、`output/` 或本地浏览器 profile / 登录态。
- 默认运行态目录应保持用户级目录策略；`TABBIT_LAB_ROOT`、`TABBIT_OUTPUT_DIR`、`TABBIT_EXECUTABLE` 和 `TABBIT_USER_DATA_DIR` 等覆盖变量应继续可用。
- 不要把本地认证 key 写入文档中的真实密钥示例；公开示例使用 `sk-tabbit-local`。
- 不要默认扩大监听地址、关闭鉴权或加入公网部署说明，除非用户明确要求并接受风险。
- `package.json.files` 是 npm 发布边界；不要因为新增仓库维护文件就把运行态、测试目录或本文件加入发布包。

## Testing and Verification

- 文档或维护规则变更后，至少运行 `npm test`。
- 影响发布边界、包元数据或示例文件时，运行 `npm pack --dry-run --json --registry=https://registry.npmjs.org`。
- 影响 CLI 启动、登录、profile、平台路径或 Playwright 桥接时，优先增加单元测试，再视需要做本地 `login` / `probe` / `/health` 验证。
- 测试失败时先定位原因，不要删除现有测试来适配实现。
- Windows 下读取中文 Markdown 时使用 UTF-8，例如 `Get-Content -Encoding UTF8 README.md`。

## Commit and Documentation Rules

- 提交信息使用 Conventional Commits，例如 `feat: add priority route alias`、`fix: improve responses stream compatibility`、`docs: update agent maintenance guide`。
- 本地提交会经过 `commitlint` 和 `husky` 校验；不要恢复 npm 生命周期 `prepare` 来自动安装 hooks。
- README 面向用户，优先保留安装、使用和 API 说明；AGENTS.md 面向 AI 代理和维护者，优先写执行规则。
- 修改 API、CLI、环境变量或客户端示例时，同步检查 README、`examples/` 和相关测试。
- 保持 `Tabbit2API` 作为文档展示名，保持 `tabbit2api` 作为包名和命令名。
