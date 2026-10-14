# sub-pi-agent

[![CI](https://github.com/AntonyLang/sub-pi-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/AntonyLang/sub-pi-agent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/sub-pi-agent)](https://www.npmjs.com/package/sub-pi-agent)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

把任务交给可复用的 [Pi](https://github.com/earendil-works/pi) agent，让主 agent 专注规划和审查。

独立的 stdio MCP 服务，适用于 Codex 和其他 MCP 客户端。支持命名 agent、跨 MCP 重启保留上下文、提问交回和运行中纠偏；等待由 MCP 处理，无需主模型反复轮询。无需 Codex App Server、桌面事件注入或专用启动器。

## 怎么用

例如，让 Pi 检查一个模块并运行相关测试，主 agent 同时处理其他工作。Pi 缺少信息时交回问题，主 agent 回答后继续同一个会话；任务完成后读取结果并审查，需要修改时也不用从头交代背景。

## 快速开始

需要 **Node.js ≥22.19.0**，以及已配置模型和认证的 Pi。尚未配置时，先按 [Pi 官方说明](https://github.com/earendil-works/pi)安装 CLI，运行 `pi`，用 `/login` 和 `/model` 完成配置。本服务内置 Pi SDK 1.2.0，读取同一套配置，不依赖全局 Pi CLI 执行任务。

### 1. 接入 Codex

把下面配置加到 `~/.codex/config.toml`，然后重新加载 MCP：

```toml
[mcp_servers.pi]
command = "npx"
args = ["-y", "sub-pi-agent@0.1.1"]
startup_timeout_sec = 120
tool_timeout_sec = 600
```

Windows 若无法启动 `npx`，将 command 改为 `"npx.cmd"`。[其他 MCP 客户端、源码安装及配置说明](https://github.com/AntonyLang/sub-pi-agent/blob/main/docs/configuration.md)。

### 2. 派发第一个任务

在客户端让主 agent 调用 `pi_spawn_agent`，传入下面的参数。将 `cwd` 替换为实际项目的绝对路径：

```json
{
  "name": "review-project",
  "description": "梳理项目结构和测试入口",
  "cwd": "/absolute/path/to/project",
  "task": "阅读项目说明，概括项目结构和测试入口。不要修改文件；缺少必要信息时交回问题。"
}
```

省略 `model` 使用该项目下的 Pi 默认模型。任务会调用模型，可能产生费用。

### 3. 等待并读取结果

保存返回的 `session_id`。有独立工作就继续做；没有时调用 `pi_wait_agent`，传入 `{"session_id":"<返回的 ID>"}`。

- `done`：调用 `pi_get_result` 读取交付并审查
- `needs_input`：调用 `pi_poll_agent` 读问题，再用同一 ID 调用 `pi_continue_agent`，将答案放在 `task` 中
- 等待超时：任务仍在运行，可以再次等待
- `error` / `interrupted`：用 `pi_get_result` 查看错误和部分结果

以上读取工具都使用同一个 `session_id`。任务结束后可用 `pi_release_agent` 卸载资源，之后仍能继续上下文。完整流程和参数见[工具参考](https://github.com/AntonyLang/sub-pi-agent/blob/main/docs/tools.md)；首次接入可按[冒烟测试](https://github.com/AntonyLang/sub-pi-agent/blob/main/docs/troubleshooting.md#接入冒烟测试)验证。

## 使用边界

- Pi 以启动 MCP 的本机用户权限访问文件和执行命令，**没有独立沙箱**；请只在可信项目中使用
- 会话和结果保存在本机，跨重启可恢复；**MCP 退出会中断执行**，需显式继续
- 没有反向实时通知，不会在上层聊天结束后自动唤醒主 agent

## 文档

- [安装与配置](https://github.com/AntonyLang/sub-pi-agent/blob/main/docs/configuration.md)：客户端接入、模型设置优先级
- [工具参考](https://github.com/AntonyLang/sub-pi-agent/blob/main/docs/tools.md)：11 个工具、状态、纠偏、提问与未读提醒
- [数据与生命周期](https://github.com/AntonyLang/sub-pi-agent/blob/main/docs/lifecycle.md)：存储目录、环境变量、恢复与权限
- [验证与排障](https://github.com/AntonyLang/sub-pi-agent/blob/main/docs/troubleshooting.md)：冒烟测试、常见错误和处理方法
- [开发与发布](https://github.com/AntonyLang/sub-pi-agent/blob/main/docs/development.md)：测试、打包和发布

## 来源与许可

基于 Courtney Andrew Richardson 的 [crichalchemist/agent-pi](https://github.com/crichalchemist/agent-pi) 1.8.0（`f3ac8c1`）修改，保留原版 [MIT LICENSE](LICENSE)。本版本增加持久化会话、提问交回、未读事件、等待与精简活动状态，并整理为独立 MCP/npm 入口。
