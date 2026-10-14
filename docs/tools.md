# 工具参考

[返回 README](../README.md)

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

模型与 thinking level 的选择见[安装与配置](configuration.md#模型与设置优先级)。

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
| `pi_followup_agent` | `session_id,message` | 仅向本 MCP 中正在运行的 agent 排队追加消息；当前工作结束后处理，返回 `ok` |
| `pi_terminate_agent` | `session_id` | 中断当前任务，保留会话；返回状态和最后的部分回复 |
| `pi_release_agent` | `session_id` | 卸载闲置运行资源，返回 `released,recoverable`；拒绝运行中的任务 |
| `pi_list_models` | `{}` | 返回 Pi 中可用模型与名称分类得到的 tier |

首版不提供 `pi_run_task`。所有任务通过持久化 agent 派发。

### 状态名称

运行中的同一 agent 在不同工具中使用两种名称：

- `pi_list_agents` 返回 `active`，筛选时也必须传 `{"status":"active"}`，不能传 `running`。
- `pi_spawn_agent`、`pi_continue_agent`、`pi_poll_agent`、`pi_wait_agent` 使用 `running`。
- 其余状态为 `needs_input`、`done`、`error`、`interrupted`。服务退出时仍在运行的任务变为 `interrupted`；恢复后需显式继续，不会自动重跑。
- `loaded` 表示运行资源是否仍被加载，与任务是否正在执行不同；已完成的 agent 也可能仍为 `loaded:true`。

### steer、followup 与 continue

| 当前情况 | 使用方式 |
|---|---|
| 正在本 MCP 中运行，需要纠偏 | `pi_steer_agent`；消息排队，在当前 assistant turn 的工具调用结束后交给 Pi |
| 正在本 MCP 中运行，希望做完再追加工作 | `pi_followup_agent`；当前工作全部结束后处理 |
| `needs_input` | 先 poll 读问题，再用同一 ID 调用 `pi_continue_agent`，把答案放在 `task` 中 |
| 已完成、失败、中断，或资源已卸载 | 用同一 ID 调用 `pi_continue_agent` 继续上下文 |

`steer` 和 `followup` 都只接受本 MCP 进程中正在运行的 agent。即使另一个 MCP 能列出或读取它，也不能从这里排队消息。非运行状态下，steer 返回 `status:"rejected"`，followup 返回 `ok:false`；它们不会重新启动任务。continue 拒绝运行中的任务。排队成功只代表 Pi 接受了消息，不代表已经执行或完成；仍需 wait/poll/get_result 确认。

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

