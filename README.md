# sub-pi-agent

[![CI](https://github.com/AntonyLang/sub-pi-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/AntonyLang/sub-pi-agent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/sub-pi-agent)](https://www.npmjs.com/package/sub-pi-agent)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A standalone stdio MCP server that delegates work to persistent [Pi](https://github.com/earendil-works/pi) agents. Works with Codex and other MCP clients. Keep planning in your main agent, reuse named Pi sessions, and wait without repeated model-driven polling.

普通 MCP 服务：上层负责规划和审查，Pi 执行任务。支持命名 agent、跨 MCP 重启保留上下文、提问交回、纠偏和有时限的等待。无需 Codex App Server、桌面事件注入或专用启动器。

## 安装与接入

需要 **Node.js ≥22.19.0**，以及已经配置模型和认证的 Pi。服务内置 Pi SDK 1.2.0，读取同一套 Pi 配置；不会调用另一个全局安装的 Pi CLI。尚未配置 Pi 时，先安装官方 Pi CLI，运行 `pi`，使用 `/login` 和 `/model` 完成配置。

```sh
npx -y sub-pi-agent@0.1.0 --help
```

### Codex

把下面配置加到 `~/.codex/config.toml`，然后重新加载 MCP：

```toml
[mcp_servers.pi]
command = "npx"
args = ["-y", "sub-pi-agent@0.1.0"]
startup_timeout_sec = 120
tool_timeout_sec = 600
```

Windows 如果客户端不能启动 `npx`，把 `command` 改成 `"npx.cmd"`。首次 npx 下载可能较慢；后续可使用全局安装，或直接运行源码目录里的 `node bin/cli.js`。

`tool_timeout_sec` 要大于最长等待时间。此处 600 秒覆盖 `pi_wait_agent` 最长 5 分钟。请在派发任务时显式传入项目的绝对 `cwd`，避免客户端启动 MCP 时的工作目录影响任务。

### 其他 MCP 客户端

```json
{
  "mcpServers": {
    "pi": {
      "command": "npx",
      "args": ["-y", "sub-pi-agent@0.1.0"]
    }
  }
}
```

在客户端中把工具调用超时设为至少 330 秒。服务只提供 stdio 传输。配置范例见 [examples](examples)。

### 从 GitHub 源码或 Release 包安装

```sh
git clone https://github.com/AntonyLang/sub-pi-agent.git
cd sub-pi-agent
npm ci --ignore-scripts
node bin/cli.js --help
```

仓库包含编译产物；开发修改源码后运行 `npm run build`。GitHub Release 的 `.tgz` 与 npm 包使用同一份打包规则，可执行 `npm install -g ./sub-pi-agent-0.1.0.tgz --ignore-scripts` 安装。

## 任务流程

1. `pi_list_agents` 查找可以复用的 agent；新任务可用 `pi_spawn_agent`。
2. 上层继续独立工作，在需要了解进度时调用 `pi_poll_agent`。
3. 没有其他工作时调用 `pi_wait_agent`，等待 Pi 交回问题或结束。
4. `needs_input`：`pi_poll_agent` 读取问题，再用**同一个 ID** 调用 `pi_continue_agent` 传入答案。
5. `done`：`pi_get_result` 读取最终交付；上层自行审查。需要进一步修改时继续同一个 ID。
6. 不再使用运行资源时 `pi_release_agent`。会话、结果和上下文仍可恢复。

例如新建任务的工具参数：

```json
{
  "name": "fix-validation",
  "description": "修正输入校验并验证相关行为",
  "cwd": "/absolute/path/to/project",
  "task": "检查输入校验问题，修复并运行相关测试。报告结论；如果缺少必要信息，交回问题。"
}
```

省略 `model` 就跟随当前 Pi 默认模型。可以指定 `provider/model-id` 覆盖。每次 spawn/continue 都重新读取 Pi 设置；执行中的任务保留启动时的模型。thinking level 使用 Pi 中该模型的设置，再使用 Pi 默认值；都未设置时使用 SDK 的 `medium`。

## 11 个工具

| 工具 | 输入 | 返回与用途 |
|---|---|---|
| `pi_spawn_agent` | `task`；可选 `cwd,name,description,model` | 新建任务；返回 `session_id,name,description,status` |
| `pi_continue_agent` | `session_id,task`；可选 `model` | 恢复或继续同一 agent，保留上下文；拒绝正在运行的任务 |
| `pi_poll_agent` | `session_id` | 立即读取 `status,output`、活动状态或待回答的问题 |
| `pi_wait_agent` | `session_id`；可选 `timeout_ms` | 等待可处理的状态，返回 `status,timed_out,next` |
| `pi_get_result` | `session_id` | 最终一条 Pi 文字回复；未就绪时返回 `ready:false,reason,next` |
| `pi_list_agents` | 可选 `status,cwd` | 返回 ID、名字、描述、状态、模型、目录及是否加载 |
| `pi_steer_agent` | `session_id,message` | 返回原文及 `queued/rejected`；排队成功不表示已经处理 |
| `pi_followup_agent` | `session_id,message` | 排队追加消息，当前工作结束后处理；返回 `ok` |
| `pi_terminate_agent` | `session_id` | 中断当前任务，保留会话；返回状态和最后的部分回复 |
| `pi_release_agent` | `session_id` | 卸载闲置运行资源，返回 `released,recoverable`；拒绝运行中的任务 |
| `pi_list_models` | `{}` | 返回 Pi 中可用模型与名称分类得到的 tier |

首版不提供 `pi_run_task`。所有任务通过持久化 agent 派发。

### 进度、等待与最终结果

`poll` 的 `output` 是最近一次显式文字回复。Pi 只思考或执行工具时，这段文字可能不变；`activity` 提供最新活动元数据，例如：

```json
{
  "status": "running",
  "output": "开始修改输入校验。",
  "activity": {
    "phase": "tool_running",
    "tool_name": "edit",
    "updated_at": 1791970000000
  }
}
```

`phase` 包括 `thinking,replying,calling_tool,tool_running,tool_finished`。工具结束时还可返回 `is_error`。时间戳是状态更新时间，不是持续刷新的心跳。不会附带原始推理、工具参数或执行记录。

`wait` **默认 180000 毫秒（3 分钟），最长 300000 毫秒（5 分钟）**。提问、完成、失败或中断时返回；活动变化不会提前唤醒。等待期间 MCP 程序检查状态，不调用上层模型。超时或取消只结束等待，Pi 继续运行。

```json
{"status":"done","timed_out":false,"next":"pi_get_result"}
```

`get_result` 不等待，不返回执行记录。任务失败时返回部分文字和 `error`；任务未结束时返回未就绪原因。上游模型失败不等于 MCP 连接失败。

### 提问与未读提醒

Pi 的系统提示词保留原生配置，并追加精简委派说明。遇到阻塞问题，Pi 调用内置 `ask_supervisor`，然后结束本轮；MCP 状态变为 `needs_input`。这个工具属于 Pi 内部，不额外暴露为 MCP 工具。

```json
{
  "status": "needs_input",
  "output": "需要确认目标分支。",
  "question": {"id":"question-id","text":"目标分支是什么？"},
  "next": "pi_continue_agent"
}
```

每个 MCP 工具返回都可能附带 `events`：包括 agent ID、名字、状态和 `next_tool`，不含正文。只提醒本连接创建、访问或列出的 agent；最多附带 10 条，多余数量在 `remaining_events` 中。

问题提醒在 poll 读取正文后确认已读；最终交付提醒在 get_result 读取后确认已读。list/wait 不消费正文或提醒。没有反向实时通知，也不会在上层聊天结束后自动唤醒它。

## 数据与生命周期

默认数据目录为 `<Pi agent directory>/mcp/sub-pi-agent/`，通常是 `~/.pi/agent/mcp/sub-pi-agent/`。目录位于用户配置下，不随 npx 更新、工作目录变化而改变。

| 环境变量 | 用途 |
|---|---|
| `PI_CODING_AGENT_DIR` | Pi 原生配置目录，包含模型设置和认证 |
| `PI_AGENTS_DIR` | 覆盖本 MCP 的私有 agent 注册目录 |
| `PI_STATUS_DIR` | 覆盖状态目录；未设 PI_AGENTS_DIR 时，注册目录为其下的 `agents/` |

agent 注册信息、最近回复、待回答问题和原生 Pi 会话保存在本机。只有本 MCP 注册创建的会话可恢复；不会导入任意 Pi CLI 会话。

- 跨 MCP 重启保留 ID、名字、描述、结果和上下文；恢复需显式调用 continue。
- 闲置 60 分钟自动卸载内存资源；运行中的任务不会因闲置回收而停止。
- release 只卸载，不永久删除上下文。
- MCP 退出会中断执行；不会自动重跑中断的命令。
- 同一 agent 使用进程租约；另一个 MCP 可以读取状态，但不能同时写入或继续已加载的会话。

Pi SDK 工具以启动 MCP 的本机用户身份访问文件和执行命令。MCP 没有单独的执行沙箱。客户端应按项目范围派发任务；Pi 读取项目指令和扩展配置。会话数据可能包含项目内容，保存在上述本地目录中。

## 开发与发布

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:integration
npm run check:package
npm pack
```

单元测试覆盖会话生命周期和工具契约；集成测试使用真实 Pi SDK、MCP 进程与本机假模型，不调用外部模型。CI 矩阵涵盖 Windows、Linux、macOS 的 Node 22.19 和 24。

npm 包仅包含 CLI、编译后的服务、许可、README 和接入范例；不包含配置、认证、会话或测试结果。维护者通过 npm 登录后手动执行 `npm publish --access public`。`v*` 标签触发 GitHub Release 打包，不自动发布 npm。

## 来源与许可

基于 Courtney Andrew Richardson 的 [crichalchemist/agent-pi](https://github.com/crichalchemist/agent-pi) 1.8.0（`f3ac8c1`）修改，保留原版 [MIT LICENSE](LICENSE)。本版本增加持久化会话、提问交回、未读事件、等待与精简活动状态，并整理为独立 MCP/npm 入口。
