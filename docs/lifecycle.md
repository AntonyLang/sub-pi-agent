# 数据与生命周期

[返回 README](../README.md)

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

