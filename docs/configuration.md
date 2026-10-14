# 安装与配置

[返回 README](../README.md)

需要 **Node.js ≥22.19.0**，以及已经配置模型和认证的 Pi。服务内置 Pi SDK 1.2.0，读取同一套 Pi 配置；不会调用另一个全局安装的 Pi CLI。尚未配置 Pi 时，先安装官方 Pi CLI，运行 `pi`，使用 `/login` 和 `/model` 完成配置。

```sh
npx -y sub-pi-agent@0.1.1 --help
```

### Codex

把下面配置加到 `~/.codex/config.toml`，然后重新加载 MCP：

```toml
[mcp_servers.pi]
command = "npx"
args = ["-y", "sub-pi-agent@0.1.1"]
startup_timeout_sec = 120
tool_timeout_sec = 600
```

Windows 如果客户端不能启动 `npx`，把 `command` 改成 `"npx.cmd"`。首次 npx 下载可能较慢；后续可使用全局安装，或直接运行源码目录里的 `node bin/cli.js`。

如果 npm 使用镜像源且新包尚未同步，可在参数中加入 `--registry=https://registry.npmjs.org`，例如 `npx -y --registry=https://registry.npmjs.org sub-pi-agent@0.1.1`；无需更改全局 npm 设置。

`tool_timeout_sec` 要大于最长等待时间。此处 600 秒覆盖 `pi_wait_agent` 最长 5 分钟。请在派发任务时显式传入项目的绝对 `cwd`，避免客户端启动 MCP 时的工作目录影响任务。

### 其他 MCP 客户端

```json
{
  "mcpServers": {
    "pi": {
      "command": "npx",
      "args": ["-y", "sub-pi-agent@0.1.1"]
    }
  }
}
```

在客户端中把工具调用超时设为至少 330 秒。服务只提供 stdio 传输。配置范例见 [examples](../examples)。

### 从 GitHub 源码或 Release 包安装

```sh
git clone https://github.com/AntonyLang/sub-pi-agent.git
cd sub-pi-agent
npm ci --ignore-scripts
node bin/cli.js --help
```

仓库包含编译产物；开发修改源码后运行 `npm run build`。GitHub Release 的 `.tgz` 与 npm 包使用同一份打包规则，可执行 `npm install -g ./sub-pi-agent-0.1.1.tgz --ignore-scripts` 安装。

## 模型与设置优先级

服务内置 Pi SDK，使用任务的 `cwd` 读取 Pi 原生设置。有效配置由两层合并：

1. 全局：`<Pi agent directory>/settings.json`，通常为 `~/.pi/agent/settings.json`。
2. 项目：`<cwd>/.pi/settings.json`，同名设置覆盖全局值。

每次 `pi_spawn_agent` / `pi_continue_agent` 都重新读取设置。继续旧会话时也使用当前设置；执行中的任务保留启动时的模型。

- 显式传入非空 `model: "provider/model-id"` 时，以它为准。模型 ID 可以包含 `/`，第一个 `/` 之前是 provider。
- 省略 `model` 时，使用合并后的 `defaultProvider` 和 `defaultModel`；默认值缺失或模型不可用会报错，不会自动换成其他模型。
- 显式 `model` 可以覆盖默认模型，但会话启动仍会读取设置并加载项目资源，不能绕过损坏的设置文件。
- thinking level 依次取该模型的设置、Pi 默认值；都未设置时使用 `medium`。

`pi_list_models` 没有 `cwd` 参数，按 **MCP 进程的工作目录**读取设置，并用 `enabledModels` 筛选可用模型。其目录可能与任务 `cwd` 不同；列表不能代替任务实际启动验证。`tier`（fast/balanced/frontier）由模型名称分类，不代表实测能力或价格。

Pi 的认证也由 SDK 读取。MCP 客户端启动服务时需能访问相同的 Pi 配置；使用环境变量认证时，变量也需要传给服务进程。不要把密钥写入提交到仓库的配置。

接入后请按[冒烟测试](troubleshooting.md#接入冒烟测试)验证实际任务；`--help` 只检查 CLI 入口。
