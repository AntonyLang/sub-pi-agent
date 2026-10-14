# 验证与排障

[返回 README](../README.md)

## 接入冒烟测试

`npx -y sub-pi-agent@0.1.1 --help` 只检查 CLI 入口，不能证明 MCP 连接、模型认证或任务执行正常。完成[客户端配置](configuration.md)后，在 MCP 客户端依次调用以下工具。

**下面的 spawn / continue 会调用你配置的真实模型，可能产生费用。** 使用可信的空目录，并把示例路径替换为本机存在的绝对路径。任务提示要求不操作文件，但这不是安全沙箱；权限边界见[数据与生命周期](lifecycle.md)。

1. 调用 `pi_list_models`，参数为 `{}`，确认能读取模型列表。
2. 调用 `pi_spawn_agent`：

   ```json
   {
     "name": "smoke-test",
     "cwd": "/absolute/path/to/empty-directory",
     "task": "不要调用工具，不要读取或修改文件。记住校验词 orchard-73，然后只回复 READY。"
   }
   ```

   保存返回的 `session_id`。省略 `model` 同时验证该目录下的默认模型配置；需要覆盖时，使用列表返回的完整 `key`。
3. 调用 `pi_wait_agent`，参数为 `{"session_id":"<返回的 ID>","timeout_ms":180000}`。若 `timed_out:true`，任务还在运行，可以再次等待；不要重复 spawn。若为 `needs_input`，用 poll 读问题并用同一 ID 的 continue 回答。
4. 状态为 `done` 时调用 `pi_get_result`，参数为 `{"session_id":"<返回的 ID>"}`，确认最终回复包含 `READY`。遇到 `error` / `interrupted` 时也读取结果，按错误信息排查。
5. 调用 `pi_release_agent`，参数仍为同一 ID，确认 `released:true,recoverable:true`。

如需验证持久化，可在 release 后重新加载 MCP，用 `pi_list_agents` 找到原 ID，再调用：

```json
{
  "session_id": "<原 ID>",
  "task": "不要调用工具，不要读取或修改文件。只回复上一轮让你记住的校验词。"
}
```

这是 `pi_continue_agent` 的参数，会再次调用模型。wait 后用 get_result 检查是否回复 `orchard-73`，最后 release。模型回复不符合预期时，应进一步检查结果和会话配置，不要仅凭一次文字偏差断定存储失败。

## 常见问题

| 现象或错误 | 检查与处理 |
|---|---|
| 客户端无法启动服务 | 检查 Node.js ≥22.19.0、客户端进程的 PATH；Windows 可将 command 改为 `npx.cmd`。首次下载较慢时增加启动超时 |
| npm 镜像找不到版本 | 对此次命令加 `--registry=https://registry.npmjs.org`，见[安装说明](configuration.md) |
| 等待时客户端超时 | 客户端工具超时应大于 `timeout_ms`；最长等待 300 秒，建议至少 330 秒，Codex 示例使用 600 秒 |
| `default_model_missing` | 有效设置缺少 `defaultProvider` 或 `defaultModel`；在 Pi 中选择默认模型，或显式传入模型 key |
| `default_model_unavailable` / `model_not_found` | 检查 provider 和完整模型 ID、Pi 本地模型配置；不存在的模型不会自动回退 |
| `settings_unreadable` | 检查全局及任务目录下的 settings.json 是否可读、JSON 是否有效；显式 model 不能绕过会话设置错误 |
| `model_registry_unavailable` | 本地模型目录刷新失败；检查 Pi 模型配置和文件访问权限，读取错误正文定位原因 |
| 模型认证或请求失败 | 检查同一 Pi 配置目录的认证、传给 MCP 的环境变量及 provider 返回的错误。模型出现在列表中不保证远端请求成功 |
| `invalid_status` | list 的运行状态筛选用 `active`，不是 `running` |
| `agent_busy` | 任务正在运行，或另一个 MCP 仍持有运行资源；等待结束，或在原 MCP 中按需 terminate 后 release，再继续 |
| `agent_not_found` | 检查 ID 和数据目录是否一致；只支持本 MCP 注册的 agent，不能传入任意 Pi CLI 会话 |
| `invalid_agent_path` / `invalid_agent_registration` | 会话路径或注册信息无效；检查数据目录和会话文件，不要通过手改租约或路径绕过保护 |
| followup 返回 `ok:false`，或 steer 被拒绝 | 仅支持当前 MCP 中正在运行的 agent；已结束、等待输入或已卸载时使用 continue |
| poll 的 output 一直不变 | Pi 可能正在思考或执行工具，查看 activity；时间戳不是心跳。无独立工作时使用 wait |
| `get_result` 返回 `ready:false` | 任务还在运行或等待输入；按 `next` 用 poll 读取进度或问题 |
| 重启后为 `interrupted` | 退出 MCP 会中断任务。先检查部分结果和文件状态，再用同一 ID 显式 continue；不会自动重跑命令 |

错误可能出现在工具返回的 `error` 中（字符串或序列化的结构化错误），也可能作为任务的 `status:"error"` 和部分回复返回。先读正文，不要把所有失败都当作 MCP 断连。

本地开发验证见[开发与发布](development.md)。其中集成测试使用本机假模型，不调用外部模型，与上述真实认证冒烟测试不同。
